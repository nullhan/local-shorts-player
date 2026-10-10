import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import './assets/main.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')

/**
 * 注册媒体 Service Worker。
 *
 * 只在 https / localhost 下注册（其它环境浏览器直接拒绝）。
 * 它的作用是让移动端后台/锁屏播放更稳（见 public/media-sw.js），
 * 注册失败不影响任何功能，所以整段静默处理。
 */
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}media-sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(() => undefined)
  })
}
