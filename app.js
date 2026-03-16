
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

let trips = store.get("trips", []);
let expenses = store.get("expenses", []);
let settings = store.get("settings", {
  driverName: "",
  enableExpenses: true,
  costPerKm: 0.25,
  dailyGoal: 300
});
let payment = "Cash";
let working = false;
let workStart = null;

function todayStr() {
  return new Date().toISOString().slice(0,10);
}
function monthStr() {
  return new Date().toISOString().slice(0,7);
}
function weekAgoDates(days=7){
  const arr = [];
  for(let i=days-1;i>=0;i--){
    const d = new Date();
    d.setDate(d.getDate()-i);
    arr.push(d.toISOString().slice(0,10));
  }
  return arr;
}
function formatMoney(n){
  return `${Math.round((Number(n)||0)*100)/100} $`;
}
function formatDateTime(iso){
  const d = new Date(iso);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
}
function saveSettings(){
  settings.driverName = document.getElementById("driverName").value || "";
  settings.enableExpenses = document.getElementById("enableExpenses").checked;
  settings.costPerKm = Number(document.getElementById("costPerKm").value || 0);
  settings.dailyGoal = Number(document.getElementById("dailyGoal").value || 0);
  store.set("settings", settings);
  refreshAll();
}
function loadSettingsUI(){
  document.getElementById("driverName").value = settings.driverName || "";
  document.getElementById("enableExpenses").checked = !!settings.enableExpenses;
  document.getElementById("costPerKm").value = settings.costPerKm ?? 0.25;
  document.getElementById("dailyGoal").value = settings.dailyGoal ?? 300;
  document.getElementById("driverGreeting").textContent = settings.driverName ? `Bonjour ${settings.driverName}` : "Bonjour chauffeur";
}
function setPayment(type){
  payment = type;
  document.getElementById("payCash").classList.toggle("active", type === "Cash");
  document.getElementById("payCard").classList.toggle("active", type === "Carte");
}
function openPage(id){
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  const nav = document.getElementById("nav-" + id);
  if(nav) nav.classList.add("active");
  if(id === "history") renderTrips();
  if(id === "expenses") renderExpenses();
  if(id === "stats") drawPaymentChart();
}
function toggleWork(){
  working = !working;
  const btn = document.getElementById("workBtn");
  const status = document.getElementById("workStatus");
  if(working){
    workStart = new Date();
    btn.textContent = "⏹ Fin travail";
    status.textContent = "En travail";
  }else{
    const end = new Date();
    const hours = workStart ? ((end - workStart) / 3600000) : 0;
    document.getElementById("todayTime").textContent = `${hours.toFixed(1)}h`;
    btn.textContent = "▶ Commencer travail";
    status.textContent = "Hors ligne";
  }
}
function saveTrip(){
  const amount = Number(document.getElementById("amount").value || 0);
  const km = Number(document.getElementById("tripKm").value || 0);
  const note = document.getElementById("note").value || "";
  if(!amount) return alert("Entrer un montant");
  trips.push({
    amount, km, note, payment,
    date: new Date().toISOString()
  });
  store.set("trips", trips);
  document.getElementById("amount").value = "";
  document.getElementById("tripKm").value = "";
  document.getElementById("note").value = "";
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
    amount, category, note, date: new Date().toISOString()
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
  trips.slice().reverse().forEach(t => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div class="left">
        <strong>${formatMoney(t.amount)}</strong>
        <span>${t.payment} • ${t.km || 0} km</span>
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
  const list = document.getElementById("expenseList");
  list.innerHTML = "";
  expenses.slice().reverse().forEach(e => {
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
function updateNavVisibility(){
  document.getElementById("nav-expenses").style.display = settings.enableExpenses ? "flex" : "none";
}
function drawBarChart(canvasId, labels, values){
  const canvas = document.getElementById(canvasId);
  if(!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width = canvas.clientWidth * devicePixelRatio;
  const h = canvas.height = 160 * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.clearRect(0,0,canvas.clientWidth,160);
  const cw = canvas.clientWidth;
  const ch = 160;
  const max = Math.max(...values, 1);
  const padding = 16;
  const barW = (cw - padding*2) / values.length * 0.6;
  const gap = (cw - padding*2) / values.length;
  values.forEach((v,i)=>{
    const x = padding + i * gap + (gap-barW)/2;
    const bh = ((v/max) * (ch - 46));
    const y = ch - 26 - bh;
    ctx.fillStyle = "#2f6bff";
    roundRect(ctx, x, y, barW, bh, 10, true, false);
    ctx.fillStyle = "#8da0bb";
    ctx.font = "11px Arial";
    ctx.textAlign = "center";
    ctx.fillText(labels[i], x + barW/2, ch - 8);
  });
}
function drawDonutChart(canvasId, values, colors){
  const canvas = document.getElementById(canvasId);
  if(!canvas) return;
  const ctx = canvas.getContext("2d");
  const size = 180;
  const w = canvas.width = canvas.clientWidth * devicePixelRatio;
  const h = canvas.height = size * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.clearRect(0,0,canvas.clientWidth,size);
  const total = values.reduce((a,b)=>a+b,0) || 1;
  let start = -Math.PI/2;
  const cx = canvas.clientWidth/2, cy = size/2, r = 56;
  values.forEach((v,i)=>{
    const ang = (v/total)*Math.PI*2;
    ctx.beginPath();
    ctx.strokeStyle = colors[i];
    ctx.lineWidth = 20;
    ctx.arc(cx, cy, r, start, start+ang);
    ctx.stroke();
    start += ang;
  });
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 16px Arial";
  ctx.textAlign = "center";
  ctx.fillText("Paiements", cx, cy);
}
function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
  if (typeof radius === 'number') {
    radius = {tl: radius, tr: radius, br: radius, bl: radius};
  }
  ctx.beginPath();
  ctx.moveTo(x + radius.tl, y);
  ctx.lineTo(x + width - radius.tr, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius.tr);
  ctx.lineTo(x + width, y + height - radius.br);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height);
  ctx.lineTo(x + radius.bl, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius.bl);
  ctx.lineTo(x, y + radius.tl);
  ctx.quadraticCurveTo(x, y, x + radius.tl, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}
function refreshAll(){
  loadSettingsUI();
  updateNavVisibility();

  const today = todayStr();
  const month = monthStr();
  const todayTrips = trips.filter(t => t.date.slice(0,10) === today);
  const todayExpenses = expenses.filter(e => e.date.slice(0,10) === today);

  const income = todayTrips.reduce((a,b)=>a + Number(b.amount||0), 0);
  const tripCount = todayTrips.length;
  const todayKm = todayTrips.reduce((a,b)=>a + Number(b.km||0), 0);
  const expenseTotal = todayExpenses.reduce((a,b)=>a + Number(b.amount||0), 0);
  const kmCost = todayKm * Number(settings.costPerKm || 0);
  const profit = income - expenseTotal - kmCost;

  const cash = todayTrips.filter(t=>t.payment==="Cash").reduce((a,b)=>a+Number(b.amount||0),0);
  const card = todayTrips.filter(t=>t.payment==="Carte").reduce((a,b)=>a+Number(b.amount||0),0);

  const weekDates = weekAgoDates(7);
  const weekTotal = trips.filter(t => weekDates.includes(t.date.slice(0,10))).reduce((a,b)=>a+Number(b.amount||0),0);
  const monthTrips = trips.filter(t => t.date.slice(0,7) === month);
  const monthExpenses = expenses.filter(e => e.date.slice(0,7) === month);
  const monthTotal = monthTrips.reduce((a,b)=>a+Number(b.amount||0),0);
  const monthKm = monthTrips.reduce((a,b)=>a+Number(b.km||0),0);
  const avgTrip = tripCount ? income / tripCount : 0;
  const currentHours = document.getElementById("todayTime").textContent.replace("h","") || "0";
  const hourlyRate = Number(currentHours) > 0 ? income / Number(currentHours) : 0;

  document.getElementById("todayIncome").textContent = formatMoney(income);
  document.getElementById("todayTrips").textContent = tripCount;
  document.getElementById("todayKm").textContent = Math.round(todayKm * 10) / 10;
  document.getElementById("todayProfit").textContent = formatMoney(profit);
  document.getElementById("cashTotal").textContent = formatMoney(cash);
  document.getElementById("cardTotal").textContent = formatMoney(card);
  document.getElementById("expenseTotal").textContent = formatMoney(expenseTotal);
  document.getElementById("weekTotal").textContent = formatMoney(weekTotal);

  document.getElementById("monthTotal").textContent = formatMoney(monthTotal);
  document.getElementById("avgTrip").textContent = formatMoney(avgTrip);
  document.getElementById("hourlyRate").textContent = formatMoney(hourlyRate);
  document.getElementById("monthKm").textContent = Math.round(monthKm * 10) / 10;

  const labels = weekDates.map(d => {
    const dd = new Date(d);
    return dd.toLocaleDateString("fr-CA", {weekday:"short"}).slice(0,3);
  });
  const values = weekDates.map(d => trips.filter(t => t.date.slice(0,10) === d).reduce((a,b)=>a+Number(b.amount||0),0));
  drawBarChart("weeklyChart", labels, values);

  drawPaymentChart();
  renderTrips();
  renderExpenses();
}
function drawPaymentChart(){
  const month = monthStr();
  const monthTrips = trips.filter(t => t.date.slice(0,7) === month);
  const cash = monthTrips.filter(t=>t.payment==="Cash").reduce((a,b)=>a+Number(b.amount||0),0);
  const card = monthTrips.filter(t=>t.payment==="Carte").reduce((a,b)=>a+Number(b.amount||0),0);
  drawDonutChart("paymentChart", [cash, card], ["#23b26d", "#2f6bff"]);
}
function exportData(){
  const data = { trips, expenses, settings };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "driver-pro-data.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

window.addEventListener("resize", refreshAll);
setPayment("Cash");
refreshAll();
