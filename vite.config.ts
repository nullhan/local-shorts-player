import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * GitHub Pages 的项目页地址是 https://<user>.github.io/<repo>/，
 * 资源路径必须带上 /<repo>/ 前缀，否则浏览器会去请求
 * https://<user>.github.io/assets/index-xxx.js 而 404（表现为白屏）。
 *
 * 只在构建时加前缀：本地 dev 仍留在根路径，开发时不必手敲 /local-shorts-player/。
 * （路由用的是 hash 模式，页面路径不会变，所以不需要任何 404 重写规则。）
 */
const REPO_NAME = 'local-shorts-player'

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? `/${REPO_NAME}/` : '/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5188,
    host: '0.0.0.0',
    open: true
  }
}))
