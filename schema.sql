-- 路书 · D1 schema
-- 初始化：wrangler d1 execute lushu --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS books (
  id         TEXT PRIMARY KEY,           -- 24-hex 公开可读凭证（出现在 URL 里）
  doc        TEXT NOT NULL,              -- 整本路书 JSON（Book），含 doc.visibility
  edit_token TEXT NOT NULL,              -- 编辑口令（只存在创建者浏览器里）
  owner_key  TEXT,                       -- 书架密钥，用于"我的路书"列表
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 可见性（doc.visibility，'public' | 'private'）就存在 doc 里，不加列：
-- 路书本来就整本读写，拆出一列只会多一份可能不同步的状态，还逼着每次
-- 改字段都写一个迁移脚本（CREATE TABLE IF NOT EXISTS 不会给老表补列）。
-- 缺字段的老数据按公开处理（和加这个字段之前的行为一致）。
-- 表达式索引同时服务于公开路书列表的过滤和排序。
CREATE INDEX IF NOT EXISTS idx_books_public
  ON books (COALESCE(json_extract(doc, '$.visibility'), 'public'), updated_at DESC);

-- 让"我的路书"按 owner 检索，避免全表扫描吃掉 rows read 额度。
-- 代价：每次更新 updated_at 会多写一行索引（写放大 2x），
-- 免费档 10 万行/天，够用。
CREATE INDEX IF NOT EXISTS idx_books_owner
  ON books (owner_key, updated_at DESC);

-- 全局名额计数（软上限，防止被刷满 5 GB）。只在新建/删除时动一行。
CREATE TABLE IF NOT EXISTS stats (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0
);

-- ── 账号与会话 ─────────────────────────────────────────────────────────────
--
-- 账号用「邮箱 + 口令」注册与登录，没有游客账号；登录不会自动注册。
-- books.owner_key 直接就是 users.id（32-hex = 16 字节随机串）：登录/注册时
-- 把本机旧的匿名 owner_key 过户到账号，老数据不用搬家。
-- 注：users.username 列存的就是归一化（小写去空格）后的邮箱，保留旧列名免迁移。
--
-- 口令用 PBKDF2-SHA256（10 万次迭代）存成 "pbkdf2$sha256$iter$salt$hash"，
-- 明文口令任何时候都不落库。
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,           -- 32-hex，同时也是 books.owner_key
  username     TEXT NOT NULL UNIQUE,       -- 已归一化（小写）的邮箱，作为登录名
  display_name TEXT NOT NULL,              -- 展示名，保留用户输入的大小写
  pass_hash    TEXT NOT NULL,              -- pbkdf2$sha256$iter$salt$hash
  hash_id      TEXT,                       -- 邮箱派生的公开短 ID（sha256 前 10 位 hex）
  created_at   INTEGER NOT NULL,
  activated_at INTEGER                   -- 0=待激活；>0=激活时间戳；NULL=老账号（视为已激活）
);

-- hash_id 没必要单独建唯一索引：它由邮箱唯一决定，老库补列后由服务端按邮箱回填。
--
-- 已有库升级（按需执行）：
--   ALTER TABLE users ADD COLUMN activated_at INTEGER;
--   CREATE TABLE IF NOT EXISTS email_activations (...);  -- 见下方定义
--   DROP TABLE IF EXISTS email_codes;

-- 会话：cookie 里放明文 token，库里只存 SHA-256，泄库也换不来登录态。
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- 登出/清理会话、以及"这个用户有几台设备登录"都要用。
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions (expires_at);

-- 注册邮箱激活：库里只存 token 的 SHA-256 摘要，24 小时过期；点击成功即删行（一次性）。
CREATE TABLE IF NOT EXISTS email_activations (
  email      TEXT NOT NULL,              -- 归一化（小写）邮箱
  token_hash TEXT PRIMARY KEY,           -- sha256(token)
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_activations_email ON email_activations (email, created_at DESC);

-- 发码频率统计（按邮箱限流；老记录可定期清，不影响正确性）。
CREATE TABLE IF NOT EXISTS email_send_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  email   TEXT NOT NULL,
  sent_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_send_log ON email_send_log (email, sent_at DESC);

-- 认证面限流（固定窗口计数）：登录 / 注册 / 管理登录等。
-- 只存桶名与计数，不存原始 IP 或口令；过期桶会被顺手清理。
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket     TEXT PRIMARY KEY,   -- "<key>:<windowIndex>"
  expires_at INTEGER NOT NULL,
  n          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_expiry ON rate_limits (expires_at);
