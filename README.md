# 路书 Lushu

---

## 中文

界面支持简体中文 / English，页头右上角一键切换；首次访问按浏览器语言自动选择，之后记住选择。新建路书的默认书名使用创建时的界面语言。

### 前置

- Node.js 18+、pnpm
- 本地 D1（Cloudflare 的 SQLite）由 Wrangler 自带，无需单独安装

### 首次初始化

```bash
pnpm install
pnpm wrangler login                     # 首次用 Wrangler 需要授权
pnpm wrangler d1 create lushu           # 记下返回的 database_id
cp wrangler.toml.example wrangler.toml  # 把 database_id 填进 wrangler.toml
pnpm db:init:local                      # 建本地 D1 表，只需一次
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

### 数据与账号

- 搜索、路线规划（`/api/geocode`、`/api/route`）不登录也能用。
- 驾车路线优先走高德：设置 `AMAP_KEY`（高德「Web 服务」key，`wrangler pages secret put AMAP_KEY`）后，`/api/route` 走高德驾车规划；未设置或高德失败时自动回落 OSRM。高德 key 的并发 QPS 很低，多天路线会串行发送、遇限流自动重试，尽量不走兜底。返回的路线坐标统一为 GCJ02，与高德底图对齐。
- 个人数据相关的功能一律要登录：我的路书、新建 / 复制路书、编辑保存、云端书架、跨设备找回。未登录时点这些操作会先跳到账户页，登录 / 注册成功后自动接着把刚才的事做完。
- 可见性默认公开：新路书会出现在「公开路书」页，拿到链接的人都能打开。路书详情链接形如 `/{userId}/{bookId}`，`userId` 是书主的公开短 ID（账号页的「用户 ID」，由邮箱派生，不是凭证）；老链接只有 `/{bookId}` 也照常打开。在「我的路书」列表里可以把某一本切成「仅自己可见」——它随即从公开列表消失，别人再打开旧链接也读不到（服务端当成不存在），只有这本路书的 owner 能看。切回公开同理。
- 改动全程只对应同一本路书：界面先即时更新，防抖 1.4s 后写入 D1，不存在两份需要用户对照的数据。
- 退出登录会清掉这台设备上的缓存（路书、令牌、owner key）；路书仍在账号里，重新登录即可同步回来。
- 这套规则只在文档里说明，页面不做解释。

### 其他脚本

```bash
pnpm build        # 类型检查 + 构建到 dist/
pnpm preview      # 预览构建产物
pnpm lint         # oxlint
```

---

## English

The UI ships in Simplified Chinese and English; toggle it from the top-right of the header. The first visit follows your browser language and the choice is remembered. A new book's default title uses whichever language was active when it was created.

### Prerequisites

- Node.js 18+ and pnpm
- Nothing else — Wrangler brings its own local D1 (SQLite)

### First-time setup

```bash
pnpm install
pnpm wrangler login                     # authorize Wrangler once
pnpm wrangler d1 create lushu           # note the returned database_id
cp wrangler.toml.example wrangler.toml  # put database_id into wrangler.toml
pnpm db:init:local                      # create local D1 tables (once)
```

`wrangler.toml` is gitignored; only `wrangler.toml.example` is committed.

`schema.sql` is idempotent: tables use `IF NOT EXISTS` and newer fields (such as book
visibility) live inside the book JSON, so there is no separate migration script —
just run `db:init` again on an existing database.

### Run

**UI only (Vite):**

```bash
pnpm dev          # http://localhost:5173
```

Search works (`/api/geocode` is proxied to Nominatim by Vite); driving routes go through the local Worker (`/api/route`, i.e. `pnpm pages:dev` below) and fall back to a direct OSRM call in the browser when the Worker is not running. Accounts, cloud library and public books also need the Worker below.

**Full stack (real Worker + local D1):**

```bash
pnpm pages:dev    # build, then start the Worker on http://localhost:8788
```

**HMR + real D1:** run `pnpm dev` in a second terminal; Vite forwards `/api/books`, `/api/library`, etc. to the Worker on 8788 (override with `LUSHU_API`).

### Data and accounts

- Search and routing (`/api/geocode`, `/api/route`) work without signing in.
- Driving routes prefer AMap: set `AMAP_KEY` (an AMap "Web Service" key, via `wrangler pages secret put AMAP_KEY`) and `/api/route` uses AMap driving directions; when it is missing or AMap fails, the route falls back to OSRM. AMap keys have a low concurrent QPS, so multi-day routes are sent serially and retried on rate limits to avoid the fallback. Route coordinates are always returned as GCJ02 to line up with the AMap basemap.
- Personal data always requires signing in: My Books, creating / duplicating a book, editing and saving, the cloud shelf, and cross-device recovery. When signed out, those actions first jump to the account page and finish automatically once you sign in or register.
- Books are public by default: a new book shows up on the Public books page and anyone with the link can open it. A book link looks like `/{userId}/{bookId}`, where `userId` is the owner's public short ID (the "user ID" on the account page, derived from the email — not a credential); an old link with just `/{bookId}` still opens. In the My Books list you can flip a book to "only me" — it disappears from the public list and the old link stops working for everyone else (the server pretends it does not exist); only the owner can read it. Flipping it back to public works the same way.
- Storage stays local-first: the UI writes to the browser immediately, then pushes to D1 after a 1.4s debounce. Signing in only attaches local data to the account; the cloud copy is what survives a device change.
- Signing out clears the local cache (books, tokens, owner key). Cloud data stays with the account and comes back on the next sign-in.
- These rules are documented here only; the UI does not explain them.

### Other scripts

```bash
pnpm build        # type-check + build to dist/
pnpm preview      # preview the build output
pnpm lint         # oxlint
```
