// Saavi Payroll — Salary Slip tab. Classic script (file:// compatible); globals shared across files.
// Pick a saved payroll, enter a PF (Provident Fund) deduction per employee, and download an
// individual payslip PDF (single row or bulk). Final amount comes straight from the payroll
// record's `total` (advance already deducted) — the slip only subtracts PF, never recomputes.

let slipSelectedMonth = null;
let _slipPfTimer = null;

// ── Per-record figure helpers (dual-shift "Day & Night" staff sum both shifts) ──
function slipPresentDays(r)   { return (r.presentDays || 0) + (r.shift2PresentDays || 0); }
function slipPresentSalary(r) { return (r.basePay || 0) + (r.shift2BasePay || 0); }
function slipFine(r) {
  return (r.latePenalty || 0) + (r.debitAmount || 0) +
         (r.shift2LatePenalty || 0) + (r.shift2DebitAmount || 0);
}
function slipAdvance(r)     { return r.advanceSettlement || 0; }
function slipOutstanding(r) { return advBalance(r.empId); }
function slipFinal(r)       { return r.total || 0; }

// ── View entry point ────────────────────────────────────────────────────────────
function initSalarySlipView() {
  // Drop a stale selection if it no longer exists for the active pay type.
  if (slipSelectedMonth && !state.payrolls.some(p => p.month === slipSelectedMonth)) {
    slipSelectedMonth = null;
  }
  renderSlipMonths();
  if (slipSelectedMonth) renderSlipEmployees(slipSelectedMonth);
  else document.getElementById('slipEmployees').innerHTML = '';
}

function renderSlipMonths() {
  const host = document.getElementById('slipMonths');
  if (!state.payrolls.length) {
    host.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('doc')}</div><div class="empty-text">No payrolls saved</div><div class="empty-sub">Go to Payroll tab and save a month first</div></div>`;
    return;
  }
  const sorted = [...state.payrolls].sort((a, b) => b.month > a.month ? 1 : -1);
  host.innerHTML = `<div class="page-sub" style="margin-bottom:10px;">Select a payroll</div>` +
    sorted.map(p => {
      const sel = p.month === slipSelectedMonth;
      return `
      <div class="month-card" style="${sel ? 'border-color:var(--accent);box-shadow:0 0 0 1px var(--accent);' : ''}margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
          <div>
            <div style="font-family:var(--sans);font-size:20px;font-weight:700;">${monthName(p.month)}</div>
            <div style="font-size:12px;color:var(--ink-3);margin-top:3px;">${fmtDate(p.fromDate)} – ${fmtDate(p.toDate)} &nbsp;·&nbsp; ${p.employeeCount} employees</div>
          </div>
          <button class="btn ${sel ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="selectSlipMonth('${p.month}')">${sel ? 'Selected' : 'Select'}</button>
        </div>
      </div>`;
    }).join('');
}

function selectSlipMonth(month) {
  slipSelectedMonth = month;
  renderSlipMonths();
  renderSlipEmployees(month);
  document.getElementById('slipEmployees').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderSlipEmployees(month) {
  const host = document.getElementById('slipEmployees');
  const payroll = state.payrolls.find(p => p.month === month);
  if (!payroll || !payroll.records) { host.innerHTML = ''; return; }

  const recs = sortByEmpId(payroll.records);
  const rows = recs.map(r => {
    const id = r.empId;
    const final = slipFinal(r);
    const pf = (r.pfAmount && r.pfAmount > 0) ? r.pfAmount : '';
    const net = final - (Number(pf) || 0);
    return `
      <tr>
        <td class="pcol-check"><input type="checkbox" class="sRowCheck" id="schk-${h(id)}" checked aria-label="Include ${h(r.empName)}"></td>
        <td style="text-align:left;">${h(r.empName)}<div style="font-size:11px;color:var(--ink-3);">${h(id)}</div></td>
        <td class="num">${slipPresentDays(r)}</td>
        <td class="num">${inr(slipPresentSalary(r))}</td>
        <td class="num">${inr(slipFine(r))}</td>
        <td class="num">${inr(slipAdvance(r))}</td>
        <td class="num">${inr(slipOutstanding(r))}</td>
        <td class="num">${inr(final)}</td>
        <td class="num"><input type="number" class="bulk-input sPfInput" id="spf-${h(id)}" data-empid="${h(id)}" value="${pf}" min="0" max="${final}" step="1" placeholder="—" style="width:90px;text-align:right;" oninput="slipOnPfInput('${h(id)}','${month}')"></td>
        <td class="num" id="snet-${h(id)}"><b>${inr(net)}</b></td>
        <td><button class="btn btn-outline btn-sm" onclick="downloadSlip('${month}','${h(id)}')">Download</button></td>
      </tr>`;
  }).join('');

  host.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin:18px 0 12px;">
      <div style="font-family:var(--sans);font-size:18px;font-weight:700;">${monthName(payroll.month)} · ${payroll.employeeCount} employees</div>
      <button class="btn btn-primary btn-sm" onclick="downloadAllSlips('${month}')">Download All (selected)</button>
    </div>
    <div class="table-wrap">
      <table class="payroll-summary-table" style="min-width:900px;">
        <thead>
          <tr>
            <th class="pcol-check"><input type="checkbox" id="sSelectAll" checked onchange="slipToggleAll(this.checked)" aria-label="Select all" title="Select all"></th>
            <th style="text-align:left;">Employee</th>
            <th class="num">Present Days</th>
            <th class="num">Present Salary</th>
            <th class="num">Fine / Late</th>
            <th class="num">Advance Deducted</th>
            <th class="num">Outstanding Advance</th>
            <th class="num">Final Amount</th>
            <th class="num">PF / Tax</th>
            <th class="num">Net (after PF / Tax)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="font-size:12px;color:var(--ink-3);margin-top:10px;">Enter a PF / Tax amount to enable each slip. Values are saved to this payroll automatically.</div>`;
}

// ── PF input handling ────────────────────────────────────────────────────────────
function slipOnPfInput(empId, month) {
  const input = document.getElementById('spf-' + empId);
  if (!input) return;
  clampRange(input);
  const payroll = state.payrolls.find(p => p.month === month);
  const rec = payroll && payroll.records.find(r => r.empId === empId);
  const netCell = document.getElementById('snet-' + empId);
  if (rec && netCell) {
    const net = slipFinal(rec) - (Number(input.value) || 0);
    netCell.innerHTML = `<b>${inr(net)}</b>`;
  }
  slipSchedulePfSave(month);
}

function slipToggleAll(checked) {
  document.querySelectorAll('.sRowCheck').forEach(cb => { cb.checked = checked; });
}

// Collect all filled PF inputs (empty = not entered, so left untouched server-side).
function collectSlipPf() {
  const pf = {};
  document.querySelectorAll('.sPfInput').forEach(input => {
    if (input.value !== '' && input.value != null) {
      pf[input.dataset.empid] = Number(input.value) || 0;
    }
  });
  return pf;
}

function slipSchedulePfSave(month) {
  clearTimeout(_slipPfTimer);
  _slipPfTimer = setTimeout(() => {
    slipPersistPf(month).catch(e => toast(e.message || 'Could not save PF.', 'error'));
  }, 700);
}

// Persist entered PF to the payroll; refresh state.payrolls in place from the response.
async function slipPersistPf(month) {
  clearTimeout(_slipPfTimer);
  const pf = collectSlipPf();
  const updated = await api('PUT', `/payrolls/${month}/pf?pay_type=${state.payType}`, { pf });
  const idx = state.payrolls.findIndex(p => p.month === month);
  if (idx >= 0) state.payrolls[idx] = updated;
  return updated;
}

// ── Downloads ────────────────────────────────────────────────────────────────────
async function downloadSlip(month, empId) {
  const input = document.getElementById('spf-' + empId);
  if (!input || input.value === '') { toast('Enter a PF / Tax amount for this employee first.', 'error'); return; }
  let payroll;
  try { payroll = await slipPersistPf(month); }
  catch (e) { toast(e.message || 'Could not save PF.', 'error'); return; }
  const rec = payroll.records.find(r => r.empId === empId);
  if (!rec) { toast('Employee not found in payroll.', 'error'); return; }
  const { doc, filename } = buildSlipDoc(payroll, rec, Number(input.value) || 0);
  doc.save(filename);
}

async function downloadAllSlips(month) {
  const checked = [...document.querySelectorAll('.sRowCheck')].filter(cb => cb.checked);
  if (!checked.length) { toast('Select at least one employee.', 'error'); return; }

  const missing = [];
  const selected = checked.map(cb => cb.id.replace('schk-', ''));
  selected.forEach(id => {
    const input = document.getElementById('spf-' + id);
    if (!input || input.value === '') missing.push(id);
  });
  if (missing.length) {
    toast(`Enter a PF / Tax amount for ${missing.length} selected employee${missing.length === 1 ? '' : 's'} first.`, 'error');
    return;
  }

  if (typeof JSZip === 'undefined') { toast('ZIP library not loaded — check your connection.', 'error'); return; }

  let payroll;
  try { payroll = await slipPersistPf(month); }
  catch (e) { toast(e.message || 'Could not save PF.', 'error'); return; }

  const zip = new JSZip();
  let count = 0;
  selected.forEach(id => {
    const rec = payroll.records.find(r => r.empId === id);
    const input = document.getElementById('spf-' + id);
    if (!rec) return;
    const { doc, filename } = buildSlipDoc(payroll, rec, Number(input.value) || 0);
    zip.file(filename, doc.output('arraybuffer'));
    count++;
  });
  if (!count) { toast('Nothing to download.', 'error'); return; }

  const monthYear = monthName(payroll.month).replace(/\s+/g, '');
  try {
    const blob = await zip.generateAsync({ type: 'blob' });
    slipDownloadBlob(blob, `Salary_Slips_${monthYear}.zip`);
    toast(`Downloaded ${count} salary slip${count === 1 ? '' : 's'} as ZIP.`, 'success');
  } catch (e) {
    toast('Could not build ZIP.', 'error');
  }
}

// Trigger a browser download for a Blob (works over file:// too).
function slipDownloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Payslip PDF (one employee) — returns { doc, filename } ─────────────────────────
function buildSlipDoc(payroll, r, pf) {
  const doc = new jspdf.jsPDF();
  const fmt = n => 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const final = slipFinal(r);
  const net = final - (Number(pf) || 0);

  doc.setFontSize(18);
  doc.text('Salary Slip', 14, 18);
  doc.setFontSize(10);
  doc.text(`${monthName(payroll.month)}  ·  ${payroll.payType === 'cash' ? 'Cash' : 'Salary'}`, 14, 25);
  doc.setFontSize(13);
  doc.text(r.empName || '', 14, 35);
  doc.setFontSize(10);
  doc.text(`Emp ID: ${r.empId}`, 14, 41);

  doc.autoTable({
    startY: 47,
    head: [['Particulars', 'Amount']],
    body: [
      ['Present Days', String(slipPresentDays(r))],
      ['Present Salary', fmt(slipPresentSalary(r))],
      ['Fine / Late', fmt(slipFine(r))],
      ['Advance Deducted This Time', fmt(slipAdvance(r))],
      ['Outstanding Advance', fmt(slipOutstanding(r))],
      ['Final Amount', fmt(final)],
      ['PF / Tax', fmt(pf)],
    ],
    foot: [['Net Payable (after PF / Tax)', fmt(net)]],
    styles: { fontSize: 10, cellPadding: 3 },
    headStyles: { fillColor: [46, 134, 222] },
    footStyles: { fillColor: [240, 240, 240], textColor: [20, 20, 20], fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' } },
  });

  // Filename: EmpName_MonthYear  e.g. Asha_Devi_May2026.pdf
  const monthYear = monthName(payroll.month).replace(/\s+/g, '');
  const safeName = (r.empName || 'Employee').trim().replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '');
  return { doc, filename: `${safeName}_${monthYear}.pdf` };
}
