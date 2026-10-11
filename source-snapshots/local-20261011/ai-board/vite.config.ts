import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// 前端 dev server 同时代理 REST(/api) 与 WebSocket(/ws) 到 Node 后端(PORT=3001)
export default defineConfig({
  plugins: [react()],
  // 依赖预构建缓存放到非 node_modules 目录，避免 vite dev 启动时 rm 缓存误触沙箱对 node_modules 的保护
  cacheDir: '.vite-cache',
  build: {
    // 构建产物输出到 out/（与遗留的 fde-demo dist/ 隔离，避免清空时误触 node_modules 软链）
    outDir: 'out',
    // 关闭自动清空：vite 的 emptyDir 会递归 rm，在沙箱中会误触 node_modules 软链被拦截。
    // 改用 out/ 作为独立产物目录，需要清理时手动删除 out/ 即可（不会触碰 node_modules）。
    emptyOutDir: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
