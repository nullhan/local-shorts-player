<script setup lang="ts">
import { computed } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import type { VideoItem } from '@/types'
import { coverArtFor } from '@/utils/cover'
import { formatSize, titleFromFileName } from '@/utils/media'

/**
 * 音乐模式下的展示区。
 *
 * 音频没有画面，全屏 <video> 只会是一片黑。
 * 所以这里换成「生成封面 + 标题 + 专辑信息」的音乐播放页样式，
 * 同时**仍然承载那个 <audio> 元素**（通过 slot 由 PlayerView 传进来），
 * 这样播放内核完全不用为音频单独走一条路 —— useVideoControl 那套照旧工作。
 *
 * 封面是确定性生成的（见 utils/cover.ts），不需要解析内嵌图片。
 */
const props = defineProps<{ item: VideoItem | null; sourceName?: string }>()

const cover = computed(() => coverArtFor(props.item?.name ?? '♪'))
const title = computed(() => (props.item ? titleFromFileName(props.item.name) : '未选择音频'))
const subtitle = computed(() => {
  if (!props.item) return ''
  return props.item.parentPath || props.sourceName || '本地音乐'
})
</script>

<template>
  <div class="music-stage" :style="{ '--hue': String(cover.hue) }">
    <div class="glow" />

    <div class="content">
      <div class="cover" :style="{ background: cover.gradient }">
        <div class="cover-sheen" :style="{ background: cover.sheen }" />
        <span class="cover-glyph">{{ cover.glyph }}</span>
        <div class="cover-ring" />
      </div>

      <div class="meta">
        <h1 class="title" :title="item?.name">{{ title }}</h1>
        <p class="subtitle">
          <SvgIcon name="folder" :size="13" />
          <span>{{ subtitle }}</span>
          <template v-if="item">
            <em>·</em>
            <span>{{ formatSize(item.size) }}</span>
          </template>
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.music-stage {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  background:
    radial-gradient(120% 80% at 50% 0%, hsl(var(--hue), 42%, 18%) 0%, transparent 60%),
    linear-gradient(180deg, #0d0d14, #08080c);
}

.glow {
  position: absolute;
  inset: -20% -10% auto -10%;
  height: 70%;
  background: radial-gradient(closest-side, hsla(var(--hue), 70%, 55%, 0.28), transparent 72%);
  filter: blur(40px);
  pointer-events: none;
}

.content {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
  width: min(78vw, 420px);
  padding-bottom: 6vh;
}

.cover {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 20px;
  box-shadow: 0 26px 60px rgba(0, 0, 0, 0.62), 0 0 0 1px rgba(255, 255, 255, 0.06) inset;
  overflow: hidden;

  /* 手机竖屏时封面别顶到上边缘，留出顶部信息栏的位置 */
  @media (max-height: 720px) {
    border-radius: 16px;
  }
}

.cover-sheen {
  position: absolute;
  inset: 0;
}

.cover-glyph {
  position: absolute;
  right: 8%;
  bottom: 2%;
  color: rgba(255, 255, 255, 0.9);
  font-size: clamp(56px, 18vw, 104px);
  font-weight: 700;
  line-height: 1;
  text-shadow: 0 4px 18px rgba(0, 0, 0, 0.4);
}

/* 中心的一个半透明圆环，避免大色块显得太空 */
.cover-ring {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 46%;
  aspect-ratio: 1;
  border: 2px solid rgba(255, 255, 255, 0.26);
  border-radius: 50%;
  transform: translate(-50%, -50%);
}

.meta {
  width: 100%;
  text-align: center;
}

.title {
  overflow: hidden;
  margin-bottom: 8px;
  font-size: clamp(19px, 5.2vw, 26px);
  font-weight: 700;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subtitle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  color: var(--text-secondary);
  font-size: 13px;

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  em {
    color: var(--text-muted);
    font-style: normal;
  }
}
</style>
