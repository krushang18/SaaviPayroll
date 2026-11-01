// Saavi Payroll — split from index.html. Classic script (file:// compatible); globals shared across files.

// ── Advances ──────────────────────────────────────────────────────────────────
let editingAdvanceId = null, deletingAdvanceId = null, currentAdvanceHistory = null;
let editingSettlementId = null, deletingSettlementId = null;

function initAdvancesView() {
  renderAdvanceList();
}

// Master list — every employee with their current advance balance. Balances are
// already loaded into state.advanceBalances on init, so no extra fetch is needed.
function renderAdvanceList() {
  const el = document.getElementById('advList');
  if (!state.employees.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('team')}</div><div class="empty-text">No employees</div><div class="empty-sub">Add employees to track advances</div></div>`;
    return;
  }
  const q = (document.getElementById('advSearchInput').value || '').toLowerCase();
  const emps = sortByEmpId(state.employees)
    .filter(e => !q || e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q) || (e.empId || '').toLowerCase().includes(q));
  if (!emps.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('search')}</div><div class="empty-text">No matches</div><div class="empty-sub">Try a different name or ID</div></div>`;
    return;
  }
  el.innerHTML = emps.map(e => {
    const bal = advBalance(e.id);
    const balColor = bal > 0 ? 'var(--danger)' : 'var(--ink-3)';
    return `
      <div class="adv-card" data-empid="${h(e.id)}" onclick="openAdvanceDetail(this.dataset.empid)">
        <div class="adv-card-head">
          <div class="avatar av${ci(e.name)}">${h(ini(e.name))}</div>
          <div style="min-width:0;">
            <div class="emp-name">${h(e.name)}</div>
            <div class="emp-id">Sr ${h(e.id)}${e.empId ? ' &nbsp;·&nbsp; ' + h(e.empId) : ''}</div>
          </div>
        </div>
        <div class="adv-card-foot">
          <span class="comp-label">Balance</span>
          <span class="adv-card-bal" style="color:${balColor};">${inr(bal)}</span>
        </div>
      </div>`;
  }).join('');
}

// Export a single PDF listing every employee's advance figures (total advanced,
// total settled, outstanding balance) plus grand totals. Built entirely from
// state.advanceBalances — no fetch needed. Scoped to the current pay type.
function downloadAdvanceBalancesPDF() {
  if (!state.employees.length) { toast('No employees to export.', 'error'); return; }

  const doc = new jspdf.jsPDF();
  const today = new Date().toISOString().slice(0, 10);
  const emps = sortByEmpId(state.employees);

  doc.setFontSize(16);
  doc.text('Advance Balances', 14, 16);
  doc.setFontSize(10);
  doc.text(`${state.payType === 'cash' ? 'Cash' : 'Salary'} · ${emps.length} employees · as of ${fmtDate(today)}`, 14, 23);

  const fmt = n => 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  let sumAdv = 0, sumSettled = 0, sumBal = 0;
  const rows = emps.map(e => {
    const b = state.advanceBalances[e.id] || { totalAdvanced: 0, totalSettled: 0, balance: 0 };
    sumAdv += b.totalAdvanced || 0;
    sumSettled += b.totalSettled || 0;
    sumBal += b.balance || 0;
    return [e.id, e.empId || '—', e.name, fmt(b.totalAdvanced), fmt(b.totalSettled), fmt(b.balance)];
  });

  doc.autoTable({
    startY: 30,
    head: [['Sr. No.', 'Emp ID', 'Employee', 'Total Advanced', 'Total Settled', 'Outstanding Balance']],
    body: rows,
    foot: [['', '', 'Grand Total', fmt(sumAdv), fmt(sumSettled), fmt(sumBal)]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [46, 134, 222] },
    footStyles: { fillColor: [240, 240, 240], textColor: [20, 20, 20], fontStyle: 'bold' },
    didParseCell: (data) => {
      // Redden the Outstanding Balance cell when the employee still owes.
      if (data.column.index !== 5) return;
      if (data.row.section === 'body') {
        const b = state.advanceBalances[emps[data.row.index] && emps[data.row.index].id];
        if (b && b.balance > 0) data.cell.styles.textColor = [200, 50, 50];
      } else if (data.row.section === 'foot' && sumBal > 0) {
        data.cell.styles.textColor = [200, 50, 50];
      }
    }
  });

  stampDownloadDate(doc);
  doc.save(`Advance_Balances_${state.payType}_${today}.pdf`);
}

function openAdvanceDetail(empId) {
  document.getElementById('advEmpSelect').value = empId;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-advance-detail').classList.add('active');
  document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('active'));
  window.scrollTo(0, 0);
  renderAdvanceDetail();
}

async function renderAdvanceDetail() {
  const empId = document.getElementById('advEmpSelect').value;
  const el = document.getElementById('advanceDetail');
  currentAdvanceHistory = null;
  if (!empId) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('advances')}</div><div class="empty-text">Select an employee</div><div class="empty-sub">View their advance balance and history</div></div>`;
    return;
  }
  let data;
  try {
    data = await api('GET', '/advances/' + empId + '?pay_type=' + state.payType);
  } catch(e) {
    toast(e.message, 'error');
    el.innerHTML = '';
    return;
  }
  currentAdvanceHistory = data;
  const emp = state.employees.find(e => e.id === empId);
  el.innerHTML = `
    ${emp ? `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
      <div class="avatar av${ci(emp.name)}">${h(ini(emp.name))}</div>
      <div style="min-width:0;">
        <div class="emp-name">${h(emp.name)}</div>
        <div class="emp-id">Sr ${h(emp.id)}${emp.empId ? ' &nbsp;·&nbsp; Emp ID ' + h(emp.empId) : ''}</div>
      </div>
    </div>` : ''}
    <div class="comp-grid">
      <div class="comp-card"><div class="comp-label">Outstanding Balance</div><div class="comp-val" style="${data.balance > 0 ? 'color:var(--danger);' : ''}">${inr(data.balance)}</div></div>
      <div class="comp-card"><div class="comp-label">Total Advanced</div><div class="comp-val">${inr(data.totalAdvanced)}</div></div>
      <div class="comp-card"><div class="comp-label">Total Settled</div><div class="comp-val green">${inr(data.totalSettled)}</div></div>
      <div class="comp-card"><div class="comp-label">Monthly Cut</div><div class="comp-val">${data.monthlyCut ? inr(data.monthlyCut) : '—'}</div></div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;flex-wrap:wrap;">
      <div style="font-family:var(--sans);font-size:20px;font-weight:700;">History</div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary btn-sm" onclick="openAdvModal()">+ Add Advance</button>
        <button class="btn btn-sm" onclick="openAdvSettlementModal()" style="background:var(--accent);color:#fff;">+ Record Settlement</button>
      </div>
    </div>
    ${data.entries.length ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Monthly Return</th><th>Note</th><th></th></tr></thead>
          <tbody>
            ${data.entries.map(e => {
              if (e.type === 'given') return `
              <tr>
                <td>${fmtDate(e.date)}</td>
                <td><span class="badge badge-warm">Given</span></td>
                <td class="td-mono">${inr(e.amount)}</td>
                <td class="td-mono">${e.monthlyReturn ? `${inr(e.monthlyReturn)} × ${e.returnMonths}` : '—'}</td>
                <td>${e.note ? h(e.note) : '—'}</td>
                <td style="white-space:nowrap;">
                  <button class="icon-btn" onclick="downloadAdvanceSlip(${e.id})">Slip</button>
                  <button class="icon-btn" onclick="openAdvModal(${e.id})">Edit</button>
                  <button class="icon-btn danger" onclick="openAdvDeleteModal(${e.id}, ${e.amount})">Del</button>
                </td>
              </tr>`;
              if (e.type === 'settled_manual') return `
              <tr>
                <td>${fmtDate(e.date)}</td>
                <td><span class="badge badge-green">Settlement</span></td>
                <td class="td-mono td-green">-${inr(e.amount)}</td>
                <td>—</td>
                <td>${e.note ? h(e.note) : '—'}</td>
                <td style="white-space:nowrap;">
                  <button class="icon-btn" onclick="openAdvSettlementModal(${e.id})">Edit</button>
                  <button class="icon-btn danger" onclick="openAdvSettDeleteModal(${e.id}, ${e.amount})">Del</button>
                </td>
              </tr>`;
              return `
              <tr>
                <td>${fmtDate(e.date)}</td>
                <td><span class="badge badge-green">Settled · ${monthName(e.month)}</span></td>
                <td class="td-mono td-green">-${inr(e.amount)}</td>
                <td>—</td>
                <td>—</td>
                <td></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    ` : `<div class="empty-state"><div class="empty-icon">${icon('doc')}</div><div class="empty-text">No advance history yet</div></div>`}
  `;
}

function openAdvModal(id) {
  const empId = document.getElementById('advEmpSelect').value;
  if (!empId) return;
  editingAdvanceId = id || null;
  if (editingAdvanceId && currentAdvanceHistory) {
    const entry = currentAdvanceHistory.entries.find(e => e.type === 'given' && e.id === editingAdvanceId);
    document.getElementById('advModalTitle').textContent = 'Edit Advance';
    document.getElementById('advDate').value = entry ? entry.date : '';
    document.getElementById('advAmount').value = entry ? entry.amount : '';
    document.getElementById('advNote').value = (entry && entry.note) ? entry.note : '';
    document.getElementById('advMonthly').value = (entry && entry.monthlyReturn) || '';
    document.getElementById('advMonths').value = (entry && entry.returnMonths) || '';
  } else {
    document.getElementById('advModalTitle').textContent = 'Add Advance';
    document.getElementById('advDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('advAmount').value = '';
    document.getElementById('advNote').value = '';
    document.getElementById('advMonthly').value = '';
    document.getElementById('advMonths').value = '';
  }
  // Months auto-fills from amount ÷ per-month until typed by hand; an existing plan counts as typed.
  document.getElementById('advMonths').dataset.manual = document.getElementById('advMonths').value ? '1' : '';
  renderAdvCutPreview();
  document.getElementById('advModal').classList.add('open');
}

function onAdvPlanInput() {
  const amount = parseFloat(document.getElementById('advAmount').value);
  const monthly = parseFloat(document.getElementById('advMonthly').value);
  const monthsEl = document.getElementById('advMonths');
  if (!monthsEl.dataset.manual) {
    monthsEl.value = (amount > 0 && monthly > 0) ? Math.ceil(amount / monthly) : '';
  }
  renderAdvCutPreview();
}

function onAdvMonthsInput() {
  const monthsEl = document.getElementById('advMonths');
  monthsEl.dataset.manual = monthsEl.value !== '' ? '1' : '';
  if (!monthsEl.dataset.manual) onAdvPlanInput();
  else renderAdvCutPreview();
}

// What payroll will cut each month once this advance is saved: its own plan plus every
// other advance still being repaid (from the backend's oldest-first figures).
function renderAdvCutPreview() {
  const el = document.getElementById('advCutPreview');
  const amount = parseFloat(document.getElementById('advAmount').value) || 0;
  const monthly = parseFloat(document.getElementById('advMonthly').value) || 0;
  const others = currentAdvanceHistory
    ? currentAdvanceHistory.entries
        .filter(e => e.type === 'given' && e.id !== editingAdvanceId)
        .reduce((s, e) => s + (e.monthlyCut || 0), 0)
    : 0;
  const own = Math.min(monthly, amount);
  if (!own && !others) { el.textContent = ''; return; }
  el.innerHTML = `Monthly cut from salary: <strong style="color:var(--ink)">${inr(own + others)}</strong>`
    + (others ? ` (this advance ${inr(own)} + other advances ${inr(others)})` : '');
}

function closeAdvModal() { document.getElementById('advModal').classList.remove('open'); }

// withSlip: also download the approval slip for the advance just saved.
async function saveAdvance(withSlip) {
  const empId = document.getElementById('advEmpSelect').value;
  if (!empId) return;
  const dateVal = document.getElementById('advDate').value;
  const amount = parseFloat(document.getElementById('advAmount').value);
  const note = document.getElementById('advNote').value.trim() || null;
  const monthlyVal = document.getElementById('advMonthly').value;
  const monthsVal = document.getElementById('advMonths').value;
  const monthlyReturn = monthlyVal !== '' ? parseFloat(monthlyVal) : null;
  const returnMonths = monthsVal !== '' ? Number(monthsVal) : null;
  if (!dateVal) { toast('Please select a date.', 'error'); return; }
  if (isNaN(amount) || amount <= 0) { toast('Enter a valid amount.', 'error'); return; }
  if (monthlyReturn !== null && (isNaN(monthlyReturn) || monthlyReturn <= 0)) { toast('Enter a valid return per month.', 'error'); return; }
  if (monthlyReturn !== null && monthlyReturn > amount) { toast('Return per month cannot be more than the advance amount.', 'error'); return; }
  if (returnMonths !== null && monthlyReturn === null) { toast('Enter the return per month for the months to apply.', 'error'); return; }
  if (returnMonths !== null && (!Number.isInteger(returnMonths) || returnMonths < 1 || returnMonths > 120)) { toast('No. of months must be a whole number from 1 to 120.', 'error'); return; }
  if (editingAdvanceId && currentAdvanceHistory) {
    const old = currentAdvanceHistory.entries.find(e => e.type === 'given' && e.id === editingAdvanceId);
    if (old && old.amount - amount > currentAdvanceHistory.balance) {
      toast(`Cannot reduce to ${inr(amount)} — it would make the outstanding balance negative (current balance ${inr(currentAdvanceHistory.balance)}).`, 'error');
      return;
    }
  }
  try {
    let saved;
    if (editingAdvanceId) {
      saved = await api('PUT', '/advances/' + editingAdvanceId, { empId, date: dateVal, amount, note, monthlyReturn, returnMonths, payType: state.payType });
      toast('Advance updated.', 'success');
    } else {
      saved = await api('POST', '/advances', { empId, date: dateVal, amount, note, monthlyReturn, returnMonths, payType: state.payType });
      toast('Advance added.', 'success');
    }
    closeAdvModal();
    await refreshAdvanceBalances();
    await renderAdvanceDetail();
    if (withSlip && saved) downloadAdvanceSlip(saved.id);
  } catch(e) {
    toast(e.message, 'error');
  }
}

function openAdvDeleteModal(id, amount) {
  deletingAdvanceId = id;
  document.getElementById('advDelAmount').textContent = inr(amount);
  document.getElementById('advDeleteModal').classList.add('open');
}
function closeAdvDeleteModal() { document.getElementById('advDeleteModal').classList.remove('open'); }

async function confirmAdvDelete() {
  try {
    await api('DELETE', '/advances/' + deletingAdvanceId + '?pay_type=' + state.payType);
    toast('Advance entry deleted.', 'info');
    closeAdvDeleteModal();
    await refreshAdvanceBalances();
    renderAdvanceDetail();
  } catch(e) {
    toast(e.message, 'error');
  }
}

// ── Advance slip PDF (one advance) ────────────────────────────────────────────
// Approval slip for a single "Given" entry. Figures are as they stood just before that
// advance: only entries dated up to it count (same-day advances with a lower id come first),
// so re-downloading an old slip always gives the same numbers.
function advanceSlipFigures(history, adv) {
  let advanced = 0, settled = 0;
  history.entries.forEach(e => {
    if (e.type === 'given') {
      if (e.id !== adv.id && (e.date < adv.date || (e.date === adv.date && e.id < adv.id))) advanced += e.amount || 0;
    } else if (e.date <= adv.date) {
      settled += e.amount || 0;
    }
  });
  const before = advanced - settled;
  return { advanced, settled, before, after: before + (adv.amount || 0) };
}

function downloadAdvanceSlip(advanceId) {
  const adv = currentAdvanceHistory && currentAdvanceHistory.entries.find(e => e.type === 'given' && e.id === advanceId);
  if (!adv) { toast('Advance entry not found.', 'error'); return; }
  const emp = state.employees.find(e => e.id === currentAdvanceHistory.empId);
  if (!emp) { toast('Employee not found.', 'error'); return; }
  const { doc, filename } = buildAdvanceSlipDoc(emp, adv, advanceSlipFigures(currentAdvanceHistory, adv));
  doc.save(filename);
}

function buildAdvanceSlipDoc(emp, adv, fig) {
  const doc = newSlipDoc();
  const fmt = n => 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const { M, L, R, W, INK, RULE, TINT, BLUE } = slipLetterhead(doc, 'Advance Slip');
  // Current salary from the live employee record; Day & Night shows both shifts.
  const salary = emp.shiftType === 'Day & Night' && emp.shift2Monthly != null
    ? `Day ${fmt(emp.monthly)} / Night ${fmt(emp.shift2Monthly)} per month`
    : `${fmt(emp.monthly)} per month`;

  // Employee details box (two label/value pairs per row)
  const boxY = 39;
  doc.autoTable({
    startY: boxY,
    margin: { left: L, right: M },
    theme: 'plain',
    body: [
      ['Name:', emp.name || '-', 'Sr. No.:', emp.id || '-'],
      ['Category:', emp.category || '-', 'Employee ID:', emp.empId || '-'],
      ['Advance Date:', slipFullDate(adv.date), 'Pay Type:', state.payType === 'cash' ? 'Cash' : 'Salary'],
      ['Current Salary:', { content: salary, colSpan: 3 }],
      ['Note:', { content: adv.note || '-', colSpan: 3 }],
    ],
    styles: { fontSize: 8, textColor: INK, cellPadding: { top: 1.2, bottom: 1.2, left: 3, right: 1.5 } },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 27 }, 1: { cellWidth: W / 2 - 27 },
      2: { fontStyle: 'bold', cellWidth: 24 }, 3: { cellWidth: W / 2 - 24 },
    },
  });
  const boxEnd = doc.lastAutoTable.finalY;
  doc.setLineWidth(0.3);
  doc.rect(L, boxY - 1, W, boxEnd - boxY + 2);

  doc.autoTable({
    startY: boxEnd + 4,
    margin: { left: L, right: M },
    theme: 'grid',
    head: [['Particulars', 'Amount']],
    body: [
      ['Total Advanced (before this advance)', fmt(fig.advanced)],
      ['Total Settled', fmt(fig.settled)],
      ['Outstanding Balance (before this advance)', fmt(fig.before)],
      ['New Advance', fmt(adv.amount)],
    ],
    foot: [['Outstanding Balance (after this advance)', fmt(fig.after)]],
    styles: { fontSize: 8.5, cellPadding: 1.5, textColor: INK, lineColor: RULE, lineWidth: 0.25 },
    headStyles: { fillColor: TINT, textColor: INK, fontStyle: 'bold' },
    footStyles: { fillColor: TINT, textColor: INK, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' } },
    didParseCell: d => {
      if (d.section !== 'body' && d.column.index === 1) d.cell.styles.halign = 'right';
      if (d.section === 'body' && d.row.index === 3) d.cell.styles.fontStyle = 'bold';
    },
  });

  // New advance box: amount, amount in words, and the repayment plan
  const advY = doc.lastAutoTable.finalY + 4;
  const wordLines = doc.setFont('helvetica', 'normal').setFontSize(8.5)
    .splitTextToSize(`(INR ${slipAmountWords(adv.amount)} only)`, W - 8 - 28);
  const planY = advY + 13.5 + wordLines.length * 3.9;
  const advH = planY - advY + 6.5;
  doc.setDrawColor(...BLUE);
  doc.setLineWidth(0.4);
  doc.rect(L, advY, W, advH);
  doc.setFont('helvetica', 'bold').setFontSize(10.5);
  doc.text('Advance Amount', L + 4, advY + 7);
  doc.text(fmt(adv.amount), L + 4 + doc.getTextWidth('Advance Amount') + 4, advY + 7);
  doc.setFontSize(8.5);
  doc.text('Amount in words:', L + 4, advY + 13.5);
  doc.setFont('helvetica', 'normal');
  doc.text(wordLines, L + 4 + 28, advY + 13.5, { lineHeightFactor: 1.3 });
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.2);
  doc.line(L, planY - 1.5, R, planY - 1.5);
  [[L + 4, 'Return per month:', adv.monthlyReturn ? fmt(adv.monthlyReturn) : '-'],
   [L + W / 2 + 4, 'No. of months:', adv.returnMonths ? String(adv.returnMonths) : '-']].forEach(([x, label, val]) => {
    doc.setFont('helvetica', 'bold').text(label, x, planY + 3);
    const valX = x + doc.getTextWidth(label) + 2;
    doc.setFont('helvetica', 'normal').text(val, valX, planY + 3);
  });

  // Declaration the employee signs under; the fine amount is filled in by hand
  const decY = advY + advH + 6;
  const decLines = doc.setFont('helvetica', 'normal').setFontSize(8.5).splitTextToSize(
    'I will not take a new Advance until the old one is completely paid off. If the full Advance is not '
    + 'deducted in the agreed-upon month, then a fine of Rs. ____________ per month will be settled in person.', W);
  doc.setFont('helvetica', 'bold').text('Declaration:', L, decY);
  doc.setFont('helvetica', 'normal').text(decLines, L, decY + 4.5, { lineHeightFactor: 1.4 });
  const decEnd = decY + 4.5 + (decLines.length - 1) * 4.2;

  // Signatures: Employee + Dr. Dhaval on the left, Manager on the right
  const sigW = 54, rowGap = 19, sigY = decEnd + 13;
  [[L, sigY, 'Employee Signature'], [R - sigW, sigY, 'Manager Signature'],
   [L, sigY + rowGap, 'Dr. Dhaval Signature']].forEach(([x, y, label]) => {
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.3);
    doc.line(x, y, x + sigW, y);
    doc.setFont('helvetica', 'bold').setFontSize(8.5);
    doc.text(label, x, y + 4.5);
    doc.setFont('helvetica', 'normal');
    doc.text('Date:', x, y + 10.5);
    doc.line(x + 9, y + 11, x + sigW, y + 11);
  });

  // Filename: Advance_EmpName_Date  e.g. Advance_Asha_Devi_26-04-2026.pdf
  const safeName = (emp.name || 'Employee').trim().replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '');
  stampDownloadDate(doc);
  return { doc, filename: `Advance_${safeName}_${slipFullDate(adv.date)}.pdf` };
}

document.getElementById('advModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeAdvModal(); });
document.getElementById('advDeleteModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeAdvDeleteModal(); });

// ── Settlement modal functions ──────────────────────────────────────────────
function openAdvSettlementModal(id) {
  const empId = document.getElementById('advEmpSelect').value;
  if (!empId) return;
  if (!id && (!currentAdvanceHistory || !currentAdvanceHistory.entries.some(e => e.type === 'given'))) {
    toast('No advances found for this employee.', 'error');
    return;
  }
  editingSettlementId = id || null;
  if (editingSettlementId && currentAdvanceHistory) {
    const entry = currentAdvanceHistory.entries.find(e => e.type === 'settled_manual' && e.id === editingSettlementId);
    document.getElementById('advSettlementModalTitle').textContent = 'Edit Settlement';
    document.getElementById('advSettDate').value = entry ? entry.date : '';
    document.getElementById('advSettAmount').value = entry ? entry.amount : '';
    document.getElementById('advSettNote').value = (entry && entry.note) ? entry.note : '';
  } else {
    document.getElementById('advSettlementModalTitle').textContent = 'Record Settlement';
    document.getElementById('advSettDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('advSettAmount').value = '';
    document.getElementById('advSettNote').value = '';
  }
  document.getElementById('advSettlementModal').classList.add('open');
}

function closeAdvSettlementModal() { document.getElementById('advSettlementModal').classList.remove('open'); }

async function saveAdvSettlement() {
  const empId = document.getElementById('advEmpSelect').value;
  if (!empId) return;
  const dateVal = document.getElementById('advSettDate').value;
  const amount = parseFloat(document.getElementById('advSettAmount').value);
  const note = document.getElementById('advSettNote').value.trim() || null;
  if (!dateVal) { toast('Please select a date.', 'error'); return; }
  if (isNaN(amount) || amount <= 0) { toast('Enter a valid amount.', 'error'); return; }
  if (currentAdvanceHistory) {
    const givenDates = currentAdvanceHistory.entries.filter(e => e.type === 'given').map(e => e.date).sort();
    if (!givenDates.length) {
      toast('No advances found for this employee.', 'error');
      return;
    }
    if (dateVal < givenDates[0]) {
      toast(`Settlement date cannot be before first advance date (${fmtDate(givenDates[0])}).`, 'error');
      return;
    }
    const oldAmount = editingSettlementId
      ? (currentAdvanceHistory.entries.find(e => e.type === 'settled_manual' && e.id === editingSettlementId)?.amount || 0)
      : 0;
    const maxAllowed = currentAdvanceHistory.balance + oldAmount;
    if (amount > maxAllowed) {
      toast(`Settlement amount (${inr(amount)}) exceeds outstanding balance (${inr(maxAllowed)}).`, 'error');
      return;
    }
  }
  try {
    if (editingSettlementId) {
      await api('PUT', '/advance-settlements/' + editingSettlementId, { empId, date: dateVal, amount, note, payType: state.payType });
      toast('Settlement updated.', 'success');
    } else {
      await api('POST', '/advance-settlements', { empId, date: dateVal, amount, note, payType: state.payType });
      toast('Settlement recorded.', 'success');
    }
    closeAdvSettlementModal();
    await refreshAdvanceBalances();
    renderAdvanceDetail();
  } catch(e) {
    toast(e.message, 'error');
  }
}

function openAdvSettDeleteModal(id, amount) {
  deletingSettlementId = id;
  document.getElementById('advSettDelAmount').textContent = inr(amount);
  document.getElementById('advSettlementDeleteModal').classList.add('open');
}
function closeAdvSettDeleteModal() { document.getElementById('advSettlementDeleteModal').classList.remove('open'); }

async function confirmAdvSettDelete() {
  try {
    await api('DELETE', '/advance-settlements/' + deletingSettlementId + '?pay_type=' + state.payType);
    toast('Settlement entry deleted.', 'info');
    closeAdvSettDeleteModal();
    await refreshAdvanceBalances();
    renderAdvanceDetail();
  } catch(e) {
    toast(e.message, 'error');
  }
}

document.getElementById('advSettlementModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeAdvSettlementModal(); });
document.getElementById('advSettlementDeleteModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeAdvSettDeleteModal(); });
