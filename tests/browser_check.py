"""記帳本互動測試：自行啟動本機伺服器，資料只寫入測試瀏覽器的 localStorage。"""
import functools
import os
import shutil
import tempfile
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SHOTS = Path(__file__).resolve().parent / 'output'


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}/index.html'


def chromium_path():
    # 可用 CHROMIUM_PATH 指定瀏覽器；否則用系統 chromium，再退回 Playwright 內建版本。
    return os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or None


try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=chromium_path(), headless=True, args=['--no-sandbox'])
        context = browser.new_context(viewport={'width': 390, 'height': 844}, service_workers='block',
                                      accept_downloads=True)
        # 固定日期，讓月份與預設日期可預期。
        context.add_init_script("""(() => { const fixed = new Date('2026-11-16T10:00:00').getTime(); const RealDate = Date;
          class FakeDate extends RealDate { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } }
          window.Date = FakeDate; })();""")
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(url)

        def stored():
            return page.evaluate("JSON.parse(localStorage.getItem('ledger-records-v1') || '[]')")

        def add(amount, category=None, note='', date=None, kind='expense'):
            page.locator(f'.type-toggle input[value={kind}]').check(force=True)
            page.locator('[name=amount]').fill(str(amount))
            if category:
                page.locator('[name=category]').select_option(category)
            if date:
                page.locator('[name=date]').fill(date)
            page.locator('[name=note]').fill(note)
            page.locator('#submit-button').click()

        # 初始狀態：今天日期、本月、空清單。
        assert page.locator('[name=date]').input_value() == '2026-11-16'
        assert page.locator('#month-picker').input_value() == '2026-11'
        assert '還沒有帳目' in page.locator('#list-message').inner_text()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')

        # 驗證：空白或負數金額不寫入。
        page.locator('#submit-button').click()
        assert page.locator('#form-message').get_attribute('data-kind') == 'error'
        page.locator('[name=amount]').fill('-5')
        page.locator('#submit-button').click()
        assert page.locator('#form-message').get_attribute('data-kind') == 'error'
        assert stored() == []

        # 收入切換類別清單；新增收支後統計正確（含小數不產生浮點誤差）。
        page.locator('.type-toggle input[value=income]').check(force=True)
        assert '薪資' in page.locator('[name=category]').inner_text()
        add(50000, '薪資', '十一月薪水', '2026-11-05', 'income')
        assert page.locator('[name=amount]').input_value() == ''
        add(120.1, '餐飲', '午餐', '2026-11-16')
        add(80.2, '交通', '捷運', '2026-11-16')
        add(300, '餐飲', '<img src=x onerror=alert(1)>')
        assert len(stored()) == 4
        assert page.locator('#stat-income').inner_text().endswith('50,000')
        assert page.locator('#stat-expense').inner_text().endswith('500.3'), page.locator('#stat-expense').inner_text()
        assert page.locator('#stat-balance').inner_text().endswith('49,499.7')
        assert page.locator('.record img').count() == 0
        assert page.locator('.breakdown-row').first.inner_text().startswith('餐飲')
        assert page.locator('.day-group').count() == 2
        assert '16' in page.locator('.day-group h3').first.inner_text()

        # 篩選。
        page.locator('[data-filter=income]').click()
        assert page.locator('.record').count() == 1
        page.locator('[data-filter=expense]').click()
        assert page.locator('.record').count() == 3
        page.locator('[data-filter=all]').click()

        # 編輯：修改金額不新增筆數。
        page.locator('.record', has_text='捷運').locator('[data-action=edit]').click()
        assert page.locator('[name=amount]').input_value() == '80.2'
        assert page.locator('#cancel-edit').is_visible()
        page.locator('[name=amount]').fill('100')
        page.locator('#submit-button').click()
        assert len(stored()) == 4
        assert any(r['note'] == '捷運' and r['amount'] == 100 for r in stored())
        assert not page.locator('#cancel-edit').is_visible()

        # 重新載入後資料仍在。
        page.reload()
        assert page.locator('.record').count() == 4

        # 刪除需確認：取消不刪，確認才刪。
        page.once('dialog', lambda d: d.dismiss())
        page.locator('.record', has_text='午餐').locator('[data-action=delete]').click()
        assert len(stored()) == 4
        page.once('dialog', lambda d: d.accept())
        page.locator('.record', has_text='午餐').locator('[data-action=delete]').click()
        assert len(stored()) == 3

        # 月份切換：上個月為空，記帳到其他月份會跳到該月。
        page.locator('#prev-month').click()
        assert page.locator('#month-picker').input_value() == '2026-10'
        assert page.locator('.record').count() == 0
        add(60, '娛樂', '=1+1', '2026-10-03')
        assert page.locator('#month-picker').input_value() == '2026-10'
        assert page.locator('.record').count() == 1
        page.locator('#next-month').click()

        # 匯出 CSV：BOM、標題、公式字元加上 '。
        with page.expect_download() as info:
            page.locator('#export-button').click()
        csv_path = Path(info.value.path())
        raw = csv_path.read_bytes()
        assert raw.startswith('﻿'.encode())
        text = raw.decode('utf-8-sig')
        assert text.splitlines()[0] == '日期,類型,類別,金額,備註,編號'
        assert "'=1+1" in text
        assert len(text.strip().splitlines()) == 5

        # 匯入：同一份備份重複匯入全部略過；清除後匯入可完整還原。
        page.locator('#import-input').set_input_files(str(csv_path))
        assert '新增 0 筆' in page.locator('#data-message').inner_text()
        page.once('dialog', lambda d: d.accept())
        page.locator('#clear-button').click()
        assert stored() == []
        page.locator('#import-input').set_input_files(str(csv_path))
        assert '新增 4 筆' in page.locator('#data-message').inner_text()
        assert any(r['note'] == '=1+1' for r in stored())
        bad = Path(tempfile.mkdtemp()) / 'bad.csv'
        bad.write_text('日期,類型,類別,金額\n2026-11-01,支出,不存在,10\n2026/11/02,支出,餐飲,"1,200"\n', encoding='utf-8')
        page.locator('#import-input').set_input_files(str(bad))
        assert '新增 1 筆' in page.locator('#data-message').inner_text()
        assert '格式錯誤 1 筆' in page.locator('#data-message').inner_text()
        assert any(r['amount'] == 1200 and r['date'] == '2026-11-02' for r in stored())

        # 損壞的儲存內容不會讓頁面壞掉。
        page.evaluate("localStorage.setItem('ledger-records-v1', '{broken')")
        page.reload()
        assert '還沒有帳目' in page.locator('#list-message').inner_text()
        page.evaluate("localStorage.setItem('ledger-records-v1', JSON.stringify([%s]))" % ','.join(
            "{id:'s%d',type:'%s',amount:%s,category:'%s',date:'2026-11-%02d',note:'%s',createdAt:%d}" % row for row in [
                (1, 'income', 52000, '薪資', 5, '十一月薪水', 1), (2, 'expense', 15000, '居家', 6, '房租', 2),
                (3, 'expense', 1280, '購物', 9, '生活用品', 3), (4, 'expense', 3200, '餐飲', 12, '本週伙食', 4),
                (5, 'expense', 1200, '交通', 14, '悠遊卡加值', 5), (6, 'expense', 135, '餐飲', 16, '午餐便當', 6),
                (7, 'expense', 450, '娛樂', 16, '電影', 7)]))
        page.reload()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        assert not errors, errors
        SHOTS.mkdir(exist_ok=True)
        page.screenshot(path=str(SHOTS / 'mobile.png'), full_page=True)
        page.set_viewport_size({'width': 1280, 'height': 900})
        page.screenshot(path=str(SHOTS / 'desktop.png'), full_page=True)
        browser.close()
        print('PASS: validation, add/edit/delete, persistence, monthly summary, category breakdown, filters, '
              'month navigation, safe text, CSV export/import with dedupe, corrupted storage, mobile width')
finally:
    server.shutdown()
    server.server_close()
