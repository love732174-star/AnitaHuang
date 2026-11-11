報修登記系統
用於登記報修需求，方便追蹤與管理維修進度。
雲端任務測試
[報修欄位表（Excel）](文件/報修欄位表.xlsx)

## 網頁前端

根目錄的 `index.html`、`style.css`、`app.js` 與 `config.js` 是無需建置的純 HTML/CSS/JavaScript 前端。Supabase JS v2 由固定版本 CDN 載入；`config.js` 僅含可公開的專案網址及 publishable key，不可放入 secret 或 service_role 金鑰。資料庫須先具備 `supabase/schema.sql` 的資料表及權限。

本機預覽需要 Python 3：在根目錄執行 `python -m http.server 8000`，再開啟 `http://localhost:8000`。沒有套件安裝或正式環境建置步驟。

GitHub Pages 請在 Settings → Pages 選擇 Deploy from a branch、`main`、`/ (root)`。預期網址為 https://love732174-star.github.io/AnitaHuang/ 。合併程式碼不代表已啟用 Pages。

JavaScript 語法檢查需要 Node.js：`node --check app.js` 與 `node --check config.js`。瀏覽器測試使用 Python 3、Playwright（`pip install playwright`）與 Chromium（系統 Chromium 或 `python -m playwright install chromium`）；啟動上述本機伺服器後執行 `python tests/browser_check.py`。測試模擬 Supabase API，不寫入正式資料，涵蓋手機寬度、文字安全、清單排序與筆數、送出欄位、成功、錯誤、空白驗證及空清單。
