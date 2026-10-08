<script setup lang="ts">
import SvgIcon from '@/components/SvgIcon.vue'
import type { PulseMessage } from '@/types'

defineProps<{ pulse: PulseMessage | null }>()
</script>

<template>
  <!--
    参考抖音：播放 / 暂停只在画面中央闪一个大图标，
    没有任何底色、胶囊或遮罩，闪一下就淡出。
  -->
  <Transition name="pulse">
    <div v-if="pulse" :key="pulse.id" class="pulse">
      <SvgIcon :name="pulse.kind" :size="88" />
    </div>
  </Transition>
</template>

<style scoped lang="less">
.pulse {
  position: absolute;
  top: 50%;
  left: 50%;
  display: grid;
  place-items: center;
  color: rgba(255, 255, 255, 0.92);
  filter: drop-shadow(0 6px 24px rgba(0, 0, 0, 0.55));
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 28;
}

.pulse-enter-active {
  transition: opacity 0.1s var(--ease), transform 0.16s var(--ease);
}

.pulse-leave-active {
  transition: opacity 0.3s var(--ease), transform 0.3s var(--ease);
}

.pulse-enter-from {
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.72);
}

.pulse-leave-to {
  opacity: 0;
  transform: translate(-50%, -50%) scale(1.18);
}
</style>
