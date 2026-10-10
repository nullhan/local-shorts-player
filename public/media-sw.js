/// <reference lib="webworker" />
/**
 * Service Worker —— 只为「移动端后台播放」这一件事存在。
 *
 * 移动端浏览器在页面切到后台 / 锁屏一段时间后会挂起页面，此时：
 * - Media Session 的锁屏信息还在，但按键事件要等页面被唤醒才能处理
 * - 网络中断或页面被回收时，播放会直接断掉
 *
 * 这里用 Service Worker 接管 fetch，对音视频请求做 **Range 透传 + 缓存兜底**：
 * 同一首歌曲在服务端不支持 Range 的情况下也能靠 Cache 续上，
 * 并且让浏览器把媒体请求视为可被 SW 处理，减少被直接丢弃的概率。
 *
 * 刻意做得很保守：
 * - 只处理 GET 且目标是媒体扩展名（其余请求一律放行，不干扰页面）
 * - 不做全量预缓存（会浪费流量），只缓存「完整拉取过的」响应
 * - 失败时静默回退到网络，绝不让 SW 成为新的故障点
 */

const CACHE = 'lsp-media-v1'
/** 只有这些扩展名才走 SW，其余请求完全不碰 */
const MEDIA_EXT = /\.(mp3|m4a|aac|flac|wav|ogg|oga|opus|mp4|m4v|webm|mov|mkv)$/i

self.addEventListener('install', () => {
  // 新版立即接管，避免等旧标签页全部关闭
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      await self.clients.claim()
    })()
  )
})

/**
 * 判断响应是否值得放进缓存。
 * 只收「完整的 200」：partial (206) 只有半截，缓存了反而会让后续播放读到残缺数据。
 */
function isCacheable(response) {
  if (!response || response.status !== 200) return false
  if (response.headers.get('Content-Range')) return false
  return true
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }
  // blob: 是页面内存里的本地文件，交给浏览器自己处理（SW 也拿不到）
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return
  if (!MEDIA_EXT.test(url.pathname)) return

  event.respondWith(
    (async () => {
      // 带 Range 的请求直接放行：分片请求交给网络，缓存半截反而会坏掉进度条
      if (request.headers.has('range')) {
        return fetch(request)
      }

      const cache = await caches.open(CACHE)
      const hit = await cache.match(request)
      if (hit) return hit

      try {
        const response = await fetch(request)
        if (isCacheable(response)) {
          // clone 后异步写缓存，不阻塞本次响应
          const copy = response.clone()
          void cache.put(request, copy).catch(() => undefined)
        }
        return response
      } catch (error) {
        // 网络挂了但有缓存的话还能放
        const fallback = await cache.match(request)
        if (fallback) return fallback
        throw error
      }
    })()
  )
})
