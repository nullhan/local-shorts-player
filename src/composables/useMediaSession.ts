import { onBeforeUnmount, watch } from 'vue'

import { seekBy, togglePlay, videoDuration, videoPaused, videoTime } from '@/composables/useVideoControl'
import { usePlayerStore } from '@/store/player'
import { titleFromFileName } from '@/utils/media'

/**
 * 移动端的两块系统级集成，放在一起是因为它们都由「是否正在播放」驱动。
 *
 * 1) **Media Session**：把当前曲目 + 封面 + 播放状态交给系统，
 *    锁屏 / 通知栏 / 耳机按键 / 车机就都能控制，不用装 App。
 *    Chrome(Android) / Safari(iOS 15+) 可用；不支持时静默跳过。
 *
 * 2) **Wake Lock**：手机上听歌时屏幕会自己灭。听视频无所谓，
 *    但音频场景频繁点亮屏幕很烦（而且音频往往一放就是几十分钟）。
 *    用 Screen Wake Lock API 保持常亮，页面隐藏时浏览器会自动释放，回来再申请。
 *
 * 两者都做了能力探测，桌面浏览器 / 老浏览器上就是 no-op。
 */

type MediaSessionAction = 'play' | 'pause' | 'previoustrack' | 'nexttrack' | 'seekbackward' | 'seekforward' | 'seekto' | 'stop'

interface WakeLockSentinelLike {
  released: boolean
  release(): Promise<void>
  addEventListener(type: 'release', listener: () => void): void
}

export function useMediaSession() {
  const store = usePlayerStore()

  const supported = typeof navigator !== 'undefined' && 'mediaSession' in navigator
  const wakeSupported =
    typeof navigator !== 'undefined' && 'wakeLock' in navigator && Boolean(navigator.wakeLock)

  let wakeLock: WakeLockSentinelLike | null = null
  let wakeWanted = false

  /* ---------------- Wake Lock ---------------- */

  async function acquireWakeLock() {
    if (!wakeSupported || wakeLock || !wakeWanted) return
    try {
      wakeLock = (await (
        navigator as Navigator & {
          wakeLock: { request(type: 'screen'): Promise<WakeLockSentinelLike> }
        }
      ).wakeLock.request('screen')) as WakeLockSentinelLike
      // 系统可能在切后台 / 省电时主动回收，置空后等 visibilitychange 再申请
      wakeLock.addEventListener('release', () => {
        wakeLock = null
      })
    } catch {
      /* 用户拒绝 / 电量过低等，忽略即可 */
    }
  }

  async function releaseWakeLock() {
    const current = wakeLock
    wakeLock = null
    try {
      await current?.release()
    } catch {
      /* 已经释放过会抛，忽略 */
    }
  }

  function syncWakeLock() {
    // 只有「开着开关 + 音乐模式 + 正在播放」才需要常亮；
    // 视频场景用户自己在看，不需要也不应该阻止息屏。
    wakeWanted = store.keepAwake && store.isMusicMode && !videoPaused.value
    if (wakeWanted) void acquireWakeLock()
    else void releaseWakeLock()
  }

  function onVisibilityChange() {
    // 回到前台时如果仍然需要，重新申请（浏览器在隐藏时已自动释放）
    if (document.visibilityState === 'visible') syncWakeLock()
  }

  /* ---------------- Media Session ---------------- */

  function setActionHandlers() {
    if (!supported) return
    const session = navigator.mediaSession

    const handlers: Array<[MediaSessionAction, (() => void) | null]> = [
      ['play', () => togglePlay()],
      ['pause', () => togglePlay()],
      ['previoustrack', () => store.prev()],
      ['nexttrack', () => store.next()],
      ['seekbackward', () => seekBy(-store.seekStep)],
      ['seekforward', () => seekBy(store.seekStep)],
      ['stop', () => store.closePanel()]
    ]

    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler)
      } catch {
        /* 个别动作不被支持会抛，跳过即可 */
      }
    }

    // seekto 需要读事件里的目标秒数（耳机 / 车机拖动进度条会用到）
    try {
      session.setActionHandler('seekto', (details) => {
        const time = details?.seekTime
        if (typeof time === 'number') seekBy(time - videoTime.value)
      })
    } catch {
      /* 忽略 */
    }
  }

  function syncMetadata() {
    if (!supported || !store.mediaSession) return
    const item = store.current
    if (!item) {
      navigator.mediaSession.metadata = null
      return
    }

    const isAudio = store.isMusicMode
    navigator.mediaSession.metadata = new MediaMetadata({
      title: titleFromFileName(item.name),
      artist: item.parentPath || (isAudio ? '本地音乐' : '本地视频'),
      album: store.activeSource?.name || '本地媒体'
    })
  }

  function syncPlaybackState() {
    if (!supported) return
    navigator.mediaSession.playbackState = videoPaused.value ? 'paused' : 'playing'
  }

  function syncPositionState() {
    if (!supported) return
    const session = navigator.mediaSession
    if (typeof session.setPositionState !== 'function') return
    const duration = videoDuration.value
    if (!Number.isFinite(duration) || duration <= 0) return
    try {
      session.setPositionState({
        duration,
        playbackRate: store.playbackRate,
        position: Math.min(Math.max(videoTime.value, 0), duration)
      })
    } catch {
      /* 位置越界等会抛，忽略 */
    }
  }

  /* ---------------- 绑定 ---------------- */

  setActionHandlers()

  watch(
    () => store.currentId,
    () => {
      syncMetadata()
      syncPositionState()
      syncWakeLock()
    },
    { immediate: true }
  )

  watch(videoPaused, () => {
    syncPlaybackState()
    syncWakeLock()
  })

  watch(
    () => store.isMusicMode,
    () => {
      syncMetadata()
      syncWakeLock()
    }
  )

  watch(
    () => store.keepAwake,
    () => syncWakeLock()
  )

  watch(
    () => store.mediaSession,
    () => {
      if (store.mediaSession) {
        setActionHandlers()
        syncMetadata()
        syncPlaybackState()
      } else if (supported) {
        // 关掉开关就交还控制权，避免系统控制条还残留着旧信息
        navigator.mediaSession.metadata = null
      }
    }
  )

  document.addEventListener('visibilitychange', onVisibilityChange)

  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    void releaseWakeLock()
  })

  return { supported, wakeSupported }
}
