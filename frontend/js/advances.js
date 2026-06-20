// Saavi Payroll — split from index.html. Classic script (file:// compatible); globals shared across files.

// ── Advances ──────────────────────────────────────────────────────────────────
let editingAdvanceId = null, deletingAdvanceId = null, currentAdvanceHistory = null;
let editingSettlementId = null, deletingSettlementId = null;

function _advEmpLabel(e) { return `${e.name} (${e.id})`; }

function initAdvancesView() {
  const sel = document.getElementById('advEmpSelect');
  const list = document.getElementById('advEmpDatalist');
  list.innerHTML = sortByEmpId(state.employees).map(e => `<option value="${h(_advEmpLabel(e))}"></option>`).join('');
  const current = state.employees.find(e => e.id === sel.value);
  document.getElementById('advEmpSearch').value = current ? _advEmpLabel(current) : '';
  if (!current) sel.value = '';
  renderAdvanceDetail();
}

function onAdvEmpSearchInput() {
  const input = document.getElementById('advEmpSearch');
  const sel = document.getElementById('advEmpSelect');
  const val = input.value.trim();
  if (!val) {
    if (sel.value !== '') { sel.value = ''; renderAdvanceDetail(); }
    return;
  }
  const match = state.employees.find(e => _advEmpLabel(e) === val);
  if (match && sel.value !== match.id) {
    sel.value = match.id;
    renderAdvanceDetail();
  }
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
    data = await api('GET', '/advances/' + empId);
  } catch(e) {
    toast(e.message, 'error');
    el.innerHTML = '';
    return;
  }
  currentAdvanceHistory = data;
  el.innerHTML = `
    <div class="comp-grid">
      <div class="comp-card"><div class="comp-label">Outstanding Balance</div><div class="comp-val" style="${data.balance > 0 ? 'color:var(--danger);' : ''}">${inr(data.balance)}</div></div>
      <div class="comp-card"><div class="comp-label">Total Advanced</div><div class="comp-val">${inr(data.totalAdvanced)}</div></div>
      <div class="comp-card"><div class="comp-label">Total Settled</div><div class="comp-val green">${inr(data.totalSettled)}</div></div>
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
          <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Note</th><th></th></tr></thead>
          <tbody>
            ${data.entries.map(e => {
              if (e.type === 'given') return `
              <tr>
                <td>${fmtDate(e.date)}</td>
                <td><span class="badge badge-warm">Given</span></td>
                <td class="td-mono">${inr(e.amount)}</td>
                <td>${e.note ? h(e.note) : '—'}</td>
                <td style="white-space:nowrap;">
                  <button class="icon-btn" onclick="openAdvModal(${e.id})">Edit</button>
                  <button class="icon-btn danger" onclick="openAdvDeleteModal(${e.id}, ${e.amount})">Del</button>
                </td>
              </tr>`;
              if (e.type === 'settled_manual') return `
              <tr>
                <td>${fmtDate(e.date)}</td>
                <td><span class="badge badge-green">Settlement</span></td>
                <td class="td-mono td-green">-${inr(e.amount)}</td>
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
  } else {
    document.getElementById('advModalTitle').textContent = 'Add Advance';
    document.getElementById('advDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('advAmount').value = '';
    document.getElementById('advNote').value = '';
  }
  document.getElementById('advModal').classList.add('open');
}

function closeAdvModal() { document.getElementById('advModal').classList.remove('open'); }

async function saveAdvance() {
  const empId = document.getElementById('advEmpSelect').value;
  if (!empId) return;
  const dateVal = document.getElementById('advDate').value;
  const amount = parseFloat(document.getElementById('advAmount').value);
  const note = document.getElementById('advNote').value.trim() || null;
  if (!dateVal) { toast('Please select a date.', 'error'); return; }
  if (isNaN(amount) || amount <= 0) { toast('Enter a valid amount.', 'error'); return; }
  try {
    if (editingAdvanceId) {
      await api('PUT', '/advances/' + editingAdvanceId, { empId, date: dateVal, amount, note });
      toast('Advance updated.', 'success');
    } else {
      await api('POST', '/advances', { empId, date: dateVal, amount, note });
      toast('Advance added.', 'success');
    }
    closeAdvModal();
    await refreshAdvanceBalances();
    renderAdvanceDetail();
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
    await api('DELETE', '/advances/' + deletingAdvanceId);
    toast('Advance entry deleted.', 'info');
    closeAdvDeleteModal();
    await refreshAdvanceBalances();
    renderAdvanceDetail();
  } catch(e) {
    toast(e.message, 'error');
  }
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
      await api('PUT', '/advance-settlements/' + editingSettlementId, { empId, date: dateVal, amount, note });
      toast('Settlement updated.', 'success');
    } else {
      await api('POST', '/advance-settlements', { empId, date: dateVal, amount, note });
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
    await api('DELETE', '/advance-settlements/' + deletingSettlementId);
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
