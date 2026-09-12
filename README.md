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

搜索可用（`/api/geocode` 由 Vite 代理直连 Nominatim）；驾车路线走本地 Worker（`/api/route`，即下面的 `pnpm pages:dev`），Worker 没起时浏览器直连 OSRM 兜底；账号、我的路书、公开路书也需要下面的 Worker。

**完整前后端（真实 Worker + 本地 D1）：**

```bash
pnpm pages:dev    # 先 build，再起 Worker，http://localhost:8788
```

**要 HMR + 真实 D1：** 再开一个终端跑 `pnpm dev`，Vite 会把 `/api/books`、`/api/library` 等转发到 8788 的本地 Worker（可用 `LUSHU_API` 覆盖地址）。

## 界面语言

界面支持简体中文 / English，页头右上角一键切换；首次访问按浏览器语言自动选择，之后记住选择。新建路书的默认书名使用创建时的界面语言。

## 数据与账号

- 搜索、路线规划（`/api/geocode`、`/api/route`）不登录也能用。
- 驾车路线优先走高德：设置 `AMAP_KEY`（高德「Web 服务」key，`wrangler pages secret put AMAP_KEY`）后，`/api/route` 走高德驾车规划；未设置或高德失败时自动回落 OSRM。高德 key 的并发 QPS 很低，多天路线会串行发送、遇限流自动重试，尽量不走兜底。返回的路线坐标统一为 GCJ02，与高德底图对齐。
- 个人数据相关的功能一律要登录：我的路书、新建 / 复制路书、编辑保存、云端书架、跨设备找回。未登录时点这些操作会先跳到账户页，登录 / 注册成功后自动接着把刚才的事做完。
- 可见性默认公开：新路书会出现在「公开路书」页，拿到链接的人都能打开。路书详情链接形如 `/{userId}/{bookId}`，`userId` 是书主的公开短 ID（账号页的「用户 ID」，由邮箱派生，不是凭证）；老链接只有 `/{bookId}` 也照常打开。在「我的路书」列表里可以把某一本切成「仅自己可见」——它随即从公开列表消失，别人再打开旧链接也读不到（服务端当成不存在），只有这本路书的 owner 能看。切回公开同理。
- 改动全程只对应同一本路书：界面先即时更新，防抖 1.4s 后写入 D1，不存在两份需要用户对照的数据。
- 退出登录会清掉这台设备上的缓存（路书、令牌、owner key）；路书仍在账号里，重新登录即可同步回来。
- 这套规则只在文档里说明，页面不做解释。

## 部署

```bash
pnpm deploy       # wrangler pages deploy dist
```

密钥不写进前端代码，部署时用 `wrangler pages secret put`（本地开发写 `.dev.vars`）：

| Secret | 用途 |
| --- | --- |
| `RESEND_API_KEY` | 发送注册激活邮件 |
| `TURNSTILE_SECRET` | 注册 / 登录人机校验 |
| `ADMIN_SECRET` | 管理后台 `/admin` 口令；未设置时 `/api/admin/*` 返回 404 |
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
