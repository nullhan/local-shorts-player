<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import {
  bindController,
  controllerStamp,
  unbindController,
  videoBuffered,
  videoDuration,
  videoNativeHeight,
  videoNativeWidth,
  videoPaused,
  videoTime,
  type VideoController
} from '@/composables/useVideoControl'
import { FIT_MODE_LABELS, usePlayerStore } from '@/store/player'
import type { VideoItem } from '@/types'
import { hashString } from '@/utils/media'
import type { VideoTransform } from '@/utils/transforms'

const props = defineProps<{ item: VideoItem | null; transform: VideoTransform }>()

const store = usePlayerStore()

const videoRef = ref<HTMLVideoElement | null>(null)
const mediaReady = ref(false)
const mediaError = ref(false)
const posterHue = ref(0)

/**
 * 全部实例共享：是否已经成功渲染过至少一帧。
 * 切换视频时不再显示深色占位海报 —— 否则滑入的那一下会是一块暗色/黑色，
 * 正是用户反馈的「切换黑一下」。首次进入仍然保留海报，避免开屏纯黑。
 */
const everRendered = ref(false)

const current = computed(() => props.item)
const videoKey = computed(() => current.value?.id ?? 'empty')

/** 画面转向：旋转角度 + 是否水平镜像（逐视频，见 utils/transforms.ts） */
const transformClasses = computed(() => [
  `rot-${props.transform.rotate}`,
  { flipped: props.transform.flip }
])

/** 只有首屏（或换目录后）才需要占位海报 */
const showPoster = computed(
  () => !mediaReady.value && !mediaError.value && !everRendered.value
)

/** 常见比例的友好名称，便于一眼判断画面是否被裁切 */
const ratioLabel = computed(() => {
  const w = videoNativeWidth.value
  const h = videoNativeHeight.value
  if (!w || !h) return ''
  const ratio = w / h
  const known: Array<[number, string]> = [
    [16 / 9, '16:9'],
    [9 / 16, '9:16'],
    [4 / 3, '4:3'],
    [3 / 4, '3:4'],
    [1, '1:1'],
    [21 / 9, '21:9'],
    [2.39, '2.39:1']
  ]
  const hit = known.find(([value]) => Math.abs(ratio - value) < 0.02)
  return hit ? hit[1] : `${ratio.toFixed(2)}:1`
})

/** 根据文件名生成稳定的占位海报渐变 */
watch(
  current,
  (item) => {
    mediaReady.value = false
    mediaError.value = false
    if (item) posterHue.value = parseInt(hashString(item.name), 36) % 360
  },
  { immediate: true }
)

function tryPlay() {
  const el = videoRef.value
  if (!el) return
  if (!store.autoPlay) return
  const promise = el.play()
  if (promise?.catch) promise.catch(() => undefined)
}

function restartFromStart() {
  const el = videoRef.value
  if (!el) return
  el.currentTime = 0
  tryPlay()
}

watch(
  () => current.value?.id,
  () => {
    // 切换后立刻尝试播放（浏览器要求用户手势，失败会静默忽略）
    videoPaused.value = true
    requestAnimationFrame(() => {
      restartFromStart()
    })
  }
)

watch(
  () => [store.volume, store.muted],
  ([volume, muted]) => {
    const el = videoRef.value
    if (!el) return
    el.volume = store.muted ? 0 : (volume as number)
  }
)

watch(
  () => store.playbackRate,
  (rate) => {
    if (videoRef.value) videoRef.value.playbackRate = rate
  }
)

/* ------------------------------------------------------------------
 * 切换动画期间会同时存在两个实例（旧的滑出、新的滑入）。
 * 用 stamp 判定「我是不是当前活跃实例」，旧实例的事件回调直接返回，
 * 避免把过期状态写进全局的 videoTime / videoPaused 等。
 * ------------------------------------------------------------------ */
const stamp = Symbol('video-stage')
const isActive = () => controllerStamp.value === stamp

function onLoadedMetadata() {
  const el = videoRef.value
  if (!el) return
  mediaError.value = false
  mediaReady.value = true
  everRendered.value = true
  if (!isActive()) return
  videoDuration.value = Number.isFinite(el.duration) ? el.duration : 0
  videoNativeWidth.value = el.videoWidth || 0
  videoNativeHeight.value = el.videoHeight || 0
  el.volume = store.muted ? 0 : store.volume
  el.playbackRate = store.playbackRate
  if (el.currentTime > 0.05) el.currentTime = 0
  tryPlay()
  probeDuration(el)
}

function onLoadedData() {
  mediaReady.value = true
  everRendered.value = true
}

/** 探测期间屏蔽 ended / 自动播放，避免探测动作被当成播放结束 */
let probing = false
let userSeekedDuringProbe = false
let probeTimer: number | undefined
const probed = new WeakSet<HTMLVideoElement>()

/**
 * 部分容器（webm 录制片段、部分 mkv）的 duration 为 Infinity，
 * 通过跳到极大时间点触发时长计算，再把进度拉回起点。
 */
function probeDuration(el: HTMLVideoElement) {
  if (Number.isFinite(el.duration) || probed.has(el)) return
  probed.add(el)
  probing = true
  userSeekedDuringProbe = false

  const finish = () => {
    if (!probing) return
    if (Number.isFinite(el.duration) && el.duration > 0) {
      videoDuration.value = el.duration
    }
    el.removeEventListener('durationchange', onDurationChange)
    // 如果探测期间用户已经手动跳转，则不要抢回进度
    if (!userSeekedDuringProbe) {
      el.currentTime = 0
      videoTime.value = 0
    }
    probing = false
    tryPlay()
  }

  const onDurationChange = () => {
    if (Number.isFinite(el.duration) && el.duration > 0) finish()
  }

  el.addEventListener('durationchange', onDurationChange)
  try {
    el.currentTime = 1e101
  } catch {
    finish()
  }
  // 兜底：某些实现不会触发 durationchange
  probeTimer = window.setTimeout(finish, 1200)
}

function onTimeUpdate() {
  const el = videoRef.value
  if (!el || probing || !isActive()) return
  videoTime.value = el.currentTime
  if (Number.isFinite(el.duration) && el.duration > 0 && videoDuration.value !== el.duration) {
    videoDuration.value = el.duration
  }
}

function onProgress() {
  const el = videoRef.value
  if (!el || probing || !isActive() || !el.buffered.length) return
  videoBuffered.value = el.buffered.end(el.buffered.length - 1)
}

function onPlay() {
  if (!isActive()) return
  videoPaused.value = false
}

function onPause() {
  if (!isActive()) return
  videoPaused.value = true
}

function onEnded() {
  if (probing || !isActive()) return
  if (store.loopMode === 'loop') {
    restartFromStart()
  } else {
    videoPaused.value = true
  }
}

function onError() {
  mediaError.value = true
  mediaReady.value = true
}

function onVideoClick() {
  toggle()
}

function toggle(): 'play' | 'pause' | null {
  const el = videoRef.value
  if (!el) return null
  if (el.paused) {
    videoPaused.value = false
    const promise = el.play()
    if (promise?.catch) promise.catch(() => undefined)
    return 'play'
  }
  el.pause()
  videoPaused.value = true
  return 'pause'
}

const controllerInstance: VideoController = {
  play: () => {
    const promise = videoRef.value?.play()
    promise?.catch(() => undefined)
  },
  pause: () => videoRef.value?.pause(),
  toggle,
  seekTo: (time: number) => {
    const el = videoRef.value
    if (!el) return
    if (probing) userSeekedDuringProbe = true
    const max = Number.isFinite(el.duration) ? el.duration : time
    el.currentTime = Math.min(Math.max(time, 0), max)
    videoTime.value = el.currentTime
  },
  seekBy: (delta: number) => {
    const el = videoRef.value
    if (!el) return 0
    if (probing) userSeekedDuringProbe = true
    const max = Number.isFinite(el.duration) ? el.duration : el.currentTime + delta
    const target = Math.min(Math.max(el.currentTime + delta, 0), max)
    const actual = target - el.currentTime
    el.currentTime = target
    videoTime.value = target
    return Math.round(actual)
  },
  setVolume: (value: number, muted: boolean) => {
    const el = videoRef.value
    if (!el) return
    el.volume = muted ? 0 : value
  },
  setRate: (rate: number) => {
    if (videoRef.value) videoRef.value.playbackRate = rate
  },
  restart: restartFromStart
}

onMounted(() => {
  bindController(controllerInstance, stamp)
})

onBeforeUnmount(() => {
  if (probeTimer) window.clearTimeout(probeTimer)
  unbindController(controllerInstance)
})
</script>

<template>
  <div class="video-stage" @click="onVideoClick">
    <div v-if="showPoster" class="poster" :style="{ '--hue': `${posterHue}` }">
      <span class="poster-name">{{ current?.name || '未选择视频' }}</span>
      <span class="poster-tip">加载中…</span>
    </div>

    <video
      v-if="current"
      :key="videoKey"
      ref="videoRef"
      class="video-el"
      :class="[`fit-${store.fitMode}`, transformClasses]"
      :src="current.url"
      playsinline
      preload="auto"
      @loadedmetadata="onLoadedMetadata"
      @loadeddata="onLoadedData"
      @timeupdate="onTimeUpdate"
      @durationchange="onTimeUpdate"
      @progress="onProgress"
      @play="onPlay"
      @pause="onPause"
      @ended="onEnded"
      @error="onError"
    />

    <div v-if="current && mediaReady && !mediaError" class="res-tag">
      {{ videoNativeWidth || '?' }}×{{ videoNativeHeight || '?' }}
      <template v-if="ratioLabel"> · {{ ratioLabel }}</template>
      <template v-if="store.fitMode !== 'contain'"> · {{ FIT_MODE_LABELS[store.fitMode] }}</template>
    </div>

    <div v-if="mediaError" class="error-mask">
      <SvgIcon name="close" :size="30" />
      <p>无法解码该视频格式</p>
      <span>{{ current?.name }}</span>
      <em>可按 <kbd>Delete</kbd> 删除，或用 <kbd>滚轮</kbd> 跳过；无法播放的编码需转码为 H.264 / MP4</em>
    </div>
  </div>
</template>

<style scoped lang="less">
.video-stage {
  /* 绝对铺满容器：切换时新旧两个 stage 需要重叠滑动，不能参与文档流 */
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  overflow: hidden;
  cursor: pointer;
  will-change: transform;
  /* 给 .video-el 提供 cqw / cqh 基准：旋转 90° 时要用「容器的另一条边」当宽度 */
  container-type: size;
}

.video-el {
  /*
   * 关键：元素盒必须严格等于容器盒子（旋转 90°/270° 时两条边互换）。
   * 用 top/left 50% + translate(-50%,-50%) 居中而不是 inset:0 ——
   * 旋转后盒子尺寸与容器不同，需要一个稳定的中心点。
   *
   * 不用 100%/100% 的原因：视频带有固有宽高比，若盒子的尺寸由内容参与计算，
   * auto 最小尺寸会按固有比例把盒子撑大，超出部分被 overflow:hidden 裁掉。
   * 用容器查询单位显式给尺寸，留白完全交给 object-fit 处理。
   */
  position: absolute;
  top: 50%;
  left: 50%;
  width: 100cqw;
  height: 100cqh;
  background: #000;
  transform: translate(-50%, -50%) scaleX(var(--flip, 1)) rotate(var(--rot, 0deg));
  /*
   * scaleX 写在 rotate 之前：CSS transform 是「从右往左」作用到点上，
   * 所以先 rotate 再按屏幕水平轴翻转 —— 这样即使画面已经转了 90°，
   * 「水平镜像」依然是屏幕上的左右翻转，符合按钮字面含义。
   */
}

/* 老浏览器拿不到 cqw/cqh（声明会被整条丢弃 → width 变 auto），显式兜底成容器尺寸 */
@supports not (width: 100cqw) {
  .video-el {
    width: 100%;
    height: 100%;
  }
}

/* 旋转 90° / 270°：盒子长宽互换，旋转后视觉边界才正好等于容器 */
.rot-90,
.rot-270 {
  width: 100cqh;
  height: 100cqw;
}

.rot-90 {
  --rot: 90deg;
}

.rot-180 {
  --rot: 180deg;
}

.rot-270 {
  --rot: 270deg;
}

.flipped {
  --flip: -1;
}

.fit-contain {
  object-fit: contain;
}

.fit-cover {
  object-fit: cover;
}

.fit-fill {
  object-fit: fill;
}

.res-tag {
  position: absolute;
  left: 12px;
  bottom: 12px;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(12, 12, 18, 0.62);
  backdrop-filter: blur(6px);
  color: var(--text-secondary);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  z-index: 5;
}

.poster {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: linear-gradient(
    160deg,
    hsl(var(--hue), 32%, 16%),
    hsl(calc(var(--hue) + 40), 28%, 8%)
  );

  .poster-name {
    max-width: 70%;
    color: rgba(255, 255, 255, 0.72);
    font-size: 15px;
    text-align: center;
    word-break: break-all;
  }

  .poster-tip {
    color: rgba(255, 255, 255, 0.36);
    font-size: 12px;
  }
}

.error-mask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(12, 12, 18, 0.9);
  color: var(--text-secondary);
  text-align: center;
  padding: 24px;

  p {
    color: var(--text-primary);
    font-size: 16px;
  }

  span {
    max-width: 60%;
    font-size: 13px;
    word-break: break-all;
    color: var(--text-muted);
  }

  em {
    margin-top: 6px;
    font-size: 12px;
    font-style: normal;
    color: var(--text-muted);
  }
}
</style>
