# 路书 Lushu

**简体中文** ｜ [English](README.en.md)

把想去的地点搜进来，自动串成顺路的路线，在过夜处分成一天一天——几分钟整理出一本可以分享的多日自驾路书。

前端 React + Vite，后端 Cloudflare Pages Functions + D1；地图与驾车规划走高德；编辑**本地优先**，改动先落浏览器，防抖 1.4s 后写库。

[![License](https://img.shields.io/badge/license-MIT-brightgreen?style=flat-square)](LICENSE)
[![Live](https://img.shields.io/badge/live-lushu.fittools.cc-00a67e?style=flat-square)](https://lushu.fittools.cc)
[![Stars](https://img.shields.io/github/stars/yangyang5214/lushu?style=flat-square&label=stars)](https://github.com/yangyang5214/lushu/stargazers)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](tsconfig.app.json)
[![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=white)](package.json)
[![Cloudflare Pages + D1](https://img.shields.io/badge/Cloudflare-Pages%20%2B%20D1-f38020?style=flat-square&logo=cloudflare&logoColor=white)](wrangler.toml.example)

**[在线体验](https://lushu.fittools.cc)** ｜ [问题反馈](https://github.com/yangyang5214/lushu/issues) ｜ [提交记录](https://github.com/yangyang5214/lushu/commits/main)

## 目录

- [功能](#功能)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [配置](#配置)
- [部署](#部署)
- [设计要点](#设计要点)
- [配套](#配套)
- [已知限制](#已知限制)
- [参与贡献](#参与贡献)
- [许可证](#许可证)
- [致谢](#致谢)

## 功能

- **随意加点**：搜城市、寺庙、老街、营地，加进来就行，不用管顺序，也不用先想第几天。搜索走高德 POI 检索（结果缓存 3 天），Worker 没起时退化为本地地名库。
- **点地图看地点**：在路书页点地图任意一点，右侧弹出那一点最近的高德地点卡片——评分、照片（大多是用户评价图）、电话、营业时间、地址、到点击处的直线距离，附「在高德看全部评价」入口，下面还能一键换到附近其它地点。确认后按「加入路线」就落进当前路书（只读分享里没有这个动作）。
- **自动串线**：定好起点和终点，路线按驾车里程自动重排；环线可切顺时针 / 逆时针。地图按天着色、带方向箭头，点到点显示里程与驾驶时长。
- **过夜分天**：在行程尺上点珠子设过夜，或直接拖分割针，行程自动分成一天天，每天有独立里程与图例。改过夜点，天数立刻重算。
- **云端书架**：编辑先落本地，1.4s 防抖后写 D1。`/list` 管理「我的路书」，`/public` 逛别人公开的路书，卡片直接画出缩略线路。
- **分享与可见性**：`/d/{userId}/{bookId}` 链接人人可读（只读态自动去掉编辑入口）；公开 / 私密随时切，私密书对非 owner 一律返回 404。
- **账号**：邮箱 + 口令注册，邮件激活；口令 PBKDF2-SHA256 加盐存储，会话 cookie 里只有 token 摘要。界面中英双语。
- **功能介绍**：首页首屏之后逐条展开编辑页里的动作（加地点、起点终点、过夜分天、行程尺、里程与时长），每个动作配一张编辑页示意图，中英各一份文案。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | React 19 · TypeScript（strict）· Vite 8 · Zustand 5 |
| 样式 | 手写 CSS（`src/index.css`、`src/home.css`），无 UI 框架 |
| 后端 | Cloudflare Pages Functions（本质是 Worker） |
| 数据库 | Cloudflare D1（SQLite），只读 SQL 全部走参数绑定 |
| 地图 | 高德 JS API（底图 / 标记 / 图面）· 高德 Web 服务 API（POI 检索 / 周边检索 / 驾车规划） |
| 邮件 · 人机校验 | Resend（可选）· Cloudflare Turnstile（可选） |
| 工具链 | pnpm · oxlint · wrangler |

## 项目结构

```
src/            React 前端：App.tsx、store.ts、components/、lib/（amap、geocode、route、sync、i18n…）
functions/      Pages Functions：api/[[path]].ts（全部 API 路由）、lib/（auth、mail、rate-limit、admin…）
shared/         前后端共用的纯函数与类型：坐标换算、顺路排序、口令规则、公开配置、地点卡片类型
schema.sql      D1 建表脚本，可重复执行，不需要单独的迁移脚本
public/         静态资源：favicon、icons、小程序码、sitemap.xml、robots.txt
scripts/        本地开发脚本：dev.mjs 一条命令起 Vite + 本地 Worker + 本地 D1（`pnpm dev:all`）
```

## 快速开始

### 前置

- Node.js **22.12+** 与 pnpm（Vite 8 要求 `^20.19.0 || >=22.12.0`，wrangler 要求 `>=22`；版本偏低时 `vite build` 会在 `node:util` 上找不到 `styleText` 而失败）
- 无需单独装数据库：本地 D1（SQLite）由 Wrangler 自带

### 初始化（只需一次）

```bash
pnpm install
pnpm wrangler login                     # 首次用 Wrangler 需要授权
pnpm wrangler d1 create lushu           # 记下返回的 database_id
cp wrangler.toml.example wrangler.toml  # 把 database_id 填进 wrangler.toml
pnpm db:init:local                      # 建本地 D1 表
```

`wrangler.toml` 已被 gitignore，不会提交；仓库里只留 `wrangler.toml.example`。

`schema.sql` 可以重复执行：建表用 `IF NOT EXISTS`，可见性等新字段直接存在路书 JSON 里，因此没有单独的迁移脚本，老库再跑一次 `db:init` 即可。

### 启动

| 目的 | 命令 | 地址 |
| --- | --- | --- |
| **本地全栈（推荐）** | `pnpm dev:all` | 5173（HMR）+ 8788（Worker）同时起好，`/api/*` 已代理 |
| 只调界面 | `pnpm dev` | http://localhost:5173 |
| 只跑后端 | `pnpm pages:dev` | http://localhost:8788（先 build，再起 Worker） |
| 手动组合 | 一个终端 `pnpm pages:dev`，另一个 `pnpm dev` | 5173；`/api/*` 代理到 8788（可用 `LUSHU_API` 覆盖） |

`pnpm dev:all` 会自动补齐 `wrangler.toml`、幂等跑一遍 `schema.sql`、`dist/` 不存在时先 build，然后等 Worker 就绪再起 Vite，Ctrl-C 一次同时收掉两个进程。参数：`--web-port` / `--api-port` / `--skip-db-init` / `--skip-build` / `--check`（只做启动前检查）。

只跑 `pnpm dev` 时只有纯前端：搜索退化为本地地名库（`src/lib/gazetteer.ts`），路线不绘制，账号 / 我的路书 / 公开路书都不可用——搜索和驾车路线只用高德，需要 Worker 并在其中配好 `AMAP_KEY`。

### 常用脚本

```bash
pnpm dev:all      # 一键起本地全栈（Vite + Worker + D1），日常开发用这个
pnpm build        # 类型检查（前端 + functions）+ 构建到 dist/
pnpm lint         # oxlint
pnpm preview      # 预览构建产物
pnpm db:init:local / pnpm db:init   # 初始化本地 / 线上 D1 表
pnpm deploy       # 部署到 Cloudflare Pages
```

## 配置

前端公开变量写在 `wrangler.toml` 的 `[vars]` 里，构建时注入 bundle（见 `vite.config.ts`）；密钥不进前端代码，本地放 `.dev.vars`，线上用 `wrangler pages secret put`。

### 公开变量（`[vars]`）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `AMAP_JS_KEY` | 空 | 高德「Web端(JS API)」key，底图 / 标记 / 路线图面都靠它渲染，**必须配置**。这是公开 key（会出现在前端），建议在高德控制台给它绑定站点域名白名单。 |
| `AMAP_SECURITY_CODE` | 空 | 可选，JS API 2.0 安全密钥（控制台里的「安全密钥」），用到插件能力时才需要。 |
| `TURNSTILE_SITE_KEY` | 空 | 可选，Cloudflare Turnstile site key；配了才在注册 / 登录启用前端人机校验。 |
| `MAX_BOOKS` | `20000` | 全站路书数软上限，`0` = 不限。防止被刷满 D1 的 5 GB 额度。 |
| `MAX_DOC_BYTES` | `262144` | 单本路书 JSON 体积上限（约 300 个地点）。 |

### 密钥（Secrets）

| 名称 | 必填 | 用途 |
| --- | --- | --- |
| `AMAP_KEY` | 是（搜索 / 路线） | 高德「Web 服务」key，**不是**上面那个 JS API key。`/api/places`（搜索）、`/api/poi`（点地图看地点）与 `/api/route`（驾车规划）都只用高德，未配置时这几个接口返回 5xx。支持用 `;` 配多个（`key1;key2`）：按顺序轮换分摊配额，单个失败自动换下一个。 |
| `ADMIN_SECRET` | 否 | 管理后台 `/admin` 口令，至少 6 字符；未设置或过短时 `/api/admin/*` 一律 404（后台等于不存在）。 |
| `RESEND_API_KEY` | 否 | 发送注册激活邮件；不配则注册流程不可用。 |
| `TURNSTILE_SECRET` | 否 | 注册 / 登录 / 重发激活的人机校验；配了即强制校验。 |
| `EMAIL_FROM` | 否 | 发件人，默认 `路书 <onboarding@resend.dev>`；换自家域名前先在 Resend 里验证域名。 |
| `SESSION_TTL_DAYS` | 否 | 登录态有效期（天），默认 `30`。 |

设置方式：

```bash
pnpm secret:amap        # = wrangler pages secret put AMAP_KEY
pnpm secret:resend      # = wrangler pages secret put RESEND_API_KEY
pnpm secret:turnstile   # = wrangler pages secret put TURNSTILE_SECRET
# 其他 secret 直接 wrangler pages secret put <NAME>；本地开发写 .dev.vars
```

> 鉴权入口（登录 / 注册 / 重发激活信 / 管理登录）基于 D1 `rate_limits` 表限流，老库升级后请重跑一次 `pnpm db:init`（或 `pnpm db:init:local`）建表。
> 另外建议在 Cloudflare 控制台给 `/api/*` 加一条免费的速率限制规则，挡在最外层。

其余可调参数见 `wrangler.toml.example`。

## 部署

```bash
pnpm build        # tsc -b && tsc -p functions/tsconfig.json && vite build
pnpm deploy       # wrangler pages deploy dist
```

- D1 绑定：`wrangler.toml` 里填 `database_id`；Pages 项目也要在 Settings → Functions → D1 bindings 配同样的绑定。
- Git 接入的 Pages 构建读不到被 gitignore 的 `wrangler.toml`，前端会在运行时向 `GET /api/config` 取公开变量；也可以把 `AMAP_JS_KEY` / `AMAP_SECURITY_CODE` 用 `wrangler pages secret put` 配成变量。
- 首次部署后跑一次 `pnpm db:init` 建线上表。

## 设计要点

- **本地优先**：编辑先落浏览器，1.4s 防抖后写 D1（`src/lib/sync.ts`）；带 `baseUpdatedAt` 的写入会拿到 409 冲突而不是静默覆盖。
- **同源防线**：仓库公开意味着端点形状全公开，所以防线都在服务端——不下发 CORS 头、新建必须登录、全站容量与单本体积双上限、口令 PBKDF2-SHA256 加盐迭代、会话 cookie 只存 token 摘要、上游 host 写死（无 SSRF）、恒定时间比较、id 形态校验。
- **坐标系**：存储统一 WGS84，高德底图与路线用 GCJ02，转换集中在 `shared/coords.ts`。
- **点地图看地点**：查询走高德周边检索（v5 place/around），半径随视野放大；结果坐标是 GCJ02（底图坐标系），查询本身不写库，只有用户选「加入路线」时才转成 WGS84 落进路书；同一点附近的结果缓存 1 天。
- **驾车节流**：所有驾车请求先过一道 3 次/秒的排队闸口（`AMAP_DRIVE_QPS`），避免自己把自己打出上游限流；遇 10004 / 10020 按退避重试并换 key。
- **可见性**：新建默认 private；缺字段的老数据当 public；private 不进公开列表，对非 owner 一律 404（不泄露存在性）。

## 配套

- **微信小程序**：站点 `/mp` 页介绍配套小程序（gpx merge）——手机上看当天行程、点地点直接导航。

## 已知限制

- 路线**只支持驾车**（高德驾车规划），没有步行 / 骑行 / 公交。
- 没配 `AMAP_KEY` 时搜索退化为本地地名库、不绘制路线；站点不回落其他地图源。
- 驾车请求全站 3 次/秒（每个 isolate 各自限流），地点特别多时首次串线要排队。
- 单本路书 ≤ `MAX_DOC_BYTES`，全站路书数 ≤ `MAX_BOOKS`。
- 高德开放平台没有公开「评价正文」接口：点地图弹出的卡片只有评分、评价照片和跳转入口，评价全文要到高德页面看。
- 跑在 Cloudflare 免费档（Pages + 单库 D1）。

## 参与贡献

- 改动后确保 `pnpm build` 退出码为 0（`tsc -b && tsc -p functions/tsconfig.json && vite build`），`src/` 与 `functions/` 两边都要过类型检查；`pnpm lint`（oxlint）可选。
- 不需要为此起 dev server 或浏览器。
- PR 会自动跑同一套检查（`.github/workflows/pr.yml`：`pnpm lint` + `pnpm build`，Node 22 + pnpm 10）；草稿 PR 不跑，标记 ready for review 后才跑。
- 提交信息沿用现有风格（Conventional Commits，如 `feat(sidebar): …`、`fix(search): …`）。
- 守住这条边界：搜索与路线规划不登录也能用，个人数据（我的路书、新建 / 复制路书、编辑保存、云端书架）必须登录后才能用；页面不提示，只在文档里写明。
- 服务端新增任何写入路径都要做输入校验与鉴权，上游 host 必须写死。
- Bug 与需求走 [Issues](https://github.com/yangyang5214/lushu/issues)，请附复现步骤；涉及地图或路线时说明是否配置了 `AMAP_KEY`。

## 许可证

[MIT](LICENSE) © 2026 lxa：可以自由使用、复制、修改、合并、发布、分发、再许可和销售，**包括商业用途**，只需在副本或实质性部分中保留版权与许可声明。软件按「原样」提供，不带任何担保。线上 `lushu.fittools.cc` 只是作者自部署的一个实例，不在本许可的授权范围内；高德、Resend、Cloudflare 等第三方服务另受各自条款约束。

## 致谢

[Cloudflare Pages / D1 / Turnstile](https://developers.cloudflare.com/) · [高德开放平台](https://lbs.amap.com/) · [React](https://react.dev/) · [Vite](https://vite.dev/) · [Zustand](https://zustand.docs.pmnd.rs/) · [Resend](https://resend.com/) · [oxlint](https://oxc.rs/)
