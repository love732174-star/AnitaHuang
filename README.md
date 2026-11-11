報修登記系統
用於登記報修需求，方便追蹤與管理維修進度。
雲端任務測試
[報修欄位表（Excel）](文件/報修欄位表.xlsx)

## 網頁前端

根目錄的 `index.html`、`style.css`、`app.js` 與 `config.js` 是無需建置的純 HTML/CSS/JavaScript 前端。Supabase JS v2 由固定版本 CDN 載入；`config.js` 僅含可公開的專案網址及 publishable key，不可放入 secret 或 service_role 金鑰。資料庫須先具備 `supabase/schema.sql` 的資料表及權限。

本機預覽需要 Python 3：在根目錄執行 `python -m http.server 8000`，再開啟 `http://localhost:8000`。沒有套件安裝或正式環境建置步驟。

GitHub Pages 請在 Settings → Pages 選擇 Deploy from a branch、`main`、`/ (root)`。預期網址為 https://love732174-star.github.io/AnitaHuang/ 。合併程式碼不代表已啟用 Pages。

JavaScript 語法檢查需要 Node.js：`node --check app.js` 與 `node --check config.js`。瀏覽器測試使用 Python 3、Playwright（`pip install playwright`）與 Chromium（系統 Chromium 或 `python -m playwright install chromium`）；啟動上述本機伺服器後執行 `python tests/browser_check.py`。測試模擬 Supabase API，不寫入正式資料，涵蓋手機寬度、文字安全、清單排序與筆數、送出欄位、成功、錯誤、空白驗證及空清單。


## 緊急程度篩選

最近報修清單上方新增「全部／高／中／低」按鈕，預設為「全部」；選中的按鈕以深綠底、白字及底線標示，並提供 `aria-pressed` 狀態。篩選只處理網頁已讀取的最近 20 筆，保留原本由新到舊的排序，不會額外查詢 Supabase，也不代表篩選整個資料庫；沒有符合項目時會顯示提示。重新整理清單或成功送出報修後，會保留目前的篩選條件。

緊急程度為「高」的標籤改為淺紅底、深紅字。這次只變更網頁呈現與說明，沒有修改資料庫、增加欄位或變更 `supabase/`。

手機驗收：開啟此 PR 分支的本機預覽，捲到「最近報修」，確認四個按鈕完整顯示；依序點選「高／中／低」，確認按鈕選取外觀、顯示的報修緊急程度與無結果提示；點選「全部」應恢復原清單。「高」的標籤應為紅色，畫面不應左右溢出。此 PR 尚未合併，因此正式 GitHub Pages 不會顯示這次變更。

[報修系統操作說明（Word）](文件/報修系統操作說明.docx)
