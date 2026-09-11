# 项目规则（AGENTS.md）

## 硬性禁止

- **禁止调用任何 Chrome / Chromium / 浏览器命令**（如 `chrome`、`google-chrome`、`chromium`、`open -a "Google Chrome"`、headless 截图、Puppeteer/Playwright 启动浏览器等）。不要用浏览器做验证、截图或调试。

## 验证方式

- **改动完成后，只要构建通过即可**：运行 `pnpm build`（= `tsc -b && tsc -p functions/tsconfig.json && vite build`），exit code 为 0 即视为验证通过。
- 不要为此启动 dev server、浏览器或任何交互式进程；不要自行部署（`pnpm deploy`、`wrangler pages deploy`）。
- 如需额外静态检查，可运行 `pnpm lint`（oxlint），但它不是必需的通过条件。

## 代码约定

- TypeScript 严格模式；前端 `src/`，Pages Function 在 `functions/`（两个 tsconfig 都会在 build 中检查，两边都要过）。
- 云函数与前端共享类型时，类型定义放在双方都能引用的位置，避免 `functions/` 反向依赖 `src/` 的运行时文件。
- 数据流：本地优先（浏览器先落数据），防抖 1.4s 后写 D1。新增写入路径时保持这个模式。
- 个人数据（我的路书、新建 / 复制路书、编辑保存、云端书架）必须登录后才能使用；搜索、路线规划不登录也能用。这条规则只写在文档里，页面不提示。
- 本地只需 `cp wrangler.toml.example wrangler.toml` 并填入 D1 `database_id`（`wrangler.toml` 已 gitignore）。密钥只在部署时用 `wrangler pages secret put`，不要在前端代码里写任何“暗号”或密钥。
- 服务端必须做输入校验与鉴权（如新建路书需登录），上游 host 写死防止 SSRF。
