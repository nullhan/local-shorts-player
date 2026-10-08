<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    name: string
    size?: number | string
  }>(),
  { size: 18 }
)

const PATHS: Record<string, string> = {
  play: 'M8 5.14v13.72L19 12 8 5.14z',
  pause: 'M6 5h4v14H6V5zm8 0h4v14h-4V5z',
  volume:
    'M11 5 6.5 9H3v6h3.5L11 19V5zm3.5 2.5a5.5 5.5 0 0 1 0 9M17 5a9 9 0 0 1 0 14',
  mute: 'M11 5 6.5 9H3v6h3.5L11 19V5zM16 9.5l5 5m0-5-5 5',
  folder:
    'M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h9A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5V6.5z',
  list: 'M4 6h16M4 12h16M4 18h16',
  gear:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 7.2 19.7l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 3 14.6H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.3 7.2l-.06-.06A2 2 0 1 1 7.07 4.3l.06.06A1.7 1.7 0 0 0 9 4.6h.1A1.7 1.7 0 0 0 10.8 3V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 16.8 4.3l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.1a1.7 1.7 0 0 0 1.6 1.7H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.2z',
  keyboard:
    'M3 6.5h18a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M6 12.5h.01M9.5 12.5h.01M13 12.5h.01M16.5 12.5h.01M8 15.5h8',
  trash:
    'M4 7h16M10 7V5h4v2m-7 0 .8 12.2A1 1 0 0 0 8.8 20h6.4a1 1 0 0 0 1-1L17 7m-7 3v7m4-7v7',
  check: 'M4.5 12.5 9.5 17.5 19.5 7',
  close: 'M6 6l12 12M18 6 6 18',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronRight: 'M9 5l7 7-7 7',
  chevronUp: 'M5 15l7-7 7 7',
  chevronDown: 'M5 9l7 7 7-7',
  import: 'M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 19h16',
  shuffle:
    'M16 4h4v4M4 20l5.5-5.5M20 20h-4v-4M4 4l6 6m6 6 4 4M20 4l-6 6',
  undo: 'M9 14 4 9l5-5M4 9h9a6 6 0 0 1 0 12h-3',
  rotate: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8M21 3v5h-5',
  flip: 'M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3M12 2v2M12 8v2M12 14v2M12 20v2',
  copy: 'M9 9V5.5A1.5 1.5 0 0 1 10.5 4h9A1.5 1.5 0 0 1 21 5.5v9a1.5 1.5 0 0 1-1.5 1.5H16M4.5 9h9A1.5 1.5 0 0 1 15 10.5v9A1.5 1.5 0 0 1 13.5 21h-9A1.5 1.5 0 0 1 3 19.5v-9A1.5 1.5 0 0 1 4.5 9z',
  dot: 'M12 12h.01'
}

const filled = computed(() => ['play', 'pause'].includes(props.name))
const dimension = computed(() =>
  typeof props.size === 'number' ? `${props.size}px` : props.size
)
</script>

<template>
  <svg
    class="svg-icon"
    :style="{ width: dimension, height: dimension }"
    viewBox="0 0 24 24"
    :fill="filled ? 'currentColor' : 'none'"
    stroke="currentColor"
    :stroke-width="filled ? 0 : 1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="PATHS[name] || PATHS.dot" />
  </svg>
</template>

<style scoped>
.svg-icon {
  display: block;
  flex: none;
}
</style>
