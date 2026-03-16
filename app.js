import {
  auth, db, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, doc, setDoc, getDoc, collection, addDoc, getDocs, query, orderBy
} from "./firebase.js";

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

const COMPANY_SUGGESTIONS = ["Diamand","Teo","Coop de l'est","Coop de l'ouest","Coop Montreal","Hypra","Coop Laval","Uber","Lyft","iMove","Union Taxi"];
const DEFAULT_PAYMENT_METHODS = [{ name:"Cash", percentage:0 }, { name:"Carte", percentage:0 }];
const DAYS = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const AIRPORT_COMPANIES = ["diamand","teo"];
const DAY_TO_INDEX = { "Dimanche":0, "Lundi":1, "Mardi":2, "Mercredi":3, "Jeudi":4, "Vendredi":5, "Samedi":6 };

let authMode = "login";
let currentUser = null;
let profile = { driverName:"", dailyGoal:300, costPerKm:0.25, companies:[], paymentMethods:DEFAULT_PAYMENT_METHODS.slice(), vehicles:[], offDays:[], profileCompleted:false };
let trips = [];
let expenses = [];
let selectedPayment = "Cash";
let selectedTripType = "normal";
let working = false;
let workStart = null;
let dashboardCompanyFilter = "";
let statsCompanyFilter = "";

const $ = (id) => document.getElementById(id);
const normalize = (s) => String(s || "").trim().toLowerCase();
const companyNeedsAirport = (n) => AIRPORT_COMPANIES.includes(normalize(n));
const todayStr = () => new Date().toISOString().slice(0,10);
const monthStr = () => new Date().toISOString().slice(0,7);
const formatMoney = (n) => `${Math.round((Number(n)||0) * 100) / 100} $`;
const formatDateTime = (iso) => { const d = new Date(iso); return d.toLocaleDateString() + " " + d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}); };
function showAuthMessage(msg, err=false){ $("authMessage").textContent = msg || ""; $("authMessage").style.color = err ? "#ff8f8f" : "#b8b8b8"; }
function defaultCompany(name=""){ return { name, fee:0, weekStartDay:"Lundi", airport:false }; }
function defaultVehicle(name=""){ return { name, status:"propriétaire", active:false }; }
function escapeAttr(v){ return String(v ?? "").replace(/"/g, "&quot;"); }

function getWeekRangeForCompany(companyName){
  const company = (profile.companies || []).find(c => c.name === companyName) || (profile.companies || [])[0];
  const dayName = company?.weekStartDay || "Lundi";
  const target = DAY_TO_INDEX[dayName] ?? 1;
  const now = new Date();
  const start = new Date(now);
  const diff = (now.getDay() - target + 7) % 7;
  start.setDate(now.getDate() - diff);
  start.setHours(0,0,0,0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23,59,59,999);
  return { start, end, label:`${start.toLocaleDateString()} - ${end.toLocaleDateString()}`, company };
}
function inRange(iso, start, end){
  const d = new Date(iso);
  return d >= start && d <= end;
}
function isFeeAppliedThisWeek(companyName, start, end){
  return trips.some(t => t.company === companyName && t.weeklyCompanyFeeApplied === true && inRange(t.date, start, end));
}
function filteredTripsByCompany(name){ return name ? trips.filter(t => t.company === name) : trips; }

window.switchAuthMode = function(mode){
  authMode = mode;
  $("tabLogin").classList.toggle("active", mode === "login");
  $("tabRegister").classList.toggle("active", mode === "register");
  $("registerFields").classList.toggle("hidden", mode !== "register");
  $("loginFields").classList.toggle("hidden", mode !== "login");
  showAuthMessage("");
};

window.handleAuth = async function(){
  try{
    if(authMode === "register"){
      const driverName = $("loginName").value.trim();
      const email = $("loginEmail").value.trim();
      const password = $("loginPassword").value;
      if(!driverName || !email || !password) return showAuthMessage("Entre le nom, l'email et le mot de passe.", true);
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, "drivers", cred.user.uid), {
        driverName, dailyGoal:300, costPerKm:0.25, companies:[], paymentMethods:DEFAULT_PAYMENT_METHODS,
        vehicles:[], offDays:[], profileCompleted:false, email, createdAt:new Date().toISOString()
      }, { merge:true });
    } else {
      const email = $("signinEmail").value.trim();
      const password = $("signinPassword").value;
      if(!email || !password) return showAuthMessage("Entre l'email et le mot de passe.", true);
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch(e){ showAuthMessage(e.message, true); }
};

window.logoutUser = async function(){ await signOut(auth); };
window.toggleSidebar = function(){ $("sidebar").classList.toggle("open"); $("overlay").classList.toggle("hidden"); };
window.openPage = function(id){
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  $(id).classList.add("active");
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  const nav = $("nav-" + id); if(nav) nav.classList.add("active");
  if(id === "history") renderTrips();
  if(id === "expenses") renderExpenses();
  if(id === "stats") refreshStatsByCompany();
  if(id === "settings") renderSettingsSummary();
};

window.setTripType = function(type){
  selectedTripType = type;
  $("tripNormalBtn").classList.toggle("active", type === "normal");
  $("tripAirportBtn").classList.toggle("active", type === "airport");
};

function buildSuggestions(){
  const wrap = $("companySuggestions"); wrap.innerHTML = "";
  COMPANY_SUGGESTIONS.forEach(name => {
    const btn = document.createElement("button");
    btn.className = "chip"; btn.textContent = name; btn.onclick = () => addSuggestedCompany(name);
    wrap.appendChild(btn);
  });
}
window.addSuggestedCompany = function(name){
  if(!(profile.companies || []).some(c => normalize(c.name) === normalize(name))){
    profile.companies.push(defaultCompany(name)); renderCompanies(); renderCompanySelect(); renderCompanyFilters();
  }
};
window.addCompanyRow = function(){ profile.companies.push(defaultCompany("")); renderCompanies(); };
window.addPaymentMethodRow = function(){ profile.paymentMethods.push({ name:"", percentage:0 }); renderPaymentMethods(); };
window.addVehicleRow = function(){ profile.vehicles.push(defaultVehicle("")); renderVehicles(); };

function renderCompanies(){
  $("companiesContainer").innerHTML = (profile.companies || []).map((company, i) => `
    <div class="repeat-card">
      <label>Nom de la compagnie</label>
      <input value="${escapeAttr(company.name)}" oninput="updateCompanyName(${i}, this.value)" placeholder="Ex: Diamand" />
      <div class="inline-three">
        <div>
          <label>Frais compagnie / semaine ($)</label>
          <input type="number" value="${Number(company.fee || 0)}" oninput="updateCompanyFee(${i}, this.value)" placeholder="0" />
        </div>
        <div>
          <label>Début de semaine</label>
          <select onchange="updateCompanyWeekStart(${i}, this.value)">
            ${DAYS.map(d => `<option value="${d}" ${company.weekStartDay === d ? "selected" : ""}>${d}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>Travail à l'aéroport</label>
          <select onchange="updateCompanyAirport(${i}, this.value)">
            <option value="non" ${company.airport ? "" : "selected"}>Non</option>
            <option value="oui" ${company.airport ? "selected" : ""}>Oui</option>
          </select>
        </div>
      </div>
      ${companyNeedsAirport(company.name) ? '<p class="muted">Pour cette compagnie, les courses aéroport auront 5.75$ de frais.</p>' : ""}
      <button class="remove-btn" onclick="removeCompany(${i})">Retirer</button>
    </div>
  `).join("");
}
function renderPaymentMethods(){
  $("paymentMethodsContainer").innerHTML = (profile.paymentMethods || []).map((method, i) => `
    <div class="repeat-card">
      <div class="inline-two">
        <div>
          <label>Méthode</label>
          <input value="${escapeAttr(method.name)}" oninput="updatePaymentName(${i}, this.value)" placeholder="Cash / Carte / Uber..." />
        </div>
        <div>
          <label>Pourcentage (%)</label>
          <input type="number" value="${Number(method.percentage || 0)}" oninput="updatePaymentPercentage(${i}, this.value)" placeholder="0" />
        </div>
      </div>
      <button class="remove-btn" onclick="removePaymentMethod(${i})">Retirer</button>
    </div>
  `).join("");
}
function renderVehicles(){
  $("vehiclesContainer").innerHTML = (profile.vehicles || []).map((vehicle, i) => `
    <div class="repeat-card">
      <label>Nom du véhicule</label>
      <input value="${escapeAttr(vehicle.name)}" oninput="updateVehicleName(${i}, this.value)" placeholder="Toyota Sienna 2025" />
      <div class="inline-two">
        <div>
          <label>Statut</label>
          <select onchange="updateVehicleStatus(${i}, this.value)">
            <option value="propriétaire" ${vehicle.status === "propriétaire" ? "selected" : ""}>Propriétaire</option>
            <option value="loué" ${vehicle.status === "loué" ? "selected" : ""}>Loué</option>
          </select>
        </div>
        <div>
          <label>Véhicule actuel</label>
          <select onchange="setActiveVehicle(${i}, this.value)">
            <option value="non" ${vehicle.active ? "" : "selected"}>Non</option>
            <option value="oui" ${vehicle.active ? "selected" : ""}>Oui</option>
          </select>
        </div>
      </div>
      <button class="remove-btn" onclick="removeVehicle(${i})">Retirer</button>
    </div>
  `).join("");
}
function renderOffDays(){
  $("offDaysContainer").innerHTML = DAYS.map(day => `
    <label class="day-option">
      <input type="checkbox" ${profile.offDays.includes(day) ? "checked" : ""} onchange="toggleOffDay('${day}', this.checked)" />
      <span>${day}</span>
    </label>
  `).join("");
}
function renderOnboarding(){
  $("profileDriverName").value = profile.driverName || "";
  $("profileDailyGoal").value = Number(profile.dailyGoal ?? 300);
  $("profileCostPerKm").value = Number(profile.costPerKm ?? 0.25);
  renderCompanies(); renderPaymentMethods(); renderVehicles(); renderOffDays();
}

window.updateCompanyName = (i, value) => { profile.companies[i].name = value; renderCompanies(); renderCompanySelect(); renderCompanyFilters(); };
window.updateCompanyFee = (i, value) => { profile.companies[i].fee = Number(value || 0); };
window.updateCompanyWeekStart = (i, value) => { profile.companies[i].weekStartDay = value; renderCompanyFilters(); };
window.updateCompanyAirport = (i, value) => { profile.companies[i].airport = value === "oui"; };
window.removeCompany = (i) => { profile.companies.splice(i, 1); renderCompanies(); renderCompanySelect(); renderCompanyFilters(); };
window.updatePaymentName = (i, value) => { profile.paymentMethods[i].name = value; renderPaymentMethods(); renderPaymentButtons(); };
window.updatePaymentPercentage = (i, value) => { profile.paymentMethods[i].percentage = Number(value || 0); };
window.removePaymentMethod = (i) => { profile.paymentMethods.splice(i, 1); renderPaymentMethods(); renderPaymentButtons(); };
window.updateVehicleName = (i, value) => { profile.vehicles[i].name = value; };
window.updateVehicleStatus = (i, value) => { profile.vehicles[i].status = value; };
window.setActiveVehicle = (i, value) => { profile.vehicles = profile.vehicles.map((v, idx) => ({ ...v, active: idx === i && value === "oui" })); renderVehicles(); refreshDashboardHeader(); };
window.removeVehicle = (i) => { profile.vehicles.splice(i, 1); renderVehicles(); refreshDashboardHeader(); };
window.toggleOffDay = (day, checked) => {
  if(checked && !profile.offDays.includes(day)) profile.offDays.push(day);
  if(!checked) profile.offDays = profile.offDays.filter(d => d !== day);
};

function cleanProfileBeforeSave(){
  profile.driverName = $("profileDriverName").value.trim();
  profile.dailyGoal = Number($("profileDailyGoal").value || 0);
  profile.costPerKm = Number($("profileCostPerKm").value || 0);
  profile.companies = (profile.companies || []).filter(c => String(c.name || "").trim()).map(c => ({
    name:String(c.name).trim(), fee:Number(c.fee || 0), weekStartDay:c.weekStartDay || "Lundi", airport:!!c.airport
  }));
  profile.paymentMethods = (profile.paymentMethods || []).filter(p => String(p.name || "").trim()).map(p => ({
    name:String(p.name).trim(), percentage:Number(p.percentage || 0)
  }));
  profile.vehicles = (profile.vehicles || []).filter(v => String(v.name || "").trim()).map(v => ({
    name:String(v.name).trim(), status:v.status || "propriétaire", active:!!v.active
  }));
  if(!profile.paymentMethods.length) profile.paymentMethods = DEFAULT_PAYMENT_METHODS.slice();
  profile.profileCompleted = true;
}
window.saveOnboarding = async function(){
  if(!currentUser) return;
  cleanProfileBeforeSave();
  if(!profile.driverName) return alert("Entre le nom du chauffeur.");
  await setDoc(doc(db, "drivers", currentUser.uid), profile, { merge:true });
  renderPaymentButtons(); renderCompanySelect(); renderCompanyFilters(); renderSettingsSummary(); refreshDashboardHeader(); refreshAll();
  $("onboardingPage").classList.add("hidden"); $("appPage").classList.remove("hidden");
};
window.openOnboardingForEdit = function(){ renderOnboarding(); $("appPage").classList.add("hidden"); $("onboardingPage").classList.remove("hidden"); };

function renderPaymentButtons(){
  const wrap = $("paymentButtons");
  wrap.innerHTML = "";
  const methods = (profile.paymentMethods || []).length ? profile.paymentMethods : DEFAULT_PAYMENT_METHODS.slice();
  methods.forEach((m, idx) => {
    const btn = document.createElement("button");
    btn.className = "seg" + ((selectedPayment === m.name || (!selectedPayment && idx === 0)) ? " active" : "");
    btn.textContent = m.name || `Méthode ${idx+1}`;
    btn.onclick = () => setPaymentMethod(m.name);
    wrap.appendChild(btn);
  });
  if(!methods.find(m => m.name === selectedPayment)) selectedPayment = methods[0].name;
  setPaymentMethod(selectedPayment);
}
function setPaymentMethod(name){
  selectedPayment = name;
  [...$("paymentButtons").children].forEach(btn => btn.classList.toggle("active", btn.textContent === name));
}
function renderCompanySelect(){
  const select = $("tripCompany");
  select.innerHTML = "";
  (profile.companies || []).forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.name; opt.textContent = c.name;
    select.appendChild(opt);
  });
  if(!(profile.companies || []).length){
    const opt = document.createElement("option");
    opt.value = ""; opt.textContent = "Aucune compagnie";
    select.appendChild(opt);
  }
  select.onchange = refreshTripAirportArea;
  refreshTripAirportArea();
}
function renderCompanyFilters(){
  const companies = profile.companies || [];
  const ids = ["dashboardCompanyFilter","statsCompanyFilter"];
  ids.forEach(id => {
    const select = $(id);
    if(!select) return;
    select.innerHTML = "";
    companies.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.name; opt.textContent = c.name;
      select.appendChild(opt);
    });
  });
  if(companies.length){
    if(!companies.find(c => c.name === dashboardCompanyFilter)) dashboardCompanyFilter = companies[0].name;
    if(!companies.find(c => c.name === statsCompanyFilter)) statsCompanyFilter = companies[0].name;
    $("dashboardCompanyFilter").value = dashboardCompanyFilter;
    $("statsCompanyFilter").value = statsCompanyFilter;
  }
  $("dashboardCompanyFilter").onchange = (e) => { dashboardCompanyFilter = e.target.value; renderCompanyWeekSummary(); refreshDashboardWeekOnly(); };
  $("statsCompanyFilter").onchange = (e) => { statsCompanyFilter = e.target.value; refreshStatsByCompany(); };
}
function selectedCompanyObj(){ return (profile.companies || []).find(c => c.name === $("tripCompany").value) || null; }
function refreshTripAirportArea(){
  const company = selectedCompanyObj();
  const show = company && companyNeedsAirport(company.name) && company.airport;
  $("tripAirportArea").classList.toggle("hidden", !show);
  if(!show) selectedTripType = "normal";
  setTripType(selectedTripType);
}
function activeVehicleName(){ const active = (profile.vehicles || []).find(v => v.active); return active ? active.name : ((profile.vehicles || [])[0]?.name || "Votre véhicule"); }
function mainCompanyName(){ return (profile.companies || [])[0]?.name || "Compagnie"; }
function refreshDashboardHeader(){
  $("driverNameDisplay").textContent = profile.driverName || "Chauffeur";
  $("sideDriverName").textContent = profile.driverName || "Chauffeur";
  $("vehicleName").textContent = activeVehicleName();
  $("mainCompanyChip").textContent = mainCompanyName();
}
function renderSettingsSummary(){
  const companies = (profile.companies || []).map(c => `${c.name} (${c.fee}$ / semaine, débute ${c.weekStartDay}${c.airport ? ", aéroport" : ""})`).join(", ") || "Aucune";
  const methods = (profile.paymentMethods || []).map(p => `${p.name} ${p.percentage}%`).join(", ") || "Aucune";
  const vehicles = (profile.vehicles || []).map(v => `${v.name} (${v.status}${v.active ? ", actuel" : ""})`).join(", ") || "Aucun";
  const offDays = (profile.offDays || []).join(", ") || "Aucun";
  $("settingsSummary").innerHTML = `
    <div class="summary-box"><strong>Objectif/jour :</strong> ${formatMoney(profile.dailyGoal || 0)}</div>
    <div class="summary-box"><strong>Compagnies :</strong> ${companies}</div>
    <div class="summary-box"><strong>Méthodes :</strong> ${methods}</div>
    <div class="summary-box"><strong>Véhicules :</strong> ${vehicles}</div>
    <div class="summary-box"><strong>Jours de repos :</strong> ${offDays}</div>
  `;
}

window.toggleWork = function(){
  working = !working;
  const btn = $("workBtn");
  if(working){ workStart = new Date(); btn.textContent = "⏹ Fin travail"; }
  else { const hours = workStart ? ((new Date() - workStart)/3600000) : 0; $("todayTime").textContent = `${hours.toFixed(1)}h`; btn.textContent = "▶ Commencer travail"; }
};

window.saveTrip = async function(){
  if(!currentUser) return;
  const amount = Number($("amount").value || 0);
  const km = Number($("tripKm").value || 0);
  const note = $("tripNote").value || "";
  const company = $("tripCompany").value || "";
  if(!amount) return alert("Entrer un montant");

  const companyObj = (profile.companies || []).find(c => c.name === company) || null;
  const paymentMethod = (profile.paymentMethods || []).find(m => m.name === selectedPayment) || { percentage:0 };
  const paymentFee = amount * (Number(paymentMethod.percentage || 0) / 100);
  const airportFee = companyObj && companyNeedsAirport(companyObj.name) && companyObj.airport && selectedTripType === "airport" ? 5.75 : 0;

  let weeklyCompanyFee = 0;
  let weeklyCompanyFeeApplied = false;
  if(companyObj){
    const range = getWeekRangeForCompany(companyObj.name);
    if(!isFeeAppliedThisWeek(companyObj.name, range.start, range.end)){
      weeklyCompanyFee = Number(companyObj.fee || 0);
      weeklyCompanyFeeApplied = weeklyCompanyFee > 0;
    }
  }

  await addDoc(collection(db, "drivers", currentUser.uid, "trips"), {
    amount, km, note, company, payment:selectedPayment,
    paymentPercentage:Number(paymentMethod.percentage || 0),
    paymentFee, weeklyCompanyFee, weeklyCompanyFeeApplied, airportFee,
    tripType:selectedTripType, date:new Date().toISOString()
  });

  $("amount").value = ""; $("tripKm").value = ""; $("tripNote").value = "";
  selectedTripType = "normal"; setTripType("normal");
  await loadTrips(currentUser.uid);
  refreshAll();
  openPage("dashboard");
};

window.openExpenseModal = function(){ $("expenseModal").classList.remove("hidden"); };
window.closeExpenseModal = function(){ $("expenseModal").classList.add("hidden"); };
window.saveExpense = async function(){
  if(!currentUser) return;
  const amount = Number($("expenseAmount").value || 0);
  const category = $("expenseCategory").value;
  const note = $("expenseNote").value || "";
  if(!amount) return alert("Entrer un montant");
  await addDoc(collection(db, "drivers", currentUser.uid, "expenses"), { amount, category, note, date:new Date().toISOString() });
  $("expenseAmount").value = ""; $("expenseNote").value = ""; closeExpenseModal();
  await loadExpenses(currentUser.uid); refreshAll(); openPage("expenses");
};

async function loadProfile(uid){
  const snap = await getDoc(doc(db, "drivers", uid));
  if(snap.exists()){
    const data = snap.data();
    profile = {
      driverName:data.driverName || "", dailyGoal:Number(data.dailyGoal ?? 300), costPerKm:Number(data.costPerKm ?? 0.25),
      companies:Array.isArray(data.companies) ? data.companies.map(c => ({ name:c.name || "", fee:Number(c.fee || 0), weekStartDay:c.weekStartDay || "Lundi", airport:!!c.airport })) : [],
      paymentMethods:Array.isArray(data.paymentMethods) && data.paymentMethods.length ? data.paymentMethods : DEFAULT_PAYMENT_METHODS.slice(),
      vehicles:Array.isArray(data.vehicles) ? data.vehicles : [], offDays:Array.isArray(data.offDays) ? data.offDays : [],
      profileCompleted:!!data.profileCompleted
    };
  }
}
async function loadTrips(uid){
  const q = query(collection(db, "drivers", uid, "trips"), orderBy("date", "desc"));
  const snap = await getDocs(q); trips = snap.docs.map(d => ({ id:d.id, ...d.data() }));
}
async function loadExpenses(uid){
  const q = query(collection(db, "drivers", uid, "expenses"), orderBy("date", "desc"));
  const snap = await getDocs(q); expenses = snap.docs.map(d => ({ id:d.id, ...d.data() }));
}

function renderTrips(){
  const list = $("tripList"); list.innerHTML = "";
  trips.forEach(t => {
    const details = [t.payment || "", `${t.km || 0} km`, t.company || ""].filter(Boolean).join(" • ");
    const extras = [];
    if(t.weeklyCompanyFeeApplied) extras.push(`frais semaine ${formatMoney(t.weeklyCompanyFee)}`);
    if(Number(t.airportFee || 0) > 0) extras.push(`aéroport ${formatMoney(t.airportFee)}`);
    if(Number(t.paymentFee || 0) > 0) extras.push(`paiement ${formatMoney(t.paymentFee)}`);
    const info = [details, ...extras].filter(Boolean).join(" • ");
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `<div class="left"><strong>${formatMoney(t.amount)}</strong><span>${info || "Course"}</span></div><div class="right">${formatDateTime(t.date)}</div>`;
    list.appendChild(item);
  });
  if(!trips.length) list.innerHTML = '<div class="panel">Aucune course pour le moment.</div>';
}
function renderExpenses(){
  const list = $("expenseList"); list.innerHTML = "";
  expenses.forEach(e => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `<div class="left"><strong>${formatMoney(e.amount)}</strong><span>${e.category}${e.note ? " • " + e.note : ""}</span></div><div class="right">${formatDateTime(e.date)}</div>`;
    list.appendChild(item);
  });
  if(!expenses.length) list.innerHTML = '<div class="panel">Aucune dépense pour le moment.</div>';
}

function renderCompanyWeekSummary(){
  const companyName = dashboardCompanyFilter || (profile.companies || [])[0]?.name || "";
  const el = $("companyWeekSummary");
  if(!companyName){
    $("currentWeekRange").textContent = "-";
    el.innerHTML = '<div class="summary-box">Ajoute une compagnie pour suivre la semaine.</div>';
    return;
  }
  const { start, end, label, company } = getWeekRangeForCompany(companyName);
  $("currentWeekRange").textContent = label;
  const weekTrips = trips.filter(t => t.company === companyName && inRange(t.date, start, end));
  const gross = weekTrips.reduce((a,b)=>a+Number(b.amount||0),0);
  const paymentFees = weekTrips.reduce((a,b)=>a+Number(b.paymentFee||0),0);
  const airportFees = weekTrips.reduce((a,b)=>a+Number(b.airportFee||0),0);
  const companyWeeklyFee = weekTrips.reduce((a,b)=>a+Number(b.weeklyCompanyFee||0),0);
  const netBeforeExpenses = gross - paymentFees - airportFees - companyWeeklyFee;
  el.innerHTML = `
    <div class="summary-box"><strong>${company.name}</strong> • début de semaine : ${company.weekStartDay}</div>
    <div class="summary-box"><strong>Revenu semaine :</strong> ${formatMoney(gross)}</div>
    <div class="summary-box"><strong>Frais paiement :</strong> ${formatMoney(paymentFees)}</div>
    <div class="summary-box"><strong>Frais aéroport :</strong> ${formatMoney(airportFees)}</div>
    <div class="summary-box"><strong>Frais compagnie appliqués :</strong> ${formatMoney(companyWeeklyFee)}</div>
    <div class="summary-box"><strong>Net semaine avant dépenses :</strong> ${formatMoney(netBeforeExpenses)}</div>
  `;
}
function refreshDashboardWeekOnly(){
  const companyName = dashboardCompanyFilter || (profile.companies || [])[0]?.name || "";
  if(!companyName){ $("weekTotal").textContent = formatMoney(0); return; }
  const { start, end } = getWeekRangeForCompany(companyName);
  const weekTrips = trips.filter(t => t.company === companyName && inRange(t.date, start, end));
  const weekTotal = weekTrips.reduce((a,b)=>a+Number(b.amount||0),0);
  $("weekTotal").textContent = formatMoney(weekTotal);
  renderCompanyWeekSummary();
}

function refreshStatsByCompany(){
  const companyName = statsCompanyFilter || (profile.companies || [])[0]?.name || "";
  const companyTrips = filteredTripsByCompany(companyName);
  const month = monthStr();

  const { start, end } = companyName ? getWeekRangeForCompany(companyName) : { start:new Date(), end:new Date() };
  const weekTrips = companyTrips.filter(t => inRange(t.date, start, end));
  const monthTrips = companyTrips.filter(t => String(t.date).slice(0,7) === month);

  const weekTotal = weekTrips.reduce((a,b)=>a+Number(b.amount||0),0);
  const monthTotal = monthTrips.reduce((a,b)=>a+Number(b.amount||0),0);
  const monthKm = monthTrips.reduce((a,b)=>a+Number(b.km||0),0);
  const avgTrip = companyTrips.length ? monthTotal / monthTrips.length || 0 : 0;
  const paymentFees = companyTrips.reduce((a,b)=>a+Number(b.paymentFee||0),0);
  const airportFees = companyTrips.reduce((a,b)=>a+Number(b.airportFee||0),0);
  const companyFees = companyTrips.reduce((a,b)=>a+Number(b.weeklyCompanyFee||0),0);
  const net = monthTotal - paymentFees - airportFees - companyFees;

  $("weekTotal").textContent = formatMoney(weekTotal);
  $("monthTotal").textContent = formatMoney(monthTotal);
  $("avgTrip").textContent = formatMoney(avgTrip);
  $("monthKm").textContent = Math.round(monthKm * 10) / 10;
  $("statsPaymentFees").textContent = formatMoney(paymentFees);
  $("statsAirportFees").textContent = formatMoney(airportFees);
  $("statsCompanyFees").textContent = formatMoney(companyFees);
  $("statsNet").textContent = formatMoney(net);

  drawWeeklyChart(companyName);
}

function refreshAll(){
  const today = todayStr();
  const month = monthStr();
  const todayTrips = trips.filter(t => String(t.date).slice(0,10) === today);
  const todayExpenses = expenses.filter(e => String(e.date).slice(0,10) === today);

  const income = todayTrips.reduce((a,b)=>a+Number(b.amount||0),0);
  const tripCount = todayTrips.length;
  const km = todayTrips.reduce((a,b)=>a+Number(b.km||0),0);
  const cash = todayTrips.filter(t=>t.payment==="Cash").reduce((a,b)=>a+Number(b.amount||0),0);
  const card = todayTrips.filter(t=>t.payment==="Carte").reduce((a,b)=>a+Number(b.amount||0),0);
  const expense = todayExpenses.reduce((a,b)=>a+Number(b.amount||0),0);
  const tripFees = todayTrips.reduce((a,b)=>a+Number(b.paymentFee||0)+Number(b.weeklyCompanyFee||0)+Number(b.airportFee||0),0);
  const profit = income - expense - tripFees - (km * Number(profile.costPerKm || 0));

  $("todayIncome").textContent = formatMoney(income);
  $("todayTrips").textContent = tripCount;
  $("todayKm").textContent = Math.round(km * 10) / 10;
  $("cashTotal").textContent = formatMoney(cash);
  $("cardTotal").textContent = formatMoney(card);
  $("expenseTotal").textContent = formatMoney(expense);
  $("profitTotal").textContent = formatMoney(profit);

  refreshDashboardWeekOnly();
  renderTrips(); renderExpenses(); refreshStatsByCompany();
}

function drawWeeklyChart(companyName=""){
  const canvas = $("weeklyChart"); if(!canvas) return;
  const ctx = canvas.getContext("2d");
  const cw = canvas.clientWidth, ch = 170;
  canvas.width = cw * devicePixelRatio; canvas.height = ch * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio); ctx.clearRect(0,0,cw,ch);

  const dates = [];
  for(let i=6;i>=0;i--){ const d = new Date(); d.setDate(d.getDate()-i); dates.push(d.toISOString().slice(0,10)); }
  const sourceTrips = companyName ? trips.filter(t => t.company === companyName) : trips;
  const values = dates.map(d => sourceTrips.filter(t => String(t.date).slice(0,10) === d).reduce((a,b)=>a+Number(b.amount||0),0));
  const max = Math.max(...values, 1), padding = 16, step = (cw - padding*2) / values.length, barW = step * 0.58;

  values.forEach((v,i) => {
    const x = padding + i*step + (step-barW)/2;
    const h = (v/max) * (ch-42), y = ch - 24 - h;
    ctx.fillStyle = "#f7c948";
    roundRect(ctx, x, y, barW, h, 10, true, false);
    ctx.fillStyle = "#cfcfcf"; ctx.font = "11px Arial"; ctx.textAlign = "center";
    const dd = new Date(dates[i]); const label = dd.toLocaleDateString("fr-CA", {weekday:"short"}).slice(0,3);
    ctx.fillText(label, x + barW/2, ch - 7);
  });
}
function roundRect(ctx, x, y, width, height, radius, fill, stroke){
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  if(fill) ctx.fill();
  if(stroke) ctx.stroke();
}

window.exportData = function(){
  const data = { profile, trips, expenses };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "taxi-driver-pro-data.json";
  a.click();
  URL.revokeObjectURL(a.href);
};

window.addEventListener("resize", () => { if($("stats").classList.contains("active")) refreshStatsByCompany(); });

async function loadProfile(uid){
  const snap = await getDoc(doc(db, "drivers", uid));
  if(snap.exists()){
    const data = snap.data();
    profile = {
      driverName:data.driverName || "", dailyGoal:Number(data.dailyGoal ?? 300), costPerKm:Number(data.costPerKm ?? 0.25),
      companies:Array.isArray(data.companies) ? data.companies.map(c => ({ name:c.name || "", fee:Number(c.fee || 0), weekStartDay:c.weekStartDay || "Lundi", airport:!!c.airport })) : [],
      paymentMethods:Array.isArray(data.paymentMethods) && data.paymentMethods.length ? data.paymentMethods : DEFAULT_PAYMENT_METHODS.slice(),
      vehicles:Array.isArray(data.vehicles) ? data.vehicles : [], offDays:Array.isArray(data.offDays) ? data.offDays : [],
      profileCompleted:!!data.profileCompleted
    };
  }
}
async function loadTrips(uid){
  const q = query(collection(db, "drivers", uid, "trips"), orderBy("date", "desc"));
  const snap = await getDocs(q); trips = snap.docs.map(d => ({ id:d.id, ...d.data() }));
}
async function loadExpenses(uid){
  const q = query(collection(db, "drivers", uid, "expenses"), orderBy("date", "desc"));
  const snap = await getDocs(q); expenses = snap.docs.map(d => ({ id:d.id, ...d.data() }));
}

switchAuthMode("login");
setTripType("normal");

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if(user){
    await Promise.all([loadProfile(user.uid), loadTrips(user.uid), loadExpenses(user.uid)]);
    buildSuggestions(); renderOnboarding(); renderPaymentButtons(); renderCompanySelect(); renderCompanyFilters(); renderSettingsSummary(); refreshDashboardHeader(); refreshAll();
    $("loginPage").classList.add("hidden");
    if(profile.profileCompleted){ $("appPage").classList.remove("hidden"); $("onboardingPage").classList.add("hidden"); }
    else { $("onboardingPage").classList.remove("hidden"); $("appPage").classList.add("hidden"); }
  } else {
    $("loginPage").classList.remove("hidden"); $("onboardingPage").classList.add("hidden"); $("appPage").classList.add("hidden");
  }
});
