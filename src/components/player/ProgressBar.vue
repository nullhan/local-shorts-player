<script setup lang="ts">
import { computed, ref } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import {
  durationKnown,
  markSeeking,
  setUiTime,
  videoBuffered,
  videoDuration,
  videoPaused,
  videoTime
} from '@/composables/useVideoControl'
import { usePlayerStore } from '@/store/player'
import { formatTime, clamp } from '@/utils/media'

const emit = defineEmits<{ (e: 'seek', time: number): void }>()

const store = usePlayerStore()
const trackRef = ref<HTMLDivElement | null>(null)
const dragging = ref(false)
const hoverTime = ref(0)
const hoverLeft = ref(0)
const hovering = ref(false)

const duration = computed(() => videoDuration.value)
const currentTime = computed(() => videoTime.value)
const canSeek = computed(() => durationKnown.value)
const progressPercent = computed(() =>
  canSeek.value ? (currentTime.value / duration.value) * 100 : 0
)
const bufferPercent = computed(() =>
  canSeek.value ? (videoBuffered.value / duration.value) * 100 : 0
)

function ratioFromEvent(event: MouseEvent): number {
  const track = trackRef.value
  if (!track) return 0
  const rect = track.getBoundingClientRect()
  if (!rect.width) return 0
  return clamp((event.clientX - rect.left) / rect.width, 0, 1)
}

function previewTime(event: MouseEvent) {
  if (!canSeek.value) return
  const ratio = ratioFromEvent(event)
  hoverTime.value = ratio * duration.value
  hoverLeft.value = ratio * 100
}

function onPointerDown(event: MouseEvent) {
  if (!canSeek.value) return
  dragging.value = true
  markSeeking(true)
  const time = ratioFromEvent(event) * duration.value
  setUiTime(time)
  window.addEventListener('mousemove', onPointerMove)
  window.addEventListener('mouseup', onPointerUp)
}

function onPointerMove(event: MouseEvent) {
  if (!canSeek.value) return
  previewTime(event)
  if (!dragging.value) return
  const time = ratioFromEvent(event) * duration.value
  setUiTime(time)
}

function onPointerUp(event: MouseEvent) {
  if (dragging.value) {
    const time = ratioFromEvent(event) * duration.value
    emit('seek', time)
    dragging.value = false
  }
  markSeeking(false)
  window.removeEventListener('mousemove', onPointerMove)
  window.removeEventListener('mouseup', onPointerUp)
}
</script>

<template>
  <div
    class="progress-bar"
    :class="{ dragging }"
    @mouseenter="hovering = true"
    @mouseleave="hovering = false"
    @mousemove="previewTime"
    @mousedown="onPointerDown"
  >
    <div ref="trackRef" class="track">
      <div class="buffer" :style="{ width: `${bufferPercent}%` }" />
      <div class="fill" :style="{ width: `${progressPercent}%` }" />
      <div class="thumb" :style="{ left: `${progressPercent}%` }" />

      <div v-if="hovering && canSeek" class="hover" :style="{ left: `${hoverLeft}%` }">
        {{ formatTime(hoverTime) }}
      </div>
    </div>

    <div class="meta">
      <span class="pause-hint">
        <SvgIcon :name="videoPaused ? 'pause' : 'play'" :size="12" />
        {{ videoPaused ? '已暂停' : '播放中' }}
      </span>
      <span class="time">
        {{ formatTime(currentTime) }} / {{ canSeek ? formatTime(duration) : '--:--' }}
      </span>
    </div>
  </div>
</template>

<style scoped lang="less">
.progress-bar {
  position: relative;
  padding: 10px 0 0;
  cursor: pointer;
  user-select: none;
}

.track {
  position: relative;
  height: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.22);
  /* 没有整屏蒙版了，靠一圈阴影把轨道从亮画面里分出来 */
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.55);
  transition: height 0.15s var(--ease);

  &:hover {
    height: 6px;
  }
}

.buffer,
.fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  border-radius: 999px;
}

.buffer {
  background: rgba(255, 255, 255, 0.3);
}

.fill {
  background: linear-gradient(90deg, #fe2c55, #ff6a3d);
}

.thumb {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 10px rgba(254, 44, 85, 0.8);
  transform: translate(-50%, -50%) scale(0);
  transition: transform 0.15s var(--ease);
}

.progress-bar:hover .thumb,
.progress-bar.dragging .thumb {
  transform: translate(-50%, -50%) scale(1);
}

.hover {
  position: absolute;
  bottom: 20px;
  transform: translateX(-50%);
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.82);
  color: #fff;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}

.meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  color: var(--text-secondary);
  font-size: 12px;

  .pause-hint {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }

  .time {
    font-variant-numeric: tabular-nums;
  }
}
</style>
