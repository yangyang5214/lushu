import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 本地 `pnpm dev` 的代理：
//   /api/geocode、/api/route  → 直接打上游（不需要 Worker，纯 UI 调试也能搜地点）
//   其余 /api/*               → 转发到本地 Worker（`pnpm pages:dev`，默认 8788）
//
// 这样 `pnpm dev` 单独跑 = 纯前端 + 搜索可用；再开一个 `pnpm pages:dev` =
// 有 HMR 的完整前后端联调。两条路都是同源，所以 Worker 不需要下发 CORS 头。
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/geocode': {
        target: 'https://nominatim.openstreetmap.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/geocode/, '/search'),
        headers: {
          'User-Agent': 'LushuRoutePlanner/1.0',
          'Accept-Language': 'zh',
        },
      },
      '/api/route': {
        target: 'https://router.project-osrm.org',
        changeOrigin: true,
        rewrite: (path) => {
          const coords = new URL(path, 'http://local').searchParams.get('coords') ?? ''
          return `/route/v1/driving/${coords}?overview=full&geometries=geojson&continue_straight=false`
        },
      },
      '/api': {
        target: process.env.LUSHU_API ?? 'http://127.0.0.1:8788',
        changeOrigin: true,
      },
    },
  },
})
