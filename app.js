(() => {
  'use strict';
  const STORAGE_KEY = 'ledger-records-v1';
  const CATEGORIES = {
    expense: ['餐飲', '交通', '購物', '居家', '娛樂', '醫療', '教育', '其他'],
    income: ['薪資', '獎金', '投資', '兼職', '其他'],
  };
  const TYPE_LABEL = { expense: '支出', income: '收入' };
  const MAX_AMOUNT = 999999999;
  const CSV_HEADER = ['日期', '類型', '類別', '金額', '備註', '編號'];

  const $ = (selector) => document.querySelector(selector);
  const form = $('#entry-form');
  const submitButton = $('#submit-button');
  const cancelEdit = $('#cancel-edit');
  const formMessage = $('#form-message');
  const monthPicker = $('#month-picker');
  const recordList = $('#record-list');
  const listMessage = $('#list-message');
  const filterButtons = document.querySelectorAll('#type-filters button');
  const dataMessage = $('#data-message');
  const storageMessage = $('#storage-message');
  const money = new Intl.NumberFormat('zh-TW', { style: 'currency', currency: 'TWD', minimumFractionDigits: 0, maximumFractionDigits: 2 });

  let records = [];
  let editingId = null;
  let selectedType = 'all';
  let currentMonth = today().slice(0, 7);
  let storageAvailable = true;

  function today() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function message(element, text, kind = '') {
    element.textContent = text;
    element.dataset.kind = kind;
  }

  function newId() {
    return window.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function isValidDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function parseAmount(value) {
    const text = String(value).replace(/[,\s]/g, '').replace(/^NT\$|^\$/i, '');
    if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
    const amount = Number(text);
    return amount > 0 && amount <= MAX_AMOUNT ? amount : null;
  }

  // 只接受欄位完整、類別合法的資料，避免損壞的儲存內容影響畫面。
  function normalize(raw) {
    if (!raw || !CATEGORIES[raw.type]) return null;
    const amount = parseAmount(raw.amount);
    if (amount === null || !isValidDate(raw.date) || !CATEGORIES[raw.type].includes(raw.category)) return null;
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 64) : newId(),
      type: raw.type,
      amount,
      category: raw.category,
      date: raw.date,
      note: String(raw.note ?? '').trim().slice(0, 100),
      createdAt: Number(raw.createdAt) || Date.now(),
    };
  }

  function load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      records = Array.isArray(parsed) ? parsed.map(normalize).filter(Boolean) : [];
    } catch {
      storageAvailable = false;
      records = [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
      storageAvailable = true;
    } catch {
      storageAvailable = false;
    }
    storageMessage.hidden = storageAvailable;
    storageMessage.textContent = storageAvailable ? ''
      : '瀏覽器目前無法儲存資料（可能是無痕模式或儲存空間已滿）。帳目只保留到關閉頁面為止，請先匯出 CSV 備份。';
    return storageAvailable;
  }

  function selectedFormType() {
    return form.elements.namedItem('type').value;
  }

  function fillCategories(type, selected) {
    const select = form.elements.namedItem('category');
    select.replaceChildren(...CATEGORIES[type].map((name) => new Option(name, name, false, name === selected)));
  }

  function resetForm() {
    editingId = null;
    const keepDate = form.elements.namedItem('date').value;
    const keepType = selectedFormType();
    form.reset();
    form.querySelector(`input[name=type][value=${keepType}]`).checked = true;
    fillCategories(keepType);
    form.elements.namedItem('date').value = keepDate || today();
    submitButton.firstChild.textContent = '記一筆 ';
    cancelEdit.hidden = true;
  }

  function startEdit(record) {
    editingId = record.id;
    form.querySelector(`input[name=type][value=${record.type}]`).checked = true;
    fillCategories(record.type, record.category);
    form.elements.namedItem('amount').value = record.amount;
    form.elements.namedItem('date').value = record.date;
    form.elements.namedItem('note').value = record.note;
    submitButton.firstChild.textContent = '儲存修改 ';
    cancelEdit.hidden = false;
    message(formMessage, `正在編輯 ${record.date} 的${TYPE_LABEL[record.type]}。`);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    form.elements.namedItem('amount').focus({ preventScroll: true });
  }

  function element(tag, className, text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = text;
    return node;
  }

  function signed(record) {
    return `${record.type === 'expense' ? '−' : '+'}${money.format(record.amount)}`;
  }

  function sum(list, type) {
    // 以分為單位相加，避免小數浮點誤差。
    return list.filter((r) => r.type === type).reduce((total, r) => total + Math.round(r.amount * 100), 0) / 100;
  }

  function renderSummary(monthRecords) {
    const income = sum(monthRecords, 'income');
    const expense = sum(monthRecords, 'expense');
    const balance = Math.round((income - expense) * 100) / 100;
    $('#stat-income').textContent = money.format(income);
    $('#stat-expense').textContent = money.format(expense);
    const balanceNode = $('#stat-balance');
    balanceNode.textContent = money.format(balance);
    balanceNode.className = `stat-value ${balance < 0 ? 'expense' : 'income'}`;

    const totals = new Map();
    for (const r of monthRecords) {
      if (r.type === 'expense') totals.set(r.category, (totals.get(r.category) || 0) + Math.round(r.amount * 100));
    }
    const rows = [...totals].sort((a, b) => b[1] - a[1]).map(([category, cents]) => {
      const share = expense ? cents / 100 / expense : 0;
      const row = element('li', 'breakdown-row');
      const bar = element('div', 'bar');
      const fill = element('span');
      fill.style.width = `${Math.max(share * 100, 2)}%`;
      bar.append(fill);
      const amount = element('span', 'breakdown-amount', money.format(cents / 100));
      amount.append(element('small', '', `${Math.round(share * 100)}%`));
      row.append(element('span', '', category), bar, amount);
      return row;
    });
    $('#breakdown-list').replaceChildren(...rows);
    $('#breakdown-empty').hidden = rows.length > 0;
  }

  function renderList(monthRecords) {
    const visible = monthRecords.filter((r) => selectedType === 'all' || r.type === selectedType)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    const groups = new Map();
    for (const r of visible) {
      if (!groups.has(r.date)) groups.set(r.date, []);
      groups.get(r.date).push(r);
    }
    const fragment = document.createDocumentFragment();
    for (const [date, items] of groups) {
      const group = element('section', 'day-group');
      const heading = element('h3');
      const weekday = new Date(`${date}T00:00:00`).toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'short' });
      const net = Math.round((sum(items, 'income') - sum(items, 'expense')) * 100) / 100;
      heading.append(element('span', '', weekday), element('span', '', `當日 ${net < 0 ? '−' : '+'}${money.format(Math.abs(net))}`));
      const ul = element('ul');
      for (const r of items) {
        const li = element('li', 'record');
        li.dataset.id = r.id;
        const main = element('div', 'record-main');
        main.append(element('span', 'record-category', r.category));
        if (r.note) main.append(element('span', 'record-note', r.note));
        const amount = element('span', `record-amount ${r.type}`, signed(r));
        const actions = element('div', 'record-actions');
        const edit = element('button', 'secondary', '編輯');
        edit.type = 'button';
        edit.dataset.action = 'edit';
        edit.setAttribute('aria-label', `編輯 ${r.category} ${money.format(r.amount)}`);
        const remove = element('button', 'danger', '刪除');
        remove.type = 'button';
        remove.dataset.action = 'delete';
        remove.setAttribute('aria-label', `刪除 ${r.category} ${money.format(r.amount)}`);
        actions.append(edit, remove);
        li.append(main, amount, actions);
        ul.append(li);
      }
      group.append(heading, ul);
      fragment.append(group);
    }
    recordList.replaceChildren(fragment);
    $('#list-count').textContent = `共 ${visible.length} 筆 · 新的日期在上方`;
    message(listMessage, visible.length ? '' : (monthRecords.length ? '這個月沒有符合篩選的帳目。' : '這個月還沒有帳目，從上方記下第一筆吧。'));
    for (const button of filterButtons) button.setAttribute('aria-pressed', String(button.dataset.filter === selectedType));
  }

  function render() {
    monthPicker.value = currentMonth;
    const [year, month] = currentMonth.split('-');
    $('#list-title').textContent = `${Number(year)} 年 ${Number(month)} 月明細`;
    const monthRecords = records.filter((r) => r.date.startsWith(currentMonth));
    renderSummary(monthRecords);
    renderList(monthRecords);
  }

  function shiftMonth(delta) {
    const [year, month] = currentMonth.split('-').map(Number);
    const date = new Date(year, month - 1 + delta, 1);
    currentMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    render();
  }

  form.addEventListener('change', (event) => {
    if (event.target.name === 'type') fillCategories(event.target.value);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const amount = parseAmount(data.get('amount'));
    if (amount === null) {
      message(formMessage, '請輸入大於 0 的金額，最多兩位小數。', 'error');
      form.elements.namedItem('amount').focus();
      return;
    }
    if (!isValidDate(data.get('date'))) {
      message(formMessage, '請選擇正確的日期。', 'error');
      form.elements.namedItem('date').focus();
      return;
    }
    const existing = records.find((r) => r.id === editingId);
    const record = normalize({
      id: existing?.id, createdAt: existing?.createdAt, type: data.get('type'), amount,
      category: data.get('category'), date: data.get('date'), note: data.get('note'),
    });
    if (!record) {
      message(formMessage, '資料格式不正確，請重新確認類別與欄位。', 'error');
      return;
    }
    records = existing ? records.map((r) => (r.id === existing.id ? record : r)) : [...records, record];
    const saved = save();
    const verb = existing ? '已更新' : '已記下';
    message(formMessage, `${verb}：${record.category} ${signed(record)}${saved ? '' : '（尚未儲存到裝置）'}`, saved ? 'success' : 'error');
    currentMonth = record.date.slice(0, 7);
    resetForm();
    render();
    form.elements.namedItem('amount').focus();
  });

  cancelEdit.addEventListener('click', () => {
    resetForm();
    message(formMessage, '已取消編輯。');
  });

  recordList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const record = records.find((r) => r.id === button.closest('.record').dataset.id);
    if (!record) return;
    if (button.dataset.action === 'edit') {
      startEdit(record);
    } else if (window.confirm(`確定刪除 ${record.date} ${record.category} ${signed(record)}？`)) {
      records = records.filter((r) => r.id !== record.id);
      if (editingId === record.id) resetForm();
      save();
      render();
      message(listMessage, `已刪除 ${record.category} ${signed(record)}。`, 'success');
    }
  });

  for (const button of filterButtons) {
    button.addEventListener('click', () => {
      selectedType = button.dataset.filter;
      render();
    });
  }

  $('#prev-month').addEventListener('click', () => shiftMonth(-1));
  $('#next-month').addEventListener('click', () => shiftMonth(1));
  monthPicker.addEventListener('change', () => {
    if (/^\d{4}-\d{2}$/.test(monthPicker.value)) {
      currentMonth = monthPicker.value;
      render();
    }
  });

  // CSV：加 BOM 讓 Excel 正確顯示中文；以 ' 開頭避免試算表把備註當公式執行。
  function csvCell(value) {
    let text = String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
        else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"') quoted = true;
      else if (char === ',') { row.push(cell); cell = ''; }
      else if (char === '\n' || char === '\r') {
        if (char === '\r' && text[i + 1] === '\n') i += 1;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += char;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim()));
  }

  $('#export-button').addEventListener('click', () => {
    if (!records.length) {
      message(dataMessage, '目前沒有帳目可匯出。', 'error');
      return;
    }
    const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
    const lines = [CSV_HEADER, ...sorted.map((r) => [r.date, TYPE_LABEL[r.type], r.category, r.amount, r.note, r.id])]
      .map((row) => row.map(csvCell).join(','));
    const blob = new Blob([`﻿${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `記帳本-${today()}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    message(dataMessage, `已匯出 ${records.length} 筆帳目。`, 'success');
  });

  $('#import-input').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      message(dataMessage, '檔案太大，請選擇 5 MB 以下的 CSV。', 'error');
      return;
    }
    const rows = parseCsv((await file.text()).replace(/^﻿/, ''));
    const header = rows.shift()?.map((c) => c.trim()) || [];
    const index = Object.fromEntries(CSV_HEADER.map((name) => [name, header.indexOf(name)]));
    if (['日期', '類型', '類別', '金額'].some((name) => index[name] < 0)) {
      message(dataMessage, 'CSV 缺少「日期、類型、類別、金額」欄位，請使用本系統匯出的格式。', 'error');
      return;
    }
    const typeByLabel = { 支出: 'expense', 收入: 'income' };
    const known = new Set(records.map((r) => r.id));
    let added = 0;
    let duplicated = 0;
    let invalid = 0;
    const imported = [];
    for (const row of rows) {
      const get = (name) => (index[name] >= 0 ? (row[index[name]] ?? '').trim() : '');
      const note = get('備註').replace(/^'(?=[=+\-@\t\r])/, '');
      const record = normalize({ id: get('編號'), type: typeByLabel[get('類型')], category: get('類別'),
        amount: get('金額'), date: get('日期').replace(/\//g, '-'), note, createdAt: Date.now() + added });
      if (!record) { invalid += 1; continue; }
      if (known.has(record.id)) { duplicated += 1; continue; }
      known.add(record.id);
      imported.push(record);
      added += 1;
    }
    records = [...records, ...imported];
    const saved = save();
    render();
    message(dataMessage, `匯入完成：新增 ${added} 筆，略過重複 ${duplicated} 筆、格式錯誤 ${invalid} 筆。${saved ? '' : '\n注意：瀏覽器無法儲存，關閉頁面後會遺失。'}`,
      added && saved ? 'success' : (invalid || !saved ? 'error' : ''));
  });

  $('#clear-button').addEventListener('click', () => {
    if (!records.length) {
      message(dataMessage, '目前沒有帳目。');
      return;
    }
    if (!window.confirm(`確定清除全部 ${records.length} 筆帳目？此動作無法復原，建議先匯出 CSV。`)) return;
    records = [];
    resetForm();
    save();
    render();
    message(dataMessage, '已清除全部帳目。', 'success');
  });

  load();
  if (!storageAvailable) save();
  fillCategories('expense');
  form.elements.namedItem('date').value = today();
  render();
})();
