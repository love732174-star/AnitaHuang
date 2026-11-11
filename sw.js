/* 更新靜態檔案時一併更換版本；新版本等待使用者同意，避免清除未送出表單。 */
const BASE = new URL('./', self.location.href);
const CACHE_PREFIX = `repair-desk-shell-${BASE.pathname}-`;
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const SHELL_FILES = [
  './index.html', './style.css', './app.js', './config.js', './pwa.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];
const SHELL_URLS = new Set(SHELL_FILES.map((path) => new URL(path, BASE).href));
const INDEX_URL = new URL('./index.html', BASE).href;
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/dist/umd/supabase.min.js';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_FILES.map((path) => new Request(new URL(path, BASE), { cache: 'reload' })));
    // CDN 無法連線時仍可安裝離線介面；不快取不透明或失敗的回應。
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(SDK_URL, { mode: 'cors', signal: controller.signal });
      if (response.ok && response.type !== 'opaque') await cache.put(SDK_URL, response);
    } catch {
      // 離線時若無 SDK，表單依然可見，但無法送出。
    } finally {
      clearTimeout(timer);
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 僅清除此應用程式命名的舊快取，不影響同網域其他專案。
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // 只處理首頁與白名單靜態資源，Supabase API、報修清單及表單資料絕不快取。
  if (request.mode === 'navigate' && url.origin === BASE.origin
      && (url.pathname === BASE.pathname || url.pathname === new URL(INDEX_URL).pathname)) {
    event.respondWith((async () => {
      // 使用當前 worker 的一致版本；新版本安裝完成後由使用者選擇套用。
      const cached = await caches.match(INDEX_URL, { cacheName: CACHE_NAME });
      return cached || fetch(request);
    })());
  } else if (SHELL_URLS.has(url.href) || url.href === SDK_URL) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type !== 'opaque') await cache.put(request, response.clone());
      return response;
    })());
  }
});
