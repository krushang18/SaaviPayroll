// Saavi Payroll — Excel export for saved payrolls. Classic script (file:// compatible); globals shared across files.
// Based on the sheet the accounts desk maintains by hand, plus every addition/deduction that
// feeds the total (so a row's columns add up to its Total Salary): 15 columns, dual-shift staff
// split into day / "> Night shift" / "TOTAL=" rows, money written as real numbers.

const XL_ORG = 'SAAVI WOMENS HOSPITAL';

const XL_HEADERS = ['Sr No', 'Emp ID', 'Employee Name', 'Monthly Salary', 'Present',
                    'Absent', 'EX HRS', 'Day Adj', 'OT Pay', 'Night Pay', 'Home Visit',
                    'Debit', 'Late Cut', 'Adv', 'Total Salary'];
const XL_WIDTHS  = [6, 10, 32, 14, 9, 9, 9, 12, 11, 11, 11, 11, 11, 12, 14];
// 1-based column groups by number format
const XL_COLS_MONEY  = [4, 9, 10, 11, 15];
const XL_COLS_SIGNED = [8];
const XL_COLS_CUT    = [12, 13, 14];   // Debit (fine + debit hours), Late Cut, Adv — shown negative, dash when zero

const XL_BLUE  = 'FF2E86DE';   // same blue the PDF exports use — headStyles.fillColor [46,134,222]
const XL_GREY  = 'FFF0F0F0';
const XL_MUTED = 'FF787878';

// Money: Indian lakh grouping, paise only when present.
const XL_FMT_MONEY  = '#,##,##0.##';
const XL_FMT_SIGNED = '+#,##,##0.##;-#,##,##0.##;"+0"';   // Day Adj — matches the "+0" / "-20,000" in the source sheet
const XL_FMT_ADV    = '#,##,##0.##;-#,##,##0.##;"—"';      // a zero advance shows as a dash

const XL_THIN = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const XL_BORDER = { top: XL_THIN, left: XL_THIN, bottom: XL_THIN, right: XL_THIN };

// Build the body rows for one payroll. Each entry carries an explicit `kind` so styling
// never has to sniff the name cell the way the PDF exporters do.
function _xlBodyRows(payroll) {
  const rows = [];
  payroll.records.forEach(r => {
    const isDual = r.shift2BasePay != null;
    const adv = r.advanceSettlement || 0;
    // r.total is the combined net of both shifts, so the day row must show only its own share.
    const dayTotal = isDual ? (r.total || 0) - (r.shift2Total || 0) : (r.total || 0);

    rows.push({ kind: 'day', cells: [
      r.empId,
      _empIdFor(r.empId),
      r.empName,
      r.monthly || 0,
      r.presentDays,
      r.absentDays,
      r.extraHours || 0,
      r.dayAdj || 0,
      r.otPay || 0,
      r.nightPay || 0,
      r.homeVisitPay || 0,
      -((r.debitAmount || 0) + (r.debitHrsPay || 0)) || 0,
      -(r.latePenalty || 0) || 0,
      adv > 0 ? -adv : 0,
      dayTotal,
    ]});

    if (!isDual) return;

    rows.push({ kind: 'night', cells: [
      null,
      null,
      '> Night shift',
      r.shift2Monthly || 0,
      r.shift2PresentDays,
      r.shift2AbsentDays,
      r.shift2ExtraHours || 0,
      r.shift2DayAdj || 0,
      r.shift2OtPay || 0,
      r.shift2NightPay || 0,
      r.shift2HomeVisitPay || 0,
      -((r.shift2DebitAmount || 0) + (r.shift2DebitHrsPay || 0)) || 0,
      -(r.shift2LatePenalty || 0) || 0,
      null,
      r.shift2Total || 0,
    ]});

    rows.push({ kind: 'subtotal', cells: [
      null, null, 'TOTAL=',
      (r.monthly || 0) + (r.shift2Monthly || 0),
      null, null, null, null, null, null, null, null, null, null,
      r.total || 0,
    ]});
  });
  return rows;
}

function _xlGrandTotalRow(payroll) {
  let monthly = 0, dayAdj = 0, ot = 0, night = 0, home = 0, debit = 0, late = 0, adv = 0;
  payroll.records.forEach(r => {
    monthly += (r.monthly || 0) + (r.shift2Monthly || 0);
    dayAdj  += (r.dayAdj  || 0) + (r.shift2DayAdj  || 0);
    ot      += (r.otPay   || 0) + (r.shift2OtPay   || 0);
    night   += (r.nightPay || 0) + (r.shift2NightPay || 0);
    home    += (r.homeVisitPay || 0) + (r.shift2HomeVisitPay || 0);
    debit   += (r.debitAmount || 0) + (r.debitHrsPay || 0) + (r.shift2DebitAmount || 0) + (r.shift2DebitHrsPay || 0);
    late    += (r.latePenalty || 0) + (r.shift2LatePenalty || 0);
    adv     += r.advanceSettlement || 0;
  });
  // Attendance columns are left blank — summing present/absent/hours across staff is meaningless.
  return [null, null, 'GRAND TOTAL', monthly, null, null, null, dayAdj, ot, night, home,
          -debit || 0, -late || 0, adv > 0 ? -adv : 0, payroll.totalPay || 0];
}

async function downloadMonthExcel(month) {
  const payroll = state.payrolls.find(p => p.month === month);
  if (!payroll || !payroll.records) { toast('Payroll data not found.', 'error'); return; }
  if (typeof ExcelJS === 'undefined') { toast('Excel library not loaded — check your connection.', 'error'); return; }

  const label = monthName(payroll.month);          // e.g. "July 2026"
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(label);
  ws.views = [{ state: 'frozen', ySplit: 2 }];
  XL_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Row 1 — banner
  ws.mergeCells(1, 1, 1, XL_HEADERS.length);
  const title = ws.getCell(1, 1);
  title.value = `${XL_ORG} ${label} Payroll`;
  title.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_BLUE } };
  ws.getRow(1).height = 22;

  // Row 2 — column headers
  const head = ws.addRow(XL_HEADERS);
  head.eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_BLUE } };
    c.border = XL_BORDER;
  });
  head.height = 20;

  const styleBody = (row, kind) => {
    row.eachCell({ includeEmpty: true }, (c, col) => {
      c.border = XL_BORDER;
      c.alignment = { horizontal: col === 3 ? 'left' : (col <= 2 ? 'left' : 'right') };
      if (XL_COLS_MONEY.includes(col))  c.numFmt = XL_FMT_MONEY;
      if (XL_COLS_SIGNED.includes(col)) c.numFmt = XL_FMT_SIGNED;
      if (XL_COLS_CUT.includes(col))    c.numFmt = XL_FMT_ADV;
      if (kind === 'night') {
        c.font = { italic: true, size: 10, color: { argb: XL_MUTED } };
      } else if (kind === 'subtotal') {
        c.font = { bold: true };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_GREY } };
      }
    });
    if (kind === 'night') row.getCell(3).alignment = { horizontal: 'left', indent: 2 };
  };

  _xlBodyRows(payroll).forEach(r => styleBody(ws.addRow(r.cells), r.kind));

  const gt = ws.addRow(_xlGrandTotalRow(payroll));
  gt.eachCell({ includeEmpty: true }, (c, col) => {
    c.font = { bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL_GREY } };
    c.border = { ...XL_BORDER, top: { style: 'medium', color: { argb: 'FF808080' } } };
    c.alignment = { horizontal: col === 3 ? 'right' : 'right' };
    if (XL_COLS_MONEY.includes(col))  c.numFmt = XL_FMT_MONEY;
    if (XL_COLS_SIGNED.includes(col)) c.numFmt = XL_FMT_SIGNED;
    if (XL_COLS_CUT.includes(col))    c.numFmt = XL_FMT_ADV;
  });

  try {
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    slipDownloadBlob(blob, `Payroll_${payroll.month}.xlsx`);
  } catch (e) {
    toast('Could not build the Excel file.', 'error');
  }
}
