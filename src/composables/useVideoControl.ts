import { computed, ref } from 'vue'

import { clamp } from '@/utils/media'

/**
 * 播放内核的共享状态。
 * VideoStage 负责把原生 <video> 事件同步进来，
 * 其它组件（进度条、OSD）只读取，不直接操作 DOM 元素。
 *
 * 切换动画期间会同时存在两个 VideoStage 实例（旧的滑出、新的滑入），
 * 因此用 `controllerStamp` 标记「当前活跃实例」，
 * 旧实例的事件回调据此提前返回，避免污染全局播放状态。
 */
const currentTime = ref(0)
const duration = ref(0)
const paused = ref(true)
const buffered = ref(0)
const seeking = ref(false)
/** 视频固有分辨率，用于展示原始长宽比 */
const nativeWidth = ref(0)
const nativeHeight = ref(0)

export const videoTime = currentTime
export const videoDuration = duration
export const videoPaused = paused
export const videoBuffered = buffered
export const videoSeeking = seeking
export const videoNativeWidth = nativeWidth
export const videoNativeHeight = nativeHeight

export type PlayAction = 'play' | 'pause'

/** 由 VideoStage 注入的真实元素操作句柄 */
export interface VideoController {
  play: () => void
  pause: () => void
  toggle: () => PlayAction | null
  seekTo: (time: number) => void
  seekBy: (delta: number) => number
  setVolume: (value: number, muted: boolean) => void
  setRate: (rate: number) => void
  restart: () => void
}

let controller: VideoController | null = null

/** 当前活跃控制器的标识 */
export const controllerStamp = ref<symbol | null>(null)

export function bindController(instance: VideoController, stamp: symbol) {
  controller = instance
  controllerStamp.value = stamp
}

/** 只卸载自己：切换动画期间旧实例的卸载不能顶掉新实例的绑定 */
export function unbindController(instance: VideoController) {
  if (controller !== instance) return
  controller = null
  controllerStamp.value = null
}

export const progress = computed(() => {
  if (!durationKnown.value) return 0
  return clamp(currentTime.value / duration.value, 0, 1)
})

/** duration 可能为 Infinity（webm/mkv 缺失时长元数据），需要先探测再启用进度条 */
export const durationKnown = computed(
  () => Number.isFinite(duration.value) && duration.value > 0
)

export const bufferedProgress = computed(() => {
  if (!durationKnown.value) return 0
  return clamp(buffered.value / duration.value, 0, 1)
})

/** 切换播放状态，返回切换后进入的状态，便于 UI 立即给出正确反馈 */
export function togglePlay(): PlayAction | null {
  return controller?.toggle() ?? null
}

export function seekTo(time: number) {
  controller?.seekTo(time)
}

export function seekBy(delta: number): number {
  return controller?.seekBy(delta) ?? 0
}

export function setPlaybackRate(rate: number) {
  controller?.setRate(rate)
}

export function restart() {
  controller?.restart()
}

export function useVideoControl() {
  return {
    currentTime,
    duration,
    paused,
    buffered,
    seeking,
    durationKnown,
    progress,
    bufferedProgress,
    togglePlay,
    seekTo,
    seekBy,
    setPlaybackRate,
    restart
  }
}

/** 让外部（如进度条拖拽）直接同步 UI 时间，避免拖动时被 timeupdate 回拉 */
export function markSeeking(value: boolean) {
  seeking.value = value
}

export function setUiTime(value: number) {
  currentTime.value = value
}
