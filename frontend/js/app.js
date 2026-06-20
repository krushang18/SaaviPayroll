// Saavi Payroll — split from index.html. Classic script (file:// compatible); globals shared across files.

// ── Boot ──────────────────────────────────────────────────────────────────────
let currentView = 'employees';

function renderEmployeesSkeleton() {
  document.getElementById('statsRow').innerHTML =
    Array.from({ length: 4 }, () => '<div class="skel skel-stat"></div>').join('');
  document.getElementById('empList').innerHTML =
    Array.from({ length: 5 }, () => '<div class="skel skel-row"></div>').join('');
}

function renderConnError() {
  document.getElementById('statsRow').innerHTML = '';
  document.getElementById('empList').innerHTML = `
    <div class="conn-error">
      <div class="ce-icon">${icon('alert')}</div>
      <div class="ce-title">Couldn't reach the server</div>
      <div class="ce-sub">Make sure the backend is running, then try again.</div>
      <button class="btn btn-primary" onclick="init()">Retry</button>
    </div>`;
}

async function init() {
  renderEmployeesSkeleton();
  try {
    const pt = state.payType;
    const [emps, payrolls, categories, balances, settings] = await Promise.all([
      api('GET', '/employees?pay_type=' + pt),
      api('GET', '/payrolls?pay_type=' + pt),
      api('GET', '/categories'),
      api('GET', '/advances/balances?pay_type=' + pt),
      api('GET', '/settings'),
    ]);
    state.employees = emps;
    state.payrolls = payrolls;
    state.categories = categories;
    state.advanceBalances = Object.fromEntries(balances.map(b => [b.empId, b]));
    state.settings = settings;
    _syncPayTypeToggle();
  } catch(e) {
    renderConnError();
    toast('Could not reach server — is the backend running?', 'error');
    return;
  }
  renderEmployeeList();
}

async function refreshAdvanceBalances() {
  try {
    const balances = await api('GET', '/advances/balances?pay_type=' + state.payType);
    state.advanceBalances = Object.fromEntries(balances.map(b => [b.empId, b]));
  } catch(e) { /* non-fatal */ }
}

function _syncPayTypeToggle() {
  const s = document.getElementById('ptSalary');
  const c = document.getElementById('ptCash');
  if (s) s.classList.toggle('active', state.payType === 'salary');
  if (c) c.classList.toggle('active', state.payType === 'cash');
}

async function switchPayType(pt) {
  state.payType = pt;
  localStorage.setItem('saavi_payType', pt);
  _syncPayTypeToggle();
  await init();
  switchView(currentView);
}

// ── Views ─────────────────────────────────────────────────────────────────────
function switchView(v) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.getElementById('view-' + v).classList.add('active');
  document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('active'));
  const nb = document.getElementById('bnav-' + v); if (nb) nb.classList.add('active');
  document.querySelectorAll('.dtab').forEach(t => t.classList.remove('active'));
  const map = { employees: 0, calculate: 1, history: 2, advances: 3 };
  const tabs = document.querySelectorAll('.dtab');
  if (tabs[map[v]]) tabs[map[v]].classList.add('active');
  currentView = v;
  if (v === 'employees') renderEmployeeList();
  if (v === 'calculate') initBulkCalc();
  if (v === 'history') renderPayrollHistory();
  if (v === 'advances') initAdvancesView();
  window.scrollTo(0, 0);
}

init();

document.addEventListener('wheel', e => {
  if (e.target.type === 'number' && document.activeElement === e.target) {
    e.preventDefault();
  }
}, { passive: false });
