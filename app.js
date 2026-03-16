import {
  auth, db, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, doc, setDoc, getDoc, collection, addDoc, getDocs, query, orderBy
} from "./firebase.js";

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");

const COMPANY_SUGGESTIONS = [
  "Diamand","Teo","Coop de l'est","Coop de l'ouest","Coop Montreal",
  "Hypra","Coop Laval","Uber","Lyft","iMove","Union Taxi"
];
const DEFAULT_PAYMENT_METHODS = [
  { name: "Cash", percentage: 0 },
  { name: "Carte", percentage: 0 }
];
const DAYS = ["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];
const AIRPORT_COMPANIES = ["diamand","teo"];

let authMode = "login";
let currentUser = null;
let profile = {
  driverName: "",
  dailyGoal: 300,
  costPerKm: 0.25,
  companies: [],
  paymentMethods: DEFAULT_PAYMENT_METHODS.slice(),
  vehicles: [],
  offDays: [],
  profileCompleted: false
};
let trips = [];
let expenses = [];
let selectedPayment = "Cash";
let selectedTripType = "normal";
let working = false;
let workStart = null;

const $ = (id) => document.getElementById(id);

function todayStr(){ return new Date().toISOString().slice(0,10); }
function monthStr(){ return new Date().toISOString().slice(0,7); }
function formatMoney(n){ return `${Math.round((Number(n)||0) * 100) / 100} $`; }
function formatDateTime(iso){
  const d = new Date(iso);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
}
function normalize(str){ return String(str || "").trim().toLowerCase(); }
function companyNeedsAirport(name){ return AIRPORT_COMPANIES.includes(normalize(name)); }

function defaultCompany(name=""){
  return { name, fee: 0, airport: false };
}
function defaultVehicle(name=""){
  return { name, status: "propriétaire", active: false };
}
function showAuthMessage(msg, err=false){
  $("authMessage").textContent = msg || "";
  $("authMessage").style.color = err ? "#ff8f8f" : "#b8b8b8";
}

window.switchAuthMode = function(mode){
  authMode = mode;
  $("tabLogin").classList.toggle("active", mode === "login");
  $("tabRegister").classList.toggle("active", mode === "register");
  $("registerFields").classList.toggle("hidden", mode !== "register");
  $("loginFields").classList.toggle("hidden", mode !== "login");
  showAuthMessage("");
};

window.handleAuth = async function(){
  try {
    if(authMode === "register"){
      const driverName = $("loginName").value.trim();
      const email = $("loginEmail").value.trim();
      const password = $("loginPassword").value;
      if(!driverName || !email || !password){
        showAuthMessage("Entre le nom, l'email et le mot de passe.", true);
        return;
      }
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, "drivers", cred.user.uid), {
        driverName,
        dailyGoal: 300,
        costPerKm: 0.25,
        companies: [],
        paymentMethods: DEFAULT_PAYMENT_METHODS,
        vehicles: [],
        offDays: [],
        profileCompleted: false,
        email,
        createdAt: new Date().toISOString()
      }, { merge: true });
    } else {
      const email = $("signinEmail").value.trim();
      const password = $("signinPassword").value;
      if(!email || !password){
        showAuthMessage("Entre l'email et le mot de passe.", true);
        return;
      }
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (e) {
    showAuthMessage(e.message, true);
  }
};

window.logoutUser = async function(){ await signOut(auth); };

window.toggleSidebar = function(){
  $("sidebar").classList.toggle("open");
  $("overlay").classList.toggle("hidden");
};

window.openPage = function(id){
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  $(id).classList.add("active");
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  const nav = $("nav-" + id);
  if(nav) nav.classList.add("active");
  if(id === "history") renderTrips();
  if(id === "expenses") renderExpenses();
  if(id === "stats") drawWeeklyChart();
  if(id === "settings") renderSettingsSummary();
};

window.setTripType = function(type){
  selectedTripType = type;
  $("tripNormalBtn").classList.toggle("active", type === "normal");
  $("tripAirportBtn").classList.toggle("active", type === "airport");
};

function selectedCompanyObj(){
  return (profile.companies || []).find(c => c.name === $("tripCompany").value) || null;
}

function refreshTripAirportArea(){
  const company = selectedCompanyObj();
  const show = company && companyNeedsAirport(company.name) && company.airport;
  $("tripAirportArea").classList.toggle("hidden", !show);
  if(!show) selectedTripType = "normal";
  setTripType(selectedTripType);
}

async function loadProfile(uid){
  const snap = await getDoc(doc(db, "drivers", uid));
  if(snap.exists()){
    const data = snap.data();
    profile = {
      driverName: data.driverName || "",
      dailyGoal: Number(data.dailyGoal ?? 300),
      costPerKm: Number(data.costPerKm ?? 0.25),
      companies: Array.isArray(data.companies) ? data.companies : [],
      paymentMethods: Array.isArray(data.paymentMethods) && data.paymentMethods.length ? data.paymentMethods : DEFAULT_PAYMENT_METHODS.slice(),
      vehicles: Array.isArray(data.vehicles) ? data.vehicles : [],
      offDays: Array.isArray(data.offDays) ? data.offDays : [],
      profileCompleted: !!data.profileCompleted
    };
  }
}

async function loadTrips(uid){
  const q = query(collection(db, "drivers", uid, "trips"), orderBy("date", "desc"));
  const snap = await getDocs(q);
  trips = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function loadExpenses(uid){
  const q = query(collection(db, "drivers", uid, "expenses"), orderBy("date", "desc"));
  const snap = await getDocs(q);
  expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function loadAll(uid){
  await Promise.all([loadProfile(uid), loadTrips(uid), loadExpenses(uid)]);
  buildSuggestions();
  renderOnboarding();
  renderPaymentButtons();
  renderCompanySelect();
  renderSettingsSummary();
  refreshDashboardHeader();
  refreshAll();
}

function showApp(){
  $("loginPage").classList.add("hidden");
  $("onboardingPage").classList.add("hidden");
  $("appPage").classList.remove("hidden");
}
function showOnboarding(){
  $("loginPage").classList.add("hidden");
  $("appPage").classList.add("hidden");
  $("onboardingPage").classList.remove("hidden");
}
function showLogin(){
  $("appPage").classList.add("hidden");
  $("onboardingPage").classList.add("hidden");
  $("loginPage").classList.remove("hidden");
}

function buildSuggestions(){
  const wrap = $("companySuggestions");
  wrap.innerHTML = "";
  COMPANY_SUGGESTIONS.forEach(name => {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.textContent = name;
    btn.onclick = () => addSuggestedCompany(name);
    wrap.appendChild(btn);
  });
}

window.addSuggestedCompany = function(name){
  const exists = (profile.companies || []).some(c => normalize(c.name) === normalize(name));
  if(!exists){
    profile.companies.push(defaultCompany(name));
    renderCompanies();
    renderCompanySelect();
  }
};

window.addCompanyRow = function(){
  profile.companies.push(defaultCompany(""));
  renderCompanies();
};
window.addPaymentMethodRow = function(){
  profile.paymentMethods.push({ name: "", percentage: 0 });
  renderPaymentMethods();
};
window.addVehicleRow = function(){
  profile.vehicles.push(defaultVehicle(""));
  renderVehicles();
};

function companyRowHtml(company, i){
  const needsAirport = companyNeedsAirport(company.name);
  return `
    <div class="repeat-card">
      <label>Nom de la compagnie</label>
      <input value="${escapeAttr(company.name)}" oninput="updateCompanyName(${i}, this.value)" placeholder="Ex: Diamand" />
      <div class="inline-two">
        <div>
          <label>Frais de la compagnie ($)</label>
          <input type="number" value="${Number(company.fee || 0)}" oninput="updateCompanyFee(${i}, this.value)" placeholder="0" />
        </div>
        <div>
          <label>Travail à l'aéroport</label>
          <select onchange="updateCompanyAirport(${i}, this.value)">
            <option value="non" ${company.airport ? "" : "selected"}>Non</option>
            <option value="oui" ${company.airport ? "selected" : ""}>Oui</option>
          </select>
        </div>
      </div>
      ${needsAirport ? '<p class="muted">Pour cette compagnie, les courses aéroport auront 5.75$ de frais quand tu choisis "course aéroport".</p>' : ""}
      <button class="remove-btn" onclick="removeCompany(${i})">Retirer</button>
    </div>
  `;
}

function paymentMethodHtml(method, i){
  return `
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
  `;
}

function vehicleHtml(vehicle, i){
  return `
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
  `;
}

function escapeAttr(v){
  return String(v ?? "").replace(/"/g, "&quot;");
}

function renderCompanies(){
  $("companiesContainer").innerHTML = (profile.companies || []).map(companyRowHtml).join("");
}
function renderPaymentMethods(){
  $("paymentMethodsContainer").innerHTML = (profile.paymentMethods || []).map(paymentMethodHtml).join("");
}
function renderVehicles(){
  $("vehiclesContainer").innerHTML = (profile.vehicles || []).map(vehicleHtml).join("");
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
  renderCompanies();
  renderPaymentMethods();
  renderVehicles();
  renderOffDays();
}

window.updateCompanyName = function(i, value){
  profile.companies[i].name = value;
  renderCompanies();
  renderCompanySelect();
};
window.updateCompanyFee = function(i, value){
  profile.companies[i].fee = Number(value || 0);
};
window.updateCompanyAirport = function(i, value){
  profile.companies[i].airport = value === "oui";
};
window.removeCompany = function(i){
  profile.companies.splice(i, 1);
  renderCompanies();
  renderCompanySelect();
};
window.updatePaymentName = function(i, value){
  profile.paymentMethods[i].name = value;
  renderPaymentMethods();
  renderPaymentButtons();
};
window.updatePaymentPercentage = function(i, value){
  profile.paymentMethods[i].percentage = Number(value || 0);
};
window.removePaymentMethod = function(i){
  profile.paymentMethods.splice(i, 1);
  renderPaymentMethods();
  renderPaymentButtons();
};
window.updateVehicleName = function(i, value){
  profile.vehicles[i].name = value;
};
window.updateVehicleStatus = function(i, value){
  profile.vehicles[i].status = value;
};
window.setActiveVehicle = function(i, value){
  profile.vehicles = profile.vehicles.map((v, idx) => ({ ...v, active: idx === i && value === "oui" }));
  renderVehicles();
  refreshDashboardHeader();
};
window.removeVehicle = function(i){
  profile.vehicles.splice(i, 1);
  renderVehicles();
  refreshDashboardHeader();
};
window.toggleOffDay = function(day, checked){
  if(checked && !profile.offDays.includes(day)) profile.offDays.push(day);
  if(!checked) profile.offDays = profile.offDays.filter(d => d !== day);
};

function cleanProfileBeforeSave(){
  profile.driverName = $("profileDriverName").value.trim();
  profile.dailyGoal = Number($("profileDailyGoal").value || 0);
  profile.costPerKm = Number($("profileCostPerKm").value || 0);
  profile.companies = (profile.companies || []).filter(c => String(c.name || "").trim()).map(c => ({
    name: String(c.name).trim(),
    fee: Number(c.fee || 0),
    airport: !!c.airport
  }));
  profile.paymentMethods = (profile.paymentMethods || []).filter(p => String(p.name || "").trim()).map(p => ({
    name: String(p.name).trim(),
    percentage: Number(p.percentage || 0)
  }));
  profile.vehicles = (profile.vehicles || []).filter(v => String(v.name || "").trim()).map(v => ({
    name: String(v.name).trim(),
    status: v.status || "propriétaire",
    active: !!v.active
  }));
  if(!profile.paymentMethods.length) profile.paymentMethods = DEFAULT_PAYMENT_METHODS.slice();
  profile.profileCompleted = true;
}

window.saveOnboarding = async function(){
  if(!currentUser) return;
  cleanProfileBeforeSave();
  if(!profile.driverName){
    alert("Entre le nom du chauffeur.");
    return;
  }
  await setDoc(doc(db, "drivers", currentUser.uid), profile, { merge: true });
  renderPaymentButtons();
  renderCompanySelect();
  renderSettingsSummary();
  refreshDashboardHeader();
  refreshAll();
  showApp();
};

window.openOnboardingForEdit = function(){
  renderOnboarding();
  showOnboarding();
};

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
  const companies = profile.companies || [];
  companies.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.name;
    opt.textContent = c.name;
    select.appendChild(opt);
  });
  if(!companies.length){
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Aucune compagnie";
    select.appendChild(opt);
  }
  refreshTripAirportArea();
  select.onchange = refreshTripAirportArea;
}

function activeVehicleName(){
  const active = (profile.vehicles || []).find(v => v.active);
  return active ? active.name : ((profile.vehicles || [])[0]?.name || "Votre véhicule");
}
function mainCompanyName(){
  return (profile.companies || [])[0]?.name || "Compagnie";
}
function refreshDashboardHeader(){
  $("driverNameDisplay").textContent = profile.driverName || "Chauffeur";
  $("sideDriverName").textContent = profile.driverName || "Chauffeur";
  $("vehicleName").textContent = activeVehicleName();
  $("mainCompanyChip").textContent = mainCompanyName();
}
function renderSettingsSummary(){
  const el = $("settingsSummary");
  const companies = (profile.companies || []).map(c => `${c.name} (${c.fee}$${c.airport ? ", aéroport" : ""})`).join(", ") || "Aucune";
  const methods = (profile.paymentMethods || []).map(p => `${p.name} ${p.percentage}%`).join(", ") || "Aucune";
  const vehicles = (profile.vehicles || []).map(v => `${v.name} (${v.status}${v.active ? ", actuel" : ""})`).join(", ") || "Aucun";
  const offDays = (profile.offDays || []).join(", ") || "Aucun";
  el.innerHTML = `
    <div class="summary-box"><strong>Objectif/jour :</strong> ${formatMoney(profile.dailyGoal || 0)}</div>
    <div class="summary-box"><strong>Compagnies :</strong> ${companies}</div>
    <div class="summary-box"><strong>Méthodes :</strong> ${methods}</div>
    <div class="summary-box"><strong>Véhicules :</strong> ${vehicles}</div>
    <div class="summary-box"><strong>Jours de repos :</strong> ${offDays}</div>
  `;
}

window.saveTrip = async function(){
  if(!currentUser) return;
  const amount = Number($("amount").value || 0);
  const km = Number($("tripKm").value || 0);
  const note = $("tripNote").value || "";
  const company = $("tripCompany").value || "";
  if(!amount){
    alert("Entrer un montant");
    return;
  }
  const companyObj = (profile.companies || []).find(c => c.name === company) || null;
  const paymentMethod = (profile.paymentMethods || []).find(m => m.name === selectedPayment) || { percentage: 0 };
  const paymentFee = amount * (Number(paymentMethod.percentage || 0) / 100);
  const companyFee = Number(companyObj?.fee || 0);
  const airportFee = companyObj && companyNeedsAirport(companyObj.name) && companyObj.airport && selectedTripType === "airport" ? 5.75 : 0;

  await addDoc(collection(db, "drivers", currentUser.uid, "trips"), {
    amount,
    km,
    note,
    company,
    payment: selectedPayment,
    paymentPercentage: Number(paymentMethod.percentage || 0),
    paymentFee,
    companyFee,
    airportFee,
    tripType: selectedTripType,
    date: new Date().toISOString()
  });

  $("amount").value = "";
  $("tripKm").value = "";
  $("tripNote").value = "";
  selectedTripType = "normal";
  setTripType("normal");
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
  if(!amount){
    alert("Entrer un montant");
    return;
  }
  await addDoc(collection(db, "drivers", currentUser.uid, "expenses"), {
    amount, category, note, date: new Date().toISOString()
  });
  $("expenseAmount").value = "";
  $("expenseNote").value = "";
  closeExpenseModal();
  await loadExpenses(currentUser.uid);
  refreshAll();
  openPage("expenses");
};

function renderTrips(){
  const list = $("tripList");
  list.innerHTML = "";
  trips.forEach(t => {
    const item = document.createElement("div");
    item.className = "list-item";
    const feeText = [`${t.payment || ""}`, `${t.km || 0} km`, t.company || ""].filter(Boolean).join(" • ");
    const fees = (Number(t.paymentFee || 0) + Number(t.companyFee || 0) + Number(t.airportFee || 0));
    item.innerHTML = `
      <div class="left">
        <strong>${formatMoney(t.amount)}</strong>
        <span>${feeText}${fees ? " • frais " + formatMoney(fees) : ""}</span>
      </div>
      <div class="right">${formatDateTime(t.date)}</div>
    `;
    list.appendChild(item);
  });
  if(!trips.length) list.innerHTML = '<div class="panel">Aucune course pour le moment.</div>';
}

function renderExpenses(){
  const list = $("expenseList");
  list.innerHTML = "";
  expenses.forEach(e => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div class="left">
        <strong>${formatMoney(e.amount)}</strong>
        <span>${e.category}${e.note ? " • " + e.note : ""}</span>
      </div>
      <div class="right">${formatDateTime(e.date)}</div>
    `;
    list.appendChild(item);
  });
  if(!expenses.length) list.innerHTML = '<div class="panel">Aucune dépense pour le moment.</div>';
}

function refreshAll(){
  const today = todayStr();
  const month = monthStr();
  const todayTrips = trips.filter(t => String(t.date).slice(0,10) === today);
  const todayExpenses = expenses.filter(e => String(e.date).slice(0,10) === today);

  const income = todayTrips.reduce((a,b) => a + Number(b.amount || 0), 0);
  const tripCount = todayTrips.length;
  const km = todayTrips.reduce((a,b) => a + Number(b.km || 0), 0);
  const cash = todayTrips.filter(t => t.payment === "Cash").reduce((a,b) => a + Number(b.amount || 0), 0);
  const card = todayTrips.filter(t => t.payment === "Carte").reduce((a,b) => a + Number(b.amount || 0), 0);
  const expense = todayExpenses.reduce((a,b) => a + Number(b.amount || 0), 0);
  const tripFees = todayTrips.reduce((a,b) => a + Number(b.paymentFee || 0) + Number(b.companyFee || 0) + Number(b.airportFee || 0), 0);
  const profit = income - expense - tripFees - (km * Number(profile.costPerKm || 0));

  $("todayIncome").textContent = formatMoney(income);
  $("todayTrips").textContent = tripCount;
  $("todayKm").textContent = Math.round(km * 10) / 10;
  $("cashTotal").textContent = formatMoney(cash);
  $("cardTotal").textContent = formatMoney(card);
  $("expenseTotal").textContent = formatMoney(expense);
  $("profitTotal").textContent = formatMoney(profit);

  const weekDates = [];
  for(let i=6; i>=0; i--){
    const d = new Date();
    d.setDate(d.getDate() - i);
    weekDates.push(d.toISOString().slice(0,10));
  }
  const weekTotal = trips.filter(t => weekDates.includes(String(t.date).slice(0,10))).reduce((a,b) => a + Number(b.amount || 0), 0);
  const monthTrips = trips.filter(t => String(t.date).slice(0,7) === month);
  const monthTotal = monthTrips.reduce((a,b) => a + Number(b.amount || 0), 0);
  const monthKm = monthTrips.reduce((a,b) => a + Number(b.km || 0), 0);
  const avgTrip = tripCount ? income / tripCount : 0;

  $("weekTotal").textContent = formatMoney(weekTotal);
  $("monthTotal").textContent = formatMoney(monthTotal);
  $("avgTrip").textContent = formatMoney(avgTrip);
  $("monthKm").textContent = Math.round(monthKm * 10) / 10;

  renderTrips();
  renderExpenses();
  drawWeeklyChart();
}

function drawWeeklyChart(){
  const canvas = $("weeklyChart");
  if(!canvas) return;
  const ctx = canvas.getContext("2d");
  const cw = canvas.clientWidth;
  const ch = 170;
  canvas.width = cw * devicePixelRatio;
  canvas.height = ch * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.clearRect(0,0,cw,ch);

  const dates = [];
  for(let i=6;i>=0;i--){
    const d = new Date();
    d.setDate(d.getDate()-i);
    dates.push(d.toISOString().slice(0,10));
  }
  const values = dates.map(d => trips.filter(t => String(t.date).slice(0,10) === d).reduce((a,b) => a + Number(b.amount || 0), 0));
  const max = Math.max(...values, 1);
  const padding = 16;
  const step = (cw - padding * 2) / values.length;
  const barW = step * 0.58;

  values.forEach((v, i) => {
    const x = padding + i * step + (step - barW) / 2;
    const h = (v / max) * (ch - 42);
    const y = ch - 24 - h;
    ctx.fillStyle = "#f7c948";
    roundRect(ctx, x, y, barW, h, 10, true, false);
    ctx.fillStyle = "#cfcfcf";
    ctx.font = "11px Arial";
    ctx.textAlign = "center";
    const dd = new Date(dates[i]);
    const label = dd.toLocaleDateString("fr-CA", {weekday:"short"}).slice(0,3);
    ctx.fillText(label, x + barW / 2, ch - 7);
  });
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
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

window.addEventListener("resize", () => {
  if(!$("stats").classList.contains("active")) return;
  drawWeeklyChart();
});

switchAuthMode("login");
setTripType("normal");

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if(user){
    await loadAll(user.uid);
    if(profile.profileCompleted){
      showApp();
    } else {
      renderOnboarding();
      showOnboarding();
    }
  } else {
    showLogin();
  }
});
