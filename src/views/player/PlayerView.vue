<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import OsdToast from '@/components/player/OsdToast.vue'
import DuplicatePanel from '@/components/player/DuplicatePanel.vue'
import PlaylistPanel from '@/components/player/PlaylistPanel.vue'
import PlayPulse from '@/components/player/PlayPulse.vue'
import ProgressBar from '@/components/player/ProgressBar.vue'
import SettingsPanel from '@/components/player/SettingsPanel.vue'
import VideoStage from '@/components/player/VideoStage.vue'
import VolumeControl from '@/components/player/VolumeControl.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { useIdle } from '@/composables/useIdle'
import { useKeyboardShortcuts, useWheelNavigate } from '@/composables/useShortcuts'
import { seekTo, togglePlay, videoPaused } from '@/composables/useVideoControl'
import { usePlayerStore } from '@/store/player'
import { ACTIONS, comboText, formatCombo } from '@/utils/keymap'
import { formatSize } from '@/utils/media'

const router = useRouter()
const store = usePlayerStore()

const stage = ref<HTMLElement | null>(null)
const { idle } = useIdle()

useWheelNavigate(stage)
useKeyboardShortcuts({ container: stage })

const current = computed(() => store.current)
const sliderOpen = ref(false)
const seekSliderValue = ref(0)

watch(
  () => store.currentIndex,
  (index) => {
    if (!sliderOpen.value && index >= 0) seekSliderValue.value = index
  }
)

/**
 * 切换方向决定动画：新的在下 → slide-up（列表往上顶），反之 slide-down。
 * 只在「当前视频真的换了」时更新，避免排序导致索引变化时误触发动画。
 */
const transitionName = ref('slide-up')
watch(
  () => store.currentId,
  (id, prevId) => {
    if (!id || !prevId) return
    const nextIndex = store.playlist.findIndex((item) => item.id === id)
    const prevIndex = store.playlist.findIndex((item) => item.id === prevId)
    if (nextIndex < 0 || prevIndex < 0) return
    transitionName.value = nextIndex >= prevIndex ? 'slide-up' : 'slide-down'
  }
)

function backToImport() {
  void router.push({ name: 'import' })
}

function handleSeekSlider(value: number) {
  store.select(store.playlist[value]?.id ?? '')
}

function handleSeekTime(time: number) {
  seekTo(time)
}

function onPlayButton() {
  const action = togglePlay()
  if (action) store.pulsePlay(action)
}

let flushOnHide: (() => void) | null = null

onMounted(() => {
  if (store.isEmpty) void router.replace({ name: 'import' })
  ;(window as unknown as { __videoGesture?: boolean }).__videoGesture = true

  // 页面隐藏 / 关闭时把挂起的偏好立刻落盘，避免防抖窗口内丢数据
  flushOnHide = () => store.flushPrefs()
  window.addEventListener('pagehide', flushOnHide)
  document.addEventListener('visibilitychange', flushOnHide)
})

onBeforeUnmount(() => {
  if (flushOnHide) {
    window.removeEventListener('pagehide', flushOnHide)
    document.removeEventListener('visibilitychange', flushOnHide)
  }
  store.flushPrefs()
})
</script>

<template>
  <div
    ref="stage"
    class="player-view"
    :class="{ idle, controlsHidden: idle || Boolean(store.activePanel) }"
  >
    <!-- 上下切换：新旧画面同时滑动（参考抖音），不做淡入淡出，避免中间露出黑底 -->
    <Transition :name="transitionName">
      <VideoStage
        :key="current?.id || 'empty'"
        :item="current"
        :transform="store.currentTransform"
      />
    </Transition>

    <!-- 顶部信息 -->
    <header class="top-bar">
      <button class="icon-btn" title="返回导入 (Esc)" @click="backToImport">
        <SvgIcon name="chevronLeft" :size="18" />
      </button>
      <div class="title" :title="current?.relativePath">
        <span class="name">{{ current?.name || '播放结束' }}</span>
        <span class="meta">
          <template v-if="current">
            {{ store.currentIndex + 1 }} / {{ store.playlistCount }} · {{ formatSize(current.size) }}
          </template>
        </span>
      </div>
      <div class="top-actions">
        <button
          class="icon-btn"
          :class="{ on: store.activePanel === 'playlist' }"
          title="播放列表 (N)"
          @click="store.togglePanel('playlist')"
        >
          <SvgIcon name="list" :size="18" />
        </button>
        <button
          class="icon-btn"
          :class="{ on: store.activePanel === 'settings' }"
          title="设置 (S)"
          @click="store.togglePanel('settings')"
        >
          <SvgIcon name="gear" :size="18" />
        </button>
      </div>
    </header>

    <!-- 左侧操作轨道 -->
    <div class="rail">
      <button
        class="rail-btn"
        :disabled="store.currentIndex <= 0"
        :title="`上一个 (${comboText(store.keymap.prevVideo)})`"
        @click="store.prev()"
      >
        <SvgIcon name="chevronUp" :size="20" />
      </button>

      <button
        class="rail-item"
        :class="{ on: sliderOpen }"
        title="快速跳转"
        @click="sliderOpen = !sliderOpen"
      >
        <SvgIcon name="shuffle" :size="19" />
      </button>

      <button
        class="rail-item"
        :class="{ on: store.hasTransform }"
        :title="`画面转向：${store.transformLabel}（${comboText(store.keymap.rotateVideo)} 旋转 / ${comboText(store.keymap.flipVideo)} 镜像）`"
        @click="store.rotateVideo()"
      >
        <SvgIcon name="rotate" :size="19" />
      </button>

      <button
        class="rail-item danger"
        :title="`删除当前视频 (${comboText(store.keymap.deleteCurrent)})`"
        @click="store.removeCurrent()"
      >
        <SvgIcon name="trash" :size="20" />
      </button>

      <button
        v-if="store.canUndo"
        class="rail-item"
        :title="`撤销删除 (${comboText(store.keymap.undoDelete)})`"
        @click="store.undoDelete()"
      >
        <SvgIcon name="undo" :size="19" />
      </button>

      <button
        class="rail-btn"
        :disabled="store.currentIndex >= store.playlistCount - 1"
        :title="`下一个 (${comboText(store.keymap.nextVideo)})`"
        @click="store.next()"
      >
        <SvgIcon name="chevronDown" :size="20" />
      </button>
    </div>

    <!-- 快速跳转滑块 -->
    <Transition name="fade">
      <div v-if="sliderOpen" class="seek-slider">
        <SvgIcon name="list" :size="15" />
        <div class="vertical">
          <input
            v-model.number="seekSliderValue"
            class="range"
            type="range"
            min="0"
            :max="Math.max(store.playlistCount - 1, 0)"
            step="1"
            @input="handleSeekSlider(seekSliderValue)"
          />
        </div>
        <span class="counter">{{ store.currentIndex + 1 }}/{{ store.playlistCount }}</span>
      </div>
    </Transition>

    <!-- 底部控制条 -->
    <footer class="bottom-bar">
      <div class="playline">
        <button
          class="play-btn"
          :title="`播放 / 暂停 (${comboText(store.keymap.togglePlay)})`"
          @click="onPlayButton()"
        >
          <SvgIcon :name="videoPaused ? 'play' : 'pause'" :size="18" />
        </button>

        <ProgressBar @seek="handleSeekTime" />

        <VolumeControl />
      </div>

      <div class="hint-line">
        <span>
          <kbd>{{ comboText(store.keymap.prevVideo) }}</kbd>
          <kbd>{{ comboText(store.keymap.nextVideo) }}</kbd> 切换视频
        </span>
        <span>
          <kbd>{{ comboText(store.keymap.seekBackward) }}</kbd>
          <kbd>{{ comboText(store.keymap.seekForward) }}</kbd> 进度
        </span>
        <span><kbd>{{ comboText(store.keymap.togglePlay) }}</kbd> 播放/暂停</span>
        <span><kbd>{{ comboText(store.keymap.deleteCurrent) }}</kbd> 删除</span>
        <span><kbd>{{ comboText(store.keymap.toggleHelp) }}</kbd> 全部快捷键</span>
        <span class="spacer" />
        <span class="mode-tag" :class="{ fallback: store.mode !== 'handle' }">
          {{ store.mode === 'handle' ? '可读写目录' : '兼容模式：删除仅移出列表' }}
        </span>
      </div>
    </footer>

    <!-- 播放 / 暂停：只闪一个图标，无底色无遮罩 -->
    <PlayPulse :pulse="store.pulse" />

    <OsdToast :message="store.osd" />

    <Transition name="slide-panel">
      <PlaylistPanel v-if="store.activePanel === 'playlist'" />
    </Transition>
    <Transition name="slide-panel">
      <SettingsPanel v-if="store.activePanel === 'settings'" />
    </Transition>
    <Transition name="slide-panel">
      <DuplicatePanel v-if="store.activePanel === 'duplicates'" />
    </Transition>

    <!-- 快捷键帮助（按当前绑定动态渲染） -->
    <Transition name="fade">
      <div v-if="store.activePanel === 'help'" class="help-mask" @click="store.closePanel()">
        <div class="help-card" @click.stop>
          <h3>快捷键</h3>
          <p class="help-tip">
            均可在「设置 → 快捷键」里重新绑定；进度键按住 <kbd>Shift</kbd> 走 3 倍步长。
          </p>
          <ul>
            <li v-for="action in ACTIONS" :key="action.id">
              <span class="keys">
                <kbd
                  v-for="(token, i) in formatCombo(store.keymap[action.id])"
                  :key="`${action.id}-${i}`"
                  :class="{ muted: !store.keymap[action.id] }"
                >
                  {{ token }}
                </kbd>
              </span>
              <span class="label">{{ action.label }}</span>
            </li>
          </ul>
          <button class="help-close" @click="store.closePanel()">关闭</button>
        </div>
      </div>
    </Transition>

    <!-- 空状态 -->
    <div v-if="store.isEmpty" class="empty-state">
      <p>播放列表已空</p>
      <div class="empty-actions">
        <button class="solid" @click="backToImport">重新导入</button>
        <button v-if="store.canUndo" class="ghost" @click="store.undoDelete()">撤销删除</button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.player-view {
  position: relative;
  height: 100%;
  width: 100%;
  overflow: hidden;
  background: #000;
  cursor: default;

  &.idle {
    cursor: none;
  }
}

.top-bar,
.bottom-bar,
.rail {
  transition: opacity 0.25s var(--ease), transform 0.25s var(--ease);
}

/*
 * 刻意不做任何整屏宽的背景遮罩。
 *
 * 竖屏视频在横屏窗口里用 object-fit: contain 会留出纯黑边，而"把纯黑再压暗"没有任何变化，
 * 于是整屏蒙版只在视频那一列可见 —— 变成一个比屏幕窄、左右带硬边的暗色矩形，
 * 看起来就是"阶梯式遮罩"。只要存在黑边，任何全宽暗化都救不回来。
 *
 * 所以改成：控件自己带背景，纯文字用 text-shadow 保证在亮画面上也读得清。
 */
.controlsHidden {
  .top-bar {
    opacity: 0;
    transform: translateY(-12px);
    pointer-events: none;
  }

  .bottom-bar {
    opacity: 0;
    transform: translateY(14px);
    pointer-events: none;
  }

  .rail {
    opacity: 0;
    transform: translateX(-12px);
    pointer-events: none;
  }
}

.top-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  /* 底部 padding 不再需要为渐变留长度，遮罩由 .scrim 统一负责 */
  padding: 14px 20px 16px;
  z-index: 12;

  .title {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    /* 没有整屏蒙版，靠阴影保证文字在亮画面上也读得清 */
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.92), 0 0 2px rgba(0, 0, 0, 0.7);

    .name {
      overflow: hidden;
      font-size: 14px;
      font-weight: 600;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .meta {
      color: rgba(255, 255, 255, 0.78);
      font-size: 12px;
    }
  }

  .top-actions {
    display: flex;
    gap: 8px;
  }
}

.icon-btn {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  /*
   * 刻意不用 backdrop-filter：这几个按钮的父元素 .top-bar 会做 opacity / transform 动画，
   * 而 backdrop-filter 在带动画的祖先里会因 backdrop root 变化产生矩形伪影
   * （底栏没有 backdrop-filter，所以只有"顶部"出问题）。改用不透明度更高的底色。
   */
  background: rgba(18, 18, 26, 0.62);
  color: var(--text-primary);
  transition: background 0.16s var(--ease);

  &:hover {
    background: rgba(60, 60, 76, 0.72);
  }

  &.on {
    background: var(--accent);
  }
}

.rail {
  position: absolute;
  left: 20px;
  top: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  transform: translateY(-50%);
  z-index: 14;
}

.rail-btn,
.rail-item {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  /* 同 .icon-btn：.rail 也做 opacity / transform 动画，这里不能留 backdrop-filter */
  background: rgba(18, 18, 26, 0.72);
  color: var(--text-primary);
  transition: all 0.16s var(--ease);

  &:hover:not(:disabled) {
    background: rgba(70, 70, 88, 0.82);
    transform: scale(1.06);
  }

  &:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
}

.rail-item {
  width: 46px;
  height: 46px;

  &.on {
    background: var(--accent);
  }

  &.danger:hover {
    background: #d92c3f;
  }
}

.seek-slider {
  position: absolute;
  left: 82px;
  top: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 16px 12px;
  border-radius: 999px;
  background: rgba(18, 18, 26, 0.86);
  transform: translateY(-50%);
  z-index: 15;
  color: var(--text-secondary);

  .vertical {
    height: 220px;
    display: grid;
    place-items: center;
  }

  .range {
    width: 220px;
    height: 4px;
    appearance: none;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.2);
    cursor: pointer;
    transform: rotate(-90deg);

    &::-webkit-slider-thumb {
      appearance: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 0 8px rgba(254, 44, 85, 0.7);
    }

    &::-moz-range-thumb {
      width: 14px;
      height: 14px;
      border: none;
      border-radius: 50%;
      background: #fff;
    }
  }

  .counter {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
}

.bottom-bar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  /* 同理：60px 的顶部 padding 原本只是为了把渐变拉长，现在交给 .scrim */
  padding: 20px 24px 16px;
  z-index: 12;
}

.playline {
  display: flex;
  align-items: center;
  gap: 16px;
  max-width: 1400px;
  margin: 0 auto;

  > :nth-child(2) {
    flex: 1;
    min-width: 0;
  }
}

.play-btn {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  /* 同 .icon-btn：自带底色，不依赖整屏蒙版 */
  background: rgba(18, 18, 26, 0.62);
  color: #fff;
  transition: background 0.16s var(--ease);

  &:hover {
    background: rgba(60, 60, 76, 0.72);
  }
}

.hint-line {
  display: flex;
  align-items: center;
  gap: 16px;
  max-width: 1400px;
  margin: 10px auto 0;
  color: rgba(255, 255, 255, 0.62);
  font-size: 11px;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);

  span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
  }

  /* 全局 kbd 是给深色面板用的，叠在视频上需要自带一点底色才看得见 */
  kbd {
    border-color: rgba(255, 255, 255, 0.26);
    background: rgba(10, 10, 14, 0.55);
    text-shadow: none;
  }

  .spacer {
    flex: 1;
  }

  .mode-tag {
    padding: 2px 9px;
    border-radius: 999px;
    background: rgba(61, 220, 132, 0.14);
    color: #6fe0a3;

    &.fallback {
      background: rgba(255, 190, 90, 0.14);
      color: #ffc978;
    }
  }
}

.help-mask {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(8, 8, 12, 0.72);
  backdrop-filter: blur(8px);
  z-index: 26;
}

.help-card {
  width: min(620px, 90vw);
  max-height: 76vh;
  overflow-y: auto;
  padding: 26px 30px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  box-shadow: var(--shadow-panel);

  h3 {
    margin-bottom: 10px;
    font-size: 16px;
  }

  .help-tip {
    margin-bottom: 16px;
    color: var(--text-muted);
    font-size: 12px;
  }

  ul {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 26px;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-secondary);
    font-size: 13px;
  }

  .keys {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  kbd.muted {
    color: var(--text-muted);
    font-style: italic;
  }

  .help-close {
    width: 100%;
    height: 34px;
    margin-top: 20px;
    border: 1px solid var(--border-soft);
    border-radius: var(--radius-sm);
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-primary);
    font-size: 13px;

    &:hover {
      background: rgba(255, 255, 255, 0.12);
    }
  }
}

.empty-state {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  background: rgba(8, 8, 12, 0.9);
  z-index: 18;

  p {
    color: var(--text-secondary);
    font-size: 17px;
  }

  .empty-actions {
    display: flex;
    gap: 10px;
  }

  button {
    height: 38px;
    padding: 0 20px;
    border-radius: 999px;
    font-weight: 500;

    &.solid {
      background: linear-gradient(135deg, #fe2c55, #ff5f45);
      color: #fff;
    }

    &.ghost {
      border: 1px solid var(--border-soft);
      color: var(--text-secondary);
    }
  }
}

/* ------------------------------------------------------------------
 * 竖向切换动效（参考抖音）
 * - 新旧画面同时全屏滑动，纯 transform，不碰 opacity
 * - 两者都铺满视口，任意时刻画面都是满的，不会中途露出黑底
 * ------------------------------------------------------------------ */
.slide-up-enter-active,
.slide-up-leave-active,
.slide-down-enter-active,
.slide-down-leave-active {
  transition: transform 0.3s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.slide-up-enter-from {
  transform: translateY(100%);
}

.slide-up-leave-to {
  transform: translateY(-100%);
}

.slide-down-enter-from {
  transform: translateY(-100%);
}

.slide-down-leave-to {
  transform: translateY(100%);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s var(--ease);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-panel-enter-active,
.slide-panel-leave-active {
  transition: transform 0.24s var(--ease), opacity 0.24s var(--ease);
}

.slide-panel-enter-from,
.slide-panel-leave-to {
  transform: translateX(24px);
  opacity: 0;
}
</style>
