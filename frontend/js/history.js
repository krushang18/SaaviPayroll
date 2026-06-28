// Saavi Payroll — split from index.html. Classic script (file:// compatible); globals shared across files.

// ── History ───────────────────────────────────────────────────────────────────
function renderPayrollHistory() {
  const list = document.getElementById('payrollMonths');
  if (!state.payrolls.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('history')}</div><div class="empty-text">No payrolls saved</div><div class="empty-sub">Go to Payroll tab and save a month</div></div>`;
    return;
  }
  const sorted = [...state.payrolls].sort((a, b) => b.month > a.month ? 1 : -1);
  list.innerHTML = sorted.map(p => {
    const cd = p.compDays || 0;
    const compBadge = cd > 0 ? ` &nbsp;<span style="color:var(--accent);font-weight:500;">+${cd} comp. day${cd === 1 ? '' : 's'}</span>` : '';
    return `
    <div class="month-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div>
          <div style="font-family:var(--sans);font-size:22px;font-weight:700;">${monthName(p.month)}</div>
          <div style="font-size:12px;color:var(--ink-3);margin-top:3px;">
            ${fmtDate(p.fromDate)} – ${fmtDate(p.toDate)} &nbsp;·&nbsp; ${p.employeeCount} employees${compBadge}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-family:var(--num);font-size:20px;font-weight:700;color:var(--accent);">${inr(p.totalPay)}</div>
          <div style="font-size:11px;color:var(--ink-3);margin-top:2px;text-transform:uppercase;letter-spacing:0.5px;">total payout</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button class="btn btn-outline btn-sm" style="flex:1;" onclick="showMonthDetail('${p.month}')">View Sheet</button>
        <button class="btn btn-danger-out btn-sm" onclick="deletePayroll('${p.month}')">Delete</button>
      </div>
    </div>
  `;
  }).join('');
}

// ── Month Detail ──────────────────────────────────────────────────────────────
let detailView = 'summary';        // 'summary' | 'full'
let detailMonth = null;

function showMonthDetail(month) {
  const payroll = state.payrolls.find(p => p.month === month);
  if (!payroll || !payroll.records) { toast('Payroll data not found.', 'error'); return; }
  detailMonth = month;

  const detailCd = payroll.compDays || 0;
  const detailCompNote = detailCd > 0 ? ` &nbsp;·&nbsp; <span style="color:var(--accent);font-weight:500;">+${detailCd} complementary day${detailCd === 1 ? '' : 's'}</span>` : '';
  document.getElementById('monthDetailContent').innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="font-family:var(--sans);font-size:26px;font-weight:700;">${monthName(payroll.month)} Payroll</div>
      <div style="font-size:13px;color:var(--ink-3);margin-top:4px;">
        ${fmtDate(payroll.fromDate)} – ${fmtDate(payroll.toDate)} &nbsp;·&nbsp; ${payroll.employeeCount} employees${detailCompNote}
      </div>
    </div>
    <div class="seg-toggle" role="tablist" aria-label="Sheet detail level">
      <button class="seg" id="segSummary" role="tab" onclick="setDetailView('summary')">Summary</button>
      <button class="seg" id="segFull" role="tab" onclick="setDetailView('full')">Full breakdown</button>
    </div>
    <div id="detailSheetHost"></div>
    <div style="height:16px;"></div>
    <div style="display:flex;gap:10px;">
      <button class="btn btn-outline" style="flex:1;" onclick="editMonthDetail('${payroll.month}')">Edit Payroll</button>
      <button class="btn btn-outline" onclick="downloadMonthPDF('${payroll.month}')">Download PDF</button>
      <button class="btn btn-outline" onclick="downloadMonthFullPDF('${payroll.month}')">Download Full PDF</button>
      <button class="btn btn-danger-out" onclick="deletePayroll('${payroll.month}')">Delete</button>
    </div>
  `;
  renderDetailSheet();

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-month-detail').classList.add('active');
  document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('bnav-history').classList.add('active');
  window.scrollTo(0, 0);
}

function setDetailView(mode) {
  detailView = mode;
  renderDetailSheet();
}

function renderDetailSheet() {
  const payroll = state.payrolls.find(p => p.month === detailMonth);
  const host = document.getElementById('detailSheetHost');
  if (!payroll || !host) return;
  const sumBtn = document.getElementById('segSummary');
  const fullBtn = document.getElementById('segFull');
  if (sumBtn)  sumBtn.classList.toggle('active', detailView === 'summary');
  if (fullBtn) fullBtn.classList.toggle('active', detailView === 'full');
  if (sumBtn)  sumBtn.setAttribute('aria-selected', detailView === 'summary');
  if (fullBtn) fullBtn.setAttribute('aria-selected', detailView === 'full');
  host.innerHTML = detailView === 'summary' ? summarySheetHTML(payroll) : fullSheetHTML(payroll);
}

function _catLine(empId) {
  const emp = state.employees.find(e => e.id === empId);
  return emp?.category
    ? `<div style="font-size:11px;color:var(--accent);font-weight:500;margin-top:1px;letter-spacing:0.3px;">${h(emp.category)}</div>`
    : '';
}

// Emp ID isn't snapshotted on payroll records — looked up live, same precedent as _catLine.
function _empIdFor(srNo) {
  const emp = state.employees.find(e => e.id === srNo);
  return emp && emp.empId ? emp.empId : '—';
}

function summarySheetHTML(payroll) {
  return `
    <div class="table-wrap table-wrap-detail">
      <table class="payroll-summary-table">
        <thead>
          <tr>
            <th>Sr. No.</th>
            <th>Emp ID</th>
            <th>Employee</th>
            <th class="num">Monthly</th>
            <th class="num">Adjustments</th>
            <th class="num">Advance</th>
            <th class="num">Net Total</th>
          </tr>
        </thead>
        <tbody>
          ${payroll.records.map(r => {
            const adv = r.advanceSettlement || 0;
            const other = (r.total || 0) - (r.monthly || 0) + adv;   // net of all additions/deductions except advance
            const isDual = r.shift2BasePay != null;
            const row = `
            <tr>
              <td class="td-mono">${h(r.empId)}</td>
              <td class="td-mono">${h(_empIdFor(r.empId))}</td>
              <td><div class="td-primary">${h(r.empName)}</div>${_catLine(r.empId)}</td>
              <td class="num td-mono">${inr(r.monthly)}</td>
              <td class="num ${other >= 0 ? 'adj-positive' : 'adj-negative'}">${other >= 0 ? '+' : '−'}${inr(Math.abs(other))}</td>
              <td class="num" style="color:${adv > 0 ? 'var(--danger)' : 'var(--ink-3)'};font-weight:500;">${adv > 0 ? '-' + inr(adv) : '—'}</td>
              <td class="num td-green" style="font-weight:700;">${inr(r.total)}</td>
            </tr>`;
            const nightRow = isDual ? (() => {
              const other2 = (r.shift2Total || 0) - (r.shift2Monthly || 0);
              return `
              <tr class="shift2-row">
                <td class="td-mono"></td>
                <td class="td-mono"></td>
                <td style="padding-left:18px;font-size:11px;color:var(--ink-3);">↳ Night shift</td>
                <td class="num td-mono">${inr(r.shift2Monthly||0)}</td>
                <td class="num ${other2 >= 0 ? 'adj-positive' : 'adj-negative'}">${other2 >= 0 ? '+' : '−'}${inr(Math.abs(other2))}</td>
                <td class="num" style="color:var(--ink-3);">—</td>
                <td class="num td-mono" style="font-size:12px;color:var(--ink-2);">${inr(r.shift2Total||0)}</td>
              </tr>`;
            })() : '';
            return row + nightRow;
          }).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="6" style="text-align:right;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--ink-3);padding-right:16px;">Grand Total</td>
            <td class="num" style="font-family:var(--num);font-size:15px;font-weight:700;color:var(--accent);">${inr(payroll.totalPay)}</td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

function fullSheetHTML(payroll) {
  return `
    <div class="table-wrap table-wrap-detail">
      <table class="payroll-detail-table">
        <thead>
          <tr class="col-group-row">
            <th class="pcol-grp" colspan="3">Staff</th>
            <th colspan="2">Rates</th>
            <th class="grp-sep" colspan="5">Attendance</th>
            <th class="grp-sep" colspan="5">Additions</th>
            <th class="grp-sep" colspan="8">Adjustments &amp; Deductions</th>
            <th class="grp-sep" colspan="1">Net</th>
          </tr>
          <tr class="col-head-row">
            <th class="pcol-id">Sr. No.</th>
            <th class="pcol-empid">Emp ID</th>
            <th class="pcol-emp">Employee</th>
            <th>Monthly</th>
            <th>WD</th>
            <th>Present</th>
            <th>Absent</th>
            <th>Nml Leave</th>
            <th>OnCall</th>
            <th>Eff. Leave</th>
            <th>Ex. Hrs</th>
            <th>Night</th>
            <th>Night Pay</th>
            <th>Home</th>
            <th>Home Pay</th>
            <th>Dbt Hrs</th>
            <th>Late</th>
            <th>Day Adj</th>
            <th>OT</th>
            <th>Debit</th>
            <th>Debit Amt</th>
            <th>Late Ded</th>
            <th>Adv Settle</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          ${payroll.records.map(r => {
            const isDual = r.shift2BasePay != null;
            const row = `
            <tr>
              <td class="td-mono pcol-id">${h(r.empId)}</td>
              <td class="td-mono pcol-empid">${h(_empIdFor(r.empId))}</td>
              <td class="pcol-emp">
                <div class="td-primary">${h(r.empName)}</div>
                ${_catLine(r.empId)}
              </td>
              <td class="td-mono">${inr(r.monthly)}</td>
              <td class="td-mono">${r.workingDays}</td>
              <td>${r.presentDays}</td>
              <td>${r.absentDays}</td>
              <td>${r.normalLeaves ?? '—'}</td>
              <td>${r.onCallLeaves ?? '—'}</td>
              <td style="font-weight:600;">${(r.normalLeaves != null || r.effectiveOncall != null) ? (r.normalLeaves ?? 0) + (r.effectiveOncall ?? 0) : '—'}</td>
              <td>${r.extraHours || 0}</td>
              <td>${r.nightShifts || 0}</td>
              <td style="color:var(--accent);font-weight:500;">${(r.nightPay||0)>0?'+'+inr(r.nightPay):'—'}</td>
              <td>${r.homeVisits || 0}</td>
              <td style="color:var(--accent);font-weight:500;">${(r.homeVisitPay||0)>0?'+'+inr(r.homeVisitPay):'—'}</td>
              <td>${r.debitHours || 0}</td>
              <td>${r.lateCount || 0}</td>
              <td class="${(r.dayAdj||0)>=0?'adj-positive':'adj-negative'}">${(r.dayAdj||0)>=0?'+':''}${inr(r.dayAdj||0)}</td>
              <td>${inr(r.otPay||0)}</td>
              <td style="color:var(--danger);font-weight:500;">${(r.debitAmount||0)>0?'-'+inr(r.debitAmount):'—'}</td>
              <td style="color:var(--danger);font-weight:500;">${((r.debitAmount||0)+(r.debitHrsPay||0))>0?'-'+inr((r.debitAmount||0)+(r.debitHrsPay||0)):'—'}</td>
              <td style="color:var(--danger);font-weight:500;">${(r.latePenalty||0)>0?'-'+inr(r.latePenalty):'—'}</td>
              <td style="color:var(--danger);font-weight:500;">${(r.advanceSettlement||0)>0?'-'+inr(r.advanceSettlement):'—'}</td>
              <td class="td-green" style="font-weight:700;">${inr(r.total)}</td>
            </tr>`;
            const nightRow = isDual ? `
            <tr class="shift2-row">
              <td class="pcol-id"></td>
              <td class="pcol-empid"></td>
              <td class="pcol-emp" style="padding-left:18px;font-size:11px;color:var(--ink-3);">↳ Night shift (${inr(r.shift2Monthly||0)} / ${inr(r.shift2Hourly||0)} hr)</td>
              <td class="td-mono">${inr(r.shift2Monthly||0)}</td>
              <td class="td-mono">${r.shift2WorkingDays ?? r.workingDays}</td>
              <td>${r.shift2PresentDays ?? '—'}</td>
              <td>${r.shift2AbsentDays ?? '—'}</td>
              <td>${r.shift2NormalLeaves ?? '—'}</td>
              <td>${r.shift2OnCallLeaves ?? '—'}</td>
              <td style="font-weight:600;">${(r.shift2NormalLeaves != null || r.shift2EffectiveOncall != null) ? (r.shift2NormalLeaves ?? 0) + (r.shift2EffectiveOncall ?? 0) : '—'}</td>
              <td>${r.shift2ExtraHours || 0}</td>
              <td>${r.shift2NightShifts || 0}</td>
              <td style="color:var(--accent);font-weight:500;">${(r.shift2NightPay||0)>0?'+'+inr(r.shift2NightPay):'—'}</td>
              <td>${r.shift2HomeVisits || 0}</td>
              <td style="color:var(--accent);font-weight:500;">${(r.shift2HomeVisitPay||0)>0?'+'+inr(r.shift2HomeVisitPay):'—'}</td>
              <td>${r.shift2DebitHours || 0}</td>
              <td>${r.shift2LateCount || 0}</td>
              <td class="${(r.shift2DayAdj||0)>=0?'adj-positive':'adj-negative'}">${(r.shift2DayAdj||0)>=0?'+':''}${inr(r.shift2DayAdj||0)}</td>
              <td>${inr(r.shift2OtPay||0)}</td>
              <td style="color:var(--danger);font-weight:500;">${(r.shift2DebitAmount||0)>0?'-'+inr(r.shift2DebitAmount):'—'}</td>
              <td style="color:var(--danger);font-weight:500;">${((r.shift2DebitAmount||0)+(r.shift2DebitHrsPay||0))>0?'-'+inr((r.shift2DebitAmount||0)+(r.shift2DebitHrsPay||0)):'—'}</td>
              <td style="color:var(--danger);font-weight:500;">${(r.shift2LatePenalty||0)>0?'-'+inr(r.shift2LatePenalty):'—'}</td>
              <td style="color:var(--ink-3);font-size:11px;">—</td>
              <td class="td-mono">${inr(r.shift2Total||0)}</td>
            </tr>` : '';
            return row + nightRow;
          }).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="23" style="text-align:right;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--ink-3);padding-right:16px;">Grand Total</td>
            <td style="font-family:var(--num);font-size:15px;font-weight:700;color:var(--accent);">${inr(payroll.totalPay)}</td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

function downloadMonthPDF(month) {
  const payroll = state.payrolls.find(p => p.month === month);
  if (!payroll || !payroll.records) { toast('Payroll data not found.', 'error'); return; }

  const doc = new jspdf.jsPDF();

  doc.setFontSize(16);
  doc.text(`${monthName(payroll.month)} Payroll`, 14, 16);
  doc.setFontSize(10);
  doc.text(`${fmtDate(payroll.fromDate)} - ${fmtDate(payroll.toDate)} | ${payroll.employeeCount} employees`, 14, 23);

  const fmt = n => 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const fmtSigned = n => (n < 0 ? '-' : (n > 0 ? '+' : '')) + fmt(Math.abs(n));

  const rows = [];
  let hasDual = false;
  payroll.records.forEach(r => {
    const advance = r.advanceSettlement || 0;
    const otherSettlements = (r.total || 0) - (r.monthly || 0) + advance;
    rows.push([
      r.empId,
      _empIdFor(r.empId),
      r.empName,
      fmt(r.monthly),
      advance > 0 ? '-' + fmt(advance) : '—',
      fmtSigned(otherSettlements),
      fmt(r.total)
    ]);
    if (r.shift2BasePay != null) {
      hasDual = true;
      const otherSettlements2 = (r.shift2Total || 0) - (r.shift2Monthly || 0);
      rows.push([
        '', '', '   -> Night shift',
        fmt(r.shift2Monthly),
        '—',
        fmtSigned(otherSettlements2),
        fmt(r.shift2Total) + ' *'
      ]);
    }
  });

  doc.autoTable({
    startY: 30,
    head: [['Sr. No.', 'Emp ID', 'Employee', 'Monthly Salary', 'Advance Settle', 'Other Settlements', 'Final Amount']],
    body: rows,
    foot: [['', '', 'Grand Total', '', '', '', fmt(payroll.totalPay)]],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [46, 134, 222] },
    footStyles: { fillColor: [240, 240, 240], textColor: [20, 20, 20], fontStyle: 'bold' },
    didParseCell: (data) => {
      if (data.row.section === 'body' && Array.isArray(data.row.raw) && String(data.row.raw[2] || '').includes('Night shift')) {
        data.cell.styles.textColor = [120, 120, 120];
        data.cell.styles.fontSize = 8;
      }
    }
  });

  if (hasDual) {
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text('* Night shift total is already included in the day row\'s Final Amount above.', 14, doc.lastAutoTable.finalY + 8);
  }

  doc.save(`Payroll_${payroll.month}.pdf`);
}

// Landscape "Full breakdown" export — mirrors fullSheetHTML() column-for-column.
// The portrait downloadMonthPDF above is intentionally left untouched.
function downloadMonthFullPDF(month) {
  const payroll = state.payrolls.find(p => p.month === month);
  if (!payroll || !payroll.records) { toast('Payroll data not found.', 'error'); return; }

  const doc = new jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFontSize(16);
  doc.text(`${monthName(payroll.month)} Payroll`, 14, 14);
  doc.setFontSize(10);
  doc.text(`${fmtDate(payroll.fromDate)} - ${fmtDate(payroll.toDate)} | ${payroll.employeeCount} employees`, 14, 20);
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text('All amounts in Rs.', 14, 25);
  doc.setTextColor(20, 20, 20);

  // Money formatter without the "Rs." prefix — 24 columns won't fit on A4 landscape otherwise.
  const num = n => Number(n || 0).toLocaleString('en-IN');
  const numSigned = n => ((n || 0) >= 0 ? '+' : '') + num(n);   // matches Day Adj sign in fullSheetHTML
  const dash = '—';

  const rows = [];
  let hasDual = false;
  payroll.records.forEach(r => {
    const effLeave = (r.normalLeaves != null || r.effectiveOncall != null)
      ? (r.normalLeaves ?? 0) + (r.effectiveOncall ?? 0) : dash;
    const debitTotal = (r.debitAmount || 0) + (r.debitHrsPay || 0);
    rows.push([
      r.empId,
      _empIdFor(r.empId),
      r.empName,
      num(r.monthly),
      r.workingDays,
      r.presentDays,
      r.absentDays,
      r.normalLeaves ?? dash,
      r.onCallLeaves ?? dash,
      effLeave,
      r.extraHours || 0,
      r.nightShifts || 0,
      (r.nightPay || 0) > 0 ? '+' + num(r.nightPay) : dash,
      r.homeVisits || 0,
      (r.homeVisitPay || 0) > 0 ? '+' + num(r.homeVisitPay) : dash,
      r.debitHours || 0,
      r.lateCount || 0,
      numSigned(r.dayAdj || 0),
      num(r.otPay || 0),
      (r.debitAmount || 0) > 0 ? '-' + num(r.debitAmount) : dash,
      debitTotal > 0 ? '-' + num(debitTotal) : dash,
      (r.latePenalty || 0) > 0 ? '-' + num(r.latePenalty) : dash,
      (r.advanceSettlement || 0) > 0 ? '-' + num(r.advanceSettlement) : dash,
      num(r.total),
    ]);
    if (r.shift2BasePay != null) {
      hasDual = true;
      const effLeave2 = (r.shift2NormalLeaves != null || r.shift2EffectiveOncall != null)
        ? (r.shift2NormalLeaves ?? 0) + (r.shift2EffectiveOncall ?? 0) : dash;
      const debitTotal2 = (r.shift2DebitAmount || 0) + (r.shift2DebitHrsPay || 0);
      rows.push([
        '', '',
        '   -> Night shift',
        num(r.shift2Monthly || 0),
        r.shift2WorkingDays ?? r.workingDays,
        r.shift2PresentDays ?? dash,
        r.shift2AbsentDays ?? dash,
        r.shift2NormalLeaves ?? dash,
        r.shift2OnCallLeaves ?? dash,
        effLeave2,
        r.shift2ExtraHours || 0,
        r.shift2NightShifts || 0,
        (r.shift2NightPay || 0) > 0 ? '+' + num(r.shift2NightPay) : dash,
        r.shift2HomeVisits || 0,
        (r.shift2HomeVisitPay || 0) > 0 ? '+' + num(r.shift2HomeVisitPay) : dash,
        r.shift2DebitHours || 0,
        r.shift2LateCount || 0,
        numSigned(r.shift2DayAdj || 0),
        num(r.shift2OtPay || 0),
        (r.shift2DebitAmount || 0) > 0 ? '-' + num(r.shift2DebitAmount) : dash,
        debitTotal2 > 0 ? '-' + num(debitTotal2) : dash,
        (r.shift2LatePenalty || 0) > 0 ? '-' + num(r.shift2LatePenalty) : dash,
        dash,
        num(r.shift2Total || 0) + ' *',
      ]);
    }
  });

  doc.autoTable({
    startY: 29,
    head: [['Sr. No.', 'Emp ID', 'Employee', 'Monthly', 'WD', 'Present', 'Absent', 'Nml Leave', 'OnCall',
            'Eff. Leave', 'Ex. Hrs', 'Night', 'Night Pay', 'Home', 'Home Pay', 'Dbt Hrs', 'Late', 'Day Adj',
            'OT', 'Debit', 'Debit Amt', 'Late Ded', 'Adv Settle', 'Total']],
    body: rows,
    foot: [[{ content: 'Grand Total', colSpan: 23, styles: { halign: 'right', fontStyle: 'bold' } }, num(payroll.totalPay)]],
    margin: { left: 8, right: 8 },
    styles: { fontSize: 6, cellPadding: 1, overflow: 'linebreak', halign: 'right' },
    headStyles: { fillColor: [46, 134, 222], fontSize: 6, halign: 'right' },
    footStyles: { fillColor: [240, 240, 240], textColor: [20, 20, 20], fontStyle: 'bold' },
    columnStyles: {
      0: { halign: 'left', cellWidth: 11 },   // Sr. No.
      1: { halign: 'left', cellWidth: 13 },   // Emp ID
      2: { halign: 'left', cellWidth: 34 },   // Employee
    },
    didParseCell: (data) => {
      if (data.row.section === 'body' && Array.isArray(data.row.raw) && String(data.row.raw[2] || '').includes('Night shift')) {
        data.cell.styles.textColor = [120, 120, 120];
        data.cell.styles.fontSize = 5.5;
      }
    }
  });

  if (hasDual) {
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text('* Night shift total is already included in the day row\'s Total above.', 14, doc.lastAutoTable.finalY + 8);
  }

  doc.save(`Payroll_${payroll.month}_Full.pdf`);
}

function editMonthDetail(month) {
  const payroll = state.payrolls.find(p => p.month === month);
  if (!payroll || !payroll.records) return;

  const editCd = payroll.compDays || 0;
  const editCompNote = editCd > 0 ? ` &nbsp;·&nbsp; <span style="color:var(--accent);font-weight:500;">+${editCd} comp. day${editCd === 1 ? '' : 's'}</span>` : '';
  document.getElementById('monthDetailContent').innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="font-family:var(--sans);font-size:26px;font-weight:700;">${monthName(payroll.month)} Payroll</div>
      <div style="font-size:13px;color:var(--ink-3);margin-top:4px;">
        ${fmtDate(payroll.fromDate)} – ${fmtDate(payroll.toDate)} &nbsp;·&nbsp; Editing ${payroll.employeeCount} employees${editCompNote}
      </div>
    </div>
    <div class="table-wrap" style="max-height:70vh;overflow:auto;">
      <table class="payroll-edit-table" style="min-width:1480px;">
        <thead>${payrollHeadHTML({ mode: 'edit' })}</thead>
        <tbody>
          ${payroll.records.map(r => {
            const emp = state.employees.find(e => e.id === r.empId);
            const isDual = r.shift2BasePay != null;
            const obj = { id: r.empId, empId: emp?.empId || null, category: emp?.category || null,
                          name: r.empName, monthly: r.monthly, hourly: r.hourly, workingDays: r.workingDays,
                          shiftType: isDual ? 'Day & Night' : (emp?.shiftType || 'Day'),
                          shift2Monthly: r.shift2Monthly, shift2Hourly: r.shift2Hourly, shift2WorkingDays: r.shift2WorkingDays };
            const vals = { presentDays: r.presentDays, absentDays: r.absentDays,
                           normalLeaves: r.normalLeaves, onCallLeaves: r.onCallLeaves,
                           extraHours: r.extraHours || 0, nightShifts: r.nightShifts || 0,
                           homeVisits: r.homeVisits || 0,
                           debitHours: r.debitHours || 0, debitAmount: r.debitAmount || 0,
                           lateCount: r.lateCount || 0, advanceSettlement: r.advanceSettlement || 0,
                           shift2PresentDays: r.shift2PresentDays, shift2AbsentDays: r.shift2AbsentDays,
                           shift2ExtraHours: r.shift2ExtraHours || 0,
                           shift2NormalLeaves: r.shift2NormalLeaves, shift2OnCallLeaves: r.shift2OnCallLeaves,
                           shift2NightShifts: r.shift2NightShifts || 0, shift2HomeVisits: r.shift2HomeVisits || 0,
                           shift2DebitHours: r.shift2DebitHours || 0, shift2DebitAmount: r.shift2DebitAmount || 0,
                           shift2LateCount: r.shift2LateCount || 0 };
            return payrollRowHTML(obj, { mode: 'edit', prefix: 'e', month, vals });
          }).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="22" style="text-align:right;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--ink-3);padding-right:16px;">Grand Total</td>
            <td id="eGrandTotal" style="font-family:var(--num);font-size:15px;font-weight:700;color:var(--accent);">—</td>
          </tr>
        </tfoot>
      </table>
    </div>
    <div style="height:16px;"></div>
    <div style="display:flex;gap:10px;">
      <button class="btn btn-primary" style="flex:1;" id="eSaveBtn" onclick="saveMonthEdit('${month}')">Save Changes</button>
      <button class="btn btn-outline" onclick="showMonthDetail('${month}')">Cancel</button>
    </div>
  `;

  // Initialise live-computed cells for every row
  payroll.records.forEach(r => calcEditRow(r.empId, month));
}

function calcEditRow(empId, month, source) {
  const payroll = state.payrolls.find(p => p.month === month);
  if (!payroll) return;
  const rec = payroll.records.find(r => r.empId === empId);
  if (!rec) return;

  const pd  = periodDays(payroll.fromDate, payroll.toDate);
  const prEl  = document.getElementById('epr-'  + empId);
  const abEl  = document.getElementById('eab-'  + empId);
  const enlEl = document.getElementById('enl-'  + empId);
  const oclEl = document.getElementById('eocl-' + empId);
  const efEl  = document.getElementById('eefl-' + empId);

  // Cleared present/absent: reset leaves too
  if ((source === 'present' && prEl && prEl.value === '') || (source === 'absent' && abEl && abEl.value === '')) {
    if (prEl) prEl.value = ''; if (abEl) abEl.value = '';
    if (enlEl) { enlEl.disabled = true; enlEl.value = ''; }
    if (oclEl) { oclEl.disabled = true; oclEl.value = ''; }
    if (efEl) efEl.textContent = '—';
    return;
  }

  // Present / Absent sync
  if (source === 'present' && prEl && abEl && prEl.value !== '') {
    const v = Math.min(pd, Math.max(0, Math.floor(parseFloat(prEl.value))));
    prEl.value = v; abEl.value = pd - v;
    if (enlEl) enlEl.disabled = false;
    if (oclEl) oclEl.disabled = false;
    if (enlEl && oclEl && enlEl.value === '' && oclEl.value === '') { enlEl.value = pd - v; oclEl.value = 0; }
    _resyncLeavesToAbsent(enlEl, oclEl, efEl, pd - v);
  } else if (source === 'absent' && prEl && abEl && abEl.value !== '') {
    const v = Math.min(pd, Math.max(0, Math.floor(parseFloat(abEl.value))));
    abEl.value = v; prEl.value = pd - v;
    if (enlEl) enlEl.disabled = false;
    if (oclEl) oclEl.disabled = false;
    if (enlEl && oclEl && enlEl.value === '' && oclEl.value === '') { enlEl.value = v; oclEl.value = 0; }
    _resyncLeavesToAbsent(enlEl, oclEl, efEl, v);
  } else if (!source) {
    // Init: enable/disable leaves based on whether absent is known
    const hasAbsent = abEl && abEl.value !== '';
    if (enlEl) enlEl.disabled = !hasAbsent;
    if (oclEl) oclEl.disabled = !hasAbsent;
  }

  // Normal / On-call leave sync (normal + oncall = absent)
  const absent = parseFloat(abEl?.value) || 0;
  if (source === 'normal') {
    if (enlEl && enlEl.value === '') {
      if (oclEl) oclEl.value = '';
    } else if (enlEl) {
      const nl = Math.min(absent, Math.max(0, Math.floor(parseFloat(enlEl.value) || 0)));
      enlEl.value = nl;
      if (oclEl) oclEl.value = absent - nl;
    }
  } else if (source === 'oncall') {
    if (oclEl && oclEl.value === '') {
      if (enlEl) enlEl.value = '';
    } else if (oclEl) {
      const ocl = Math.min(absent, Math.max(0, Math.floor(parseFloat(oclEl.value) || 0)));
      oclEl.value = ocl;
      if (enlEl) enlEl.value = absent - ocl;
    }
  }

  // Compute effectiveAbsent from leave fields
  let effectiveAbsent = null;
  const nlVal  = enlEl && enlEl.value !== '' ? Math.floor(parseFloat(enlEl.value)  || 0) : null;
  const oclVal = oclEl && oclEl.value !== '' ? Math.floor(parseFloat(oclEl.value) || 0) : null;
  if (nlVal !== null || oclVal !== null) {
    const effOcl = Math.min(oclVal || 0, 2) + Math.max(0, (oclVal || 0) - 2) * 2;
    effectiveAbsent = (nlVal || 0) + effOcl;
    if (efEl) efEl.textContent = effectiveAbsent;
  } else {
    if (efEl) efEl.textContent = '—';
  }

  const present    = parseFloat(prEl?.value) || 0;
  const extraHours = parseFloat(document.getElementById('ehr-'  + empId)?.value) || 0;
  const nightShifts = parseFloat(document.getElementById('ens-' + empId)?.value) || 0;
  const debitHours = parseFloat(document.getElementById('edh-'  + empId)?.value) || 0;
  const debit      = parseFloat(document.getElementById('edbt-' + empId)?.value) || 0;
  const lateCount  = Math.floor(parseFloat(document.getElementById('elc-' + empId)?.value) || 0);
  const advEl = document.getElementById('eadv-' + empId);
  const advanceSettlement = advEl && advEl.value !== '' ? parseFloat(advEl.value) || 0 : 0;
  const homeVisits = parseFloat(document.getElementById('ehv-' + empId)?.value) || 0;

  // Use snapshotted rates so editing attendance never alters historical rates.
  const cv = computeRowValues({
    present, effectiveAbsent, pd, compDays: rec.compDays || 0,
    monthly: rec.monthly, daily: rec.daily, hourly: rec.hourly, workingDays: rec.workingDays,
    nightBase: rec.nightBase || 0, nightAppr: rec.nightAppr || 0,
    extraHours, nightShifts, debitHours, debitAmount: debit, lateCount, advanceSettlement,
    homeVisits, homeVisitRate: state.settings.homeVisitRate || 0,
  });
  const { dayAdj } = cv;
  const isDual = rec.shift2BasePay != null;
  const s2 = isDual
    ? _shift2Contribution({ shiftType: 'Day & Night', shift2Monthly: rec.shift2Monthly, shift2Hourly: rec.shift2Hourly, workingDays: rec.workingDays, shift2WorkingDays: rec.shift2WorkingDays }, 'e', empId, pd, rec.compDays || 0,
        rec.nightBase || 0, rec.nightAppr || 0, state.settings.homeVisitRate || 0)
    : { hasInput: false, dayAdj: 0, total: 0 };
  const adj2El    = document.getElementById('eadj2-'    + empId);
  const dbtAmt2El = document.getElementById('edbtamt2-' + empId);
  const lp2El     = document.getElementById('elp2-'     + empId);
  const tot2El    = document.getElementById('etot2-'    + empId);
  if (adj2El) {
    adj2El.textContent = s2.hasInput ? (s2.dayAdj >= 0 ? '+' : '') + inr(s2.dayAdj) : '—';
    adj2El.className = s2.dayAdj > 0 ? 'adj-positive' : s2.dayAdj < 0 ? 'adj-negative' : '';
  }
  if (dbtAmt2El) dbtAmt2El.textContent = (s2.hasInput && s2.totalDebit > 0) ? '-' + inr(s2.totalDebit) : '—';
  if (lp2El) lp2El.textContent = (s2.hasInput && s2.latePenalty > 0) ? '-' + inr(s2.latePenalty) : '—';
  if (tot2El) tot2El.textContent = s2.hasInput ? inr(s2.total) : '—';
  const total = cv.total + (s2.hasInput ? s2.total : 0);

  const adjEl    = document.getElementById('eadj-'    + empId);
  const dbtAmtEl = document.getElementById('edbtamt-' + empId);
  const lpEl     = document.getElementById('elp-'     + empId);
  const balEl    = document.getElementById('ebal-'    + empId);
  const totEl    = document.getElementById('etot-'    + empId);

  if (adjEl) {
    adjEl.textContent = (dayAdj >= 0 ? '+' : '') + inr(dayAdj);
    adjEl.className   = dayAdj > 0 ? 'adj-positive' : dayAdj < 0 ? 'adj-negative' : '';
  }
  if (dbtAmtEl) dbtAmtEl.textContent = cv.totalDebit > 0 ? '-' + inr(cv.totalDebit) : '—';
  if (lpEl) lpEl.textContent = cv.latePenalty > 0 ? '-' + inr(cv.latePenalty) : '—';
  if (balEl) {
    const available = advBalance(empId) + (rec.advanceSettlement || 0);
    const remaining = available - advanceSettlement;
    if (advanceSettlement > available) {
      balEl.innerHTML = `<span style="color:var(--danger);">Exceeds! Bal: ${inr(available)}</span>`;
      if (advEl) advEl.classList.add('missing');
    } else {
      if (advEl) advEl.classList.remove('missing');
      balEl.textContent = (available > 0 || advanceSettlement > 0) ? `Bal: ${inr(available)} → ${inr(remaining)}` : '—';
    }
  }
  if (totEl) totEl.textContent = inr(total);

  // Update grand total
  let sum = 0;
  payroll.records.forEach(r => {
    const el = document.getElementById('etot-' + r.empId);
    if (el) { const v = parseFloat(el.textContent.replace(/[₹,]/g, '')); if (!isNaN(v)) sum += v; }
  });
  const gtEl = document.getElementById('eGrandTotal');
  if (gtEl) gtEl.textContent = inr(sum);
}

// Night sub-row present/absent + leave auto-balance for Edit, mirrors calcBulkRowShift2.
function calcEditRowShift2(empId, month, source) {
  const payroll = state.payrolls.find(p => p.month === month);
  if (!payroll) { calcEditRow(empId, month); return; }
  const pd = periodDays(payroll.fromDate, payroll.toDate);
  const pr2El  = document.getElementById('epr2-'  + empId);
  const ab2El  = document.getElementById('eab2-'  + empId);
  const nl2El  = document.getElementById('enl2-'  + empId);
  const ocl2El = document.getElementById('eocl2-' + empId);
  const efl2El = document.getElementById('eefl2-' + empId);
  if (!pr2El || !ab2El) { calcEditRow(empId, month); return; }

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

  calcEditRow(empId, month);
}

async function saveMonthEdit(month) {
  const payroll = state.payrolls.find(p => p.month === month);
  if (!payroll) return;

  // Validate leave sums before building entries
  const leaveErrors = [];
  for (const r of payroll.records) {
    const nlEl  = document.getElementById('enl-'  + r.empId);
    const oclEl = document.getElementById('eocl-' + r.empId);
    const abEl  = document.getElementById('eab-'  + r.empId);
    const nl  = (nlEl  && !nlEl.disabled  && nlEl.value  !== '') ? parseFloat(nlEl.value)  : null;
    const ocl = (oclEl && !oclEl.disabled && oclEl.value !== '') ? parseFloat(oclEl.value) : null;
    const ab  = abEl ? (parseFloat(abEl.value) || 0) : 0;
    if (ab > 0 && nl === null && ocl === null) {
      leaveErrors.push(`${r.empName} (fill normal & on-call leaves — absent is ${ab})`);
      if (nlEl)  nlEl.classList.add('missing');
      if (oclEl) oclEl.classList.add('missing');
    } else if (ab > 0 && (nl !== null || ocl !== null)) {
      const leaveSum = (nl || 0) + (ocl || 0);
      if (leaveSum !== ab) {
        leaveErrors.push(`${r.empName} (normal + on-call = ${leaveSum}, must equal absent ${ab})`);
        if (nlEl)  nlEl.classList.add('missing');
        if (oclEl) oclEl.classList.add('missing');
      } else {
        if (nlEl)  nlEl.classList.remove('missing');
        if (oclEl) oclEl.classList.remove('missing');
      }
    }

    if (r.shift2BasePay == null) continue;
    const nl2El  = document.getElementById('enl2-'  + r.empId);
    const ocl2El = document.getElementById('eocl2-' + r.empId);
    const ab2El  = document.getElementById('eab2-'  + r.empId);
    const nl2  = (nl2El  && !nl2El.disabled  && nl2El.value  !== '') ? parseFloat(nl2El.value)  : null;
    const ocl2 = (ocl2El && !ocl2El.disabled && ocl2El.value !== '') ? parseFloat(ocl2El.value) : null;
    const ab2  = ab2El ? (parseFloat(ab2El.value) || 0) : 0;
    if (ab2 > 0 && nl2 === null && ocl2 === null) {
      leaveErrors.push(`${r.empName} (fill night-shift normal & on-call leaves — absent is ${ab2})`);
      if (nl2El)  nl2El.classList.add('missing');
      if (ocl2El) ocl2El.classList.add('missing');
    } else if (ab2 > 0 && (nl2 !== null || ocl2 !== null)) {
      const leaveSum2 = (nl2 || 0) + (ocl2 || 0);
      if (leaveSum2 !== ab2) {
        leaveErrors.push(`${r.empName} (night-shift normal + on-call = ${leaveSum2}, must equal absent ${ab2})`);
        if (nl2El)  nl2El.classList.add('missing');
        if (ocl2El) ocl2El.classList.add('missing');
      } else {
        if (nl2El)  nl2El.classList.remove('missing');
        if (ocl2El) ocl2El.classList.remove('missing');
      }
    }
  }
  if (leaveErrors.length > 0) {
    toast(`Fix leave totals for ${leaveErrors.length} employee${leaveErrors.length > 1 ? 's' : ''}:\n• ` + leaveErrors.join('\n• '), 'error');
    return;
  }

  // Validate advance settlement doesn't exceed balance before building entries
  const balErrors = [];
  for (const r of payroll.records) {
    const advEl = document.getElementById('eadv-' + r.empId);
    const advanceSettlement = advEl && advEl.value !== '' ? parseFloat(advEl.value) || 0 : 0;
    if (advanceSettlement <= 0) { if (advEl) advEl.classList.remove('missing'); continue; }
    const available = advBalance(r.empId) + (r.advanceSettlement || 0);
    if (advanceSettlement > available) {
      balErrors.push(`${r.empName} (advance settlement ${inr(advanceSettlement)} exceeds balance ${inr(available)})`);
      if (advEl) advEl.classList.add('missing');
    } else {
      if (advEl) advEl.classList.remove('missing');
    }
  }
  if (balErrors.length > 0) {
    toast(`Fix advance settlements for ${balErrors.length} employee${balErrors.length > 1 ? 's' : ''}:\n• ` + balErrors.join('\n• '), 'error');
    return;
  }

  const entries = payroll.records.map(r => {
    const nlEl  = document.getElementById('enl-'  + r.empId);
    const oclEl = document.getElementById('eocl-' + r.empId);
    const nl2El  = document.getElementById('enl2-'  + r.empId);
    const ocl2El = document.getElementById('eocl2-' + r.empId);
    return {
      empId:        r.empId,
      presentDays:  (v => Number.isFinite(v) ? v : r.presentDays)(parseFloat(document.getElementById('epr-'  + r.empId)?.value)),
      absentDays:   (v => Number.isFinite(v) ? v : r.absentDays) (parseFloat(document.getElementById('eab-'  + r.empId)?.value)),
      normalLeaves: (nlEl  && !nlEl.disabled  && nlEl.value  !== '') ? parseFloat(nlEl.value)   : null,
      onCallLeaves: (oclEl && !oclEl.disabled && oclEl.value !== '') ? parseFloat(oclEl.value)  : null,
      extraHours:   parseFloat(document.getElementById('ehr-'  + r.empId)?.value) || 0,
      nightShifts:  parseFloat(document.getElementById('ens-'  + r.empId)?.value) || 0,
      debitHours:   parseFloat(document.getElementById('edh-'  + r.empId)?.value) || 0,
      debitAmount:  parseFloat(document.getElementById('edbt-' + r.empId)?.value) || 0,
      lateCount:    parseFloat(document.getElementById('elc-'  + r.empId)?.value) || 0,
      advanceSettlement: parseFloat(document.getElementById('eadv-' + r.empId)?.value) || 0,
      homeVisits:   parseFloat(document.getElementById('ehv-'  + r.empId)?.value) || 0,
      shift2PresentDays: (v => Number.isFinite(v) ? v : r.shift2PresentDays)(parseFloat(document.getElementById('epr2-' + r.empId)?.value)),
      shift2AbsentDays:  (v => Number.isFinite(v) ? v : r.shift2AbsentDays) (parseFloat(document.getElementById('eab2-' + r.empId)?.value)),
      shift2ExtraHours:  parseFloat(document.getElementById('ehr2-' + r.empId)?.value) || 0,
      shift2NormalLeaves: (nl2El  && !nl2El.disabled  && nl2El.value  !== '') ? parseFloat(nl2El.value)  : null,
      shift2OnCallLeaves: (ocl2El && !ocl2El.disabled && ocl2El.value !== '') ? parseFloat(ocl2El.value) : null,
      shift2NightShifts:  parseFloat(document.getElementById('ens2-'  + r.empId)?.value) || 0,
      shift2HomeVisits:   parseFloat(document.getElementById('ehv2-'  + r.empId)?.value) || 0,
      shift2DebitHours:   parseFloat(document.getElementById('edh2-'  + r.empId)?.value) || 0,
      shift2DebitAmount:  parseFloat(document.getElementById('edbt2-' + r.empId)?.value) || 0,
      shift2LateCount:    parseFloat(document.getElementById('elc2-'  + r.empId)?.value) || 0,
    };
  });

  const btn = document.getElementById('eSaveBtn');
  if (btn) btn.disabled = true;
  try {
    const updated = await api('PUT', '/payrolls/' + month, {
      month,
      fromDate: payroll.fromDate,
      toDate:   payroll.toDate,
      entries,
      payType: state.payType,
    });
    state.payrolls = state.payrolls.map(p => p.month === month ? updated : p);
    await refreshAdvanceBalances();
    toast('Payroll updated for ' + monthName(month) + '.', 'success');
    showMonthDetail(month);
  } catch(e) {
    toast(e.message, 'error');
    if (btn) btn.disabled = false;
  }
}

async function deletePayroll(month) {
  try {
    await api('DELETE', '/payrolls/' + month + '?pay_type=' + state.payType);
    state.payrolls = state.payrolls.filter(p => p.month !== month);
    toast('Payroll for ' + monthName(month) + ' deleted.', 'info');
    switchView('history');
  } catch(e) {
    toast(e.message, 'error');
  }
}
