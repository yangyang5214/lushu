-- 路书 · D1 schema
-- 初始化：wrangler d1 execute lushu --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS books (
  id         TEXT PRIMARY KEY,           -- 24-hex 公开可读凭证（出现在 URL 里）
  doc        TEXT NOT NULL,              -- 整本路书 JSON（Book）
  edit_token TEXT NOT NULL,              -- 编辑口令（只存在创建者浏览器里）
  owner_key  TEXT,                       -- 书架密钥，用于"我的路书"列表
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

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
