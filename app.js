(() => {
  'use strict';

  const API = '/api/transactions';
  const LS_CURRENCY = 'ledger.currency.v1';

  const CURRENCIES = [
    { code: 'USD', symbol: '$'  },
    { code: 'EUR', symbol: '€'  },
    { code: 'GBP', symbol: '£'  },
    { code: 'INR', symbol: '₹'  },
    { code: 'JPY', symbol: '¥'  },
    { code: 'AUD', symbol: 'A$' },
    { code: 'CAD', symbol: 'C$' },
    { code: 'SGD', symbol: 'S$' },
  ];

  const $ = (id) => document.getElementById(id);

  const els = {
    currency: $('currency'),
    exportBtn: $('exportBtn'),
    statBalance: $('statBalance'),
    statIncome: $('statIncome'),
    statExpense: $('statExpense'),
    statCount: $('statCount'),
    statBalanceFoot: $('statBalanceFoot'),
    statIncomeFoot: $('statIncomeFoot'),
    statExpenseFoot: $('statExpenseFoot'),
    statCountFoot: $('statCountFoot'),
    formTitle: $('formTitle'),
    form: $('txForm'),
    date: $('date'),
    segmented: $('segmented'),
    type: $('type'),
    amount: $('amount'),
    category: $('category'),
    categoryList: $('categoryList'),
    description: $('description'),
    notes: $('notes'),
    formError: $('formError'),
    submitBtn: $('submitBtn'),
    submitLabel: $('submitLabel'),
    cancelBtn: $('cancelBtn'),
    moneySymbol: $('moneySymbol'),
    breakdown: $('breakdown'),
    breakdownEmpty: $('breakdownEmpty'),
    listCount: $('listCount'),
    fFrom: $('fFrom'),
    fTo: $('fTo'),
    fType: $('fType'),
    fCategory: $('fCategory'),
    fQ: $('fQ'),
    clearFilters: $('clearFilters'),
    txBody: $('txBody'),
    emptyState: $('emptyState'),
    toasts: $('toasts'),
  };

  const state = {
    transactions: [],
    editingId: null,
    currency: 'USD',
  };

  /* ---------- Utilities ---------- */

  const symbol = () =>
    (CURRENCIES.find((c) => c.code === state.currency) || CURRENCIES[0]).symbol;

  function fmtMoney(n) {
    const abs = Math.abs(Number(n) || 0);
    return symbol() + abs.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function todayISO() {
    const d = new Date();
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  }

  function escapeHTML(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    els.toasts.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 260);
    }, 2600);
  }

  /* ---------- API ---------- */

  async function api(method, path = '', body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(API + path, opts);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  /* ---------- Currency ---------- */

  function initCurrency() {
    const saved = localStorage.getItem(LS_CURRENCY);
    state.currency = CURRENCIES.some((c) => c.code === saved) ? saved : 'USD';

    els.currency.innerHTML = CURRENCIES
      .map((c) => `<option value="${c.code}">${c.code} ${c.symbol}</option>`)
      .join('');
    els.currency.value = state.currency;
    els.moneySymbol.textContent = symbol();

    els.currency.addEventListener('change', () => {
      state.currency = els.currency.value;
      localStorage.setItem(LS_CURRENCY, state.currency);
      els.moneySymbol.textContent = symbol();
      render();
    });
  }

  /* ---------- Load ---------- */

  async function load() {
    try {
      const data = await api('GET');
      state.transactions = Array.isArray(data && data.transactions) ? data.transactions : [];
      render();
    } catch (err) {
      toast(err.message || 'Could not load transactions', 'error');
    }
  }

  /* ---------- Filtering ---------- */

  function getFiltered() {
    const from = els.fFrom.value;
    const to   = els.fTo.value;
    const type = els.fType.value;
    const cat  = els.fCategory.value;
    const q    = els.fQ.value.trim().toLowerCase();

    return state.transactions
      .filter((t) => {
        if (from && t.date < from) return false;
        if (to   && t.date > to)   return false;
        if (type && t.type !== type) return false;
        if (cat && (t.category || '') !== cat) return false;
        if (q) {
          const hay = [t.description, t.notes, t.category]
            .filter(Boolean).join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) =>
        a.date === b.date
          ? (b.createdAt || '').localeCompare(a.createdAt || '')
          : b.date.localeCompare(a.date)
      );
  }

  /* ---------- Rendering ---------- */

  function render() {
    const rows = getFiltered();
    renderStats(rows);
    renderBreakdown(rows);
    renderTable(rows);
    renderCategoryOptions();
    renderCategoryDatalist();
    els.listCount.textContent = `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`;
  }

  function renderStats(rows) {
    let income = 0, expense = 0, incCount = 0, expCount = 0;
    for (const t of rows) {
      const amt = Number(t.amount) || 0;
      if (t.type === 'income') { income += amt; incCount++; }
      else { expense += amt; expCount++; }
    }
    const balance = income - expense;

    els.statBalance.textContent = fmtMoney(balance);
    els.statBalance.style.color =
      balance > 0 ? 'var(--income)' : balance < 0 ? 'var(--expense)' : '';
    els.statIncome.textContent  = fmtMoney(income);
    els.statExpense.textContent = fmtMoney(expense);
    els.statCount.textContent   = String(rows.length);

    els.statIncomeFoot.textContent  = incCount ? `across ${incCount} ${incCount === 1 ? 'entry' : 'entries'}` : 'no income yet';
    els.statExpenseFoot.textContent = expCount ? `across ${expCount} ${expCount === 1 ? 'entry' : 'entries'}` : 'no expenses yet';
    els.statBalanceFoot.textContent = balance > 0 ? 'you are in the green'
                                    : balance < 0 ? 'you are overspending'
                                    : 'income − expenses';
    els.statCountFoot.textContent = 'in current view';
  }

  function renderBreakdown(rows) {
    const map = new Map();
    for (const t of rows) {
      if (t.type !== 'expense') continue;
      const key = (t.category || 'Uncategorized').trim() || 'Uncategorized';
      map.set(key, (map.get(key) || 0) + (Number(t.amount) || 0));
    }

    if (map.size === 0) {
      els.breakdown.innerHTML = '';
      els.breakdownEmpty.hidden = false;
      return;
    }
    els.breakdownEmpty.hidden = true;

    const entries = [...map.entries()].sort((a, b) => b[1] - a[1]);
    const max = entries[0][1];

    els.breakdown.innerHTML = entries.map(([name, total]) => {
      const pct = max > 0 ? (total / max) * 100 : 0;
      return `
        <div class="break-row">
          <div class="break-top">
            <span class="break-name" title="${escapeHTML(name)}">${escapeHTML(name)}</span>
            <span class="break-amount">${fmtMoney(total)}</span>
          </div>
          <div class="break-track">
            <div class="break-fill" style="width:${pct.toFixed(1)}%"></div>
          </div>
        </div>`;
    }).join('');
  }

  function renderTable(rows) {
    if (rows.length === 0) {
      els.txBody.innerHTML = '';
      els.emptyState.hidden = false;
      els.emptyState.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H18a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 18.5z"/>
          <path d="M3 9h17M8 14.5h6"/>
        </svg>
        <strong>No transactions to show</strong>
        <span>Try adjusting your filters, or add your first entry above.</span>`;
      return;
    }
    els.emptyState.hidden = true;

    els.txBody.innerHTML = rows.map((t) => {
      const amtClass = t.type === 'income' ? 'income' : 'expense';
      const sign = t.type === 'income' ? '+' : '−';
      const cat = t.category
        ? escapeHTML(t.category)
        : '<span class="no-cat">Uncategorized</span>';
      const notes = t.notes
        ? `<span class="desc-notes" title="${escapeHTML(t.notes)}">${escapeHTML(t.notes)}</span>`
        : '';

      return `
        <tr data-id="${escapeHTML(t.id)}">
          <td class="date">${escapeHTML(fmtDate(t.date))}</td>
          <td class="desc">
            <span class="desc-main">${escapeHTML(t.description)}</span>
            ${notes}
          </td>
          <td class="cat">${cat}</td>
          <td class="type"><span class="badge ${amtClass}">${escapeHTML(t.type)}</span></td>
          <td class="right amount ${amtClass}">${sign} ${fmtMoney(t.amount)}</td>
          <td class="actions right">
            <span class="row-actions">
              <button class="icon-btn" data-action="edit" title="Edit" aria-label="Edit">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
                </svg>
              </button>
              <button class="icon-btn danger" data-action="delete" title="Delete" aria-label="Delete">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 6h18"/><path d="M8 6V4h8v2"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                  <path d="M10 11v6M14 11v6"/>
                </svg>
              </button>
            </span>
          </td>
        </tr>`;
    }).join('');
  }

  function renderCategoryOptions() {
    const set = new Set(
      state.transactions.map((t) => (t.category || '').trim()).filter(Boolean)
    );
    const cats = [...set].sort((a, b) => a.localeCompare(b));
    const current = els.fCategory.value;

    els.fCategory.innerHTML = '<option value="">All</option>' +
      cats.map((c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');

    if (cats.includes(current)) els.fCategory.value = current;
  }

  function renderCategoryDatalist() {
    const set = new Set(
      state.transactions.map((t) => (t.category || '').trim()).filter(Boolean)
    );
    els.categoryList.innerHTML = [...set].sort()
      .map((c) => `<option value="${escapeHTML(c)}"></option>`).join('');
  }

  /* ---------- Form ---------- */

  function setType(type) {
    els.type.value = type;
    els.segmented.dataset.active = type;
  }

  function resetForm() {
    state.editingId = null;
    els.form.reset();
    els.date.value = todayISO();
    setType('expense');
    els.formTitle.textContent = 'Add transaction';
    els.submitLabel.textContent = 'Add transaction';
    els.cancelBtn.hidden = true;
    els.formError.hidden = true;
  }

  function showError(msg) {
    els.formError.textContent = msg;
    els.formError.hidden = false;
  }

  function startEdit(id) {
    const t = state.transactions.find((x) => x.id === id);
    if (!t) return;

    state.editingId = id;
    els.date.value = t.date;
    setType(t.type);
    els.amount.value = t.amount;
    els.category.value = t.category || '';
    els.description.value = t.description || '';
    els.notes.value = t.notes || '';

    els.formTitle.textContent = 'Edit transaction';
    els.submitLabel.textContent = 'Save changes';
    els.cancelBtn.hidden = false;
    els.formError.hidden = true;

    els.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function submitForm(e) {
    e.preventDefault();
    els.formError.hidden = true;

    const payload = {
      date: els.date.value,
      type: els.type.value,
      amount: Number(els.amount.value),
      category: els.category.value.trim(),
      description: els.description.value.trim(),
      notes: els.notes.value.trim(),
    };

    if (!payload.date) return showError('Please choose a date.');
    if (!payload.description) return showError('Please add a description.');
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
      return showError('Amount must be greater than zero.');
    }

    els.submitBtn.disabled = true;

    try {
      if (state.editingId) {
        const updated = await api('PUT', '/' + encodeURIComponent(state.editingId), payload);
        const i = state.transactions.findIndex((x) => x.id === state.editingId);
        if (i >= 0) state.transactions[i] = updated;
        toast('Transaction updated', 'success');
      } else {
        const created = await api('POST', '', payload);
        state.transactions.push(created);
        toast('Transaction added', 'success');
      }
      resetForm();
      render();
    } catch (err) {
      showError(err.message || 'Could not save transaction.');
    } finally {
      els.submitBtn.disabled = false;
    }
  }

  async function deleteTx(id) {
    const t = state.transactions.find((x) => x.id === id);
    if (!t) return;
    if (!confirm(`Delete "${t.description}"?`)) return;

    try {
      await api('DELETE', '/' + encodeURIComponent(id));
      state.transactions = state.transactions.filter((x) => x.id !== id);
      if (state.editingId === id) resetForm();
      render();
      toast('Transaction deleted', 'success');
    } catch (err) {
      toast(err.message || 'Could not delete', 'error');
    }
  }

  /* ---------- CSV export ---------- */

  function exportCSV() {
    const rows = getFiltered();
    if (rows.length === 0) {
      toast('Nothing to export', 'error');
      return;
    }

    const headers = ['Date', 'Type', 'Amount', 'Currency', 'Category', 'Description', 'Notes'];
    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };

    const lines = [headers.join(',')];
    for (const t of rows) {
      lines.push([
        t.date,
        t.type,
        Number(t.amount).toFixed(2),
        state.currency,
        t.category || '',
        t.description || '',
        t.notes || '',
      ].map(esc).join(','));
    }

    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledger-${todayISO()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    toast(`Exported ${rows.length} rows`, 'success');
  }

  /* ---------- Events ---------- */

  function bindEvents() {
    els.segmented.addEventListener('click', (e) => {
      const btn = e.target.closest('.seg');
      if (!btn) return;
      setType(btn.dataset.type);
    });

    els.form.addEventListener('submit', submitForm);
    els.cancelBtn.addEventListener('click', resetForm);

    els.txBody.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.closest('tr')?.dataset.id;
      if (!id) return;

      if (btn.dataset.action === 'edit') startEdit(id);
      else if (btn.dataset.action === 'delete') deleteTx(id);
    });

    ['fFrom', 'fTo', 'fType', 'fCategory', 'fQ'].forEach((id) => {
      els[id].addEventListener('input', render);
      els[id].addEventListener('change', render);
    });

    els.clearFilters.addEventListener('click', () => {
      els.fFrom.value = '';
      els.fTo.value = '';
      els.fType.value = '';
      els.fCategory.value = '';
      els.fQ.value = '';
      render();
    });

    els.exportBtn.addEventListener('click', exportCSV);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.editingId) resetForm();
    });
  }

  /* ---------- Boot ---------- */

  document.addEventListener('DOMContentLoaded', () => {
    initCurrency();
    bindEvents();
    els.date.value = todayISO();
    load();
  });
})();