(() => {
  'use strict';
  const form = document.querySelector('#repair-form');
  const submitButton = document.querySelector('#submit-button');
  const refreshButton = document.querySelector('#refresh-button');
  const formMessage = document.querySelector('#form-message');
  const listMessage = document.querySelector('#list-message');
  const list = document.querySelector('#request-list');
  let client;
  let submitting = false;
  let loading = false;

  function message(element, text, kind = '') {
    element.textContent = text;
    element.dataset.kind = kind;
  }

  function errorText(error) {
    if (error?.code === '42501') return '目前沒有資料存取權限，請聯絡管理員檢查資料表授權及 RLS 政策。';
    if (error?.code === '23514' || error?.code === '23502') return '資料格式不符合規定，請確認必填欄位、文字長度與選項。';
    return '無法完成連線或資料操作，請檢查網路，或聯絡管理員確認服務設定。';
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }

  function renderRequests(requests) {
    const fragment = document.createDocumentFragment();
    for (const request of requests) {
      const card = element('li', 'request-card', '');
      const top = element('div', 'card-top', '');
      top.append(element('h3', 'card-location', request.location));
      const badges = element('div', 'badges', '');
      const status = element('span', 'badge', request.status);
      status.dataset.status = request.status;
      const urgency = element('span', 'badge', `緊急程度：${request.urgency}`);
      urgency.dataset.urgency = request.urgency;
      badges.append(element('span', 'badge', request.category), urgency, status);
      top.append(badges);
      const date = new Date(request.created_at);
      const formattedDate = Number.isNaN(date.getTime()) ? '時間未知' : date.toLocaleString('zh-TW', { hour12: false });
      card.append(top, element('p', 'card-description', request.description),
        element('div', 'card-meta', `${request.reporter_name} · ${formattedDate}`));
      fragment.append(card);
    }
    list.replaceChildren(fragment);
  }

  async function loadRequests() {
    if (loading || !client) return;
    loading = true;
    refreshButton.disabled = true;
    list.setAttribute('aria-busy', 'true');
    message(listMessage, '正在載入報修清單…');
    try {
      const { data, error } = await client.from('repair_requests')
        .select('id, created_at, reporter_name, location, category, description, urgency, status')
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(20);
      if (error) throw error;
      renderRequests(data ?? []);
      message(listMessage, data?.length ? '' : '目前還沒有報修紀錄，歡迎登記第一筆需求。');
    } catch (error) {
      message(listMessage, `清單更新失敗。${errorText(error)}${list.children.length ? ' 下方保留上次載入的資料。' : ''}`, 'error');
    } finally {
      loading = false;
      refreshButton.disabled = false;
      list.setAttribute('aria-busy', 'false');
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting || !client || !form.reportValidity()) return;
    const values = new FormData(form);
    // 僅傳送獲授權的五個欄位；status、id、created_at 由資料庫產生。
    const payload = Object.fromEntries(['reporter_name', 'location', 'category', 'description', 'urgency']
      .map((key) => [key, String(values.get(key) ?? '').trim()]));
    if (Object.values(payload).some((value) => !value)) {
      message(formMessage, '請填寫所有欄位，文字不可只有空白。', 'error');
      return;
    }
    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = '送出中…';
    message(formMessage, '正在送出，請稍候…');
    try {
      const { error } = await client.from('repair_requests').insert(payload);
      if (error) throw error;
      form.reset();
      message(formMessage, '報修已成功送出！初始狀態為「待處理」。', 'success');
      // 若使用者正在手動重新整理，等該次讀取完成後再取最新資料。
      while (loading) await new Promise((resolve) => setTimeout(resolve, 100));
      await loadRequests();
    } catch (error) {
      message(formMessage, `未能確認報修送出成功。${errorText(error)} 若連線中斷，請先重新整理清單確認是否已登記，再決定是否重送。`, 'error');
    } finally {
      submitting = false;
      submitButton.disabled = false;
      submitButton.textContent = '送出報修 ↗';
    }
  });
  refreshButton.addEventListener('click', loadRequests);

  try {
    const config = window.REPAIR_CONFIG;
    if (!window.supabase?.createClient || !config?.supabaseUrl || !config?.supabasePublishableKey) throw new Error('Missing configuration');
    client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async (url, options = {}) => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);
          try {
            return await fetch(url, { ...options, signal: controller.signal });
          } finally {
            clearTimeout(timeout);
          }
        },
      },
    });
    submitButton.disabled = false;
    loadRequests();
  } catch {
    refreshButton.disabled = true;
    message(formMessage, '無法初始化報修服務，請重新載入頁面，或聯絡管理員檢查連線設定與 CDN。', 'error');
    message(listMessage, '報修服務尚未就緒，無法載入清單。', 'error');
  }
})();
