"""執行前先在根目錄啟動 python -m http.server 8000；所有 Supabase 資料請求均模擬。"""
import json
import shutil
from urllib.request import urlopen
from pathlib import Path
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=shutil.which('chromium'), headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=1, service_workers='block')
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    records = [{'id': 'test', 'created_at': '2026-11-11T01:00:00Z',
                'reporter_name': '測試人員', 'location': '行政部', 'category': '設備',
                'description': '<img src=x onerror=alert(1)>', 'urgency': '中', 'status': '待處理'}]
    state = {'fail': False, 'payloads': [], 'queries': []}

    def handle(route):
        request = route.request
        if request.method == 'OPTIONS':
            route.fulfill(status=200, headers={'access-control-allow-origin': '*',
                'access-control-allow-headers': '*', 'access-control-allow-methods': '*'})
            return
        headers = {'access-control-allow-origin': '*', 'content-type': 'application/json'}
        if request.method == 'POST':
            state['payloads'].append(request.post_data_json)
            if state['fail']:
                route.fulfill(status=403, headers=headers, body=json.dumps({'code': '42501', 'message': 'denied'}))
            else:
                route.fulfill(status=201, headers=headers, body='')
        else:
            state['queries'].append(request.url)
            route.fulfill(status=200, headers=headers, body=json.dumps(records))

    cdn_url = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/dist/umd/supabase.min.js'
    with urlopen(cdn_url, timeout=20) as response:
        sdk = response.read()
    page.route(cdn_url, lambda route: route.fulfill(content_type='application/javascript', body=sdk))
    page.route('https://maozappqxarifqbzytte.supabase.co/**', handle)
    page.goto('http://127.0.0.1:8000', wait_until='networkidle')
    page.locator('.request-card').wait_for()
    assert page.locator('.card-description').inner_text() == records[0]['description']
    assert page.locator('.request-card img').count() == 0
    assert 'limit=20' in state['queries'][0] and 'created_at.desc' in state['queries'][0]
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')

    def fill():
        page.locator('[name=reporter_name]').fill('王小明')
        page.locator('[name=location]').fill('三樓')
        page.locator('[name=category]').select_option('網路')
        page.locator('textarea[name=description]').fill('無法連線')

    fill()
    page.locator('#submit-button').click()
    page.wait_for_function("document.querySelector('#form-message').dataset.kind === 'success'")
    assert set(state['payloads'][0]) == {'reporter_name', 'location', 'category', 'description', 'urgency'}
    assert state['payloads'][0]['urgency'] == '中'
    assert page.locator('[name=reporter_name]').input_value() == ''
    state['fail'] = True
    fill()
    page.locator('#submit-button').click()
    page.wait_for_function("document.querySelector('#form-message').dataset.kind === 'error'")
    assert page.locator('[name=reporter_name]').input_value() == '王小明'
    assert page.locator('#submit-button').is_enabled()
    page.locator('[name=reporter_name]').fill('   ')
    page.locator('#submit-button').click()
    assert len(state['payloads']) == 2
    records.clear()
    page.locator('#refresh-button').click()
    page.wait_for_function("document.querySelector('#list-message').textContent.includes('目前還沒有')")
    page.reload(wait_until='networkidle')
    page.wait_for_function("document.querySelector('#list-message').textContent.includes('目前還沒有')")
    Path('/tmp').mkdir(exist_ok=True)
    page.screenshot(path='/tmp/repair-mobile.png', full_page=True)
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.screenshot(path='/tmp/repair-desktop.png', full_page=True)
    assert not errors, errors
    browser.close()
    print('PASS: mobile layout, safe text rendering, latest-20 query, insert payload, success, failure, whitespace, empty list')
