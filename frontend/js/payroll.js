// Saavi Payroll — split from index.html. Classic script (file:// compatible); globals shared across files.

// ── Bulk Payroll Entry ────────────────────────────────────────────────────────
let bulkInitialized = false;

function toLocalISODate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function initBulkCalc() {
  if (!bulkInitialized) {
    const now = new Date();
    const toD = new Date(now.getFullYear(), now.getMonth(), 25);
    const frD = new Date(toD.getFullYear(), toD.getMonth() - 1, 26);
    document.getElementById('bCalcFrom').value = toLocalISODate(frD);
    document.getElementById('bCalcTo').value = toLocalISODate(toD);
    bulkInitialized = true;
  }
  renderBulkTable();
  onBulkDatesChange();
}

// ── Shared payroll-table renderer (used by Create + Edit) ───────────────────────
// One column layout for both screens. cfg = { mode:'create'|'edit', prefix, month, vals }
// `o` is an employee-like object: { id, name, category, monthly, hourly, workingDays }.
function payrollHeadHTML(cfg) {
  const staffCols = cfg.mode === 'create' ? 4 : 3;   // create has a checkbox column
  const checkTh = cfg.mode === 'create'
    ? `<th class="pcol-check"><input type="checkbox" id="${cfg.prefix}SelectAll" checked onchange="toggleSelectAll(this.checked)" aria-label="Select all employees" title="Select all"></th>`
    : '';
  return `
    <tr class="col-group-row">
      <th class="pcol-grp" colspan="${staffCols}">Staff</th>
      <th colspan="3">Rates</th>
      <th class="grp-sep" colspan="5">Attendance</th>
      <th class="grp-sep" colspan="3">Additions</th>
      <th class="grp-sep" colspan="8">Deductions &amp; Advances</th>
      <th class="grp-sep" colspan="1">Net</th>
    </tr>
    <tr class="col-head-row">
      ${checkTh}
      <th class="pcol-id">Sr. No.</th>
      <th class="pcol-empid">Emp ID</th>
      <th class="pcol-emp">Employee</th>
      <th title="Monthly salary">Monthly</th>
      <th title="Hourly rate">Per Hr</th>
      <th title="Working days required this month">WD</th>
      <th title="Days present">Present</th>
      <th title="Days absent">Absent</th>
      <th title="Normal paid leave days">Nml Leave</th>
      <th title="On-call leave days">OnCall</th>
      <th title="Effective leave after on-call weighting">Eff. Leave</th>
      <th title="Extra / overtime hours">Ex. Hrs</th>
      <th title="Night shifts worked">Night</th>
      <th title="Home visits">Home</th>
      <th title="Debit hours docked">Dbt Hrs</th>
      <th title="Flat debit amount (₹)">Fine</th>
      <th title="Count of 15-min late arrivals">Late 15mins</th>
      <th title="Pay adjustment for attendance vs working days">Day Adj</th>
      <th title="Total debit amount deducted">Debit Amt</th>
      <th title="Late-arrival penalty deducted">Late Ded</th>
      <th title="Advance settled this month">Adv Settle</th>
      <th title="Advance balance before → after">Adv Balance</th>
      <th title="Net payable">Total</th>
    </tr>`;
}

function payrollRowHTML(o, cfg) {
  const p = cfg.prefix;
  const edit = cfg.mode === 'edit';
  const v = cfg.vals || {};
  const id = h(o.id);
  const calc = (slice, src) => edit
    ? `calcEditRow(this.id.slice(${slice}),'${cfg.month}'${src ? `,'${src}'` : ''})`
    : `calcBulkRow(this.id.slice(${slice})${src ? `,'${src}'` : ''})`;
  const va  = x => edit ? ` value="${x ?? ''}"` : '';                 // numeric inputs prefill in edit
  const lv  = x => edit ? ` value="${x ?? ''}"` : '';                 // leave inputs prefill in edit
  const ld  = key => edit ? (v[key] == null ? ' disabled' : '') : ' disabled';  // leaves: create start disabled; edit disabled if null
  const checkboxCell = edit ? '' :
    `<td class="pcol-check"><input type="checkbox" class="${p}RowCheck" id="${p}chk-${id}" checked aria-label="Include ${h(o.name)} in payroll" onchange="updateGrandTotal()"></td>`;
  const isDual = o.shiftType === 'Day & Night';
  const calc2 = (slice, src) => edit
    ? `calcEditRowShift2(this.id.slice(${slice}),'${cfg.month}'${src ? `,'${src}'` : ''})`
    : `calcBulkRowShift2(this.id.slice(${slice})${src ? `,'${src}'` : ''})`;
  const dayRow = `
    <tr id="${p}row-${id}">
      ${checkboxCell}
      <td class="td-mono pcol-id">${id}</td>
      <td class="td-mono pcol-empid">${h(o.empId || '—')}</td>
      <td class="pcol-emp" style="white-space:nowrap;">
        <div style="font-family:var(--sans);font-size:14px;font-weight:600;">${h(o.name)}</div>
        ${o.category ? `<div style="font-size:11px;color:var(--accent);font-weight:500;margin-top:1px;letter-spacing:0.3px;">${h(o.category)}</div>` : ''}
      </td>
      <td class="td-mono">${inr(o.monthly)}</td>
      <td class="td-mono">${inr(o.hourly)}</td>
      <td class="td-mono">${o.workingDays}</td>
      <td><input type="number" step="1" class="bulk-input" id="${p}pr-${id}"${va(v.presentDays)} min="0" max="31" placeholder="—" oninput="clampMax(this);${calc(4,'present')}" style="width:54px;"></td>
      <td><input type="number" step="1" class="bulk-input" id="${p}ab-${id}"${va(v.absentDays)} min="0" max="31" placeholder="—" oninput="clampMax(this);${calc(4,'absent')}" style="width:54px;"></td>
      <td><input type="number" step="1" class="bulk-input" id="${p}nl-${id}"${lv(v.normalLeaves)} min="0" max="99" placeholder="0"${ld('normalLeaves')} oninput="clampMax(this);${calc(4,'normal')}" style="border-color:rgba(230,126,34,0.4);width:54px;"></td>
      <td><input type="number" step="1" class="bulk-input" id="${p}ocl-${id}"${lv(v.onCallLeaves)} min="0" max="99" placeholder="0"${ld('onCallLeaves')} oninput="clampMax(this);${calc(5,'oncall')}" style="border-color:rgba(230,126,34,0.4);width:54px;"></td>
      <td id="${p}efl-${id}" style="font-size:12px;font-weight:500;white-space:nowrap;">—</td>
      <td><input type="number" class="bulk-input" id="${p}hr-${id}"${va(v.extraHours)} min="0" max="999" placeholder="0" oninput="clampMax(this);${calc(4)}" style="width:60px;"></td>
      <td><input type="number" class="bulk-input" id="${p}ns-${id}"${va(v.nightShifts)} min="0" max="99" placeholder="0" oninput="clampMax(this);${calc(4)}" style="border-color:rgba(100,100,200,0.4);width:54px;"></td>
      <td><input type="number" class="bulk-input" id="${p}hv-${id}"${va(v.homeVisits)} min="0" max="99" placeholder="0" oninput="clampMax(this);${calc(4)}" style="border-color:rgba(46,180,80,0.4);width:54px;"></td>
      <td><input type="number" class="bulk-input" id="${p}dh-${id}"${va(v.debitHours)} min="0" max="999" placeholder="0" oninput="clampMax(this);${calc(4)}" style="border-color:rgba(192,57,43,0.3);width:60px;"></td>
      <td><input type="number" class="bulk-input" id="${p}dbt-${id}"${va(v.debitAmount)} min="0" placeholder="0" oninput="${calc(5)}" style="border-color:rgba(192,57,43,0.3);width:54px;"></td>
      <td><input type="number" step="1" class="bulk-input" id="${p}lc-${id}"${va(v.lateCount)} min="0" max="99" placeholder="0" oninput="clampMax(this);${calc(4)}" style="border-color:rgba(192,57,43,0.3);width:54px;"></td>
      <td id="${p}adj-${id}" style="font-size:12px;font-weight:500;white-space:nowrap;">—</td>
      <td id="${p}dbtamt-${id}" style="font-size:12px;font-weight:500;color:var(--danger);white-space:nowrap;">—</td>
      <td id="${p}lp-${id}" style="font-size:12px;font-weight:500;color:var(--danger);white-space:nowrap;">—</td>
      <td><input type="number" class="bulk-input" id="${p}adv-${id}"${va(v.advanceSettlement)} min="0" placeholder="0" oninput="${calc(5)}" style="border-color:rgba(46,134,222,0.4);width:70px;"></td>
      <td id="${p}bal-${id}" style="font-size:11px;font-weight:500;white-space:nowrap;color:var(--ink-3);">—</td>
      <td id="${p}tot-${id}" style="font-family:var(--num);font-size:13px;font-weight:600;color:var(--accent);white-space:nowrap;">—</td>
    </tr>`;
  if (!isDual) return dayRow;
  const ld2 = key => edit ? (v[key] == null ? ' disabled' : '') : ' disabled';
  const nightRow = `
    <tr id="${p}row2-${id}" class="shift2-row">
      ${checkboxCell ? '<td class="pcol-check"></td>' : ''}
      <td class="pcol-id"></td>
      <td class="pcol-empid"></td>
      <td class="pcol-emp" style="white-space:nowrap;padding-left:18px;font-size:12px;color:var(--ink-3);">↳ Night shift</td>
      <td class="td-mono">${inr(o.shift2Monthly || 0)}</td>
      <td class="td-mono">${inr(o.shift2Hourly || 0)}</td>
      <td class="td-mono">${o.workingDays}</td>
      <td><input type="number" step="1" class="bulk-input" id="${p}pr2-${id}"${va(v.shift2PresentDays)} min="0" max="31" placeholder="—" oninput="clampMax(this);${calc2(5,'present')}" style="width:54px;"></td>
      <td><input type="number" step="1" class="bulk-input" id="${p}ab2-${id}"${va(v.shift2AbsentDays)} min="0" max="31" placeholder="—" oninput="clampMax(this);${calc2(5,'absent')}" style="width:54px;"></td>
      <td><input type="number" step="1" class="bulk-input" id="${p}nl2-${id}"${lv(v.shift2NormalLeaves)} min="0" max="99" placeholder="0"${ld2('shift2NormalLeaves')} oninput="clampMax(this);${calc2(5,'normal2')}" style="border-color:rgba(230,126,34,0.4);width:54px;"></td>
      <td><input type="number" step="1" class="bulk-input" id="${p}ocl2-${id}"${lv(v.shift2OnCallLeaves)} min="0" max="99" placeholder="0"${ld2('shift2OnCallLeaves')} oninput="clampMax(this);${calc2(6,'oncall2')}" style="border-color:rgba(230,126,34,0.4);width:54px;"></td>
      <td id="${p}efl2-${id}" style="font-size:12px;font-weight:500;white-space:nowrap;">—</td>
      <td><input type="number" class="bulk-input" id="${p}hr2-${id}"${va(v.shift2ExtraHours)} min="0" max="999" placeholder="0" oninput="clampMax(this);${calc2(5)}" style="width:60px;"></td>
      <td><input type="number" class="bulk-input" id="${p}ns2-${id}"${va(v.shift2NightShifts)} min="0" max="99" placeholder="0" oninput="clampMax(this);${calc2(5)}" style="border-color:rgba(100,100,200,0.4);width:54px;"></td>
      <td><input type="number" class="bulk-input" id="${p}hv2-${id}"${va(v.shift2HomeVisits)} min="0" max="99" placeholder="0" oninput="clampMax(this);${calc2(5)}" style="border-color:rgba(46,180,80,0.4);width:54px;"></td>
      <td><input type="number" class="bulk-input" id="${p}dh2-${id}"${va(v.shift2DebitHours)} min="0" max="999" placeholder="0" oninput="clampMax(this);${calc2(5)}" style="border-color:rgba(192,57,43,0.3);width:60px;"></td>
      <td><input type="number" class="bulk-input" id="${p}dbt2-${id}"${va(v.shift2DebitAmount)} min="0" placeholder="0" oninput="${calc2(6)}" style="border-color:rgba(192,57,43,0.3);width:54px;"></td>
      <td><input type="number" step="1" class="bulk-input" id="${p}lc2-${id}"${va(v.shift2LateCount)} min="0" max="99" placeholder="0" oninput="clampMax(this);${calc2(5)}" style="border-color:rgba(192,57,43,0.3);width:54px;"></td>
      <td id="${p}adj2-${id}" style="font-size:12px;font-weight:500;white-space:nowrap;">—</td>
      <td id="${p}dbtamt2-${id}" style="font-size:12px;font-weight:500;color:var(--danger);white-space:nowrap;">—</td>
      <td id="${p}lp2-${id}" style="font-size:12px;font-weight:500;color:var(--danger);white-space:nowrap;">—</td>
      <td style="color:var(--ink-3);font-size:11px;">—</td>
      <td style="color:var(--ink-3);font-size:11px;">—</td>
      <td id="${p}tot2-${id}" style="font-family:var(--num);font-size:12px;font-weight:600;color:var(--ink-2);white-space:nowrap;">—</td>
    </tr>`;
  return dayRow + nightRow;
}

function renderBulkTable() {
  const tbody = document.getElementById('bulkBody');
  const sortedEmps = sortByEmpId(state.employees);
  // Check if employee rows already exist (preserve in-progress inputs). Dual-shift
  // employees render an extra "row2-" sub-row, which must be excluded from this scan.
  const existingIds = new Set([...tbody.querySelectorAll('tr[id^="brow-"]')].map(r => r.id.slice(5)));
  const currentIds = new Set(sortedEmps.map(e => e.id));
  const sameIds = [...currentIds].every(id => existingIds.has(id)) && existingIds.size === currentIds.size;
  const empHash = sortedEmps.map(e => `${e.id}|${e.empId}|${e.name}|${e.monthly}|${e.hourly}|${e.workingDays}|${e.category}|${e.shiftType}|${e.shift2Monthly}|${e.shift2Hourly}`).join('\n');
  if (sameIds && tbody.dataset.empHash === empHash) return;
  tbody.dataset.empHash = empHash;

  tbody.innerHTML = sortedEmps.map(e => payrollRowHTML(e, { mode: 'create', prefix: 'b' })).join('');
}

function onBulkDatesChange() {
  const from = document.getElementById('bCalcFrom').value;
  const to   = document.getElementById('bCalcTo').value;
  const infoEl  = document.getElementById('bPeriodInfo');
  const overlay = document.getElementById('tableOverlay');

  if (from && to && from <= to) {
    const pd = periodDays(from, to);
    if (pd < 28 || pd > 31) {
      infoEl.textContent = 'Period is ' + pd + ' days — must be between 28 and 31.';
      infoEl.style.cssText = 'display:block;color:var(--danger);font-size:12px;margin-top:6px;';
      overlay.classList.add('active');
      dismissExistingBanner();
      state.employees.forEach(e => calcBulkRow(e.id));
      return;
    }
    // Valid period
    overlay.classList.remove('active');
    // Update present/absent max to exactly pd, and recalculate counterpart for filled rows
    state.employees.forEach(e => {
      const prEl = document.getElementById('bpr-' + e.id);
      const abEl = document.getElementById('bab-' + e.id);
      if (!prEl || !abEl) return;
      if (prEl) prEl.max = pd;
      if (abEl) abEl.max = pd;
      const present = prEl.value !== '' ? parseFloat(prEl.value) : NaN;
      const absent  = abEl.value !== '' ? parseFloat(abEl.value) : NaN;
      if (!isNaN(present)) {
        abEl.value = Math.max(0, pd - Math.floor(present));
      } else if (!isNaN(absent)) {
        prEl.value = Math.max(0, pd - Math.floor(absent));
      }
      const pr2El = document.getElementById('bpr2-' + e.id);
      const ab2El = document.getElementById('bab2-' + e.id);
      if (!pr2El || !ab2El) return;
      pr2El.max = pd; ab2El.max = pd;
      const present2 = pr2El.value !== '' ? parseFloat(pr2El.value) : NaN;
      const absent2  = ab2El.value !== '' ? parseFloat(ab2El.value) : NaN;
      if (!isNaN(present2)) {
        ab2El.value = Math.max(0, pd - Math.floor(present2));
      } else if (!isNaN(absent2)) {
        pr2El.value = Math.max(0, pd - Math.floor(absent2));
      }
    });
    const cd = Math.max(0, 30 - pd);
    let txt = 'Period: ' + pd + ' day' + (pd === 1 ? '' : 's') + ' (' + fmtDate(from) + ' – ' + fmtDate(to) + ')';
    if (cd > 0) txt += ' · +' + cd + ' complementary day' + (cd === 1 ? '' : 's');
    infoEl.textContent = txt;
    infoEl.style.cssText = 'display:block;';
    // Check for existing payroll this month
    const month = to.slice(0, 7);
    const existing = state.payrolls.find(p => p.month === month);
    if (existing) {
      document.getElementById('existingPayrollMsg').textContent =
        'Payroll for ' + monthName(month) + ' (' + fmtDate(existing.fromDate) + ' – ' + fmtDate(existing.toDate) + ') already exists.';
      document.getElementById('existingPayrollBanner').style.display = 'flex';
    } else {
      dismissExistingBanner();
    }
  } else {
    infoEl.style.display = 'none';
    overlay.classList.add('active');
    dismissExistingBanner();
  }
  state.employees.forEach(e => calcBulkRow(e.id));
}

// When absent changes, keep on-call (clamped) and recompute normal = absent - oncall.
// Updates the Eff. Leave display too. No-ops if leave fields are empty.
function _resyncLeavesToAbsent(nlEl, oclEl, efEl, newAbsent) {
  if (!nlEl || !oclEl) return;
  const hasLeaves = nlEl.value !== '' || oclEl.value !== '';
  if (!hasLeaves) return;
  const ocl = Math.min(newAbsent, Math.max(0, Math.floor(parseFloat(oclEl.value) || 0)));
  const nl  = Math.max(0, newAbsent - ocl);
  oclEl.value = ocl;
  nlEl.value  = nl;
  if (efEl) {
    const effOcl = Math.min(ocl, 2) + Math.max(0, ocl - 2) * 2;
    efEl.textContent = nl + effOcl;
  }
}

// Pure salary math shared by Create (live rates) and Edit (snapshot rates).
// effectiveAbsent === null → use `present`; otherwise use leave-derived absence.
function computeRowValues(r) {
  const exactDaily = r.monthly / 30;
  const diff = (r.effectiveAbsent !== null && r.effectiveAbsent !== undefined)
    ? (r.pd - r.effectiveAbsent + r.compDays) - r.workingDays
    : (r.present + r.compDays) - r.workingDays;
  const dayAdj  = diff * exactDaily;
  const basePay = r.monthly + dayAdj;
  const otPay   = r.extraHours * r.hourly;
  const nightPay = r.nightShifts * (r.nightBase + r.nightAppr);
  const debitHrsPay = r.debitHours * r.hourly;
  const latePenalty = Math.max(0, r.lateCount - 5) * (r.monthly < 10000 ? 50 : 100);
  const homeVisitPay = (r.homeVisits || 0) * (r.homeVisitRate || 0);
  const total = Math.floor(basePay + otPay + nightPay + homeVisitPay - r.debitAmount - debitHrsPay - latePenalty - r.advanceSettlement);
  return { dayAdj: Math.floor(dayAdj), basePay: Math.floor(basePay), otPay: Math.floor(otPay),
           nightPay: Math.floor(nightPay), homeVisitPay: Math.floor(homeVisitPay),
           debitHrsPay: Math.floor(debitHrsPay), latePenalty,
           totalDebit: Math.floor(r.debitAmount + debitHrsPay), total };
}

// Reads a Day & Night employee's night sub-row inputs and computes its pay fully
// independently — own leave breakdown, own additions, own deductions, own total.
// (mirrors computeRowValues; advanceSettlement is never per-shift, always 0 here)
function _shift2Contribution(emp, prefix, empId, pd, compDays, nightBase, nightAppr, homeVisitRate) {
  if (emp.shiftType !== 'Day & Night') return { hasInput: false, dayAdj: 0, total: 0 };
  const pr2El  = document.getElementById(prefix + 'pr2-'  + empId);
  const ab2El  = document.getElementById(prefix + 'ab2-'  + empId);
  const nl2El  = document.getElementById(prefix + 'nl2-'  + empId);
  const ocl2El = document.getElementById(prefix + 'ocl2-' + empId);
  if (!pr2El || !ab2El) return { hasInput: false, dayAdj: 0, total: 0 };

  let present = pr2El.value !== '' ? parseFloat(pr2El.value) : NaN;
  let absent  = ab2El.value !== '' ? parseFloat(ab2El.value) : NaN;
  const hasLeaveInput = (nl2El && nl2El.value !== '') || (ocl2El && ocl2El.value !== '');
  if (isNaN(present) && isNaN(absent) && !hasLeaveInput) return { hasInput: false, dayAdj: 0, total: 0 };
  if (isNaN(present)) present = pd - absent;
  if (isNaN(absent))  absent  = pd - present;
  present = Math.floor(present);

  let effectiveAbsent = null;
  const nlVal  = nl2El  && nl2El.value  !== '' ? Math.floor(parseFloat(nl2El.value)  || 0) : null;
  const oclVal = ocl2El && ocl2El.value !== '' ? Math.floor(parseFloat(ocl2El.value) || 0) : null;
  if (nlVal !== null || oclVal !== null) {
    const effOcl = Math.min(oclVal || 0, 2) + Math.max(0, (oclVal || 0) - 2) * 2;
    effectiveAbsent = (nlVal || 0) + effOcl;
  }

  const hr2El  = document.getElementById(prefix + 'hr2-'  + empId);
  const ns2El  = document.getElementById(prefix + 'ns2-'  + empId);
  const hv2El  = document.getElementById(prefix + 'hv2-'  + empId);
  const dh2El  = document.getElementById(prefix + 'dh2-'  + empId);
  const dbt2El = document.getElementById(prefix + 'dbt2-' + empId);
  const lc2El  = document.getElementById(prefix + 'lc2-'  + empId);
  const extraHours  = hr2El  && hr2El.value  !== '' ? parseFloat(hr2El.value)  || 0 : 0;
  const nightShifts = ns2El  && ns2El.value  !== '' ? parseFloat(ns2El.value)  || 0 : 0;
  const homeVisits  = hv2El  && hv2El.value  !== '' ? parseFloat(hv2El.value)  || 0 : 0;
  const debitHours  = dh2El  && dh2El.value  !== '' ? parseFloat(dh2El.value)  || 0 : 0;
  const debitAmount = dbt2El && dbt2El.value !== '' ? parseFloat(dbt2El.value) || 0 : 0;
  const lateCount   = lc2El  && lc2El.value  !== '' ? Math.floor(parseFloat(lc2El.value) || 0) : 0;

  const cv = computeRowValues({
    present, effectiveAbsent, pd, compDays,
    monthly: emp.shift2Monthly || 0, hourly: emp.shift2Hourly || 0, workingDays: emp.workingDays,
    nightBase: nightBase || 0, nightAppr: nightAppr || 0,
    extraHours, nightShifts, debitHours, debitAmount, lateCount, advanceSettlement: 0,
    homeVisits, homeVisitRate: homeVisitRate || 0,
  });

  return { hasInput: true, present, absent: Math.floor(absent), effectiveAbsent, ...cv };
}

function calcBulkRow(empId, source) {
  const from = document.getElementById('bCalcFrom').value;
  const to = document.getElementById('bCalcTo').value;
  const adjEl    = document.getElementById('badj-'    + empId);
  const dbtAmtEl = document.getElementById('bdbtamt-' + empId);
  const lpEl     = document.getElementById('blp-'     + empId);
  const balEl    = document.getElementById('bbal-'    + empId);
  const totEl    = document.getElementById('btot-'    + empId);
  if (!adjEl || !totEl) return;

  if (!from || !to || from > to) {
    adjEl.textContent = '—'; if (dbtAmtEl) dbtAmtEl.textContent = '—'; if (lpEl) lpEl.textContent = '—'; if (balEl) balEl.textContent = '—'; totEl.textContent = '—';
    updateGrandTotal(); return;
  }

  const emp = state.employees.find(e => e.id === empId); if (!emp) return;

  const pd = periodDays(from, to);
  const daily = Math.floor(emp.monthly / 30);
  const wd = emp.workingDays;

  const prEl  = document.getElementById('bpr-'  + empId);
  const abEl  = document.getElementById('bab-'  + empId);
  const hrEl  = document.getElementById('bhr-'  + empId);
  const nlEl  = document.getElementById('bnl-'  + empId);
  const oclEl = document.getElementById('bocl-' + empId);
  const efEl  = document.getElementById('befl-' + empId);

  // ── Step 1: Present / Absent sync ────────────────────────────────────────────
  // Cleared field: reset both and disable leave inputs
  if ((source === 'present' && prEl.value === '') || (source === 'absent' && abEl.value === '')) {
    prEl.value = ''; abEl.value = '';
    if (nlEl)  { nlEl.disabled  = true; nlEl.value  = ''; }
    if (oclEl) { oclEl.disabled = true; oclEl.value = ''; }
    if (efEl)  efEl.textContent = '—';
    adjEl.textContent = '—'; if (dbtAmtEl) dbtAmtEl.textContent = '—'; if (lpEl) lpEl.textContent = '—'; if (balEl) balEl.textContent = '—'; totEl.textContent = '—';
    updateGrandTotal(); return;
  }

  let present = prEl.value !== '' ? parseFloat(prEl.value) : NaN;
  let absent  = abEl.value !== '' ? parseFloat(abEl.value) : NaN;

  if (source === 'present' && !isNaN(present)) {
    const v = Math.min(pd, Math.max(0, Math.floor(present)));
    prEl.value = v; present = v;
    abEl.value = pd - v; absent = pd - v;
    prEl.placeholder = '—'; abEl.placeholder = '—';
    if (nlEl)  nlEl.disabled  = false;
    if (oclEl) oclEl.disabled = false;
    if (nlEl && oclEl && nlEl.value === '' && oclEl.value === '') { nlEl.value = absent; oclEl.value = 0; }
    _resyncLeavesToAbsent(nlEl, oclEl, efEl, absent);
  } else if (source === 'absent' && !isNaN(absent)) {
    const v = Math.min(pd, Math.max(0, Math.floor(absent)));
    abEl.value = v; absent = v;
    prEl.value = pd - v; present = pd - v;
    prEl.placeholder = '—'; abEl.placeholder = '—';
    if (nlEl)  nlEl.disabled  = false;
    if (oclEl) oclEl.disabled = false;
    if (nlEl && oclEl && nlEl.value === '' && oclEl.value === '') { nlEl.value = absent; oclEl.value = 0; }
    _resyncLeavesToAbsent(nlEl, oclEl, efEl, absent);
  } else if (source !== 'normal' && source !== 'oncall') {
    // No source (date change / recalc): sync placeholders, manage lock state
    if (!isNaN(present) && isNaN(absent)) {
      abEl.placeholder = String(Math.max(0, pd - Math.floor(present)));
    } else if (isNaN(present) && !isNaN(absent)) {
      prEl.placeholder = String(Math.max(0, pd - Math.floor(absent)));
    } else {
      prEl.placeholder = '—'; abEl.placeholder = '—';
    }
    const hasAttendance = !isNaN(present) || !isNaN(absent);
    if (nlEl)  nlEl.disabled  = !hasAttendance;
    if (oclEl) oclEl.disabled = !hasAttendance;
    if (!hasAttendance && efEl) efEl.textContent = '—';
  }

  if (isNaN(present) && isNaN(absent)) {
    adjEl.textContent = '—'; if (dbtAmtEl) dbtAmtEl.textContent = '—'; if (lpEl) lpEl.textContent = '—'; if (balEl) balEl.textContent = '—'; totEl.textContent = '—';
    updateGrandTotal(); return;
  }

  if (isNaN(present)) present = pd - absent;
  if (isNaN(absent))  absent  = pd - present;
  present = Math.floor(present);
  absent  = Math.floor(absent);

  if (present < 0) {
    adjEl.textContent = '!'; adjEl.className = 'adj-negative';
    if (dbtAmtEl) dbtAmtEl.textContent = '!';
    if (lpEl) lpEl.textContent = '!';
    if (balEl) balEl.textContent = '!';
    totEl.textContent = '!';
    updateGrandTotal(); return;
  }

  // ── Step 2: Normal / On-call leave sync (normal + oncall = absent) ────────────
  // When one leave field is typed, auto-fill the other so they sum to absent
  if (source === 'normal') {
    if (nlEl.value === '') {
      if (oclEl) oclEl.value = '';
    } else {
      const nl = Math.min(absent, Math.max(0, Math.floor(parseFloat(nlEl.value) || 0)));
      nlEl.value = nl;
      if (oclEl) oclEl.value = absent - nl;
    }
  } else if (source === 'oncall') {
    if (oclEl.value === '') {
      if (nlEl) nlEl.value = '';
    } else {
      const ocl = Math.min(absent, Math.max(0, Math.floor(parseFloat(oclEl.value) || 0)));
      oclEl.value = ocl;
      if (nlEl) nlEl.value = absent - ocl;
    }
  }

  // Compute effective absence from leave fields (if any are filled)
  let effectiveAbsent = null;
  const nlVal  = nlEl  && nlEl.value  !== '' ? Math.floor(parseFloat(nlEl.value)  || 0) : null;
  const oclVal = oclEl && oclEl.value !== '' ? Math.floor(parseFloat(oclEl.value) || 0) : null;
  if (nlVal !== null || oclVal !== null) {
    const effOcl = Math.min(oclVal || 0, 2) + Math.max(0, (oclVal || 0) - 2) * 2;
    effectiveAbsent = (nlVal || 0) + effOcl;
    if (efEl) efEl.textContent = effectiveAbsent;
  } else if (source !== 'present' && source !== 'absent') {
    if (efEl) efEl.textContent = '—';
  }

  // ── Step 3: Salary calculation ────────────────────────────────────────────────
  const compDays = Math.max(0, 30 - pd);
  const extraHours = hrEl.value !== '' ? parseFloat(hrEl.value) || 0 : 0;
  const nsEl = document.getElementById('bns-' + empId);
  const nightShifts = nsEl && nsEl.value !== '' ? parseFloat(nsEl.value) || 0 : 0;
  const dhEl = document.getElementById('bdh-' + empId);
  const debitHours = dhEl && dhEl.value !== '' ? parseFloat(dhEl.value) || 0 : 0;
  const dbtEl = document.getElementById('bdbt-' + empId);
  const debitAmount = dbtEl && dbtEl.value !== '' ? parseFloat(dbtEl.value) || 0 : 0;
  const lcEl = document.getElementById('blc-' + empId);
  const lateCount = lcEl && lcEl.value !== '' ? Math.floor(parseFloat(lcEl.value) || 0) : 0;
  const advEl = document.getElementById('badv-' + empId);
  const advanceSettlement = advEl && advEl.value !== '' ? parseFloat(advEl.value) || 0 : 0;
  const hvEl = document.getElementById('bhv-' + empId);
  const homeVisits = hvEl && hvEl.value !== '' ? parseFloat(hvEl.value) || 0 : 0;
  const cat = state.categories.find(c => c.name === emp.category);
  // Create uses live employee/category rates.
  const cv = computeRowValues({
    present, effectiveAbsent, pd, compDays,
    monthly: emp.monthly, daily, hourly: emp.hourly, workingDays: wd,
    nightBase: cat ? cat.nightBase : 0, nightAppr: cat ? cat.nightAppr : 0,
    extraHours, nightShifts, debitHours, debitAmount, lateCount, advanceSettlement,
    homeVisits, homeVisitRate: state.settings.homeVisitRate || 0,
  });
  const { dayAdj } = cv;
  const s2 = _shift2Contribution(emp, 'b', empId, pd, compDays,
    cat ? cat.nightBase : 0, cat ? cat.nightAppr : 0, state.settings.homeVisitRate || 0);
  const adj2El    = document.getElementById('badj2-'    + empId);
  const dbtAmt2El = document.getElementById('bdbtamt2-' + empId);
  const lp2El     = document.getElementById('blp2-'     + empId);
  const tot2El    = document.getElementById('btot2-'    + empId);
  if (adj2El) {
    adj2El.textContent = s2.hasInput ? (s2.dayAdj >= 0 ? '+' : '') + inr(s2.dayAdj) : '—';
    adj2El.className = s2.dayAdj > 0 ? 'adj-positive' : s2.dayAdj < 0 ? 'adj-negative' : '';
  }
  if (dbtAmt2El) dbtAmt2El.textContent = (s2.hasInput && s2.totalDebit > 0) ? '-' + inr(s2.totalDebit) : '—';
  if (lp2El) lp2El.textContent = (s2.hasInput && s2.latePenalty > 0) ? '-' + inr(s2.latePenalty) : '—';
  if (tot2El) tot2El.textContent = s2.hasInput ? inr(s2.total) : '—';
  const total = cv.total + (s2.hasInput ? s2.total : 0);

  adjEl.textContent = (dayAdj >= 0 ? '+' : '') + inr(dayAdj);
  adjEl.className = dayAdj > 0 ? 'adj-positive' : dayAdj < 0 ? 'adj-negative' : '';
  if (dbtAmtEl) dbtAmtEl.textContent = cv.totalDebit > 0 ? '-' + inr(cv.totalDebit) : '—';
  if (lpEl) lpEl.textContent = cv.latePenalty > 0 ? '-' + inr(cv.latePenalty) : '—';
  if (balEl) {
    const savedAdv = parseFloat(advEl?.dataset.savedAdv || 0);
    const available = advBalance(empId) + savedAdv;
    const remaining = available - advanceSettlement;
    if (advanceSettlement > available) {
      balEl.innerHTML = `<span style="color:var(--danger);">Exceeds! Bal: ${inr(available)}</span>`;
      if (advEl) advEl.classList.add('missing');
    } else {
      if (advEl) advEl.classList.remove('missing');
      balEl.textContent = (available > 0 || advanceSettlement > 0) ? `Bal: ${inr(available)} → ${inr(remaining)}` : '—';
    }
  }
  totEl.textContent = inr(total);

  updateGrandTotal();
}

// Night sub-row present/absent + leave auto-balance (mirrors the day row's Step 1+2
// in calcBulkRow), then defers the actual pay math to calcBulkRow.
function calcBulkRowShift2(empId, source) {
  const from = document.getElementById('bCalcFrom').value;
  const to = document.getElementById('bCalcTo').value;
  const pr2El  = document.getElementById('bpr2-'  + empId);
  const ab2El  = document.getElementById('bab2-'  + empId);
  const nl2El  = document.getElementById('bnl2-'  + empId);
  const ocl2El = document.getElementById('bocl2-' + empId);
  const efl2El = document.getElementById('befl2-' + empId);
  if (!pr2El || !ab2El || !from || !to || from > to) { calcBulkRow(empId); return; }
  const pd = periodDays(from, to);

  if ((source === 'present' && pr2El.value === '') || (source === 'absent' && ab2El.value === '')) {
    pr2El.value = ''; ab2El.value = '';
    if (nl2El)  { nl2El.disabled  = true; nl2El.value  = ''; }
    if (ocl2El) { ocl2El.disabled = true; ocl2El.value = ''; }
    if (efl2El) efl2El.textContent = '—';
  } else if (source === 'present' && pr2El.value !== '') {
    const v = Math.min(pd, Math.max(0, Math.floor(parseFloat(pr2El.value) || 0)));
    pr2El.value = v; ab2El.value = pd - v;
    if (nl2El)  nl2El.disabled  = false;
    if (ocl2El) ocl2El.disabled = false;
    if (nl2El && ocl2El && nl2El.value === '' && ocl2El.value === '') { nl2El.value = pd - v; ocl2El.value = 0; }
    _resyncLeavesToAbsent(nl2El, ocl2El, efl2El, pd - v);
  } else if (source === 'absent' && ab2El.value !== '') {
    const v = Math.min(pd, Math.max(0, Math.floor(parseFloat(ab2El.value) || 0)));
    ab2El.value = v; pr2El.value = pd - v;
    if (nl2El)  nl2El.disabled  = false;
    if (ocl2El) ocl2El.disabled = false;
    if (nl2El && ocl2El && nl2El.value === '' && ocl2El.value === '') { nl2El.value = v; ocl2El.value = 0; }
    _resyncLeavesToAbsent(nl2El, ocl2El, efl2El, v);
  }

  const absent2 = parseFloat(ab2El.value) || 0;
  if (source === 'normal2' && nl2El) {
    if (nl2El.value === '') {
      if (ocl2El) ocl2El.value = '';
    } else {
      const nl = Math.min(absent2, Math.max(0, Math.floor(parseFloat(nl2El.value) || 0)));
      nl2El.value = nl;
      if (ocl2El) ocl2El.value = absent2 - nl;
    }
  } else if (source === 'oncall2' && ocl2El) {
    if (ocl2El.value === '') {
      if (nl2El) nl2El.value = '';
    } else {
      const ocl = Math.min(absent2, Math.max(0, Math.floor(parseFloat(ocl2El.value) || 0)));
      ocl2El.value = ocl;
      if (nl2El) nl2El.value = absent2 - ocl;
    }
  }

  if (efl2El && (source === 'normal2' || source === 'oncall2')) {
    const nlVal  = nl2El  && nl2El.value  !== '' ? Math.floor(parseFloat(nl2El.value)  || 0) : null;
    const oclVal = ocl2El && ocl2El.value !== '' ? Math.floor(parseFloat(ocl2El.value) || 0) : null;
    if (nlVal !== null || oclVal !== null) {
      const effOcl = Math.min(oclVal || 0, 2) + Math.max(0, (oclVal || 0) - 2) * 2;
      efl2El.textContent = (nlVal || 0) + effOcl;
    } else {
      efl2El.textContent = '—';
    }
  }

  calcBulkRow(empId);
}

function updateGrandTotal() {
  let sum = 0, count = 0;
  state.employees.forEach(emp => {
    const row = document.getElementById('brow-' + emp.id);
    const el = document.getElementById('btot-' + emp.id);
    const hasValue = el && el.textContent !== '—' && el.textContent !== '!';
    if (row) row.classList.toggle('filled', !!hasValue);
    const cb = document.getElementById('bchk-' + emp.id);
    if (!cb || !cb.checked) return;
    if (hasValue) {
      const v = parseFloat(el.textContent.replace(/[₹,]/g, ''));
      if (!isNaN(v)) { sum += v; count++; }
    }
  });
  const display = count > 0 ? inr(sum) : '—';
  const gtEl = document.getElementById('bGrandTotal');
  if (gtEl) gtEl.textContent = display;
  const sumEl = document.getElementById('bSummaryTotal');
  if (sumEl) sumEl.textContent = display;
  const cntEl = document.getElementById('bCheckedCount');
  if (cntEl) cntEl.textContent = state.employees.filter(e => {
    const cb = document.getElementById('bchk-' + e.id); return cb && cb.checked;
  }).length;
}

async function savePayroll() {
  const fromDate = document.getElementById('bCalcFrom').value;
  const toDate   = document.getElementById('bCalcTo').value;
  if (!fromDate || !toDate) { toast('Set the pay period first.', 'error'); return; }

  // month key derived from toDate: "2026-04-25" → "2026-04"
  const month = toDate.slice(0, 7);

  const entries = [];
  const errors  = [];

  for (const emp of state.employees) {
    const cb = document.getElementById('bchk-' + emp.id);
    if (!cb || !cb.checked) continue;   // skip unchecked employees

    const prEl = document.getElementById('bpr-' + emp.id);
    const abEl = document.getElementById('bab-' + emp.id);
    const hrEl = document.getElementById('bhr-' + emp.id);
    const nlEl  = document.getElementById('bnl-'  + emp.id);
    const oclEl = document.getElementById('bocl-' + emp.id);

    const presentDays  = prEl  && prEl.value  !== '' ? parseFloat(prEl.value)  : null;
    const absentDays   = abEl  && abEl.value  !== '' ? parseFloat(abEl.value)  : null;
    const normalLeaves = (nlEl  && !nlEl.disabled  && nlEl.value  !== '') ? parseFloat(nlEl.value)  : null;
    const onCallLeaves = (oclEl && !oclEl.disabled && oclEl.value !== '') ? parseFloat(oclEl.value) : null;
    const extraHours  = hrEl && hrEl.value !== '' ? parseFloat(hrEl.value) || 0 : 0;
    const nsEl = document.getElementById('bns-' + emp.id);
    const nightShifts = nsEl && nsEl.value !== '' ? parseFloat(nsEl.value) || 0 : 0;
    const dhEl = document.getElementById('bdh-' + emp.id);
    const debitHours = dhEl && dhEl.value !== '' ? parseFloat(dhEl.value) || 0 : 0;
    const dbtEl = document.getElementById('bdbt-' + emp.id);
    const debitAmount = dbtEl && dbtEl.value !== '' ? parseFloat(dbtEl.value) || 0 : 0;
    const lcEl = document.getElementById('blc-' + emp.id);
    const lateCount = lcEl && lcEl.value !== '' ? parseFloat(lcEl.value) || 0 : 0;
    const advEl = document.getElementById('badv-' + emp.id);
    const advanceSettlement = advEl && advEl.value !== '' ? parseFloat(advEl.value) || 0 : 0;
    if (advanceSettlement > 0) {
      const savedAdv = parseFloat(advEl?.dataset.savedAdv || 0);
      const available = advBalance(emp.id) + savedAdv;
      if (advanceSettlement > available) {
        errors.push(`${emp.name} (advance settlement ${inr(advanceSettlement)} exceeds balance ${inr(available)})`);
        advEl.classList.add('missing');
        continue;
      }
      advEl.classList.remove('missing');
    }
    const hvSaveEl = document.getElementById('bhv-' + emp.id);
    const homeVisits = hvSaveEl && hvSaveEl.value !== '' ? parseFloat(hvSaveEl.value) || 0 : 0;

    let shift2PresentDays = null, shift2AbsentDays = null, shift2ExtraHours = 0;
    let shift2NormalLeaves = null, shift2OnCallLeaves = null;
    let shift2NightShifts = 0, shift2HomeVisits = 0, shift2DebitHours = 0, shift2DebitAmount = 0, shift2LateCount = 0;
    if (emp.shiftType === 'Day & Night') {
      const pr2El  = document.getElementById('bpr2-'  + emp.id);
      const ab2El  = document.getElementById('bab2-'  + emp.id);
      const hr2El  = document.getElementById('bhr2-'  + emp.id);
      const nl2El  = document.getElementById('bnl2-'  + emp.id);
      const ocl2El = document.getElementById('bocl2-' + emp.id);
      const ns2El  = document.getElementById('bns2-'  + emp.id);
      const hv2El  = document.getElementById('bhv2-'  + emp.id);
      const dh2El  = document.getElementById('bdh2-'  + emp.id);
      const dbt2El = document.getElementById('bdbt2-' + emp.id);
      const lc2El  = document.getElementById('blc2-'  + emp.id);
      shift2PresentDays  = pr2El  && pr2El.value  !== '' ? parseFloat(pr2El.value)  : null;
      shift2AbsentDays   = ab2El  && ab2El.value  !== '' ? parseFloat(ab2El.value)  : null;
      shift2ExtraHours   = hr2El  && hr2El.value  !== '' ? parseFloat(hr2El.value)  || 0 : 0;
      shift2NormalLeaves = (nl2El  && !nl2El.disabled  && nl2El.value  !== '') ? parseFloat(nl2El.value)  : null;
      shift2OnCallLeaves = (ocl2El && !ocl2El.disabled && ocl2El.value !== '') ? parseFloat(ocl2El.value) : null;
      shift2NightShifts  = ns2El  && ns2El.value  !== '' ? parseFloat(ns2El.value)  || 0 : 0;
      shift2HomeVisits   = hv2El  && hv2El.value  !== '' ? parseFloat(hv2El.value)  || 0 : 0;
      shift2DebitHours   = dh2El  && dh2El.value  !== '' ? parseFloat(dh2El.value)  || 0 : 0;
      shift2DebitAmount  = dbt2El && dbt2El.value !== '' ? parseFloat(dbt2El.value) || 0 : 0;
      shift2LateCount    = lc2El  && lc2El.value  !== '' ? parseFloat(lc2El.value)  || 0 : 0;

      const ab2 = shift2AbsentDays ?? 0;
      if (shift2PresentDays === null && shift2AbsentDays === null && shift2NormalLeaves === null && shift2OnCallLeaves === null) {
        errors.push(emp.name + ' (no night-shift attendance)');
        if (pr2El) pr2El.classList.add('missing');
        if (ab2El) ab2El.classList.add('missing');
        continue;
      } else if (ab2 > 0 && shift2NormalLeaves === null && shift2OnCallLeaves === null) {
        errors.push(`${emp.name} (fill night-shift normal & on-call leaves — absent is ${ab2})`);
        if (nl2El)  nl2El.classList.add('missing');
        if (ocl2El) ocl2El.classList.add('missing');
        continue;
      } else if (ab2 > 0 && (shift2NormalLeaves !== null || shift2OnCallLeaves !== null)) {
        const leaveSum2 = (shift2NormalLeaves || 0) + (shift2OnCallLeaves || 0);
        if (leaveSum2 !== ab2) {
          errors.push(`${emp.name} (night-shift normal + on-call = ${leaveSum2}, must equal absent ${ab2})`);
          if (nl2El)  nl2El.classList.add('missing');
          if (ocl2El) ocl2El.classList.add('missing');
          continue;
        }
      }
      if (pr2El)  pr2El.classList.remove('missing');
      if (ab2El)  ab2El.classList.remove('missing');
      if (nl2El)  nl2El.classList.remove('missing');
      if (ocl2El) ocl2El.classList.remove('missing');
    }

    const ab = absentDays ?? 0;
    if (presentDays === null && absentDays === null && normalLeaves === null && onCallLeaves === null) {
      errors.push(emp.name + ' (no attendance)');
      if (prEl) prEl.classList.add('missing');
      if (abEl) abEl.classList.add('missing');
    } else if (ab > 0 && normalLeaves === null && onCallLeaves === null) {
      // Absent days exist but no leave breakdown entered
      errors.push(`${emp.name} (fill normal & on-call leaves — absent is ${ab})`);
      if (nlEl)  nlEl.classList.add('missing');
      if (oclEl) oclEl.classList.add('missing');
    } else if (ab > 0 && (normalLeaves !== null || onCallLeaves !== null)) {
      // Leave breakdown must sum to absent days
      const leaveSum = (normalLeaves || 0) + (onCallLeaves || 0);
      if (leaveSum !== ab) {
        errors.push(`${emp.name} (normal + on-call = ${leaveSum}, must equal absent ${ab})`);
        if (nlEl)  nlEl.classList.add('missing');
        if (oclEl) oclEl.classList.add('missing');
      } else {
        if (prEl)  prEl.classList.remove('missing');
        if (abEl)  abEl.classList.remove('missing');
        if (nlEl)  nlEl.classList.remove('missing');
        if (oclEl) oclEl.classList.remove('missing');
        entries.push({ empId: emp.id, presentDays, absentDays, normalLeaves, onCallLeaves, extraHours, nightShifts, debitHours, debitAmount, lateCount, advanceSettlement, homeVisits, shift2PresentDays, shift2AbsentDays, shift2ExtraHours, shift2NormalLeaves, shift2OnCallLeaves, shift2NightShifts, shift2HomeVisits, shift2DebitHours, shift2DebitAmount, shift2LateCount });
      }
    } else {
      if (prEl)  prEl.classList.remove('missing');
      if (abEl)  abEl.classList.remove('missing');
      if (nlEl)  nlEl.classList.remove('missing');
      if (oclEl) oclEl.classList.remove('missing');
      entries.push({ empId: emp.id, presentDays, absentDays, normalLeaves, onCallLeaves, extraHours, nightShifts, debitHours, debitAmount, advanceSettlement, homeVisits, shift2PresentDays, shift2AbsentDays, shift2ExtraHours, shift2NormalLeaves, shift2OnCallLeaves, shift2NightShifts, shift2HomeVisits, shift2DebitHours, shift2DebitAmount, shift2LateCount });
    }
  }

  if (errors.length > 0) {
    toast(`${errors.length} employee${errors.length > 1 ? 's' : ''} need attention:\n• ` + errors.join('\n• '), 'error'); return;
  }
  if (entries.length === 0) { toast('Check and fill at least one employee.', 'error'); return; }

  const btn = document.getElementById('bSaveBtn');
  btn.disabled = true;
  try {
    // Use PUT if payroll for this month already exists, POST otherwise
    const exists = state.payrolls.find(p => p.month === month);
    const method = exists ? 'PUT' : 'POST';
    const path   = exists ? '/payrolls/' + month : '/payrolls';
    const saved  = await api(method, path, { month, fromDate, toDate, entries, payType: state.payType });

    if (exists) {
      state.payrolls = state.payrolls.map(p => p.month === month ? saved : p);
    } else {
      state.payrolls.push(saved);
    }
    await refreshAdvanceBalances();
    toast('Payroll saved for ' + monthName(month) + '.', 'success');
    switchView('history');
  } catch(e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function toggleSelectAll(checked) {
  state.employees.forEach(e => {
    const cb = document.getElementById('bchk-' + e.id);
    if (cb) cb.checked = checked;
  });
  updateGrandTotal();
}

function dismissExistingBanner() {
  document.getElementById('existingPayrollBanner').style.display = 'none';
}

function loadExistingPayroll() {
  const month = document.getElementById('bCalcTo').value.slice(0, 7);
  const payroll = state.payrolls.find(p => p.month === month);
  if (!payroll || !payroll.records) return;
  dismissExistingBanner();
  // Uncheck all first
  state.employees.forEach(e => {
    const cb = document.getElementById('bchk-' + e.id);
    if (cb) cb.checked = false;
  });
  // Fill each employee that has a record
  payroll.records.forEach(r => {
    const cb = document.getElementById('bchk-' + r.empId);
    if (cb) cb.checked = true;
    const set = (id, val) => { const el = document.getElementById(id); if (el !== null) el.value = (val != null ? val : ''); };
    set('bpr-'  + r.empId, r.presentDays);
    set('bab-'  + r.empId, r.absentDays);
    set('bhr-'  + r.empId, r.extraHours  || 0);
    set('bns-'  + r.empId, r.nightShifts || 0);
    set('bdh-'  + r.empId, r.debitHours  || 0);
    set('bdbt-' + r.empId, r.debitAmount || 0);
    set('blc-'  + r.empId, r.lateCount   || 0);
    set('badv-' + r.empId, r.advanceSettlement || 0);
    set('bhv-'  + r.empId, r.homeVisits || 0);
    const advEl = document.getElementById('badv-' + r.empId);
    if (advEl) advEl.dataset.savedAdv = r.advanceSettlement || 0;
    set('bpr2-' + r.empId, r.shift2PresentDays);
    set('bab2-' + r.empId, r.shift2AbsentDays);
    set('bhr2-' + r.empId, r.shift2ExtraHours || 0);
    // Enable and fill leave fields from saved data
    const nlEl  = document.getElementById('bnl-'  + r.empId);
    const oclEl = document.getElementById('bocl-' + r.empId);
    const efEl  = document.getElementById('befl-' + r.empId);
    if (nlEl)  { nlEl.disabled  = false; nlEl.value  = r.normalLeaves  != null ? r.normalLeaves  : (r.absentDays || 0); }
    if (oclEl) { oclEl.disabled = false; oclEl.value = r.onCallLeaves   != null ? r.onCallLeaves  : 0; }
    if (nlEl && oclEl && efEl) {
      const nl = Math.floor(parseFloat(nlEl.value) || 0);
      const ocl = Math.floor(parseFloat(oclEl.value) || 0);
      const effOcl = Math.min(ocl, 2) + Math.max(0, ocl - 2) * 2;
      efEl.textContent = nl + effOcl;
    }
    calcBulkRow(r.empId);
  });
  // Sync select-all checkbox state
  const allChecked = state.employees.every(e => {
    const cb = document.getElementById('bchk-' + e.id);
    return cb && cb.checked;
  });
  const selectAll = document.getElementById('bSelectAll');
  if (selectAll) selectAll.checked = allChecked;
  toast('Loaded ' + monthName(month) + ' payroll — review and save changes.', 'info');
}

// ── Settings modal ──────────────────────────────────────────────────────────
function openSettingsModal() {
  document.getElementById('sHomeVisitRate').value = state.settings.homeVisitRate || '';
  document.getElementById('settingsModal').classList.add('open');
}
function closeSettingsModal() { document.getElementById('settingsModal').classList.remove('open'); }

async function saveSettings() {
  const homeVisitRate = parseFloat(document.getElementById('sHomeVisitRate').value) || 0;
  if (homeVisitRate < 0) { toast('Rate cannot be negative.', 'error'); return; }
  try {
    const result = await api('PUT', '/settings', { homeVisitRate });
    state.settings = result;
    closeSettingsModal();
    toast('Settings saved.', 'success');
  } catch(e) {
    toast(e.message, 'error');
  }
}

document.getElementById('settingsModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeSettingsModal(); });
