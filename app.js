const $ = (id) => document.getElementById(id);
const money = (n) => Number(n || 0).toLocaleString(undefined, { style:'currency', currency:'USD' });
const todayISO = () => new Date().toISOString().slice(0,10);
const daysBetween = (a,b) => Math.ceil((new Date(b) - new Date(a)) / 86400000);

const STORAGE_KEY = 'financeGamePlan.v2';
const LEGACY_KEY = 'financeGamePlan';
const defaultState = { accounts: [], bills: [], buckets: [], paychecks: [], plan: [], safeToSpend: 0, updatedAt: null };

function canUseLocalStorage(){
  try { localStorage.setItem('__test__','1'); localStorage.removeItem('__test__'); return true; }
  catch { return false; }
}
function loadState(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY);
    if (!raw) return structuredClone(defaultState);
    return { ...structuredClone(defaultState), ...JSON.parse(raw) };
  } catch {
    return structuredClone(defaultState);
  }
}
let state = loadState();

function persist(){
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function updateStorageStatus(){
  const el = $('storageStatus');
  if (!el) return;
  if (canUseLocalStorage()) {
    el.innerHTML = `<span class="status-good">Storage available.</span> Last saved: ${state.updatedAt ? new Date(state.updatedAt).toLocaleString() : 'not saved yet'}.`;
  } else {
    el.innerHTML = `<span class="status-warn">Storage is blocked in this browser/location.</span> Use Export backup before closing, or host the app as a web page.`;
  }
}
function save(){
  try { persist(); }
  catch (err) { alert('This browser did not allow saving. Use Export backup, or run the app from a hosted URL instead of the Files app.'); }
  render();
}
function id(){ return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random()); }
function totalBalances(){ return state.accounts.filter(a=>a.type !== 'Credit Card').reduce((s,a)=>s+Number(a.balance || 0),0); }
function addDays(date, days){ const d = new Date(date + 'T00:00:00'); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10); }
function nextOccurrences(item, untilDays){
  const out = [];
  let current = item.dueDate || item.nextDate;
  if (!current) return out;
  const end = addDays(todayISO(), untilDays);
  const step = item.recurrence === 'weekly' || item.frequency === 'weekly' ? 7 : item.recurrence === 'biweekly' || item.frequency === 'biweekly' ? 14 : item.recurrence === 'monthly' || item.frequency === 'monthly' ? 30 : null;
  while (current <= end) {
    if (current >= todayISO()) out.push({...item, occurrenceDate: current});
    if (!step) break;
    current = addDays(current, step);
  }
  return out;
}

function generateGamePlan(){
  const lookaheadDays = Number($('lookaheadDays').value || 45);
  let available = totalBalances();
  const lines = [];
  const paychecks = state.paychecks.flatMap(p=>nextOccurrences(p, lookaheadDays)).sort((a,b)=>a.occurrenceDate.localeCompare(b.occurrenceDate));
  paychecks.forEach(p=>{ available += Number(p.amount || 0); lines.push({type:'income', name:`${p.person} paycheck`, date:p.occurrenceDate, amount:Number(p.amount || 0), note:'Expected income added to plan'}); });
  const fixedBills = state.bills.filter(b=>b.category==='fixed').flatMap(b=>nextOccurrences(b, lookaheadDays)).sort((a,b)=>a.occurrenceDate.localeCompare(b.occurrenceDate));
  fixedBills.forEach(b=>{ const amt=Number(b.amount || 0); available -= amt; lines.push({type:'fixed', name:b.name, date:b.occurrenceDate, amount:amt, note: available >= 0 ? 'Covered' : 'Shortfall risk'}); });
  const variableBills = state.bills.filter(b=>b.category==='variable').flatMap(b=>nextOccurrences(b, lookaheadDays)).sort((a,b)=>a.occurrenceDate.localeCompare(b.occurrenceDate));
  variableBills.forEach(b=>{ const amt=Number(b.amount || 0); available -= amt; lines.push({type:'variable', name:b.name, date:b.occurrenceDate, amount:amt, note: available >= 0 ? 'Planned' : 'Shortfall risk'}); });
  const variableBuckets = state.buckets.filter(b=>b.type==='variable');
  paychecks.forEach(p=> variableBuckets.forEach(bucket=>{ const amt=Number(bucket.amount || 0); available -= amt; lines.push({type:'bucket', name:`${bucket.name} bucket`, date:p.occurrenceDate, amount:amt, note:'Resets each paycheck'}); }));
  const savings = state.buckets.filter(b=>b.type==='savings');
  savings.forEach(goal=>{ if (available <= 0) return; const amt = Math.min(Number(goal.amount || 0), available); available -= amt; lines.push({type:'savings', name:goal.name, date:goal.targetDate || 'No due date', amount:amt, note:'Allocated after bills and non-fixed buckets'}); });
  state.plan = lines;
  state.safeToSpend = Math.max(available,0);
  save();
}
function renderList(idName, items, template){
  const el = $(idName); if (!el) return;
  el.innerHTML = items.length ? items.map(template).join('') : '<p class="muted">Nothing here yet.</p>';
}
function removeItem(kind, itemId){ state[kind] = state[kind].filter(x=>x.id!==itemId); save(); }
window.removeItem = removeItem;
function render(){
  $('safeToSpend').textContent = money(state.safeToSpend || 0);
  renderList('accountSummary', state.accounts, a=>`<div class="item"><div><strong>${a.name}</strong><span class="pill">${a.type}</span></div><span class="amount">${money(a.balance)}</span></div>`);
  renderList('accountsList', state.accounts, a=>`<div class="item"><div><strong>${a.name}</strong><span class="pill">${a.type}</span></div><div><span class="amount">${money(a.balance)}</span><br><button class="remove" onclick="removeItem('accounts','${a.id}')">Remove</button></div></div>`);
  const upcoming = state.bills.flatMap(b=>nextOccurrences(b,45)).sort((a,b)=>a.occurrenceDate.localeCompare(b.occurrenceDate)).slice(0,6);
  renderList('upcomingBills', upcoming, b=>`<div class="item"><div><strong>${b.name}</strong><span class="pill">${b.category} · ${b.recurrence}</span><p class="muted">Due ${b.occurrenceDate} · ${daysBetween(todayISO(), b.occurrenceDate)} days</p></div><span class="amount">${money(b.amount)}</span></div>`);
  renderList('billsList', [...state.bills].sort((a,b)=>(a.dueDate||'').localeCompare(b.dueDate||'')), b=>`<div class="item"><div><strong>${b.name}</strong><span class="pill">${b.category} · ${b.recurrence}</span><p class="muted">Due ${b.dueDate}</p></div><div><span class="amount">${money(b.amount)}</span><br><button class="remove" onclick="removeItem('bills','${b.id}')">Remove</button></div></div>`);
  renderList('bucketsList', state.buckets, b=>`<div class="item"><div><strong>${b.name}</strong><span class="pill">${b.type}</span><p class="muted">${b.targetDate ? 'Target date: '+b.targetDate : 'No target date'}</p></div><div><span class="amount">${money(b.amount)}</span><br><button class="remove" onclick="removeItem('buckets','${b.id}')">Remove</button></div></div>`);
  renderList('paychecksList', [...state.paychecks].sort((a,b)=>(a.nextDate||'').localeCompare(b.nextDate||'')), p=>`<div class="item"><div><strong>${p.person}</strong><span class="pill">${p.frequency}</span><p class="muted">Next: ${p.nextDate}</p></div><div><span class="amount">${money(p.amount)}</span><br><button class="remove" onclick="removeItem('paychecks','${p.id}')">Remove</button></div></div>`);
  renderList('planOutput', state.plan || [], l=>`<div class="item"><div><strong>${l.name}</strong><span class="pill">${l.type}</span><p class="muted">${l.date} · ${l.note}</p></div><span class="amount">${l.type==='income' ? '+' : '-'}${money(l.amount)}</span></div>`);
  updateStorageStatus();
}
function bindForm(formId, kind, mapper){
  $(formId).addEventListener('submit', e=>{ e.preventDefault(); const fd = new FormData(e.target); state[kind].push({id:id(), ...mapper(fd)}); e.target.reset(); save(); });
}
document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.tab,.panel').forEach(x=>x.classList.remove('active'));
  btn.classList.add('active'); $(btn.dataset.tab).classList.add('active');
}));
bindForm('accountForm','accounts',fd=>({name:fd.get('name'), balance:Number(fd.get('balance')), type:fd.get('type')}));
bindForm('billForm','bills',fd=>({name:fd.get('name'), amount:Number(fd.get('amount')), dueDate:fd.get('dueDate'), category:fd.get('category'), recurrence:fd.get('recurrence')}));
bindForm('bucketForm','buckets',fd=>({name:fd.get('name'), amount:Number(fd.get('amount')), type:fd.get('type'), targetDate:fd.get('targetDate')}));
bindForm('paycheckForm','paychecks',fd=>({person:fd.get('person'), amount:Number(fd.get('amount')), nextDate:fd.get('nextDate'), frequency:fd.get('frequency')}));
$('generatePlan').addEventListener('click', generateGamePlan);
$('resetData').addEventListener('click',()=>{ if(confirm('Reset everything?')){ state = structuredClone(defaultState); save(); }});
$('loadSample').addEventListener('click',()=>{
  state = {
    accounts:[{id:id(),name:'US Bank Checking',balance:2200,type:'Checking'},{id:id(),name:'Emergency Savings',balance:500,type:'Savings'}],
    bills:[{id:id(),name:'Mortgage',amount:2100,dueDate:addDays(todayISO(),10),category:'fixed',recurrence:'monthly'},{id:id(),name:'Utilities',amount:300,dueDate:addDays(todayISO(),5),category:'fixed',recurrence:'monthly'}],
    buckets:[{id:id(),name:'Groceries',amount:250,type:'variable',targetDate:''},{id:id(),name:'Gas',amount:120,type:'variable',targetDate:''},{id:id(),name:'Emergency Fund',amount:200,type:'savings',targetDate:''}],
    paychecks:[{id:id(),person:'Nick',amount:1400,nextDate:addDays(todayISO(),7),frequency:'biweekly'},{id:id(),person:'Danielle',amount:1800,nextDate:addDays(todayISO(),14),frequency:'biweekly'}],
    plan:[], safeToSpend:0, updatedAt:null
  }; save();
});
$('exportData').addEventListener('click',()=>{
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `paycheck-game-plan-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$('importData').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    state = { ...structuredClone(defaultState), ...imported };
    save();
  } catch { alert('Could not import that backup file.'); }
  e.target.value = '';
});
window.addEventListener('beforeunload', () => { try { persist(); } catch {} });
render();
