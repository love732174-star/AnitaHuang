"""獨立啟動子目錄測試伺服器，模擬 API，不寫入正式資料。"""
import functools
import json
import shutil
import threading
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
state = {'version': 'v1', 'reads': 0, 'writes': 0}

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if not self.path.startswith('/AnitaHuang/'):
            self.send_error(404)
            return
        self.path = '/' + self.path[len('/AnitaHuang/'):]
        if self.path == '/sw.js':
            data = (ROOT / 'sw.js').read_text().replace('${CACHE_PREFIX}v1', '${CACHE_PREFIX}' + state['version']).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}/AnitaHuang/index.html'
sdk_url = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/dist/umd/supabase.min.js'
with urlopen(sdk_url, timeout=20) as response:
    sdk = response.read()

profile = tempfile.TemporaryDirectory(prefix="repair-pwa-test-")
try:
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(profile.name, executable_path=shutil.which('chromium'),
            headless=True, args=['--no-sandbox'], viewport={'width': 390, 'height': 844})
        context.route(sdk_url, lambda route: route.fulfill(content_type='application/javascript', body=sdk))

        def api(route):
            if route.request.method == 'POST':
                state['writes'] += 1
                route.fulfill(status=201, body='', headers={'access-control-allow-origin': '*'})
            else:
                state['reads'] += 1
                route.fulfill(json=[{'id': 'fake', 'created_at': '2026-01-01T00:00:00Z',
                    'reporter_name': '虛構測試', 'location': '測試區', 'category': '設備',
                    'description': '模擬資料', 'urgency': '高', 'status': '待處理'}],
                    headers={'access-control-allow-origin': '*'})
        context.route('https://maozappqxarifqbzytte.supabase.co/**', api)
        page = context.new_page()
        page.goto(url, wait_until='networkidle')
        page.evaluate('navigator.serviceWorker.ready')
        page.wait_for_function('navigator.serviceWorker.controller !== null')
        page.locator('.request-card').wait_for()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        manifest = page.evaluate("async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json()")
        assert manifest['display'] == 'standalone'
        assert page.evaluate("async () => (await navigator.serviceWorker.ready).scope") == url.rsplit('/', 1)[0] + '/'
        for icon in manifest['icons']:
            assert page.evaluate('(path) => fetch(path).then(r => r.ok)', icon['src'])
        session = context.new_cdp_session(page)
        installability = session.send('Page.getInstallabilityErrors')
        assert not installability['installabilityErrors'], installability
        keys = page.evaluate("async () => { const names = await caches.keys(); return (await Promise.all(names.map(async n => (await (await caches.open(n)).keys()).map(r => r.url)))).flat(); }")
        assert not any('supabase.co' in key for key in keys)
        assert all('/AnitaHuang/' in key or key == sdk_url for key in keys)
        initial_reads = state['reads']
        page.locator('[data-filter="高"]').click()
        page.locator('[data-filter="全部"]').click()
        assert state['reads'] == initial_reads

        # 離線不重送；保留當前頁面輸入，重新開啟時只有介面，不還原 API 資料。
        page.locator('[name=reporter_name]').fill('離線示範')
        page.locator('[name=location]').fill('示範區')
        page.locator('[name=category]').select_option('設備')
        page.locator('textarea[name=description]').fill('示範問題')
        context.set_offline(True)
        page.locator('#network-message').wait_for(state='visible')
        page.locator('#submit-button').click()
        assert '尚未送出' in page.locator('#form-message').inner_text()
        assert state['writes'] == 0
        # 同時固定離線提示的 UI 測試；實際資源由 Service Worker 快取提供。
        page.add_init_script("if (location.search.includes('offline-test')) Object.defineProperty(navigator, 'onLine', {get: () => false});")
        page.goto(url + '?offline-test=1', wait_until='load')
        assert page.locator('#form-title').inner_text() == '報修登記'
        page.locator('#network-message').wait_for(state='visible')
        assert page.locator('.request-card').count() == 0
        assert page.locator('[name=reporter_name]').input_value() == ''
        context.set_offline(False)
        page.goto(url, wait_until='networkidle')
        page.locator('.request-card').wait_for()

        # 提示套用更新，不自動清掉表單；取消更新與確認更新都要有效。
        page.locator('[name=reporter_name]').fill('未送出示範')
        state['version'] = 'v2'
        page.evaluate('async () => (await navigator.serviceWorker.ready).update()')
        page.locator('#update-panel').wait_for(state='visible', timeout=15000)
        assert page.locator('[name=reporter_name]').input_value() == '未送出示範'
        page.once('dialog', lambda dialog: dialog.dismiss())
        page.locator('#update-button').click()
        assert page.locator('[name=reporter_name]').input_value() == '未送出示範'
        page.once('dialog', lambda dialog: dialog.accept())
        page.locator('#update-button').click()
        page.wait_for_function("document.querySelector('[name=reporter_name]').value === ''")
        page.wait_for_function("async () => (await caches.keys()).filter(n => n.startsWith('repair-desk-shell-')).every(n => n.endsWith('v2'))")
        page.locator('.request-card').wait_for()
        page.locator('.pwa-tools details').click()
        page.screenshot(path='/tmp/repair-pwa-mobile.png', full_page=True)
        assert state['writes'] == 0
        context.close()
        print('PASS: installability, GitHub Pages subpath, icons, scoped cache, no API caching, offline reload/no submission, filters, update confirmation and activation')
finally:
    server.shutdown()
    server.server_close()
    profile.cleanup()
