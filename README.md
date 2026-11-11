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

[報修登記系統提案（PowerPoint）](文件/報修登記系統提案.pptx)

## PWA 安裝與離線使用

網站已加入 `manifest.webmanifest`、主畫面圖示與 `sw.js`，支援安裝後以獨立視窗開啟。所有路徑相對於網站目錄，適用 GitHub Pages 的 `/AnitaHuang/` 子路徑；正式部署須使用 HTTPS，本機可使用 `localhost` 或 `127.0.0.1`。直接開啟 `file://index.html` 無法啟用 Service Worker。

- Android／電腦 Chrome：開啟網站後，使用頁面上的「安裝報修登記」（瀏覽器提供安裝提示時顯示），或選單的「安裝應用程式／加入主畫面」。
- iPhone／iPad：用 Safari 開啟網站，選「分享 → 加入主畫面」。實際選單與安裝支援依瀏覽器版本而異；不支援安裝時仍可用一般網頁。
- 首次需連線載入並完成 Service Worker 快取；之後可離線重開操作介面。離線不能送出報修或更新清單，沒有離線排程、自動補送或背景同步。
- 快取只儲存白名單靜態檔案及可取得的固定版本 CDN SDK，不快取 Supabase API 或報修清單。已開啟頁面中的舊清單只留在記憶體；離線重新開啟不會還原。若 SDK 未快取，離線仍能看到介面，連線後需重新載入才能初始化服務。
- 表單文字不寫入本機儲存空間，關閉或重新載入會消失。恢復連線後，已初始化的頁面會重新讀清單，但報修需自行確認並送出，避免重複登記。
- 有新版本時顯示「更新版本」，由使用者點選後重新載入；有未送出文字會要求確認，送出期間不執行更新。其他開啟的分頁可在下次重新載入後使用新版本。

修改快取的靜態檔案時，須一併遞增 `sw.js` 的 `CACHE_NAME` 版本（目前 `v1`），確保新介面能被偵測。舊快取只清理同一應用路徑的版本，不會刪除其他專案的快取。`config.js` 仍只可放公開 publishable key。

PWA 驗證：執行 `node --check pwa.js`、`node --check sw.js` 與 `python tests/pwa_check.py`。後者自行啟動測試伺服器，用 Chromium 一般使用者設定檔與模擬 Supabase API 驗證安裝條件、GitHub Pages 子路徑、圖示、離線重開、離線不送出、不快取資料及更新確認；不寫入正式資料。SDK 需能從 CDN 下載。原 `tests/browser_check.py` 專注表單互動並停用 Service Worker，以免影響 API 模擬；PWA 測試則實際啟用 Service Worker。手機實機安裝仍須於正式 HTTPS 網址驗收。
