import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 本地 `pnpm dev` 的代理：
//   /api/*   → 转发到本地 Worker（`pnpm pages:dev`，默认 8788）。搜索、驾车路线都走高德，
//              需要在 Worker 侧配好 AMAP_KEY；Worker 未起时路线不画、搜索只剩本地地名库。
//
// 这样 `pnpm dev` 单独跑 = 纯前端 + 本地地名库搜索；再开一个 `pnpm pages:dev` =
// 有 HMR 的完整前后端联调（搜索 / 路线走真实高德）。两条路都是同源，Worker 不需要 CORS 头。
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.LUSHU_API ?? 'http://127.0.0.1:8788',
        changeOrigin: true,
      },
    },
  },
})
