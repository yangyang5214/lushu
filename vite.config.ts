import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 前端公开变量（高德 JS API key / 安全密钥、Turnstile site key）统一放在 wrangler.toml 的
// [vars] 里，构建时注入到 bundle —— 不再用 .env 之类的额外文件。
// 没有 wrangler.toml（例如只 checkout 了仓库）时退回读 wrangler.toml.example，值是空。
function loadVars(): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const file of ['wrangler.toml', 'wrangler.toml.example']) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    let inVars = false
    const seen = new Set<string>()
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      if (line.startsWith('[')) {
        inVars = /^\[\s*vars\s*\]/.test(line)
        continue
      }
      if (!inVars) continue
      const hit = line.match(/^([A-Za-z0-9_]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/)
      if (!hit) continue
      // 同一文件里重复定义 = 非法 TOML，wrangler 会直接报错；这里也必须失败，
      // 否则会静默取到「第一次」出现的旧值（比如已被回收的高德 key）。
      if (seen.has(hit[1])) {
        throw new Error(
          `${file}: [vars].${hit[1]} 重复定义了，请只保留一处（重复定义会让 wrangler 无法解析该文件）。`,
        )
      }
      seen.add(hit[1])
      if (!(hit[1] in vars)) vars[hit[1]] = (hit[2] ?? hit[3] ?? '').trim()
    }
  }
  return vars
}

const vars = loadVars()

// 本地 `pnpm dev` 的代理：
//   /api/*   → 转发到本地 Worker（`pnpm pages:dev`，默认 8788）。搜索、驾车路线都走高德，
//              需要在 Worker 侧配好 AMAP_KEY；Worker 未起时路线不画、搜索只剩本地地名库。
//   地图图面：用高德 JS API 渲染，key 取 wrangler.toml 的 [vars].AMAP_JS_KEY。
//
// 这样 `pnpm dev` 单独跑 = 纯前端 + 本地地名库搜索；再开一个 `pnpm pages:dev` =
// 有 HMR 的完整前后端联调（搜索 / 路线走真实高德）。两条路都是同源，Worker 不需要 CORS 头。
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_AMAP_JS_KEY': JSON.stringify(vars.AMAP_JS_KEY ?? ''),
    'import.meta.env.VITE_AMAP_SECURITY_CODE': JSON.stringify(vars.AMAP_SECURITY_CODE ?? ''),
    'import.meta.env.VITE_TURNSTILE_SITE_KEY': JSON.stringify(vars.TURNSTILE_SITE_KEY ?? ''),
  },
  server: {
    proxy: {
      '/api': {
        target: process.env.LUSHU_API ?? 'http://127.0.0.1:8788',
        changeOrigin: true,
      },
    },
  },
})
