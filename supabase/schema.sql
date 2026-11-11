-- 報修登記系統：供人工審閱後於 Supabase 執行的可重跑建表腳本。
-- 保留既有資料；若既有結構或資料不符合要求，整筆交易失敗，不自動轉換或刪除資料。
-- 使用交易，讓建表、權限與政策在未來執行時一併生效。
BEGIN;

-- 建立資料表：所有欄位必填，識別碼與建立時間由資料庫自動產生。
CREATE TABLE IF NOT EXISTS public.repair_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    reporter_name text NOT NULL,
    location text NOT NULL,
    category text NOT NULL,
    description text NOT NULL,
    urgency text NOT NULL DEFAULT '中',
    status text NOT NULL DEFAULT '待處理'
);

-- 既有資料表不能只略過建表：先確認欄位型別、主鍵與政策，避免誤認安全設定已完成。
-- 未知的既有政策可能放寬匿名存取，須先人工檢視，不在此自動刪除。
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM (VALUES
            ('id', 'uuid'), ('created_at', 'timestamp with time zone'),
            ('reporter_name', 'text'), ('location', 'text'), ('category', 'text'),
            ('description', 'text'), ('urgency', 'text'), ('status', 'text')
        ) AS expected(name, type_name)
        LEFT JOIN pg_attribute AS a
            ON a.attrelid = 'public.repair_requests'::regclass
            AND a.attname = expected.name AND NOT a.attisdropped
        WHERE a.attname IS NULL
            OR format_type(a.atttypid, a.atttypmod) <> expected.type_name
            OR a.attgenerated <> '' OR a.attidentity <> ''
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_constraint AS c
        JOIN pg_attribute AS a ON a.attrelid = c.conrelid AND a.attname = 'id'
        WHERE c.conrelid = 'public.repair_requests'::regclass
            AND c.contype = 'p' AND c.conkey = ARRAY[a.attnum]::smallint[]
    ) THEN
        RAISE EXCEPTION '既有欄位型別或主鍵不符合預期，請先人工檢視結構；未變更資料。';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'repair_requests'
            AND policyname NOT IN ('repair_requests_anon_select', 'repair_requests_anon_insert')
    ) THEN
        RAISE EXCEPTION '存在未知的既有 RLS 政策，請先人工審查，避免政策疊加放寬權限。';
    END IF;
END;
$$;

-- 對新表及既有表一律套用必填與預設值；不回填既有空值。
ALTER TABLE public.repair_requests
    ALTER COLUMN id SET DEFAULT gen_random_uuid(),
    ALTER COLUMN created_at SET DEFAULT now(),
    ALTER COLUMN urgency SET DEFAULT '中',
    ALTER COLUMN status SET DEFAULT '待處理',
    ALTER COLUMN created_at SET NOT NULL,
    ALTER COLUMN reporter_name SET NOT NULL,
    ALTER COLUMN location SET NOT NULL,
    ALTER COLUMN category SET NOT NULL,
    ALTER COLUMN description SET NOT NULL,
    ALTER COLUMN urgency SET NOT NULL,
    ALTER COLUMN status SET NOT NULL;

-- CHECK 層：重建本腳本管理的限制並驗證所有既有資料；不符合時回滾。
ALTER TABLE public.repair_requests
    DROP CONSTRAINT IF EXISTS repair_requests_reporter_name_check,
    DROP CONSTRAINT IF EXISTS repair_requests_location_check,
    DROP CONSTRAINT IF EXISTS repair_requests_description_check,
    DROP CONSTRAINT IF EXISTS repair_requests_category_check,
    DROP CONSTRAINT IF EXISTS repair_requests_urgency_check,
    DROP CONSTRAINT IF EXISTS repair_requests_status_check,
    ADD CONSTRAINT repair_requests_reporter_name_check CHECK (
        char_length(reporter_name) BETWEEN 1 AND 100 AND reporter_name ~ '[^[:space:]]'
    ),
    ADD CONSTRAINT repair_requests_location_check CHECK (
        char_length(location) BETWEEN 1 AND 200 AND location ~ '[^[:space:]]'
    ),
    ADD CONSTRAINT repair_requests_description_check CHECK (
        char_length(description) BETWEEN 1 AND 2000 AND description ~ '[^[:space:]]'
    ),
    ADD CONSTRAINT repair_requests_category_check CHECK (category IN ('設備', '網路', '環境', '其他')),
    ADD CONSTRAINT repair_requests_urgency_check CHECK (urgency IN ('低', '中', '高')),
    ADD CONSTRAINT repair_requests_status_check CHECK (status IN ('待處理', '處理中', '已完成'));

-- GRANT 層：明確清除公開與前端角色的資料表權限，不依賴預設授權。
-- authenticated 不在本次授權範圍；管理員與 service_role 須由可信任後端保管。
REVOKE ALL PRIVILEGES ON TABLE public.repair_requests
    FROM PUBLIC, anon, authenticated;
-- 資料表層 REVOKE 不會移除舊的欄位授權，因此逐欄清除前端角色的權限。
DO $$
DECLARE
    column_record record;
BEGIN
    FOR column_record IN
        SELECT attname FROM pg_attribute
        WHERE attrelid = 'public.repair_requests'::regclass
            AND attnum > 0 AND NOT attisdropped
    LOOP
        EXECUTE format(
            'REVOKE ALL PRIVILEGES (%I) ON TABLE public.repair_requests FROM PUBLIC, anon, authenticated',
            column_record.attname
        );
    END LOOP;
END;
$$;
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON TABLE public.repair_requests TO anon;

-- 僅開放新增報修必要欄位；省略 urgency 時使用「中」。
-- 不授權新增 id、created_at、status，亦不授權 UPDATE、DELETE 等操作。
GRANT INSERT (reporter_name, location, category, description, urgency)
    ON TABLE public.repair_requests TO anon;

-- RLS 層：匿名訪客可讀取全部清單，讀取仍須通過前述 SELECT 授權。
ALTER TABLE public.repair_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS repair_requests_anon_select ON public.repair_requests;
CREATE POLICY repair_requests_anon_select
    ON public.repair_requests
    FOR SELECT TO anon
    USING (true);

-- RLS 層：新增後的狀態必須為「待處理」，即使日後擴充欄位授權仍受此限制。
-- 不建立修改與刪除政策；登入使用者不會自動取得 anon 的權限。
DROP POLICY IF EXISTS repair_requests_anon_insert ON public.repair_requests;
CREATE POLICY repair_requests_anon_insert
    ON public.repair_requests
    FOR INSERT TO anon
    WITH CHECK (status = '待處理');

-- 完成交易；前端仍需防止腳本注入，並於 API 層另設防濫用措施。
COMMIT;
