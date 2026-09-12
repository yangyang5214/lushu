import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 本地 `pnpm dev` 的代理：
//   /api/geocode  → 直接打 Nominatim（不需要 Worker，纯 UI 调试也能搜地点）
//   /api/places   → 转发到本地 Worker（高德 POI 检索；Worker 没起或没配 AMAP_KEY 时
//                   前端自动回落到 Photon + /api/geocode）
//   其余 /api/*   → 转发到本地 Worker（`pnpm pages:dev`，默认 8788）
//
// 驾车路线统一交给本地 Worker 处理（和线上同一套代码：优先高德、限流自动重试、
// 失败回落 OSRM）。Worker 没起时 /api/route 会报错，浏览器侧会自动直连 OSRM 兜底，
// 所以纯 UI 调试也还能看到路线。
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
      '/api': {
        target: process.env.LUSHU_API ?? 'http://127.0.0.1:8788',
        changeOrigin: true,
      },
    },
  },
})
