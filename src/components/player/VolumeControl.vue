<script setup lang="ts">
import { computed } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { usePlayerStore } from '@/store/player'

const store = usePlayerStore()

const visible = computed(() => !store.muted && store.volume > 0)
const percent = computed(() => Math.round(store.volume * 100))
</script>

<template>
  <div class="volume-control">
    <button class="mute-btn" :title="store.muted ? '取消静音 (M)' : '静音 (M)'" @click="store.toggleMute()">
      <SvgIcon :name="visible ? 'volume' : 'mute'" :size="17" />
    </button>

    <div class="slider-wrap">
      <input
        class="slider"
        type="range"
        min="0"
        max="100"
        :value="percent"
        :style="{ '--value': `${percent}%` }"
        aria-label="音量"
        @input="store.setVolume(Number(($event.target as HTMLInputElement).value) / 100, true)"
        @change="store.setVolume(Number(($event.target as HTMLInputElement).value) / 100)"
      />
      <span class="percent">{{ percent }}%</span>
    </div>
  </div>
</template>

<style scoped lang="less">
.volume-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mute-btn {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: var(--text-primary);
  transition: background 0.15s var(--ease);

  &:hover {
    background: rgba(255, 255, 255, 0.14);
  }
}

.slider-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.slider {
  width: 84px;
  height: 4px;
  appearance: none;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    #fff 0%,
    #fff var(--value),
    rgba(255, 255, 255, 0.24) var(--value),
    rgba(255, 255, 255, 0.24) 100%
  );
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  cursor: pointer;

  &::-webkit-slider-thumb {
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 0 6px rgba(0, 0, 0, 0.5);
  }

  &::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border: none;
    border-radius: 50%;
    background: #fff;
  }
}

.percent {
  width: 34px;
  color: var(--text-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
</style>
