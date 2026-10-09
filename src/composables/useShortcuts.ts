import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

import { seekBy, togglePlay } from '@/composables/useVideoControl'
import { usePlayerStore } from '@/store/player'
import type { ActionId } from '@/types'
import { buildIndex, comboFromEvent } from '@/utils/keymap'

const WHEEL_THRESHOLD = 24
const WHEEL_LOCK_MS = 260
const WHEEL_RESET_MS = 180

/** 按住 Shift 时进度动作的步长倍数 */
const SEEK_BOOST = 3

/**
 * 抖音式滚轮切换：
 * - 累积 deltaY，越过阈值才切一次，避免触控板一次滑动连切
 * - 切完加锁，锁期内忽略后续滚动
 */
export function useWheelNavigate(target: Ref<HTMLElement | null>) {
  const store = usePlayerStore()
  const accumulator = ref(0)

  let lockedUntil = 0
  let resetTimer: number | undefined

  function onWheel(event: WheelEvent) {
    // 面板打开时不抢滚轮，交还给面板内部滚动
    if (store.activePanel) return
    if ((event.target as HTMLElement)?.closest('input, textarea, .scrollable')) return
    if (Math.abs(event.deltaY) < 1) return
    event.preventDefault()

    const now = Date.now()
    if (now < lockedUntil) return

    accumulator.value += event.deltaY

    if (resetTimer) window.clearTimeout(resetTimer)
    resetTimer = window.setTimeout(() => {
      accumulator.value = 0
    }, WHEEL_RESET_MS)

    if (Math.abs(accumulator.value) < WHEEL_THRESHOLD) return

    const direction = accumulator.value > 0 ? 1 : -1
    accumulator.value = 0
    lockedUntil = now + WHEEL_LOCK_MS

    if (direction > 0) store.next()
    else store.prev()
  }

  onMounted(() => {
    target.value?.addEventListener('wheel', onWheel, { passive: false })
  })

  onBeforeUnmount(() => {
    target.value?.removeEventListener('wheel', onWheel)
    if (resetTimer) window.clearTimeout(resetTimer)
  })
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable
}

/**
 * 全局键盘快捷键。
 *
 * 所有按键都走 store.keymap（用户可在设置里改），这里只负责
 * 「组合键 → 动作 → 执行」的分发，不再硬编码具体按键。
 */
export function useKeyboardShortcuts(options: { container: Ref<HTMLElement | null> }) {
  const store = usePlayerStore()

  function toggleFullscreen() {
    const el = options.container.value
    if (!el) return
    if (document.fullscreenElement) {
      void document.exitFullscreen()
      store.showFeedback('退出全屏', 'info', 'toast')
    } else {
      void el.requestFullscreen?.()
      store.showFeedback('进入全屏（Esc 退出）', 'info', 'toast')
    }
  }

  function run(action: ActionId, boosted: boolean) {
    switch (action) {
      case 'prevVideo':
        store.prev()
        break

      case 'nextVideo':
        store.next()
        break

      case 'seekBackward': {
        const step = store.seekStep * (boosted ? SEEK_BOOST : 1)
        const actual = seekBy(-step)
        store.showSeekOsd(actual || -step)
        break
      }

      case 'seekForward': {
        const step = store.seekStep * (boosted ? SEEK_BOOST : 1)
        const actual = seekBy(step)
        store.showSeekOsd(actual || step)
        break
      }

      case 'volumeUp':
        store.adjustVolume(store.VOLUME_STEP)
        break

      case 'volumeDown':
        store.adjustVolume(-store.VOLUME_STEP)
        break

      case 'togglePlay': {
        const next = togglePlay()
        if (next) store.pulsePlay(next)
        break
      }

      case 'toggleMute':
        store.toggleMute()
        break

      case 'rateUp':
        store.setPlaybackRate(store.playbackRate + 0.25)
        break

      case 'rateDown':
        store.setPlaybackRate(store.playbackRate - 0.25)
        break

      case 'deleteCurrent':
        void store.removeCurrent()
        break

      case 'undoDelete':
        void store.undoDelete()
        break

      case 'togglePlaylist':
        store.togglePanel('playlist')
        break

      case 'toggleSettings':
        store.togglePanel('settings')
        break

      case 'toggleHelp':
        store.togglePanel('help')
        break

      case 'cycleFit':
        store.cycleFitMode()
        break

      case 'rotateVideo':
        store.rotateVideo()
        break

      case 'flipVideo':
        store.toggleFlip()
        break

      case 'toggleFullscreen':
        toggleFullscreen()
        break

      case 'openFolder':
        void store.openFolder()
        break
    }
  }

  function onKeydown(event: KeyboardEvent) {
    // 正在录制新按键时，交给设置面板处理
    if (store.capturingKey) return

    ;(window as unknown as { __videoGesture?: boolean }).__videoGesture = true
    if (isTypingTarget(event.target)) {
      if (event.key === 'Escape') (event.target as HTMLElement).blur()
      return
    }

    const combo = comboFromEvent(event)
    if (!combo) return

    const index = buildIndex(store.keymap)
    let action = index[combo]
    let boosted = false

    // 进度动作支持 Shift 加速：Shift + 已绑定的进度键
    if (!action && combo.startsWith('Shift+')) {
      const base = index[combo.slice(6)]
      if (base === 'seekForward' || base === 'seekBackward') {
        action = base
        boosted = true
      }
    }

    /*
     * 重复视频面板是模态框：Esc 与预览由它自己处理。
     * 打开期间全局快捷键整体让位 —— 否则 Space 会去切换"背后那个正在播放的视频"，
     * 而 Delete 更危险：会直接删掉当前播放的视频，而不是列表里勾选的那些。
     *
     * 唯一的例外是「打开所在文件夹」：它天然需要跨面板工作（面板里选中一条、按快捷键定位），
     * 而且它是只读动作，不会误伤任何东西。
     */
    if (store.activePanel === 'duplicates' && action !== 'openFolder') return

    if (!action) return
    event.preventDefault()
    run(action, boosted)
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

  return { toggleFullscreen }
}
