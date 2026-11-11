-- 報修登記系統：供人工審閱後於 Supabase 執行的一次性建表腳本。
-- 僅適用於尚未建立 repair_requests 的專案；本次交付不執行此 SQL。
-- 使用交易，讓建表、權限與政策在未來執行時一併生效。
BEGIN;

-- 建立資料表：所有欄位必填，識別碼與建立時間由資料庫自動產生。
CREATE TABLE public.repair_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    reporter_name text NOT NULL,
    location text NOT NULL,
    category text NOT NULL,
    description text NOT NULL,
    urgency text NOT NULL DEFAULT '中',
    status text NOT NULL DEFAULT '待處理',

    -- CHECK 層：長度以字元計算，限制原始文字長度並拒絕純空白內容。
    CONSTRAINT repair_requests_reporter_name_check CHECK (
        char_length(reporter_name) BETWEEN 1 AND 100
        AND reporter_name ~ '[^[:space:]]'
    ),
    CONSTRAINT repair_requests_location_check CHECK (
        char_length(location) BETWEEN 1 AND 200
        AND location ~ '[^[:space:]]'
    ),
    CONSTRAINT repair_requests_description_check CHECK (
        char_length(description) BETWEEN 1 AND 2000
        AND description ~ '[^[:space:]]'
    ),

    -- CHECK 層：列舉值採精確比對，也同時限制這些文字欄位的長度。
    CONSTRAINT repair_requests_category_check
        CHECK (category IN ('設備', '網路', '環境', '其他')),
    CONSTRAINT repair_requests_urgency_check
        CHECK (urgency IN ('低', '中', '高')),
    CONSTRAINT repair_requests_status_check
        CHECK (status IN ('待處理', '處理中', '已完成'))
);

-- GRANT 層：明確清除公開與前端角色的資料表權限，不依賴預設授權。
-- authenticated 不在本次授權範圍；管理員與 service_role 須由可信任後端保管。
REVOKE ALL PRIVILEGES ON TABLE public.repair_requests
    FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON TABLE public.repair_requests TO anon;

-- 僅開放新增報修必要欄位；省略 urgency 時使用「中」。
-- 不授權新增 id、created_at、status，亦不授權 UPDATE、DELETE 等操作。
GRANT INSERT (reporter_name, location, category, description, urgency)
    ON TABLE public.repair_requests TO anon;

-- RLS 層：匿名訪客可讀取全部清單，讀取仍須通過前述 SELECT 授權。
ALTER TABLE public.repair_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY repair_requests_anon_select
    ON public.repair_requests
    FOR SELECT TO anon
    USING (true);

-- RLS 層：新增後的狀態必須為「待處理」，即使日後擴充欄位授權仍受此限制。
-- 不建立修改與刪除政策；登入使用者不會自動取得 anon 的權限。
CREATE POLICY repair_requests_anon_insert
    ON public.repair_requests
    FOR INSERT TO anon
    WITH CHECK (status = '待處理');

-- 完成交易；前端仍需防止腳本注入，並於 API 層另設防濫用措施。
COMMIT;
