<script setup lang="ts">
import SvgIcon from '@/components/SvgIcon.vue'
import type { OsdMessage } from '@/types'

const props = defineProps<{ message: OsdMessage | null }>()

const ICON: Record<string, string> = {
  volume: 'volume',
  mute: 'mute',
  seek: 'chevronRight',
  delete: 'trash',
  undo: 'undo',
  info: 'dot',
  play: 'play',
  pause: 'pause'
}

function iconOf(message: OsdMessage | null): string {
  if (!message) return 'dot'
  return ICON[message.icon ?? 'info'] || 'dot'
}

type Variant = 'pill' | 'ghost' | 'toast'

function variantOf(message: OsdMessage | null): Variant {
  const value = message?.variant
  return value === 'ghost' || value === 'toast' ? value : 'pill'
}

/**
 * 定位交给外层 layer：中央（音量 / 进度）或底部（删除 / 导入结果等重要提示）。
 * 之所以拆一层，是因为定位和内层缩放动画都用到 transform，写在一起会互相覆盖。
 */
function positionOf(message: OsdMessage | null): 'center' | 'bottom' {
  return variantOf(message) === 'toast' ? 'bottom' : 'center'
}

function iconSizeOf(message: OsdMessage | null): number {
  return variantOf(message) === 'toast' ? 15 : 18
}
</script>

<template>
  <Transition name="osd">
    <div
      v-if="props.message"
      :key="props.message.id"
      class="osd-layer"
      :class="`osd-pos-${positionOf(props.message)}`"
    >
      <div
        class="osd"
        :class="[`osd-${props.message.icon || 'info'}`, `osd-v-${variantOf(props.message)}`]"
      >
        <SvgIcon :name="iconOf(props.message)" :size="iconSizeOf(props.message)" />
        <span>{{ props.message.text }}</span>
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="less">
.osd-layer {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  pointer-events: none;
  z-index: 30;
}

.osd-pos-center {
  top: 50%;
  transform: translateY(-50%);
}

/* 底部居中：避开画面主体，也不压左侧操作轨道 */
.osd-pos-bottom {
  bottom: 17%;
}

.osd {
  display: flex;
  align-items: center;
  gap: 9px;
  white-space: nowrap;
}

/* pill：画面中央的深色胶囊（音量 / 静音） */
.osd-v-pill {
  padding: 11px 20px;
  border-radius: 999px;
  background: rgba(12, 12, 18, 0.72);
  backdrop-filter: blur(10px);
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 14px;
  font-weight: 500;
}

/* ghost：画面中央的无底色轻提示（进度拖动） */
.osd-v-ghost {
  padding: 0;
  color: rgba(255, 255, 255, 0.94);
  font-size: 19px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.8);
}

/* toast：底部居中的状态条（删除 / 撤销 / 导入结果等） */
.osd-v-toast {
  padding: 9px 16px;
  border-radius: 999px;
  background: rgba(12, 12, 18, 0.78);
  backdrop-filter: blur(10px);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.42);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
}

.osd-delete {
  color: #ff6a7f;
}

.osd-undo {
  color: #4fd18b;
}

.osd-seek {
  color: #8fc4ff;
}

/*
 * 过渡：透明度放在外层 layer 上，缩放放在内层 .osd 上。
 * 这样不会去动 .osd-pos-* 的定位 transform。
 */
.osd-enter-active,
.osd-leave-active {
  transition: opacity 0.2s var(--ease);
}

.osd-enter-active .osd,
.osd-leave-active .osd {
  transition: transform 0.2s var(--ease);
}

.osd-enter-from,
.osd-leave-to {
  opacity: 0;
}

.osd-enter-from .osd {
  transform: scale(0.92);
}

.osd-leave-to .osd {
  transform: scale(0.97);
}
</style>
