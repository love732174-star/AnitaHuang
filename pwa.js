(() => {
  'use strict';
  const installButton = document.querySelector('#install-button');
  const pwaMessage = document.querySelector('#pwa-message');
  const updatePanel = document.querySelector('#update-panel');
  const updateButton = document.querySelector('#update-button');
  const networkMessage = document.querySelector('#network-message');
  let installPrompt;
  let registration;
  let applyingUpdate = false;

  function showNetworkStatus() {
    networkMessage.hidden = navigator.onLine;
    networkMessage.textContent = navigator.onLine ? ''
      : '目前離線：可查看已快取的操作介面，無法送出或更新清單。輸入只保留在目前頁面，關閉或重新載入後不會保存。';
  }
  showNetworkStatus();
  window.addEventListener('online', showNetworkStatus);
  window.addEventListener('offline', showNetworkStatus);

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });
  installButton.addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    installButton.hidden = true;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      pwaMessage.textContent = choice.outcome === 'accepted' ? '已接受安裝，請依瀏覽器指示完成。' : '你可以稍後從瀏覽器選單安裝。';
    } catch {
      pwaMessage.textContent = '請從瀏覽器選單使用「安裝應用程式」或「加入主畫面」。';
    }
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installButton.hidden = true;
    pwaMessage.textContent = '已安裝報修登記，可從主畫面開啟。';
  });

  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    pwaMessage.textContent = '此瀏覽器或連線不支援離線安裝，仍可使用一般網頁。';
    return;
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applyingUpdate) window.location.reload();
  });
  updateButton.addEventListener('click', () => {
    if (!registration?.waiting) return;
    if (document.querySelector('#submit-button').textContent.includes('送出中')) {
      pwaMessage.textContent = '報修正在送出，請等候結果再更新。';
      return;
    }
    const form = document.querySelector('#repair-form');
    const hasInput = ['reporter_name', 'location', 'description']
      .some((name) => form.elements.namedItem(name).value.trim());
    if (hasInput && !window.confirm('更新會重新載入頁面，尚未送出的文字將清除。確定更新？')) return;
    applyingUpdate = true;
    updateButton.disabled = true;
    registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
  });
  navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })
    .then((result) => {
      registration = result;
      const showUpdate = () => {
        if (registration.waiting && navigator.serviceWorker.controller) updatePanel.hidden = false;
      };
      showUpdate();
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', showUpdate);
      });
    }).catch(() => {
      pwaMessage.textContent = '離線功能尚未就緒，請連線後重新載入；一般報修功能仍可使用。';
    });
})();
