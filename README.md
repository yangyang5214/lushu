# 路书 Lushu

**简体中文** ｜ [English](README.en.md)

基于 Cloudflare Pages + D1 的路书规划与分享应用：搜索地点、规划驾车路线、把多天行程整理成一本可分享的路书。前端 React + Vite，后端 Pages Functions。

## 快速开始

### 前置

- Node.js 18+、pnpm
- 本地 D1（Cloudflare 的 SQLite）由 Wrangler 自带，无需单独安装

### 初始化（只需一次）

```bash
pnpm install
pnpm wrangler login                     # 首次用 Wrangler 需要授权
pnpm wrangler d1 create lushu           # 记下返回的 database_id
cp wrangler.toml.example wrangler.toml  # 把 database_id 填进 wrangler.toml
pnpm db:init:local                      # 建本地 D1 表
```

`wrangler.toml` 已 gitignore，不会提交；仓库里只留 `wrangler.toml.example`。

`schema.sql` 可重复执行：建表用 `IF NOT EXISTS`，可见性等新字段直接存在路书 JSON 里，
不需要单独的迁移脚本，老库再跑一次 `db:init` 即可。

### 启动

**只调界面（只跑 Vite）：**

```bash
pnpm dev          # http://localhost:5173
```

搜索和驾车路线都只用高德，需要下面的 Worker（`pnpm pages:dev`）并在其中配好 `AMAP_KEY`；只跑 Vite 时搜索只剩本地地名库、路线不绘制。账号、我的路书、公开路书也需要下面的 Worker。

**完整前后端（真实 Worker + 本地 D1）：**

```bash
pnpm pages:dev    # 先 build，再起 Worker，http://localhost:8788
```

**要 HMR + 真实 D1：** 再开一个终端跑 `pnpm dev`，Vite 会把 `/api/books`、`/api/library` 等转发到 8788 的本地 Worker（可用 `LUSHU_API` 覆盖地址）。

## 部署

```bash
pnpm deploy       # wrangler pages deploy dist
```

密钥不写进前端代码，部署时用 `wrangler pages secret put`（本地开发写 `.dev.vars`）：

| Secret | 用途 |
| --- | --- |
| `RESEND_API_KEY` | 发送注册激活邮件 |
| `TURNSTILE_SECRET` | 注册 / 登录人机校验 |
| `ADMIN_SECRET` | 管理后台 `/admin` 口令（至少 6 字符）；未设置或过短时 `/api/admin/*` 返回 404 |

> 鉴权入口（登录 / 注册 / 重发激活信 / 管理登录）有基于 D1 `rate_limits` 表的限流，
> 首次升级后请重新执行一次 `pnpm db:init`（或 `pnpm db:init:local`）建表。
| `AMAP_KEY` | 高德「Web 服务」key（不是 JS API key），用于驾车路线 |

其他可调参数（`MAX_BOOKS`、`MAX_DOC_BYTES` 等）见 `wrangler.toml.example`。

## 脚本

```bash
pnpm dev          # 只起 Vite 开发服务器
pnpm pages:dev    # build 后起本地 Worker + D1
pnpm build        # 类型检查 + 构建到 dist/
pnpm preview      # 预览构建产物
pnpm lint         # oxlint
pnpm db:init:local / pnpm db:init   # 初始化本地 / 线上 D1
```
