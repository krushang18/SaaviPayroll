// Saavi Payroll — split from index.html. Classic script (file:// compatible); globals shared across files.

// ── Employees ─────────────────────────────────────────────────────────────────
function renderEmployeeList() {
  const q = (document.getElementById('searchInput').value || '').toLowerCase();
  const emps = sortByEmpId(state.employees)
    .filter(e => !q || e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q) || (e.empId || '').toLowerCase().includes(q));
  const el = document.getElementById('empList');
  if (!emps.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">${icon('team')}</div><div class="empty-text">No employees</div><div class="empty-sub">Add your first team member</div></div>`;
  } else {
    el.innerHTML = emps.map(e => `
      <div class="emp-row">
        <div class="avatar av${ci(e.name)}">${h(ini(e.name))}</div>
        <div class="emp-info-wrap" data-empid="${h(e.id)}" onclick="showProfile(this.dataset.empid)">
          <div class="emp-name">${h(e.name)}</div>
          <div class="emp-id">Sr ${h(e.id)}${e.empId ? ' &nbsp;·&nbsp; Emp ID ' + h(e.empId) : ''} &nbsp;·&nbsp; ${e.workingDays} working days${e.category ? ' &nbsp;·&nbsp; <span style="color:var(--accent);font-weight:600;">' + h(e.category) + '</span>' : ''}${e.shiftType && e.shiftType !== 'Day' ? ' &nbsp;·&nbsp; ' + h(e.shiftType) : ''}</div>
          <div class="emp-salary">${inr(e.monthly)} / month &nbsp;·&nbsp; ${inr(e.hourly)} / hr</div>
        </div>
        <div class="emp-actions">
          <button class="icon-btn" data-empid="${h(e.id)}" aria-label="Edit ${h(e.name)}" onclick="openEditModal(this.dataset.empid)">Edit</button>
          <button class="icon-btn danger" data-empid="${h(e.id)}" aria-label="Delete ${h(e.name)}" onclick="openDeleteModal(this.dataset.empid)">Delete</button>
        </div>
      </div>
    `).join('');
  }
  renderStats();
}

function renderStats() {
  const emps = state.employees;
  const total = emps.reduce((s, e) => s + e.monthly, 0);
  const avg = emps.length ? total / emps.length : 0;
  document.getElementById('statsRow').innerHTML = `
    <div class="stat-card"><div class="stat-label">Employees</div><div class="stat-val">${emps.length}</div></div>
    <div class="stat-card"><div class="stat-label">Avg Monthly</div><div class="stat-val green">${inr(Math.round(avg))}</div></div>
    <div class="stat-card"><div class="stat-label">Total Payroll</div><div class="stat-val">${inr(total)}</div></div>
    <div class="stat-card"><div class="stat-label">Months Saved</div><div class="stat-val">${state.payrolls.length}</div></div>
  `;
}

// ── Profile ───────────────────────────────────────────────────────────────────
async function showProfile(id) {
  const emp = state.employees.find(e => e.id === id); if (!emp) return;
  const daily = Math.floor(emp.monthly / 30);

  // Collect this employee's records across all saved payrolls
  const history = [];
  for (const p of state.payrolls) {
    if (p.records) {
      const rec = p.records.find(r => r.empId === id);
      if (rec) history.push({ month: p.month, fromDate: p.fromDate, toDate: p.toDate, ...rec });
    }
  }
  history.sort((a, b) => b.month > a.month ? 1 : -1);

  document.getElementById('profileContent').innerHTML = `
    <div class="profile-hero">
      <div class="avatar av${ci(emp.name)} profile-avatar">${h(ini(emp.name))}</div>
      <div style="flex:1;min-width:0">
        <div class="profile-name">${h(emp.name)}</div>
        <div class="profile-id">Sr ${h(emp.id)}${emp.empId ? ' &nbsp;·&nbsp; Emp ID ' + h(emp.empId) : ''}${emp.shiftType && emp.shiftType !== 'Day' ? ' &nbsp;·&nbsp; ' + h(emp.shiftType) : ''}</div>
      </div>
      <div class="profile-actions">
        <button class="icon-btn" data-empid="${h(emp.id)}" aria-label="Edit ${h(emp.name)}" onclick="openEditModal(this.dataset.empid)">Edit</button>
        <button class="icon-btn danger" data-empid="${h(emp.id)}" aria-label="Delete ${h(emp.name)}" onclick="openDeleteModal(this.dataset.empid)">Delete</button>
      </div>
    </div>
    <div class="comp-grid">
      <div class="comp-card"><div class="comp-label">Monthly</div><div class="comp-val green">${inr(emp.monthly)}</div></div>
      <div class="comp-card"><div class="comp-label">Per Day</div><div class="comp-val">${inr(daily)}</div></div>
      <div class="comp-card"><div class="comp-label">Per Hour</div><div class="comp-val">${inr(emp.hourly)}</div></div>
      <div class="comp-card"><div class="comp-label">Working Days</div><div class="comp-val">${emp.workingDays} days</div></div>
    </div>
    <div style="font-family:var(--sans);font-size:20px;font-weight:700;margin-bottom:12px;">Payroll History</div>
    ${history.length ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Month</th><th>WD</th><th>Present</th><th>Absent</th><th>Hrs</th><th>Day Adj</th><th>OT</th><th>Total</th></tr></thead>
          <tbody>
            ${history.map(h => {
              const isDual = h.shift2BasePay != null;
              const row = `
              <tr>
                <td><span class="badge badge-warm">${monthName(h.month)}</span></td>
                <td class="td-mono">${h.workingDays}</td>
                <td>${h.presentDays}</td>
                <td>${h.absentDays}</td>
                <td>${h.extraHours || 0}</td>
                <td class="${(h.dayAdj||0)>=0?'adj-positive':'adj-negative'}">${(h.dayAdj||0)>=0?'+':''}${inr(h.dayAdj||0)}</td>
                <td>${inr(h.otPay||0)}</td>
                <td class="td-green">${inr(h.total)}</td>
              </tr>`;
              const nightRow = isDual ? `
              <tr class="shift2-row">
                <td style="padding-left:18px;font-size:11px;color:var(--ink-3);">↳ Night shift</td>
                <td class="td-mono">${h.workingDays}</td>
                <td>${h.shift2PresentDays ?? '—'}</td>
                <td>${h.shift2AbsentDays ?? '—'}</td>
                <td>${h.shift2ExtraHours || 0}</td>
                <td class="${(h.shift2DayAdj||0)>=0?'adj-positive':'adj-negative'}">${(h.shift2DayAdj||0)>=0?'+':''}${inr(h.shift2DayAdj||0)}</td>
                <td>${inr(h.shift2OtPay||0)}</td>
                <td style="font-size:12px;color:var(--ink-2);">${inr(h.shift2Total||0)}</td>
              </tr>` : '';
              return row + nightRow;
            }).join('')}
          </tbody>
        </table>
      </div>
    ` : `<div class="empty-state"><div class="empty-icon">${icon('doc')}</div><div class="empty-text">No payroll records yet</div><div class="empty-sub">Save a monthly payroll to see records here</div></div>`}

    <div class="legend collapsed" id="profileAdvanceLegend">
      <div class="legend-head" onclick="document.getElementById('profileAdvanceLegend').classList.toggle('collapsed')">
        <span>Advance History</span><span class="chev">▾</span>
      </div>
      <div class="legend-body" id="profileAdvanceBody">
        <div style="grid-column:1/-1;"><div class="empty-sub">Loading…</div></div>
      </div>
    </div>
  `;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-profile').classList.add('active');
  document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('active'));
  window.scrollTo(0, 0);
  renderProfileAdvanceHistory(id);
}

async function renderProfileAdvanceHistory(id) {
  const body = document.getElementById('profileAdvanceBody');
  if (!body) return;
  let data;
  try {
    data = await api('GET', '/advances/' + id);
  } catch (e) {
    body.innerHTML = `<div class="empty-sub">Failed to load advance history.</div>`;
    return;
  }
  if (document.getElementById('profileAdvanceBody') !== body) return; // profile switched away
  if (!data.entries.length) {
    body.innerHTML = `<div style="grid-column:1/-1;"><div class="empty-sub">No advance history yet</div></div>`;
    return;
  }
  body.innerHTML = `
    <div style="grid-column:1/-1;">
      <div class="comp-grid" style="margin-bottom:16px;">
        <div class="comp-card"><div class="comp-label">Outstanding Balance</div><div class="comp-val" style="${data.balance > 0 ? 'color:var(--danger);' : ''}">${inr(data.balance)}</div></div>
        <div class="comp-card"><div class="comp-label">Total Advanced</div><div class="comp-val">${inr(data.totalAdvanced)}</div></div>
        <div class="comp-card"><div class="comp-label">Total Settled</div><div class="comp-val green">${inr(data.totalSettled)}</div></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Note</th></tr></thead>
          <tbody>
            ${data.entries.map(e => {
              if (e.type === 'given') return `
              <tr>
                <td>${fmtDate(e.date)}</td>
                <td><span class="badge badge-warm">Given</span></td>
                <td class="td-mono">${inr(e.amount)}</td>
                <td>${e.note ? h(e.note) : '—'}</td>
              </tr>`;
              if (e.type === 'settled_manual') return `
              <tr>
                <td>${fmtDate(e.date)}</td>
                <td><span class="badge badge-green">Settlement</span></td>
                <td class="td-mono td-green">-${inr(e.amount)}</td>
                <td>${e.note ? h(e.note) : '—'}</td>
              </tr>`;
              return `
              <tr>
                <td>${fmtDate(e.date)}</td>
                <td><span class="badge badge-green">Settled · ${monthName(e.month)}</span></td>
                <td class="td-mono td-green">-${inr(e.amount)}</td>
                <td>—</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Employee Modal ────────────────────────────────────────────────────────────
let editingId = null, deletingId = null;

function updateComputedDay() {
  const monthly = parseFloat(document.getElementById('fMonthly').value);
  const el = document.getElementById('computedDay');
  el.textContent = (!isNaN(monthly) && monthly > 0) ? 'Per day (auto): ' + inr(Math.floor(monthly / 30)) : '';
}

function _populateCategorySelect(selectedValue) {
  const sel = document.getElementById('fCategory');
  sel.innerHTML = '<option value="">— None —</option>' +
    state.categories.map(c => `<option value="${h(c.name)}"${c.name === selectedValue ? ' selected' : ''}>${h(c.name)}</option>`).join('');
}

function onShiftTypeChange() {
  const isDual = document.getElementById('fShiftType').value === 'Day & Night';
  document.getElementById('fShift2Group').style.display = isDual ? '' : 'none';
  document.getElementById('fMonthlyLabel').textContent = isDual ? 'Day Monthly Salary (₹)' : 'Monthly Salary (₹)';
  document.getElementById('fHourlyLabel').textContent = isDual ? 'Day Hourly Rate (₹)' : 'Hourly Rate (₹)';
}

function openAddModal() {
  editingId = null;
  document.getElementById('modalTitle').textContent = 'Add Employee';
  ['fId','fEmpId','fName','fMonthly','fWorkingDays','fHourly','fShift2Monthly','fShift2Hourly'].forEach(i => document.getElementById(i).value = '');
  document.getElementById('fId').disabled = false;
  document.getElementById('fShiftType').value = 'Day';
  document.getElementById('computedDay').textContent = '';
  onShiftTypeChange();
  _populateCategorySelect('');
  document.getElementById('empModal').classList.add('open');
}

function openEditModal(id) {
  editingId = id;
  const emp = state.employees.find(e => e.id === id); if (!emp) return;
  document.getElementById('modalTitle').textContent = 'Edit Employee';
  document.getElementById('fId').value = emp.id; document.getElementById('fId').disabled = true;
  document.getElementById('fEmpId').value = emp.empId || '';
  document.getElementById('fName').value = emp.name;
  document.getElementById('fShiftType').value = emp.shiftType || 'Day';
  document.getElementById('fMonthly').value = emp.monthly;
  document.getElementById('fWorkingDays').value = emp.workingDays || 30;
  document.getElementById('fHourly').value = emp.hourly;
  document.getElementById('fShift2Monthly').value = emp.shift2Monthly ?? '';
  document.getElementById('fShift2Hourly').value = emp.shift2Hourly ?? '';
  onShiftTypeChange();
  _populateCategorySelect(emp.category || '');
  updateComputedDay();
  document.getElementById('empModal').classList.add('open');
}

function closeModal() { document.getElementById('empModal').classList.remove('open'); }

async function saveEmployee() {
  const id = document.getElementById('fId').value.trim();
  const empId = document.getElementById('fEmpId').value.trim() || null;
  const name = document.getElementById('fName').value.trim();
  const shiftType = document.getElementById('fShiftType').value;
  const monthly = parseFloat(document.getElementById('fMonthly').value);
  const workingDays = parseInt(document.getElementById('fWorkingDays').value);
  const hourly = parseFloat(document.getElementById('fHourly').value);
  const category = document.getElementById('fCategory').value || null;
  if (!id || !name || isNaN(monthly) || isNaN(workingDays) || isNaN(hourly)) {
    toast('Please fill all fields.', 'error'); return;
  }
  if (!category) { toast('Please select a category.', 'error'); return; }
  let shift2Monthly = null, shift2Hourly = null;
  if (shiftType === 'Day & Night') {
    shift2Monthly = parseFloat(document.getElementById('fShift2Monthly').value);
    shift2Hourly = parseFloat(document.getElementById('fShift2Hourly').value);
    if (isNaN(shift2Monthly) || isNaN(shift2Hourly)) {
      toast('Please fill the night rate fields for a Day & Night employee.', 'error'); return;
    }
  }
  const empData = { id, empId, name, monthly, workingDays, hourly, category, shiftType, shift2Monthly, shift2Hourly, payType: state.payType };
  try {
    if (editingId) {
      const updated = await api('PUT', '/employees/' + editingId, empData);
      state.employees = state.employees.map(e => e.id === editingId ? updated : e);
      toast(name + ' updated.', 'success');
    } else {
      await api('POST', '/employees', empData);
      state.employees = await api('GET', '/employees?pay_type=' + state.payType);
      toast(name + ' added.', 'success');
    }
  } catch(e) {
    toast(e.message, 'error'); return;
  }
  closeModal(); renderEmployeeList();
}

// ── Category Modal ─────────────────────────────────────────────────────────────
let editingCatId = null;

function openCatModal() {
  editingCatId = null;
  renderCatList();
  ['cName','cBase','cAppr'].forEach(i => document.getElementById(i).value = '');
  document.getElementById('catFormTitle').textContent = 'Add Category';
  document.getElementById('cSaveBtn').textContent = 'Add';
  document.getElementById('catModal').classList.add('open');
}

function closeCatModal() { document.getElementById('catModal').classList.remove('open'); }

let catListOpen = true;

function toggleCatList() {
  catListOpen = !catListOpen;
  document.getElementById('catList').style.display = catListOpen ? '' : 'none';
  document.getElementById('catListChevron').textContent = catListOpen ? '▲' : '▼';
}

function renderCatList() {
  const el = document.getElementById('catList');
  el.style.display = catListOpen ? '' : 'none';
  document.getElementById('catListChevron').textContent = catListOpen ? '▲' : '▼';
  if (!state.categories.length) {
    el.innerHTML = '<p style="font-size:13px;color:var(--ink-3);margin-top:8px;">No categories yet.</p>';
    return;
  }
  el.innerHTML = state.categories.map(c => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);">
      <div style="flex:1;">
        <div style="font-weight:600;font-size:14px;">${h(c.name)}</div>
        <div style="font-size:12px;color:var(--ink-3);">Night: ${inr(c.nightBase)} base + ${inr(c.nightAppr)} appr. = ${inr(c.nightBase + c.nightAppr)}/shift</div>
      </div>
      <button class="icon-btn" onclick="editCat(${c.id})">Edit</button>
      <button class="icon-btn danger" onclick="deleteCat(${c.id})">Del</button>
    </div>
  `).join('');
}

function editCat(id) {
  const cat = state.categories.find(c => c.id === id); if (!cat) return;
  editingCatId = id;
  document.getElementById('cName').value = cat.name;
  document.getElementById('cBase').value = cat.nightBase;
  document.getElementById('cAppr').value = cat.nightAppr;
  document.getElementById('catFormTitle').textContent = 'Edit Category';
  document.getElementById('cSaveBtn').textContent = 'Save';
}

function cancelCatEdit() {
  if (editingCatId === null) { closeCatModal(); return; }
  editingCatId = null;
  ['cName','cBase','cAppr'].forEach(i => document.getElementById(i).value = '');
  document.getElementById('catFormTitle').textContent = 'Add Category';
  document.getElementById('cSaveBtn').textContent = 'Add';
}

async function saveCategoryForm() {
  const name = document.getElementById('cName').value.trim();
  const nightBase = parseFloat(document.getElementById('cBase').value) || 0;
  const nightAppr = parseFloat(document.getElementById('cAppr').value) || 0;
  if (!name) { toast('Category name is required.', 'error'); return; }
  try {
    if (editingCatId) {
      const updated = await api('PUT', '/categories/' + editingCatId, { name, nightBase, nightAppr });
      state.categories = state.categories.map(c => c.id === editingCatId ? updated : c);
      toast('Category updated.', 'success');
    } else {
      const created = await api('POST', '/categories', { name, nightBase, nightAppr });
      state.categories.push(created);
      toast('Category added.', 'success');
    }
    cancelCatEdit();
    renderCatList();
  } catch(e) {
    toast(e.message, 'error');
  }
}

async function deleteCat(id) {
  const cat = state.categories.find(c => c.id === id); if (!cat) return;
  try {
    await api('DELETE', '/categories/' + id);
    state.categories = state.categories.filter(c => c.id !== id);
    toast(cat.name + ' deleted.', 'info');
    renderCatList();
  } catch(e) {
    toast(e.message, 'error');
  }
}

function openDeleteModal(id) {
  deletingId = id;
  const emp = state.employees.find(e => e.id === id);
  document.getElementById('delName').textContent = emp ? emp.name : id;
  document.getElementById('deleteModal').classList.add('open');
}
function closeDeleteModal() { document.getElementById('deleteModal').classList.remove('open'); }

async function confirmDelete() {
  try {
    await api('DELETE', '/employees/' + deletingId);
    state.employees = state.employees.filter(e => e.id !== deletingId);
    toast('Employee removed.', 'info');
    closeDeleteModal();
    if (currentView === 'profile') switchView('employees'); else renderEmployeeList();
  } catch(e) {
    toast(e.message, 'error');
  }
}

document.getElementById('empModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
document.getElementById('deleteModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeDeleteModal(); });
document.getElementById('catModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeCatModal(); });

// Escape closes any open modal/overlay
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const open = document.querySelectorAll('.overlay.open');
    if (open.length) { e.preventDefault(); open.forEach(o => o.classList.remove('open')); }
  }
});
