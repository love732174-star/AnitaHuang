"""PWA 測試：自行啟動 GitHub Pages 子目錄伺服器，驗證安裝條件、離線記帳與更新確認。"""
import functools
import os
import re
import shutil
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
state = {'version': None}


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if not self.path.startswith('/AnitaHuang/'):
            self.send_error(404)
            return
        self.path = '/' + self.path[len('/AnitaHuang/'):]
        if self.path == '/sw.js':
            data = (ROOT / 'sw.js').read_text()
            if state['version']:
                # 模擬下一版：不論目前版本號為何，都換成測試用的新版本。
                data = re.sub(r'\$\{CACHE_PREFIX\}v\d+', '${CACHE_PREFIX}' + state['version'], data)
            data = data.encode()
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
profile = tempfile.TemporaryDirectory(prefix='ledger-pwa-test-')
try:
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            profile.name, executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or None,
            headless=True, args=['--no-sandbox'], viewport={'width': 390, 'height': 844})
        page = context.new_page()
        external = []
        page.on('request', lambda r: external.append(r.url) if not r.url.startswith(url.rsplit('/', 1)[0]) else None)
        # 模擬舊版報修網頁留下的快取，確認新版啟用時會清除。
        page.goto(url, wait_until='load')
        page.evaluate("caches.open('repair-desk-shell-/AnitaHuang/-v1').then(c => c.put('legacy', new Response('x')))")
        page.reload(wait_until='load')
        page.evaluate('navigator.serviceWorker.ready')
        page.wait_for_function('navigator.serviceWorker.controller !== null')
        page.wait_for_function("caches.keys().then(n => !n.some(k => k.startsWith('repair-desk-shell-')))")
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        manifest = page.evaluate("async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json()")
        assert manifest['display'] == 'standalone' and manifest['name'] == '記帳本'
        assert page.evaluate("async () => (await navigator.serviceWorker.ready).scope") == url.rsplit('/', 1)[0] + '/'
        for icon in manifest['icons']:
            assert page.evaluate('(path) => fetch(path).then(r => r.ok)', icon['src'])
        installability = context.new_cdp_session(page).send('Page.getInstallabilityErrors')
        assert not installability['installabilityErrors'], installability
        keys = page.evaluate("async () => { const names = await caches.keys(); return (await Promise.all(names.map(async n => (await (await caches.open(n)).keys()).map(r => r.url)))).flat(); }")
        assert keys and all('/AnitaHuang/' in key for key in keys), keys
        assert not external, external

        # 離線重新開啟仍可記帳，資料保存在 localStorage。
        context.set_offline(True)
        page.reload(wait_until='load')
        assert page.locator('#form-title').inner_text() == '記一筆'
        page.locator('[name=amount]').fill('88')
        page.locator('[name=note]').fill('離線記帳')
        page.locator('#submit-button').click()
        assert page.locator('.record', has_text='離線記帳').count() == 1
        page.reload(wait_until='load')
        assert page.locator('.record', has_text='離線記帳').count() == 1
        context.set_offline(False)

        # 有未記下的內容時更新需確認；更新後已儲存的帳目仍在。
        page.locator('[name=note]').fill('未記下')
        state['version'] = 'vtest'
        page.evaluate('async () => (await navigator.serviceWorker.ready).update()')
        page.locator('#update-panel').wait_for(state='visible', timeout=15000)
        page.once('dialog', lambda dialog: dialog.dismiss())
        page.locator('#update-button').click()
        assert page.locator('[name=note]').input_value() == '未記下'
        page.once('dialog', lambda dialog: dialog.accept())
        page.locator('#update-button').click()
        page.wait_for_function("document.querySelector('[name=note]').value === ''")
        page.wait_for_function("async () => (await caches.keys()).filter(n => n.startsWith('ledger-shell-')).every(n => n.endsWith('vtest'))")
        assert page.locator('.record', has_text='離線記帳').count() == 1
        context.close()
        print('PASS: installability, GitHub Pages subpath, icons, scoped cache, legacy cache cleanup, no external requests, '
              'offline entry and reload, update confirmation keeps saved records')
finally:
    server.shutdown()
    server.server_close()
    profile.cleanup()
