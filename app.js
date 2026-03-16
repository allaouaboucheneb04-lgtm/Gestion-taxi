import {
  auth,
  db,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  doc,
  setDoc,
  getDoc,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy
} from "./firebase.js";

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}

let authMode = "login";
let currentUser = null;
let settings = {
  driverName: "",
  carName: "",
  enableExpenses: true,
  costPerKm: 0.25
};
let trips = [];
let expenses = [];
let payment = "Cash";
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
function showAuthMessage(msg, isError = false){
  const el = $("authMessage");
  el.textContent = msg || "";
  el.style.color = isError ? "#ff8f8f" : "#b8b8b8";
}

window.switchAuthMode = function(mode){
  authMode = mode;
  $("tabLogin").classList.toggle("active", mode === "login");
  $("tabRegister").classList.toggle("active", mode === "register");
  $("registerFields").style.display = mode === "register" ? "block" : "none";
  $("authButton").textContent = mode === "register" ? "Créer le compte" : "Connexion";
  showAuthMessage("");
};

window.handleAuth = async function(){
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  const driverName = $("loginName").value.trim();
  const carName = $("loginCar").value.trim();

  if(!email || !password){
    showAuthMessage("Entre l'email et le mot de passe.", true);
    return;
  }

  try {
    if(authMode === "register"){
      if(!driverName || !carName){
        showAuthMessage("Entre le nom du chauffeur et du véhicule.", true);
        return;
      }
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, "drivers", cred.user.uid), {
        driverName,
        carName,
        enableExpenses: true,
        costPerKm: 0.25,
        email,
        createdAt: new Date().toISOString()
      }, { merge: true });
      showAuthMessage("Compte chauffeur créé.");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      showAuthMessage("");
    }
  } catch (e) {
    showAuthMessage(e.message, true);
  }
};

window.logoutUser = async function(){
  await signOut(auth);
};

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
};

window.setPayment = function(type){
  payment = type;
  $("payCash").classList.toggle("active", type === "Cash");
  $("payCard").classList.toggle("active", type === "Carte");
};

window.toggleWork = function(){
  working = !working;
  const btn = $("workBtn");
  if(working){
    workStart = new Date();
    btn.textContent = "⏹ Fin travail";
  } else {
    const hours = workStart ? ((new Date() - workStart)/3600000) : 0;
    $("todayTime").textContent = `${hours.toFixed(1)}h`;
    btn.textContent = "▶ Commencer travail";
  }
};

async function loadDriverData(uid){
  const snap = await getDoc(doc(db, "drivers", uid));
  if(snap.exists()){
    settings = {
      driverName: snap.data().driverName || "",
      carName: snap.data().carName || "",
      enableExpenses: snap.data().enableExpenses !== false,
      costPerKm: Number(snap.data().costPerKm ?? 0.25)
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

async function loadAllData(uid){
  await Promise.all([
    loadDriverData(uid),
    loadTrips(uid),
    loadExpenses(uid)
  ]);
  loadSettingsUI();
  refreshAll();
}

window.saveTrip = async function(){
  if(!currentUser) return;
  const amount = Number($("amount").value || 0);
  const km = Number($("tripKm").value || 0);
  const note = $("tripNote").value || "";
  if(!amount){
    alert("Entrer un montant");
    return;
  }

  await addDoc(collection(db, "drivers", currentUser.uid, "trips"), {
    amount,
    km,
    note,
    payment,
    date: new Date().toISOString()
  });

  $("amount").value = "";
  $("tripKm").value = "";
  $("tripNote").value = "";
  await loadTrips(currentUser.uid);
  refreshAll();
  openPage("dashboard");
};

window.openExpenseModal = function(){
  $("expenseModal").classList.remove("hidden");
};

window.closeExpenseModal = function(){
  $("expenseModal").classList.add("hidden");
};

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
    amount,
    category,
    note,
    date: new Date().toISOString()
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
    item.innerHTML = `
      <div class="left">
        <strong>${formatMoney(t.amount)}</strong>
        <span>${t.payment} • ${t.km || 0} km${t.note ? " • " + t.note : ""}</span>
      </div>
      <div class="right">${formatDateTime(t.date)}</div>
    `;
    list.appendChild(item);
  });
  if(!trips.length){
    list.innerHTML = '<div class="panel">Aucune course pour le moment.</div>';
  }
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
  if(!expenses.length){
    list.innerHTML = '<div class="panel">Aucune dépense pour le moment.</div>';
  }
}

window.saveSettings = async function(){
  if(!currentUser) return;
  settings.driverName = $("driverName").value || "";
  settings.carName = $("carName").value || "";
  settings.costPerKm = Number($("costPerKm").value || 0);
  settings.enableExpenses = $("enableExpenses").checked;

  await setDoc(doc(db, "drivers", currentUser.uid), settings, { merge: true });
  loadSettingsUI();
  refreshAll();
};

function loadSettingsUI(){
  $("driverName").value = settings.driverName || "";
  $("carName").value = settings.carName || "";
  $("costPerKm").value = settings.costPerKm ?? 0.25;
  $("enableExpenses").checked = !!settings.enableExpenses;

  $("driverNameDisplay").textContent = settings.driverName || "Chauffeur";
  $("sideDriverName").textContent = settings.driverName || "Chauffeur";
  $("vehicleName").textContent = settings.carName || "Votre véhicule";
  $("nav-expenses").style.display = settings.enableExpenses ? "flex" : "none";
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
  const profit = income - expense - (km * Number(settings.costPerKm || 0));

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
  const data = { settings, trips, expenses };
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
setPayment("Cash");

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if(user){
    $("loginPage").classList.add("hidden");
    $("appPage").classList.remove("hidden");
    await loadAllData(user.uid);
  } else {
    $("appPage").classList.add("hidden");
    $("loginPage").classList.remove("hidden");
    showAuthMessage("");
  }
});
