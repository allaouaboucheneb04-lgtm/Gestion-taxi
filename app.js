
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch(e){ return fallback; }
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
};

let settings = store.get("settings", {
  driverName: "",
  carName: "",
  enableExpenses: true,
  costPerKm: 0.25
});
let trips = store.get("trips", []);
let expenses = store.get("expenses", []);
let payment = "Cash";
let working = false;
let workStart = null;

function todayStr(){ return new Date().toISOString().slice(0,10); }
function monthStr(){ return new Date().toISOString().slice(0,7); }

function formatMoney(n){
  return `${Math.round((Number(n)||0)*100)/100} $`;
}
function formatDateTime(iso){
  const d = new Date(iso);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
}

function init(){
  if(settings.driverName || settings.carName){
    document.getElementById("loginPage").classList.add("hidden");
    document.getElementById("appPage").classList.remove("hidden");
  }
  loadSettingsUI();
  refreshAll();
}

function login(){
  const name = document.getElementById("loginName").value.trim();
  const car = document.getElementById("loginCar").value.trim();
  if(!name || !car) return alert("Entrer le nom du chauffeur et du véhicule");
  settings.driverName = name;
  settings.carName = car;
  store.set("settings", settings);
  document.getElementById("loginPage").classList.add("hidden");
  document.getElementById("appPage").classList.remove("hidden");
  loadSettingsUI();
  refreshAll();
}

function toggleSidebar(){
  document.getElementById("sidebar").classList.toggle("open");
  document.getElementById("overlay").classList.toggle("hidden");
}

function openPage(id){
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  document.querySelectorAll(".nav-item").forEach(n=>n.classList.remove("active"));
  const nav = document.getElementById("nav-" + id);
  if(nav) nav.classList.add("active");
  if(id === "history") renderTrips();
  if(id === "expenses") renderExpenses();
  if(id === "stats") drawWeeklyChart();
}

function setPayment(type){
  payment = type;
  document.getElementById("payCash").classList.toggle("active", type === "Cash");
  document.getElementById("payCard").classList.toggle("active", type === "Carte");
}

function toggleWork(){
  working = !working;
  const btn = document.getElementById("workBtn");
  if(working){
    workStart = new Date();
    btn.textContent = "⏹ Fin travail";
  }else{
    const hours = workStart ? ((new Date() - workStart)/3600000) : 0;
    document.getElementById("todayTime").textContent = `${hours.toFixed(1)}h`;
    btn.textContent = "▶ Commencer travail";
  }
}

function saveTrip(){
  const amount = Number(document.getElementById("amount").value || 0);
  const km = Number(document.getElementById("tripKm").value || 0);
  const note = document.getElementById("tripNote").value || "";
  if(!amount) return alert("Entrer un montant");

  trips.push({
    amount, km, note, payment,
    date: new Date().toISOString()
  });
  store.set("trips", trips);

  document.getElementById("amount").value = "";
  document.getElementById("tripKm").value = "";
  document.getElementById("tripNote").value = "";

  refreshAll();
  openPage("dashboard");
}

function openExpenseModal(){
  document.getElementById("expenseModal").classList.remove("hidden");
}
function closeExpenseModal(){
  document.getElementById("expenseModal").classList.add("hidden");
}
function saveExpense(){
  const amount = Number(document.getElementById("expenseAmount").value || 0);
  const category = document.getElementById("expenseCategory").value;
  const note = document.getElementById("expenseNote").value || "";
  if(!amount) return alert("Entrer un montant");

  expenses.push({
    amount, category, note,
    date: new Date().toISOString()
  });
  store.set("expenses", expenses);

  document.getElementById("expenseAmount").value = "";
  document.getElementById("expenseNote").value = "";
  closeExpenseModal();
  refreshAll();
  openPage("expenses");
}

function renderTrips(){
  const list = document.getElementById("tripList");
  list.innerHTML = "";
  trips.slice().reverse().forEach(t=>{
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
  if(!trips.length) list.innerHTML = '<div class="panel">Aucune course pour le moment.</div>';
}

function renderExpenses(){
  const list = document.getElementById("expenseList");
  list.innerHTML = "";
  expenses.slice().reverse().forEach(e=>{
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

function saveSettings(){
  settings.driverName = document.getElementById("driverName").value || "";
  settings.carName = document.getElementById("carName").value || "";
  settings.costPerKm = Number(document.getElementById("costPerKm").value || 0);
  settings.enableExpenses = document.getElementById("enableExpenses").checked;
  store.set("settings", settings);
  loadSettingsUI();
  refreshAll();
}

function loadSettingsUI(){
  document.getElementById("driverName").value = settings.driverName || "";
  document.getElementById("carName").value = settings.carName || "";
  document.getElementById("costPerKm").value = settings.costPerKm ?? 0.25;
  document.getElementById("enableExpenses").checked = !!settings.enableExpenses;

  document.getElementById("driverNameDisplay").textContent = settings.driverName || "Chauffeur";
  document.getElementById("sideDriverName").textContent = settings.driverName || "Chauffeur";
  document.getElementById("vehicleName").textContent = settings.carName || "Votre véhicule";
  document.getElementById("nav-expenses").style.display = settings.enableExpenses ? "flex" : "none";
}

function refreshAll(){
  const today = todayStr();
  const month = monthStr();

  const todayTrips = trips.filter(t=>t.date.slice(0,10)===today);
  const todayExpenses = expenses.filter(e=>e.date.slice(0,10)===today);

  const income = todayTrips.reduce((a,b)=>a+Number(b.amount||0),0);
  const tripCount = todayTrips.length;
  const km = todayTrips.reduce((a,b)=>a+Number(b.km||0),0);
  const cash = todayTrips.filter(t=>t.payment==="Cash").reduce((a,b)=>a+Number(b.amount||0),0);
  const card = todayTrips.filter(t=>t.payment==="Carte").reduce((a,b)=>a+Number(b.amount||0),0);
  const expense = todayExpenses.reduce((a,b)=>a+Number(b.amount||0),0);
  const profit = income - expense - (km * Number(settings.costPerKm || 0));

  document.getElementById("todayIncome").textContent = formatMoney(income);
  document.getElementById("todayTrips").textContent = tripCount;
  document.getElementById("todayKm").textContent = Math.round(km * 10)/10;
  document.getElementById("cashTotal").textContent = formatMoney(cash);
  document.getElementById("cardTotal").textContent = formatMoney(card);
  document.getElementById("expenseTotal").textContent = formatMoney(expense);
  document.getElementById("profitTotal").textContent = formatMoney(profit);

  const weekDates = [];
  for(let i=6;i>=0;i--){
    const d = new Date();
    d.setDate(d.getDate()-i);
    weekDates.push(d.toISOString().slice(0,10));
  }
  const weekTotal = trips.filter(t=>weekDates.includes(t.date.slice(0,10))).reduce((a,b)=>a+Number(b.amount||0),0);
  const monthTrips = trips.filter(t=>t.date.slice(0,7)===month);
  const monthTotal = monthTrips.reduce((a,b)=>a+Number(b.amount||0),0);
  const monthKm = monthTrips.reduce((a,b)=>a+Number(b.km||0),0);
  const avgTrip = tripCount ? income / tripCount : 0;

  document.getElementById("weekTotal").textContent = formatMoney(weekTotal);
  document.getElementById("monthTotal").textContent = formatMoney(monthTotal);
  document.getElementById("avgTrip").textContent = formatMoney(avgTrip);
  document.getElementById("monthKm").textContent = Math.round(monthKm * 10)/10;

  renderTrips();
  renderExpenses();
  drawWeeklyChart();
}

function drawWeeklyChart(){
  const canvas = document.getElementById("weeklyChart");
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

  const values = dates.map(d => trips.filter(t=>t.date.slice(0,10)===d).reduce((a,b)=>a+Number(b.amount||0),0));
  const max = Math.max(...values, 1);
  const padding = 16;
  const barArea = cw - padding*2;
  const step = barArea / values.length;
  const barW = step * 0.58;

  values.forEach((v,i)=>{
    const x = padding + i*step + (step-barW)/2;
    const h = (v/max) * (ch-42);
    const y = ch - 24 - h;
    ctx.fillStyle = "#f7c948";
    roundRect(ctx, x, y, barW, h, 10, true, false);
    ctx.fillStyle = "#cfcfcf";
    ctx.font = "11px Arial";
    ctx.textAlign = "center";
    const dd = new Date(dates[i]);
    const label = dd.toLocaleDateString("fr-CA", {weekday:"short"}).slice(0,3);
    ctx.fillText(label, x + barW/2, ch - 7);
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

function exportData(){
  const data = { settings, trips, expenses };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "taxi-driver-pro-data.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

window.addEventListener("resize", ()=> {
  if(document.getElementById("stats").classList.contains("active")) drawWeeklyChart();
});
setPayment("Cash");
init();
