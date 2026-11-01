// Saavi Payroll — split from index.html. Classic script (file:// compatible); globals shared across files.

// ── Sonography (visiting doctor's pay) ────────────────────────────────────────
// One row per date with the patient count per type plus any counseling / others
// patients and ₹ amount (entered now and then; the doctor gets their % of the amount). Not linked to payroll.
// Each row keeps the rates it was saved with; month totals and TDS come from the backend.
const SONO_PATIENT_TYPES = ['nt_ano', 'gs', 'nt_twins', 'gs_twins'];
const SONO_COUNT_TYPES = [...SONO_PATIENT_TYPES, 'foc'];
const SONO_LABELS = { nt_ano: 'NT & ANO', gs: 'G.S', nt_twins: 'NT Twins', gs_twins: 'G.S Twins', foc: 'FOC', counseling: 'Counseling / Others' };
const SONO_MAX_RATE = 100000;
const SONO_MAX_COUNT = 999;
const SONO_MAX_COUNSELING = 1000000;

const sono = { rates: null, tdsPct: 10, month: null, data: null, months: [], editing: null };

function inr2(n) { return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// Today in IST, which is the clock the backend checks future dates against.
function sonoToday() {
  return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
}

function _halfUpDiv(n, d) { return Math.floor((2 * n + d) / (2 * d)); }

// Mirrors backend _sono_row_paise: whole paise, doctor's share rounded half up per line.
function computeSonoRow(counts, counseling, counselingPatients, rates) {
  let billed = 0, doctor = 0;
  const addLine = (base, pct) => { billed += base; doctor += _halfUpDiv(base * Math.round(pct * 100), 10000); };
  SONO_PATIENT_TYPES.forEach(t => addLine((counts[t] || 0) * Math.round(rates[t].rate * 100), rates[t].pct));
  addLine((counseling || 0) * 100, rates.counseling.pct);
  const patients = SONO_COUNT_TYPES.reduce((s, t) => s + (counts[t] || 0), 0) + (counselingPatients || 0);
  return { billed: billed / 100, doctorShare: doctor / 100, patients };
}

async function initSonographyView() {
  document.getElementById('sonoEntryCard').innerHTML = '<div class="skel skel-row"></div>';
  document.getElementById('sonoMonth').innerHTML = '';
  document.getElementById('sonoMonths').innerHTML = '';
  try {
    const s = await api('GET', '/sonography/settings');
    sono.rates = s.rates;
    sono.tdsPct = s.tdsPct;
  } catch (e) {
    document.getElementById('sonoEntryCard').innerHTML = '';
    toast(e.message, 'error');
    return;
  }
  renderSonoEntryCard();
  await loadSonoMonth(sonoToday().slice(0, 7));
  onSonoDateChange();
  loadSonoMonths();
}

// ── Day entry ─────────────────────────────────────────────────────────────────
function renderSonoEntryCard() {
  const el = document.getElementById('sonoEntryCard');
  if (!sono.rates) {
    el.innerHTML = `
      <div class="card sono-setup">
        <div class="empty-text">Set the rates first</div>
        <div class="empty-sub" style="margin-bottom:14px;">Enter the charge per patient and the doctor's % for each type of sonography. You only do this once.</div>
        <button class="btn btn-primary btn-sm" onclick="openSonoRatesModal()">Set rates</button>
      </div>`;
    return;
  }
  const today = sonoToday();
  el.innerHTML = `
    <div class="card">
      <div class="sono-entry-head">
        <div class="form-group" style="margin-bottom:0;">
          <label for="sonoDate">Date</label>
          <input type="date" id="sonoDate" value="${today}" max="${today}" onchange="onSonoDateChange()">
        </div>
        <div class="sono-mode" id="sonoMode"></div>
      </div>
      <div class="sono-counts">
        ${SONO_COUNT_TYPES.map(t => `
          <div class="form-group">
            <label for="sonoCount-${t}">${SONO_LABELS[t]}</label>
            <input type="number" id="sonoCount-${t}" min="0" max="${SONO_MAX_COUNT}" step="1" inputmode="numeric" placeholder="0"
                   oninput="clampRange(this); updateSonoPreview()">
            <div class="sono-rate" id="sonoRate-${t}"></div>
          </div>`).join('')}
          <div class="form-group sono-counsel-start">
            <label for="sonoCounselingPt" title="${SONO_LABELS.counseling} patients">Counseling PT</label>
            <input type="number" id="sonoCounselingPt" min="0" max="${SONO_MAX_COUNT}" step="1" inputmode="numeric" placeholder="0"
                   oninput="clampRange(this); updateSonoPreview()">
            <div class="sono-rate">incl. others</div>
          </div>
          <div class="form-group">
            <label for="sonoCounseling" title="${SONO_LABELS.counseling} amount">Counseling ₹</label>
            <input type="number" id="sonoCounseling" min="0" max="${SONO_MAX_COUNSELING}" step="1" inputmode="numeric" placeholder="0"
                   oninput="clampRange(this); updateSonoPreview()">
            <div class="sono-rate" id="sonoRate-counseling"></div>
          </div>
      </div>
      <div class="sono-preview" id="sonoPreview"></div>
      <div class="sono-actions">
        <button class="btn btn-outline btn-sm" id="sonoCancelBtn" onclick="cancelSonoEdit()" hidden>Clear</button>
        <button class="btn btn-primary" id="sonoSaveBtn" onclick="saveSonoEntry()">Save</button>
      </div>
    </div>`;
}

function sonoEntryFor(d) {
  return sono.data && sono.data.entries.find(e => e.date === d);
}

async function onSonoDateChange() {
  const input = document.getElementById('sonoDate');
  if (!input) return;
  const d = input.value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d.slice(0, 7) !== sono.month) await loadSonoMonth(d.slice(0, 7));
  const entry = sonoEntryFor(d);
  sono.editing = entry || null;
  SONO_COUNT_TYPES.forEach(t => {
    document.getElementById('sonoCount-' + t).value = entry && entry.counts[t] ? entry.counts[t] : '';
  });
  document.getElementById('sonoCounseling').value = entry && entry.counseling ? entry.counseling : '';
  document.getElementById('sonoCounselingPt').value = entry && entry.counselingPatients ? entry.counselingPatients : '';
  updateSonoPreview();
}

// Rates the form computes with: the row's saved rates when editing, else today's.
function sonoFormRates() { return sono.editing ? sono.editing.rates : sono.rates; }

const _sonoInputNum = id => { const v = document.getElementById(id).value; return v === '' ? 0 : Number(v); };

function readSonoCounts() {
  const counts = {};
  SONO_COUNT_TYPES.forEach(t => { counts[t] = _sonoInputNum('sonoCount-' + t); });
  return counts;
}

function readSonoCounseling() { return _sonoInputNum('sonoCounseling'); }
function readSonoCounselingPt() { return _sonoInputNum('sonoCounselingPt'); }

function updateSonoPreview() {
  const rates = sonoFormRates();
  SONO_PATIENT_TYPES.forEach(t => {
    document.getElementById('sonoRate-' + t).textContent = `${inr(rates[t].rate)} · ${rates[t].pct}%`;
  });
  document.getElementById('sonoRate-foc').textContent = 'count only';
  document.getElementById('sonoRate-counseling').textContent = `${rates.counseling.pct}% of amount`;
  const r = computeSonoRow(readSonoCounts(), readSonoCounseling(), readSonoCounselingPt(), rates);
  document.getElementById('sonoPreview').innerHTML = `
    <div><span class="comp-label">P.T. No</span><strong>${r.patients}</strong></div>
    <div><span class="comp-label">Total billed</span><strong>${inr2(r.billed)}</strong></div>
    <div><span class="comp-label">Doctor's share</span><strong class="green">${inr2(r.doctorShare)}</strong></div>`;
  const editing = !!sono.editing;
  document.getElementById('sonoMode').innerHTML = editing
    ? `<span class="badge badge-warm">Editing saved day</span>` : `<span class="badge badge-green">New day</span>`;
  document.getElementById('sonoSaveBtn').textContent = editing ? 'Update' : 'Save';
  document.getElementById('sonoCancelBtn').hidden = !editing;
}

function cancelSonoEdit() {
  const input = document.getElementById('sonoDate');
  input.value = sonoToday();
  onSonoDateChange();
}

async function saveSonoEntry() {
  const d = document.getElementById('sonoDate').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(new Date(d + 'T00:00:00'))) { toast('Pick a valid date.', 'error'); return; }
  if (d > sonoToday()) { toast('Date cannot be in the future.', 'error'); return; }
  const counts = readSonoCounts();
  for (const t of SONO_COUNT_TYPES) {
    const n = counts[t];
    if (!Number.isInteger(n) || n < 0 || n > SONO_MAX_COUNT) {
      toast(`${SONO_LABELS[t]} must be a whole number from 0 to ${SONO_MAX_COUNT}.`, 'error');
      return;
    }
  }
  const counseling = readSonoCounseling();
  if (!Number.isInteger(counseling) || counseling < 0 || counseling > SONO_MAX_COUNSELING) {
    toast(`${SONO_LABELS.counseling} must be whole rupees from 0 to ${SONO_MAX_COUNSELING.toLocaleString('en-IN')}.`, 'error');
    return;
  }
  const counselingPatients = readSonoCounselingPt();
  if (!Number.isInteger(counselingPatients) || counselingPatients < 0 || counselingPatients > SONO_MAX_COUNT) {
    toast(`${SONO_LABELS.counseling} patients must be a whole number from 0 to ${SONO_MAX_COUNT}.`, 'error');
    return;
  }
  if (!counseling !== !counselingPatients) { toast('Enter both the counseling patients and amount, or neither.', 'error'); return; }
  if (!SONO_COUNT_TYPES.some(t => counts[t] > 0) && !counseling) { toast('Enter at least one patient.', 'error'); return; }
  const btn = document.getElementById('sonoSaveBtn');
  btn.disabled = true;
  try {
    if (sono.editing) await api('PUT', '/sonography/entries/' + sono.editing.id, { date: d, counts, counseling, counselingPatients });
    else await api('POST', '/sonography/entries', { date: d, counts, counseling, counselingPatients });
    toast(sono.editing ? `Updated ${fmtDate(d)}.` : `Saved ${fmtDate(d)}.`, 'success');
    await loadSonoMonth(d.slice(0, 7));
    onSonoDateChange();
    loadSonoMonths();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function editSonoEntry(d) {
  const input = document.getElementById('sonoDate');
  if (!input) return;
  input.value = d;
  onSonoDateChange();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Month sheet ───────────────────────────────────────────────────────────────
function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

async function loadSonoMonth(month) {
  sono.month = month;
  const el = document.getElementById('sonoMonth');
  el.innerHTML = '<div class="skel skel-row"></div><div class="skel skel-row"></div>';
  try {
    const data = await api('GET', '/sonography/entries?month=' + month);
    if (sono.month !== month) return;    // a newer month was picked meanwhile
    sono.data = data;
  } catch (e) {
    el.innerHTML = '';
    toast(e.message, 'error');
    return;
  }
  renderSonoMonth();
}

async function goSonoMonth(month) {
  await loadSonoMonth(month);
  document.getElementById('sonoMonth').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderSonoMonth() {
  const el = document.getElementById('sonoMonth');
  const d = sono.data;
  const t = d.totals;
  const thisMonth = sonoToday().slice(0, 7);
  const status = d.complete
    ? '<span class="badge badge-green">Complete</span>'
    : '<span class="badge badge-warm">In progress</span>';
  const rows = d.entries.map(e => `
    <tr>
      <td>${fmtDate(e.date)}</td>
      <td class="num"><strong>${e.patients}</strong></td>
      ${SONO_COUNT_TYPES.map(k => `<td class="num">${e.counts[k] || '<span class="muted">—</span>'}</td>`).join('')}
      <td class="num">${e.counselingPatients || '<span class="muted">—</span>'}</td>
      <td class="num">${e.counseling ? inr(e.counseling) : '<span class="muted">—</span>'}</td>
      <td class="num">${inr2(e.billed)}</td>
      <td class="num">${inr2(e.doctorShare)}</td>
      <td class="sono-row-actions">
        <button class="btn btn-outline btn-sm" onclick="editSonoEntry('${e.date}')">Edit</button>
        <button class="btn btn-danger-out btn-sm" onclick="deleteSonoEntry(${e.id})">Delete</button>
      </td>
    </tr>`).join('');
  el.innerHTML = `
    <div class="sono-month-head">
      <button class="btn btn-outline btn-sm" aria-label="Previous month" onclick="goSonoMonth('${shiftMonth(d.month, -1)}')">‹</button>
      <div class="sono-month-title">
        <div>${monthName(d.month)} ${status}</div>
        <div class="page-sub">${fmtDate(d.fromDate)} – ${fmtDate(d.toDate)} · ${t.days} day${t.days === 1 ? '' : 's'} entered</div>
      </div>
      <button class="btn btn-outline btn-sm" aria-label="Next month" onclick="goSonoMonth('${shiftMonth(d.month, 1)}')"
              ${d.month >= thisMonth ? 'disabled' : ''}>›</button>
    </div>
    <div class="stat-row sono-stats">
      <div class="stat-card"><div class="stat-label">Patients</div><div class="stat-val">${t.patients}</div></div>
      <div class="stat-card"><div class="stat-label">Total billed</div><div class="stat-val">${inr2(t.billed)}</div></div>
      <div class="stat-card"><div class="stat-label">Doctor's share</div><div class="stat-val">${inr2(t.doctorShare)}</div></div>
      <div class="stat-card"><div class="stat-label">TDS ${d.tdsPct}%</div><div class="stat-val">− ${inr2(t.tds)}</div></div>
      <div class="stat-card sono-net"><div class="stat-label">Doctor's net pay</div><div class="stat-val green">${inr2(t.netPay)}</div></div>
      <div class="stat-card"><div class="stat-label">Hospital share</div><div class="stat-val">${inr2(t.hospitalShare)}</div></div>
    </div>
    ${d.entries.length ? `
    <div class="sono-actions" style="margin-bottom:12px;">
      <button class="btn btn-outline btn-sm" onclick="downloadSonoPdf()">Download PDF</button>
    </div>
    <div class="table-wrap">
      <table class="sono-table">
        <thead><tr>
          <th>Date</th><th class="num">P.T. No</th>
          ${SONO_COUNT_TYPES.map(k => `<th class="num">${SONO_LABELS[k]}</th>`).join('')}
          <th class="num">${SONO_LABELS.counseling} PT</th>
          <th class="num">${SONO_LABELS.counseling} ₹</th>
          <th class="num">Total billed</th><th class="num">Doctor's share</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td>Total</td><td class="num">${t.patients}</td>
          ${SONO_COUNT_TYPES.map(k => `<td class="num">${t.counts[k]}</td>`).join('')}
          <td class="num">${t.counselingPatients}</td>
          <td class="num">${inr(t.counseling)}</td>
          <td class="num">${inr2(t.billed)}</td><td class="num">${inr2(t.doctorShare)}</td><td></td>
        </tr></tfoot>
      </table>
    </div>` : `
    <div class="empty-state"><div class="empty-icon">${icon('history')}</div>
      <div class="empty-text">No days entered</div>
      <div class="empty-sub">Days you save for ${monthName(d.month)} will show up here.</div></div>`}`;
}

// ── Month PDF (A5, same letterhead as the salary slips) ────────────────────────
const SONO_PDF_LABELS = { nt_ano: 'NT + Anomaly', gs: 'G.S.', nt_twins: 'Twins NT', gs_twins: 'Twins G.S',
                          foc: 'FOC / Repeat', counseling: 'Counseling / Others' };

// One row per type; a type whose rate changed during the month gets one row per rate.
// The doctor's share per row comes from the backend, so the rows add up to the total.
function sonoPdfRows(d, fmt) {
  const rows = [];
  [...SONO_COUNT_TYPES, 'counseling'].forEach(t => {
    let lines = d.lines.filter(l => l.type === t);
    if (!lines.length) {
      const cur = sono.rates && sono.rates[t];
      lines = [{ type: t, rate: cur && t !== 'counseling' ? cur.rate : null, patients: 0, amount: 0, doctorShare: 0 }];
    }
    lines.forEach(l => {
      if (t === 'foc') rows.push([SONO_PDF_LABELS[t], String(l.patients), '-']);
      else if (t === 'counseling') rows.push([`${SONO_PDF_LABELS[t]}${l.amount ? ' (' + fmt(l.amount) + ')' : ''}`, String(l.patients), fmt(l.doctorShare)]);
      else rows.push([`${SONO_PDF_LABELS[t]}${l.rate != null ? '  @ ' + fmt(l.rate) : ''}`, String(l.patients), fmt(l.doctorShare)]);
    });
  });
  return rows;
}

function downloadSonoPdf() {
  const d = sono.data;
  if (!d || !d.entries.length) { toast('No days entered for this month.', 'error'); return; }
  if (typeof jspdf === 'undefined') { toast('PDF library not loaded — check your connection.', 'error'); return; }
  const t = d.totals;
  // Whole rupees as-is, otherwise always two paise digits (4,332.90 not 4,332.9).
  const fmt = n => { n = Number(n || 0); const dp = Number.isInteger(n) ? 0 : 2;
    return 'Rs. ' + n.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: 2 }); };
  const doc = newSlipDoc();
  const { M, L, R, INK, RULE, TINT } = slipLetterhead(doc, `Sonography - ${monthName(d.month)}`);

  doc.setFont('helvetica', 'normal').setFontSize(8.5);
  doc.text(`Period: ${slipFullDate(d.fromDate)} to ${slipFullDate(d.toDate)}  ·  ${t.days} day${t.days === 1 ? '' : 's'} entered` +
           (d.complete ? '' : '  ·  month in progress'), (L + R) / 2, 39, { align: 'center' });

  doc.autoTable({
    startY: 44,
    margin: { left: L, right: M },
    theme: 'grid',
    head: [['Total PT', String(t.patients), 'Amount']],
    body: sonoPdfRows(d, fmt),
    foot: [
      ['Total', '', fmt(t.doctorShare)],
      [`TDS ${d.tdsPct}%`, '', '- ' + fmt(t.tds)],
      ['Net Pay', '', fmt(t.netPay)],
    ],
    styles: { fontSize: 9, cellPadding: 2.4, textColor: INK, lineColor: RULE, lineWidth: 0.25 },
    headStyles: { fillColor: TINT, textColor: INK, fontStyle: 'bold' },
    footStyles: { fillColor: TINT, textColor: INK, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'center', cellWidth: 22 }, 2: { halign: 'right', cellWidth: 36 } },
    didParseCell: c => {
      if (c.section !== 'body' && c.column.index === 1) c.cell.styles.halign = 'center';
      if (c.section !== 'body' && c.column.index === 2) c.cell.styles.halign = 'right';
    },
  });

  stampDownloadDate(doc);

  doc.save(`Sonography_${monthName(d.month).replace(/\s+/g, '')}.pdf`);
}

// ── All months ────────────────────────────────────────────────────────────────
async function loadSonoMonths() {
  try {
    sono.months = await api('GET', '/sonography/months');
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  const el = document.getElementById('sonoMonths');
  if (!sono.months.length) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="sono-section-title">All months</div>
    ${sono.months.map(m => `
      <button class="month-card sono-month-card" onclick="goSonoMonth('${m.month}')">
        <div>
          <div class="sono-mc-name">${monthName(m.month)}</div>
          <div class="req-meta">${m.patients} patients · ${m.days} day${m.days === 1 ? '' : 's'} ·
            ${m.complete ? 'Complete' : 'In progress'}</div>
        </div>
        <div style="text-align:right;">
          <div class="sono-mc-pay">${inr2(m.netPay)}</div>
          <div class="req-meta">net pay after TDS</div>
        </div>
      </button>`).join('')}`;
}

// ── Delete ────────────────────────────────────────────────────────────────────
let deletingSonoId = null;

function deleteSonoEntry(id) {
  const e = sono.data.entries.find(x => x.id === id);
  if (!e) return;
  const label = `${fmtDate(e.date)} ${e.date.slice(0, 4)} (${e.patients} patients${e.counseling ? ', incl. ' + inr(e.counseling) + ' counseling' : ''})`;
  deletingSonoId = id;
  document.getElementById('sonoDelLabel').textContent = label;
  document.getElementById('sonoDeleteModal').classList.add('open');
}
function closeSonoDeleteModal() { document.getElementById('sonoDeleteModal').classList.remove('open'); }

async function confirmSonoDelete() {
  const btn = document.getElementById('sonoDelBtn');
  btn.disabled = true;
  try {
    await api('DELETE', '/sonography/entries/' + deletingSonoId);
    toast('Entry deleted.', 'success');
    closeSonoDeleteModal();
    await loadSonoMonth(sono.month);
    onSonoDateChange();
    loadSonoMonths();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ── Rates ─────────────────────────────────────────────────────────────────────
function openSonoRatesModal() {
  const r = sono.rates || {};
  document.getElementById('sonoRatesForm').innerHTML = `
    <div class="sono-rates-grid">
      <div class="sono-rates-h">Type</div><div class="sono-rates-h">Charge (₹)</div><div class="sono-rates-h">Doctor %</div>
      ${SONO_PATIENT_TYPES.map(t => `
        <div class="sono-rates-name">${SONO_LABELS[t]}</div>
        <input type="number" id="sonoR-${t}" aria-label="${SONO_LABELS[t]} charge" min="0" max="${SONO_MAX_RATE}" step="0.01"
               placeholder="0" value="${r[t] ? r[t].rate : ''}">
        <input type="number" id="sonoP-${t}" aria-label="${SONO_LABELS[t]} doctor %" min="0" max="100" step="0.01"
               placeholder="60" value="${r[t] ? r[t].pct : ''}">`).join('')}
      <div class="sono-rates-name">${SONO_LABELS.counseling}</div>
      <div class="sono-rate">amount entered per day</div>
      <input type="number" id="sonoP-counseling" aria-label="${SONO_LABELS.counseling} doctor %" min="0" max="100" step="0.01"
             placeholder="60" value="${r.counseling ? r.counseling.pct : ''}">
    </div>`;
  document.getElementById('sonoRatesModal').classList.add('open');
}
function closeSonoRatesModal() { document.getElementById('sonoRatesModal').classList.remove('open'); }

const _twoDp = v => Math.abs(v * 100 - Math.round(v * 100)) <= 1e-6;

async function saveSonoRates() {
  const rates = {};
  for (const t of SONO_PATIENT_TYPES) {
    const rv = document.getElementById('sonoR-' + t).value.trim();
    const pv = document.getElementById('sonoP-' + t).value.trim();
    const rate = Number(rv), pct = Number(pv);
    if (rv === '' || isNaN(rate) || rate < 0 || rate > SONO_MAX_RATE || !_twoDp(rate)) {
      toast(`${SONO_LABELS[t]}: enter a charge from 0 to ${SONO_MAX_RATE.toLocaleString('en-IN')} (up to 2 decimals).`, 'error');
      return;
    }
    if (pv === '' || isNaN(pct) || pct < 0 || pct > 100 || !_twoDp(pct)) {
      toast(`${SONO_LABELS[t]}: enter a doctor % from 0 to 100 (up to 2 decimals).`, 'error');
      return;
    }
    rates[t] = { rate, pct };
  }
  const cv = document.getElementById('sonoP-counseling').value.trim();
  const counselingPct = Number(cv);
  if (cv === '' || isNaN(counselingPct) || counselingPct < 0 || counselingPct > 100 || !_twoDp(counselingPct)) {
    toast(`${SONO_LABELS.counseling}: enter a doctor % from 0 to 100 (up to 2 decimals).`, 'error');
    return;
  }
  const btn = document.getElementById('sonoRatesSaveBtn');
  btn.disabled = true;
  try {
    const res = await api('PUT', '/sonography/settings', { rates, counselingPct });
    const first = !sono.rates;
    sono.rates = res.rates;
    toast('Rates saved.', 'success');
    closeSonoRatesModal();
    if (first) { renderSonoEntryCard(); onSonoDateChange(); }
    else if (document.getElementById('sonoDate')) updateSonoPreview();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

document.getElementById('sonoRatesModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeSonoRatesModal(); });
document.getElementById('sonoDeleteModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeSonoDeleteModal(); });
