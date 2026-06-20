// Saavi Payroll — split from index.html. Classic script (file:// compatible); globals shared across files.

// ── Config ────────────────────────────────────────────────────────────────────
const API_BASE = (
  window.location.protocol === 'file:' ||
  ['localhost', '127.0.0.1'].includes(window.location.hostname)
) ? 'http://localhost:8000' : '/api';

// ── State ─────────────────────────────────────────────────────────────────────
const state = { employees: [], payrolls: [], categories: [], advanceBalances: {}, settings: {}, payType: localStorage.getItem('saavi_payType') || 'salary' };

function advBalance(empId) {
  return (state.advanceBalances[empId] && state.advanceBalances[empId].balance) || 0;
}

// Mirrors backend _emp_sort_key: numeric Sr. No. sorts numerically, non-numeric
// IDs sort after all numeric ones (alphabetically among themselves).
function _empSortKey(id) {
  const isNum = /^\d+$/.test(id);
  return [isNum ? Number(id) : Infinity, id];
}
function sortByEmpId(emps) {
  return [...emps].sort((a, b) => {
    const ka = _empSortKey(a.id), kb = _empSortKey(b.id);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    return ka[1] < kb[1] ? -1 : ka[1] > kb[1] ? 1 : 0;
  });
}

// ── API helper ────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(API_BASE + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    let msg = `Server error ${res.status}`;
    if (typeof err.detail === 'string') {
      msg = err.detail;
    } else if (Array.isArray(err.detail)) {
      msg = err.detail.map(e => {
        const field = Array.isArray(e.loc) ? e.loc[e.loc.length - 1] : '';
        return field ? `${field}: ${e.msg}` : (e.msg || JSON.stringify(e));
      }).join('; ');
    }
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ── Utilities ─────────────────────────────────────────────────────────────────
const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];
const MS = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function inr(n) { return '₹' + Number(n).toLocaleString('en-IN', {minimumFractionDigits:0, maximumFractionDigits:2}); }

// ── Inline SVG icons (consistent across devices) ────────────────────────────────
const ICONS = {
  team:     '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  payroll:  '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
  history:  '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  advances: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
  search:   '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  doc:      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  alert:    '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
};
function icon(name, cls) {
  return `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}
function clampMax(el) {
  if (el.value !== '' && el.max !== '' && Number(el.value) > Number(el.max)) el.value = el.max;
}
// Clamps both bounds — for plain number inputs (e.g. modal fields) that only set min/max
// without their own oninput recompute logic.
function clampRange(el) {
  if (el.value === '') return;
  let v = Number(el.value);
  if (isNaN(v)) return;
  if (el.min !== '' && v < Number(el.min)) v = Number(el.min);
  if (el.max !== '' && v > Number(el.max)) v = Number(el.max);
  if (String(v) !== el.value) el.value = v;
}
function h(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function ci(name) { return name ? name.charCodeAt(0) % 6 : 0; }
function ini(name) { return name ? name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() : '?'; }
function fmtDate(s) {
  if (!s) return '?';
  const d = new Date(s + 'T00:00:00');
  if (isNaN(d)) return '?';
  return d.getDate() + ' ' + MS[d.getMonth() + 1];
}
function periodDays(from, to) {
  const d1 = new Date(from + 'T00:00:00'), d2 = new Date(to + 'T00:00:00');
  return Math.round((d2 - d1) / 86400000) + 1;
}
function monthName(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym)) return ym;
  const [y, m] = ym.split('-');
  return MONTH_NAMES[parseInt(m) - 1] + ' ' + y;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const icons = { success: '✓', error: '✕', info: '·' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const ic = document.createElement('span'); ic.className = 'toast-ic'; ic.textContent = icons[type];
  const tx = document.createElement('span'); tx.className = 'toast-msg'; tx.textContent = msg;
  el.append(ic, tx);
  el.addEventListener('click', () => removeToast(el));
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => removeToast(el), 3500);
}
function removeToast(el) {
  if (el.classList.contains('removing')) return;
  el.classList.add('removing');
  setTimeout(() => el.remove(), 260);
}
