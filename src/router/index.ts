import { createRouter, createWebHashHistory } from 'vue-router'

import ImportView from '@/views/home/ImportView.vue'
import PlayerView from '@/views/player/PlayerView.vue'

const router = createRouter({
  // 纯本地应用，用 hash 模式便于直接双击 index.html 或任意静态服务器托管
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'import',
      component: ImportView
    },
    {
      path: '/play',
      name: 'play',
      component: PlayerView
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: { name: 'import' }
    }
  ]
})

export default router
