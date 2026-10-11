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
// Balance as it stood at the payroll's period end (after its own deduction), from the backend.
function slipOutstanding(r) { return r.advanceBalance != null ? r.advanceBalance : advBalance(r.empId); }
// The two catch-all rows that make the slip add up to the final amount:
//   additions  = overtime + night pay + home visits     deductions = debit-hours cut
// Each saved figure is floored separately, so the odd rupee of rounding is folded into
// whichever row it belongs to.
function slipExtras(r) {
  let additions = (r.otPay || 0) + (r.nightPay || 0) + (r.homeVisitPay || 0) +
                  (r.shift2OtPay || 0) + (r.shift2NightPay || 0) + (r.shift2HomeVisitPay || 0);
  let deductions = (r.debitHrsPay || 0) + (r.shift2DebitHrsPay || 0);
  const gap = slipFinal(r) - (slipPresentSalary(r) + additions - slipFine(r) - deductions - slipAdvance(r));
  if (gap > 0) additions += gap; else deductions -= gap;
  return { additions, deductions };
}
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
    const extras = slipExtras(r);
    const pf = (r.pfAmount && r.pfAmount > 0) ? r.pfAmount : '';
    const net = final - (Number(pf) || 0);
    return `
      <tr>
        <td class="pcol-check"><input type="checkbox" class="sRowCheck" id="schk-${h(id)}" checked aria-label="Include ${h(r.empName)}"></td>
        <td style="text-align:left;">${h(r.empName)}<div style="font-size:11px;color:var(--ink-3);">${h(id)}</div></td>
        <td class="num">${slipPresentDays(r)}</td>
        <td class="num">${inr(slipPresentSalary(r))}</td>
        <td class="num">${inr(extras.additions)}</td>
        <td class="num">${inr(slipFine(r))}</td>
        <td class="num">${inr(extras.deductions)}</td>
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
      <table class="payroll-summary-table" style="min-width:1040px;">
        <thead>
          <tr>
            <th class="pcol-check"><input type="checkbox" id="sSelectAll" checked onchange="slipToggleAll(this.checked)" aria-label="Select all" title="Select all"></th>
            <th style="text-align:left;">Employee</th>
            <th class="num">Present Days</th>
            <th class="num">Present Salary</th>
            <th class="num">Additions</th>
            <th class="num">Fine / Late</th>
            <th class="num">Deductions</th>
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

// ── Payslip PDF helpers ───────────────────────────────────────────────────────────
const SLIP_ORG_NAME = "Saavi Women's Hospital";
const SLIP_ORG_ADDRESS = 'Near Ishaan 3, opp. Shell Petrol Pump, Anand Nagar, Prahlad Nagar, Ahmedabad, Gujarat 380015, India';

// yyyy-mm-dd → dd-mm-yyyy (payslip shows the full pay-period dates incl. year)
function slipFullDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '-';
}

// Amount in words, Indian numbering (Thousand / Lakh / Crore). e.g. 9194 → "Nine Thousand One Hundred Ninety-Four"
function slipAmountWords(n) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
    'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = v => v < 20 ? ones[v] : tens[Math.floor(v / 10)] + (v % 10 ? '-' + ones[v % 10] : '');
  const three = v => [v >= 100 ? ones[Math.floor(v / 100)] + ' Hundred' : '', two(v % 100)].filter(Boolean).join(' ');
  const whole = v => {
    if (v === 0) return 'Zero';
    const parts = [];
    const crore = Math.floor(v / 1e7), lakh = Math.floor(v / 1e5) % 100, thousand = Math.floor(v / 1e3) % 100;
    if (crore)    parts.push(whole(crore) + ' Crore');
    if (lakh)     parts.push(two(lakh) + ' Lakh');
    if (thousand) parts.push(two(thousand) + ' Thousand');
    if (v % 1000) parts.push(three(v % 1000));
    return parts.join(' ');
  };
  const paiseTotal = Math.round(Math.abs(Number(n) || 0) * 100);
  const rupees = Math.floor(paiseTotal / 100), paise = paiseTotal % 100;
  let words = whole(rupees);
  if (paise) words += ' And ' + two(paise) + ' Paise';
  return (n < 0 ? 'Minus ' : '') + words;
}

// Shared letterhead for slip PDFs: logo left, hospital name + address right, rule, centred title.
// Returns the page metrics and palette the slip body is drawn with.
function slipLetterhead(doc, title) {
  const L = 14, R = doc.internal.pageSize.getWidth() - 14, W = R - L;
  const INK = [20, 20, 20], RULE = [90, 98, 110], TINT = [225, 232, 245], BLUE = [46, 110, 200];
  doc.setTextColor(...INK);

  const logoW = 52, logoH = logoW * SAAVI_LOGO.h / SAAVI_LOGO.w;
  doc.addImage(SAAVI_LOGO.data, 'PNG', L, 12, logoW, logoH, 'saavi-logo', 'FAST');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(SLIP_ORG_NAME, R, 17, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(doc.splitTextToSize(SLIP_ORG_ADDRESS, 108), R, 22.5, { align: 'right', lineHeightFactor: 1.3 });
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.5);
  doc.line(L, 33, R, 33);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(title, (L + R) / 2, 42, { align: 'center' });
  return { L, R, W, INK, RULE, TINT, BLUE };
}

// ── Payslip PDF (one employee) — returns { doc, filename } ─────────────────────────
function buildSlipDoc(payroll, r, pf) {
  const doc = new jspdf.jsPDF();
  const fmt = n => 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const final = slipFinal(r);
  const net = final - (Number(pf) || 0);
  const extras = slipExtras(r);
  const emp = state.employees.find(e => e.id === r.empId) || {};

  const { L, R, W, INK, RULE, TINT, BLUE } = slipLetterhead(doc, `Payslip for the Month of ${monthName(payroll.month)}`);

  // Employee details box (two label/value pairs per row)
  const boxY = 48;
  doc.autoTable({
    startY: boxY,
    margin: { left: L, right: 14 },
    theme: 'plain',
    body: [
      ['Name:', r.empName || '-', 'Employee ID:', r.empId || '-'],
      ['Category:', emp.category || '-', 'Shift:', emp.shiftType || '-'],
      ['Pay Period:', `${slipFullDate(payroll.fromDate)} to ${slipFullDate(payroll.toDate)}`, 'Pay Type:', payroll.payType === 'cash' ? 'Cash' : 'Salary'],
    ],
    styles: { fontSize: 9.5, textColor: INK, cellPadding: { top: 2.6, bottom: 2.6, left: 4, right: 2 } },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 30 }, 1: { cellWidth: W / 2 - 30 },
      2: { fontStyle: 'bold', cellWidth: 30 }, 3: { cellWidth: W / 2 - 30 },
    },
  });
  const boxEnd = doc.lastAutoTable.finalY;
  doc.setLineWidth(0.4);
  doc.rect(L, boxY - 1.5, W, boxEnd - boxY + 3);
  doc.line(L + W / 2, boxY - 1.5, L + W / 2, boxEnd + 1.5);

  doc.autoTable({
    startY: boxEnd + 8,
    margin: { left: L, right: 14 },
    theme: 'grid',
    head: [['Particulars', 'Amount']],
    body: [
      ['Present Days', String(slipPresentDays(r))],
      ['Present Salary', fmt(slipPresentSalary(r))],
      ['Additions', fmt(extras.additions)],
      ['Fine / Late', fmt(slipFine(r))],
      ['Deductions', fmt(extras.deductions)],
      ['Advance Deducted This Time', fmt(slipAdvance(r))],
      ['Outstanding Advance', fmt(slipOutstanding(r))],
      ['Final Amount', fmt(final)],
      ['PF / Tax', fmt(pf)],
    ],
    foot: [['Net Payable (after PF / Tax)', fmt(net)]],
    styles: { fontSize: 10, cellPadding: 3, textColor: INK, lineColor: RULE, lineWidth: 0.3 },
    headStyles: { fillColor: TINT, textColor: INK, fontStyle: 'bold' },
    footStyles: { fillColor: TINT, textColor: INK, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' } },
    didParseCell: d => { if (d.section !== 'body' && d.column.index === 1) d.cell.styles.halign = 'right'; },
  });

  // Net pay box with the amount in words
  const netY = doc.lastAutoTable.finalY + 8;
  const wordLines = doc.setFont('helvetica', 'normal').setFontSize(10)
    .splitTextToSize(`(INR ${slipAmountWords(net)} only)`, W - 10 - 34);
  doc.setDrawColor(...BLUE);
  doc.setLineWidth(0.5);
  doc.rect(L, netY, W, 21 + wordLines.length * 4.6);
  let x = L + 5;
  doc.setFont('helvetica', 'bold').setFontSize(13);
  doc.text('Net Pay for the Month', x, netY + 10);
  x += doc.getTextWidth('Net Pay for the Month') + 2.5;
  doc.setFont('helvetica', 'normal').setFontSize(9);
  doc.text('( Final Amount - PF / Tax ) =', x, netY + 10);
  x += doc.getTextWidth('( Final Amount - PF / Tax ) =') + 3;
  doc.setFont('helvetica', 'bold').setFontSize(13);
  doc.text(fmt(net), x, netY + 10);
  doc.setFontSize(10);
  doc.text('Amount in words:', L + 5, netY + 19);
  doc.setFont('helvetica', 'normal');
  doc.text(wordLines, L + 5 + 34, netY + 19, { lineHeightFactor: 1.3 });

  // Filename: EmpName_MonthYear  e.g. Asha_Devi_May2026.pdf
  const monthYear = monthName(payroll.month).replace(/\s+/g, '');
  const safeName = (r.empName || 'Employee').trim().replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '');
  return { doc, filename: `${safeName}_${monthYear}.pdf` };
}
