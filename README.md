# 路书

1. **搜地点，可一直加。**
2. **定起点和终点。** 其余点按路程自动串起来。起终点是同一个地方，就当成环线，最后一天回到起点。
3. **在中间任意点设分割针。** 针钉在过夜地，一天就在这里切开。针可以在行程尺上拖到别的点，天数和地图颜色会跟着走。

打开先看到「我的路书」列表，每本路书都有独立的地址：`/<id>`（如 `/abbe26963b3f90f90b8ea659`），可直接收藏或分享；列表页在 `/`。

## 架构

```
Cloudflare Pages  ── 托管 dist/ 静态资源（免费不限量）
      │
      └── /api/*  ── Pages Function（底层是 Worker）  functions/api/[[path]].ts
                        │
                        └── D1 (SQLite)  ── 一本路书一行
```

本地优先：界面永远即时响应，数据先落浏览器，再**防抖 1.4 秒**推到 D1。这样一天几万次编辑也花不了几次写入额度。

### 免费额度

计费只跟 `rows read / rows written / storage` 有关，**表和数据库数量不收费**。

| 资源 | 免费额度 | 这里的用途 |
|---|---|---|
| Pages 静态请求 | 不限量 | 页面、JS、CSS、图片 |
| Workers 请求 | 10 万/天 | 只用于 `/api/*`（`public/_routes.json` 排除静态资源） |
| D1 rows read | 500 万/天 | 打开一本 = 1 行 |
| D1 rows written | 10 万/天 | 一次编辑会话约 1–3 行 |
| D1 storage | 5 GB（单库 500 MB，免费 10 个库） | 约 3 KB/本，可存十几万本 |

> 关键取舍：没用 Workers KV。KV 免费档只有 **1,000 写/天**，编辑型应用会瞬间打满；D1 有 10 万写/天。

## 开源项目的暴露面

仓库公开 = 端点形状、鉴权规则、限额实现全部公开；前端 bundle 也是公开的。**所以客户端里放任何"暗号"都没用**，防线必须在服务端和边缘。

| 暴露点 | 风险 | 处理 |
|---|---|---|
| 新建路书无需凭证（任意未占用的 id 即可 claim） | 脚本批量刷，耗尽 10 万写/天、塞满 5 GB | ① 边缘速率限制 ② 可选 Turnstile ③ `MAX_BOOKS` 软上限 |
| `geocode` / `route` 是开放代理 | 别人白嫖你的 Worker 请求额度 | 上游 host 写死（无 SSRF）+ 入参严格校验 + 边缘限速 |
| 曾下发 CORS `*` | 任意网站能用访客浏览器打 API | **已移除**，只服务同源 |
| `database_id` 提交在 `wrangler.toml` | 无实际风险 | 它只是账号内标识，没有账号凭证无法访问，正常提交 |
| `.env`（本地密钥） | 真密钥泄露 | **已 gitignore**，仓库里只留 `.env.example` |
| book id 可枚举 | 读到别人的路书 | 96-bit 随机 24-hex，不可枚举 |

三层防护，按重要性排序：

1. **边缘速率限制（零代码，必做）** —— 免费档就能配。控制台 → Security → WAF → Rate limiting rules：
   - 表达式：`starts_with(http.request.uri.path, "/api/")`
   - 计数维度：IP；阈值：如 60 次 / 1 分钟；动作：Block，10 秒
   - 这一条就能挡住绝大多数刷接口行为。
2. **Turnstile（可选，只在"新建"那一步）** —— 免费、服务端校验，公开仓库不削弱它。配了才启用，见部署第 3 步。
3. **应用层软上限** —— `MAX_BOOKS` 全局名额 + `MAX_DOC_BYTES` 单本体积。即使前两层被绕过，也刷不满 5 GB。

### 安全模型

沿用「链接即凭证」，但读和写分开：

| 凭证 | 存放位置 | 作用 |
|---|---|---|
| `book.id`（24-hex） | URL 里 | 公开**只读**凭证，拿到链接就能看 |
| `edit_token` | 创建者浏览器 localStorage | **写**权限，永不进 URL |
| `owner_key`（书架密钥） | 本机 localStorage | 「我的路书」列表；同密钥的设备可直接编辑 |

- 别人打开分享链接 → 只读，界面显示「只读分享」。
- 换设备：把 `owner_key` 复制过去，云端书架就会出现；不导入也能看别人分享的链接。
- 冲突用乐观并发：推送带 `baseUpdatedAt`，服务端发现云端更新过就返回 `409`，界面让你选「用云端 / 留本地」。

## 本地调试

两种模式，按需选：

**只调界面（最快，无需 Cloudflare）：**

```bash
pnpm install
pnpm dev
```

`/api/geocode`、`/api/route` 由 Vite 代理直连上游，所以搜索、路线都能用；云端同步会静默降级为「仅本地」，徽章显示 `仅本地`。

**完整前后端（真实 Worker + 本地 D1）：**

```bash
pnpm db:init:local   # 建本地表，只需一次
pnpm pages:dev       # 自动 build + 起 Worker，http://localhost:8788
```

**想要 HMR + 真实 D1：** 再开一个终端跑 `pnpm dev` 即可。Vite 会把 `/api/books`、`/api/library` 转发到 8788 的本地 Worker（可用 `LUSHU_API` 覆盖地址）。两条路都是同源，所以 Worker 不需要 CORS。

**本地配置：一个 `.env` 喂两边。** `pnpm dev` / `pnpm pages:dev` 启动时会自动从 `.env.example` 生成 `.env`（已被 gitignore），所以 clone 下来直接能跑。填好后：

- `VITE_TURNSTILE_SITE_KEY` 给前端（只有 `VITE_` 前缀会进浏览器 bundle）；
- `TURNSTILE_SECRET` / `MAX_BOOKS` / `MAX_DOC_BYTES` 通过 `--env-file=.env` 注入本地 Worker。

联调 Turnstile 用官方测试密钥即可永远通过，把 `.env` 里两行取消注释、填上测试值即可：

```dotenv
VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET=1x0000000000000000000000000000000AA
```

两个必须成对启用。没配 `TURNSTILE_SECRET` 时，Worker 就完全不校验。非 `VITE_` 前缀的变量 Vite 不会注入前端（可用 `pnpm build` 后 grep bundle 自检）。

> 本机若设置了 `all_proxy` 之类的代理变量，`wrangler dev` 的出网请求可能不走代理，导致 `/api/geocode`、`/api/route` 超时。前端对这两个接口都有兜底；部署到 Cloudflare 边缘后不存在这个问题。

## 部署

```bash
# 1. 建库，把返回的 database_id 填进 wrangler.toml
pnpm wrangler d1 create lushu

# 2. 建表（远端）
pnpm db:init

# 3.（可选）启用 Turnstile：
#    a. 控制台建 widget，拿到 site key 和 secret
#    b. 在 Pages 项目设置里加构建变量 VITE_TURNSTILE_SITE_KEY=<site key>
#       （构建期注入前端；本地调试就写在 .env 里）
#    c. 把 secret 写进 Worker（运行时用，不进前端）：
pnpm secret:turnstile

# 4. 构建并部署
pnpm build
pnpm deploy
```

部署后别忘了配第 1 条**边缘速率限制规则**（见上文「三层防护」）。

`wrangler.toml` 里的 `pages_build_output_dir = "dist"` 会让它成为 **local / preview / production 的唯一配置来源**，D1 绑定会自动生效，无需再去控制台点一遍。密钥不要写进 `wrangler.toml`，用 `pages secret put`。

SPA 回退：Pages 在**没有** top-level `404.html` 时会自动把所有未知路径交给 `index.html`。所以不要加 `_redirects` 的 `/* /index.html 200`，那会触发 infinite-loop 警告。

## API

| 方法 | 路径 | 授权 | 说明 |
|---|---|---|---|
| GET | `/api/books/:id` | 无 | 读一本（id 必须是 24-hex） |
| PUT | `/api/books/:id` | `X-Edit-Token` 或 `X-Owner-Key` | 写一本；`baseUpdatedAt` 不匹配返回 409 冲突 |
| DELETE | `/api/books/:id` | 同上 | 删一本 |
| GET | `/api/library` | `X-Owner-Key` | 我的书架摘要（最多 200 条） |
| GET | `/api/geocode?q=` | 无 | Nominatim 代理，边缘缓存 7 天 |
| GET | `/api/route?coords=` | 无 | OSRM 代理，边缘缓存 6 小时 |

新建（PUT 到一个不存在的 id）时的额外约定：

- 配了 `TURNSTILE_SECRET` → 必须带 `X-Turnstile-Token`，否则 `428`，校验失败 `403`。
- 超出 `MAX_BOOKS` → `503 { error: "capacity" }`，前端显示「服务已满」，改动保留在本机。

## 数据

本地存储在浏览器（zustand persist，key `lushu-v1`），云端：

```sql
CREATE TABLE books (
  id TEXT PRIMARY KEY,      -- 24-hex 只读凭证
  doc TEXT NOT NULL,        -- Book JSON
  edit_token TEXT NOT NULL, -- 写权限
  owner_key TEXT,           -- 书架密钥
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE stats (        -- 全局名额软上限，只在新建/删除时动一行
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0
);
```
