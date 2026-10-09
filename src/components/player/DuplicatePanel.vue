<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { togglePlay, videoPaused } from '@/composables/useVideoControl'
import { usePlayerStore } from '@/store/player'
import type { VideoItem } from '@/types'
import { comboText } from '@/utils/keymap'
import { formatDateTime, formatSize } from '@/utils/media'

const store = usePlayerStore()

const selected = ref<Set<string>>(new Set())
const confirming = ref(false)

/** 正在预览的文件；null 表示未预览 */
const previewing = ref<VideoItem | null>(null)
const previewEl = ref<HTMLVideoElement | null>(null)

/**
 * 预览时主播放器必须让出声音，否则两路音频会同时响。
 * 只在「进来时主播放器确实在播放」的情况下才记这个标志，
 * 关闭面板时据此恢复，避免把用户自己暂停的视频又放起来。
 */
let resumeMainOnClose = false

/** 多来源时标出每个副本属于哪个文件夹 —— 跨文件夹重复的关键信息 */
const showSource = computed(() => store.sourceCount > 1)

const hasResult = computed(() => store.duplicates.length > 0)

function sourceName(sourceId: string): string {
  return store.sources.find((source) => source.id === sourceId)?.name ?? '未知来源'
}

/** 该组是否跨文件夹（用于提示"这一类重复横跨多个文件夹"） */
function isCrossSource(items: VideoItem[]): boolean {
  return new Set(items.map((item) => item.sourceId)).size > 1
}

/** 预览项所在的分组与组内序号，便于知道"这是第几个副本" */
const previewGroup = computed(() => {
  const item = previewing.value
  if (!item) return null
  return store.duplicates.find((group) => group.items.some((each) => each.id === item.id)) ?? null
})

const previewIndex = computed(() => {
  const group = previewGroup.value
  const item = previewing.value
  if (!group || !item) return -1
  return group.items.findIndex((each) => each.id === item.id)
})

/**
 * 每次扫描结果变化后重建默认选择：每组保留第一个（列表顺序里的第一条），
 * 其余全部勾上 —— 也就是"删掉多余的副本"这个最常见的意图。
 */
watch(
  () => store.duplicates,
  (groups) => {
    const next = new Set<string>()
    for (const group of groups) {
      for (const item of group.items.slice(1)) next.add(item.id)
    }
    selected.value = next
    confirming.value = false

    // 正在预览的文件可能已经被删掉 / 重新扫描后不复存在
    const current = previewing.value
    if (current && !groups.some((group) => group.items.some((item) => item.id === current.id))) {
      previewing.value = null
    }
  },
  { immediate: true }
)

const selectedItems = computed(() => {
  const items: VideoItem[] = []
  for (const group of store.duplicates) {
    for (const item of group.items) {
      if (selected.value.has(item.id)) items.push(item)
    }
  }
  return items
})

const selectedBytes = computed(() =>
  selectedItems.value.reduce((sum, item) => sum + item.size, 0)
)

/**
 * 告诉 store「我现在关注的是哪一条」，供「打开所在文件夹」这类跨面板动作定位。
 * 优先级：正在预览的 > 第一个被勾选的。都没有就交还给"正在播放的那个视频"。
 */
watch(
  [previewing, selected],
  () => {
    store.setContextItem(previewing.value ?? selectedItems.value[0] ?? null)
  },
  { immediate: true }
)

const percent = computed(() => {
  const { doneBytes, totalBytes } = store.duplicateScan
  if (!totalBytes) return 0
  return Math.min(100, Math.round((doneBytes / totalBytes) * 100))
})

function isSelected(id: string): boolean {
  return selected.value.has(id)
}

function toggle(item: VideoItem) {
  const next = new Set(selected.value)
  if (next.has(item.id)) next.delete(item.id)
  else next.add(item.id)
  selected.value = next
  confirming.value = false
}

/* ---------------- 预览 ---------------- */

function pauseMainForPreview() {
  if (videoPaused.value) return
  togglePlay()
  resumeMainOnClose = true
}

/** 关闭预览时把主播放器恢复回来（只恢复我们暂停的那一次） */
function restoreMain() {
  if (!resumeMainOnClose) return
  resumeMainOnClose = false
  if (videoPaused.value) togglePlay()
}

function startPreview(item: VideoItem) {
  if (previewing.value?.id === item.id) return
  pauseMainForPreview()
  previewing.value = item
}

function stopPreview() {
  previewing.value = null
  restoreMain()
}

function applyPreviewVolume() {
  const el = previewEl.value
  if (!el) return
  el.volume = store.muted ? 0 : store.volume
}

function onPreviewReady() {
  applyPreviewVolume()
  void previewEl.value?.play().catch(() => undefined)
}

/** 在播放器里打开：必要时先切到该文件所属的来源 */
function openInPlayer(item: VideoItem) {
  // 交给播放器自己接管，不再需要恢复
  resumeMainOnClose = false
  if (store.playlistMode === 'separate' && store.activeSourceId !== item.sourceId) {
    store.activeSourceId = item.sourceId
  }
  store.select(item.id)
  previewing.value = null
  store.closePanel()
}

function togglePreviewSelection() {
  if (previewing.value) toggle(previewing.value)
}

/* ---------------- 关闭 / 快捷键 ---------------- */

function close() {
  previewing.value = null
  restoreMain()
  store.closePanel()
}

/** Esc：先关预览，再关面板；其余按键一律交给面板自己（全局快捷键已被拦截） */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  if (previewing.value) stopPreview()
  else close()
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  store.setContextItem(null)
  restoreMain()
})

/* ---------------- 选择 ---------------- */

/** 每组只留第一条，其余全选 */
function selectExtras() {
  const next = new Set<string>()
  for (const group of store.duplicates) {
    for (const item of group.items.slice(1)) next.add(item.id)
  }
  selected.value = next
  confirming.value = false
}

function clearSelection() {
  selected.value = new Set()
  confirming.value = false
}

async function confirmRemove() {
  const items = selectedItems.value
  if (!items.length) return
  await store.removeDuplicateItems(items)
  confirming.value = false
}

async function rescan() {
  previewing.value = null
  restoreMain()
  store.clearDuplicates()
  store.scanDuplicates()
}
</script>

<template>
  <div class="dup-mask" @click.self="close()">
    <div class="dup-panel">
      <header class="head">
        <h3>
          <SvgIcon name="copy" :size="16" />
          重复视频
          <em v-if="store.duplicates.length">{{ store.duplicates.length }} 组</em>
        </h3>
        <button class="close" title="关闭 (Esc)" @click="close()">
          <SvgIcon name="close" :size="16" />
        </button>
      </header>

      <!-- 结果工具条 -->
      <div v-if="hasResult" class="toolbar">
        <div class="summary">
          <span>
            <em>{{ store.duplicateStats.removable }}</em>
            个多余副本
          </span>
          <span>可释放 <em>{{ formatSize(store.duplicateStats.bytes) }}</em></span>
        </div>
        <div class="quick">
          <button class="mini" @click="selectExtras()">每组只留一个</button>
          <button class="mini ghost" @click="clearSelection()">清空选择</button>
          <button class="mini ghost" @click="rescan()">重新扫描</button>
        </div>
      </div>

      <!-- 未扫描 / 扫描中 / 无重复 -->
      <div v-if="!hasResult" class="body intro-body">
        <template v-if="!store.duplicatesScanned && !store.duplicateScan.scanning">
          <p class="intro">
            按<strong>文件内容</strong>对比，内容完全相同的视频会被归到一组（即使文件名不同）。
            先用文件体积排除掉绝大多数不可能相同的文件，再对体积相同的文件计算内容指纹。
          </p>
          <div class="stat-row">
            <span class="stat">
              <em>{{ store.playlistCount }}</em>
              个视频
            </span>
            <span class="stat">
              <em>{{ store.duplicateCandidateCount }}</em>
              个需要校验
            </span>
          </div>
          <p v-if="store.duplicateCandidateCount === 0" class="tip ok">
            没有体积相同的文件，扫描会瞬间完成 —— 直接点下面的按钮即可确认。
          </p>
          <p v-if="!store.duplicateSupported" class="tip warn">
            当前环境不支持内容校验（需要 https 或 localhost 打开页面），无法扫描。
          </p>
          <button class="wide" :disabled="!store.duplicateSupported" @click="store.scanDuplicates()">
            <SvgIcon name="copy" :size="15" />
            开始扫描重复视频
          </button>
          <p class="tip">
            内容指纹用分块 SHA-256 计算，内存占用固定，几 GB 的文件也不会卡住页面。
          </p>
        </template>

        <template v-else-if="store.duplicateScan.scanning">
          <div class="progress">
            <div class="bar" :style="{ width: `${percent}%` }" />
          </div>
          <div class="progress-meta">
            <span>{{ percent }}%</span>
            <span>
              {{ store.duplicateScan.doneFiles }} / {{ store.duplicateScan.totalFiles }} 个文件
            </span>
          </div>
          <p class="tip">
            已读取 {{ formatSize(store.duplicateScan.doneBytes) }} /
            {{ formatSize(store.duplicateScan.totalBytes) }}
          </p>
          <button class="wide ghost" @click="store.cancelDuplicateScan()">取消扫描</button>
        </template>

        <template v-else>
          <p class="tip ok">
            <SvgIcon name="check" :size="15" />
            没有发现重复视频
          </p>
          <button class="wide ghost" @click="store.scanDuplicates()">重新扫描</button>
        </template>
      </div>

      <!-- 结果：左预览 + 右列表 -->
      <div v-else class="body result-body">
        <section class="preview-pane">
          <div class="preview-stage">
            <video
              v-if="previewing"
              :key="previewing.id"
              ref="previewEl"
              class="preview-video"
              :src="previewing.url"
              :muted="store.muted"
              controls
              autoplay
              loop
              playsinline
              preload="auto"
              @loadedmetadata="onPreviewReady"
            />
            <div v-else class="preview-empty">
              <SvgIcon name="eye" :size="26" />
              <p>点击右侧任意文件即可在这里预览</p>
              <p class="sub">核对完再决定保留哪一个 · 双击可直接在播放器中打开</p>
            </div>
          </div>

          <div v-if="previewing" class="preview-meta">
            <p class="name" :title="previewing.relativePath">{{ previewing.name }}</p>
            <p class="line">
              <template v-if="showSource">
                <em class="from">{{ sourceName(previewing.sourceId) }}</em> ·
              </template>
              {{ previewing.parentPath || '根目录' }}
            </p>
            <p class="line">
              {{ formatSize(previewing.size) }} · {{ formatDateTime(previewing.mtime) }}
              <template v-if="previewIndex >= 0">
                · 第 {{ previewIndex + 1 }} / {{ previewGroup?.items.length }} 个副本
              </template>
            </p>
            <div class="preview-actions">
              <button class="mini" @click="openInPlayer(previewing)">
                <SvgIcon name="external" :size="13" />
                在播放器中打开
              </button>
              <button
                class="mini"
                :class="{ ghost: !isSelected(previewing.id) }"
                @click="togglePreviewSelection()"
              >
                <SvgIcon :name="isSelected(previewing.id) ? 'check' : 'trash'" :size="13" />
                {{ isSelected(previewing.id) ? '标记为保留' : '标记为删除' }}
              </button>
              <button class="mini ghost" @click="stopPreview()">关闭预览</button>
            </div>
          </div>
        </section>

        <section class="groups-pane">
          <div class="groups">
            <section v-for="group in store.duplicates" :key="group.fingerprint" class="group">
              <div class="group-head">
                <strong>{{ group.items.length }} 个相同文件</strong>
                <span v-if="isCrossSource(group.items)" class="cross">跨文件夹</span>
                <span>{{ formatSize(group.size) }} / 个</span>
              </div>
              <div class="group-body">
                <div
                  v-for="(item, index) in group.items"
                  :key="item.id"
                  class="file"
                  :class="{ picked: isSelected(item.id), previewing: previewing?.id === item.id }"
                  :title="`点击预览 · ${item.relativePath}`"
                  @click="startPreview(item)"
                  @dblclick="openInPlayer(item)"
                >
                  <input
                    type="checkbox"
                    :checked="isSelected(item.id)"
                    title="勾选后将从磁盘删除（或移入回收站）"
                    @click.stop
                    @change="toggle(item)"
                  />
                  <span class="info">
                    <span class="name">
                      {{ item.name }}
                      <em v-if="index === 0 && !isSelected(item.id)" class="keep">保留</em>
                      <em v-if="previewing?.id === item.id" class="now">预览中</em>
                    </span>
                    <span class="path">
                      <template v-if="showSource">
                        <em class="from">{{ sourceName(item.sourceId) }}</em> ·
                      </template>
                      {{ item.parentPath || '根目录' }}
                    </span>
                    <span class="date">
                      {{ formatSize(item.size) }} · {{ formatDateTime(item.mtime) }}
                    </span>
                  </span>
                  <button class="row-eye" title="预览" @click.stop="startPreview(item)">
                    <SvgIcon name="eye" :size="15" />
                  </button>
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>

      <!-- 底部操作条 -->
      <footer v-if="hasResult" class="foot">
        <template v-if="confirming">
          <p class="confirm" :class="{ danger: store.deleteMode === 'permanent' }">
            确认删除 {{ selectedItems.length }} 个文件（{{ formatSize(selectedBytes) }}）？
            <template v-if="store.deleteMode === 'permanent'">
              当前为<strong>永久删除</strong>，不可撤销。
            </template>
            <template v-else>会移入回收站，可用 Ctrl+Z 逐个还原。</template>
          </p>
          <div class="confirm-actions">
            <button class="mini ghost" @click="confirming = false">取消</button>
            <button class="mini danger" @click="confirmRemove()">
              确认删除 {{ selectedItems.length }} 个
            </button>
          </div>
        </template>
        <template v-else>
          <div class="foot-row">
            <span class="foot-info">
              已选 {{ selectedItems.length }} 个 · {{ formatSize(selectedBytes) }}
            </span>
            <div class="foot-right">
              <span class="key-hint">
                选中后按 <kbd>{{ comboText(store.keymap.openFolder) }}</kbd> 打开所在文件夹
              </span>
              <button
                class="mini danger"
                :disabled="!selectedItems.length"
                @click="confirming = true"
              >
                <SvgIcon name="trash" :size="13" />
                删除选中
              </button>
            </div>
          </div>
        </template>
      </footer>
    </div>
  </div>
</template>

<style scoped lang="less">
.dup-mask {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(6, 6, 10, 0.68);
}

.dup-panel {
  width: 100%;
  height: 100%;
  max-width: 1280px;
  max-height: 880px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  box-shadow: var(--shadow-panel);
  overflow: hidden;
  /* 遮罩的淡入由 PlayerView 的 fade 过渡负责；卡片自己缩放进场 */
  animation: dup-in 0.2s var(--ease);
}

@keyframes dup-in {
  from {
    opacity: 0;
    transform: scale(0.97);
  }
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 18px 12px;

  h3 {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 15px;
    font-weight: 600;

    em {
      padding: 0 6px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.12);
      color: var(--text-secondary);
      font-size: 11px;
      font-style: normal;
    }
  }

  .close {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    color: var(--text-secondary);

    &:hover {
      background: rgba(255, 255, 255, 0.12);
      color: var(--text-primary);
    }
  }
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 18px 12px;
}

.summary {
  display: flex;
  flex: 1;
  gap: 10px;

  span {
    padding: 9px 12px;
    border-radius: var(--radius-sm);
    background: rgba(254, 44, 85, 0.12);
    color: #ff9aa8;
    font-size: 11.5px;

    em {
      color: #fff;
      font-style: normal;
      font-weight: 700;
    }
  }
}

.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.body {
  flex: 1;
  min-height: 0;
}

.intro-body {
  width: 100%;
  max-width: 620px;
  align-self: center;
  overflow-y: auto;
  padding: 4px 4px 20px;
}

.result-body {
  display: grid;
  grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
  /* 显式给行一个可收缩的上限：否则行高会被内容的 min-content 顶开 */
  grid-template-rows: minmax(0, 1fr);
  gap: 16px;
  padding: 0 18px 4px;
}

/* ---------------- 预览区 ---------------- */

.preview-pane {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  /* 关键：grid item 的 min-height:auto 会被视频的固有高度撑开，必须显式归零 */
  min-height: 0;
  overflow: hidden;
  padding-bottom: 14px;
}

/*
 * 预览视频必须绝对定位铺满，不能靠 place-items:center + max-height:100%。
 * 原因和 VideoStage.vue 里 .video-el 一样：可替换元素带固有宽高比时，
 * grid/flex item 的自动最小尺寸会取固有尺寸，而百分比 max-height 在
 * "高度不确定"的容器里会解析成 none，挡不住它 —— 结果是视频把整个左栏撑大，
 * 下面的按钮被挤出卡片、右侧分界线跟着错位。
 * 绝对定位后视频不参与布局，尺寸完全由容器决定。
 */
.preview-stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: #000;
  overflow: hidden;
}

.preview-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}

.preview-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 20px;
  color: var(--text-muted);
  text-align: center;

  p {
    font-size: 12.5px;
  }

  .sub {
    color: var(--text-muted);
    font-size: 11.5px;
    opacity: 0.8;
  }
}

.preview-meta {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 3px;

  .name {
    overflow: hidden;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .line {
    overflow: hidden;
    color: var(--text-muted);
    font-size: 11.5px;
    text-overflow: ellipsis;
    white-space: nowrap;

    .from {
      color: #8fc4ff;
      font-style: normal;
    }
  }
}

.preview-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 8px;
}

/* ---------------- 列表区 ---------------- */

.groups-pane {
  min-width: 0;
  overflow-y: auto;
  padding: 0 0 14px 16px;
  border-left: 1px solid var(--border-soft);
}

.groups {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.group {
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 11px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-muted);
  font-size: 11.5px;

  strong {
    color: var(--text-primary);
    font-weight: 600;
  }

  .cross {
    margin-left: auto;
    margin-right: 8px;
    padding: 0 7px;
    border-radius: 999px;
    background: rgba(143, 196, 255, 0.16);
    color: #8fc4ff;
    font-size: 10px;
  }
}

.group-body {
  padding: 4px;
}

.file {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.16s var(--ease);

  &:hover {
    background: rgba(255, 255, 255, 0.06);

    .row-eye {
      opacity: 1;
    }
  }

  &.picked {
    background: rgba(217, 44, 63, 0.14);

    .name {
      color: #ff9aa8;
    }
  }

  &.previewing {
    background: rgba(143, 196, 255, 0.14);
    outline: 1px solid rgba(143, 196, 255, 0.42);

    .name {
      color: #cfe6ff;
    }
  }

  input {
    flex: none;
    width: 16px;
    height: 16px;
    accent-color: #d92c3f;
    cursor: pointer;
  }

  .info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .name {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    color: var(--text-primary);
    font-size: 12.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .keep,
  .now {
    flex: none;
    padding: 0 6px;
    border-radius: 999px;
    font-size: 10px;
    font-style: normal;
  }

  .keep {
    background: rgba(61, 220, 132, 0.16);
    color: #6fe0a3;
  }

  .now {
    background: rgba(143, 196, 255, 0.2);
    color: #8fc4ff;
  }

  .path,
  .date {
    overflow: hidden;
    color: var(--text-muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .path .from {
    color: #8fc4ff;
    font-style: normal;
  }
}

.row-eye {
  flex: none;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  color: var(--text-secondary);
  opacity: 0.45;
  transition: all 0.16s var(--ease);

  &:hover {
    background: rgba(255, 255, 255, 0.14);
    color: var(--text-primary);
  }
}

/* ---------------- 通用控件 ---------------- */

.mini {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-primary);
  font-size: 12px;
  transition: all 0.16s var(--ease);

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.13);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &.ghost {
    background: transparent;
    color: var(--text-secondary);
  }

  &.danger {
    border-color: transparent;
    background: #d92c3f;
    color: #fff;

    &:hover:not(:disabled) {
      background: #e8384c;
    }
  }
}

.wide {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: 100%;
  height: 34px;
  margin-top: 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-primary);
  font-size: 13px;
  transition: background 0.16s var(--ease);

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &.ghost {
    background: transparent;
    color: var(--text-secondary);
  }
}

.intro {
  color: var(--text-secondary);
  font-size: 12.5px;
  line-height: 1.7;

  strong {
    color: var(--text-primary);
    font-weight: 600;
  }
}

.stat-row {
  display: flex;
  gap: 10px;
  margin: 12px 0;

  .stat {
    flex: 1;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-muted);
    font-size: 11.5px;

    em {
      display: block;
      color: var(--text-primary);
      font-size: 17px;
      font-style: normal;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
  }
}

.tip {
  margin-top: 10px;
  color: var(--text-muted);
  font-size: 11.5px;
  line-height: 1.7;

  &.ok {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: rgba(61, 220, 132, 0.12);
    color: #6fe0a3;
  }

  &.warn {
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    background: rgba(255, 190, 90, 0.12);
    color: #ffc978;
  }
}

.progress {
  height: 6px;
  margin-top: 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}

.bar {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #fe2c55, #ff6a3d);
  transition: width 0.2s linear;
}

.progress-meta {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  color: var(--text-secondary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.foot {
  padding: 10px 18px;
  border-top: 1px solid var(--border-soft);
}

.foot-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.foot-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.key-hint {
  color: var(--text-muted);
  font-size: 11.5px;

  kbd {
    margin: 0 1px;
  }
}

.foot-info {
  color: var(--text-muted);
  font-size: 11.5px;
}

.confirm {
  margin-bottom: 9px;
  padding: 9px 11px;
  border-radius: var(--radius-sm);
  background: rgba(255, 190, 90, 0.12);
  color: #ffc978;
  font-size: 11.5px;
  line-height: 1.65;

  strong {
    font-weight: 700;
  }

  &.danger {
    background: rgba(217, 44, 63, 0.16);
    color: #ff9aa8;
  }
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* 窄窗口：预览挪到上方，列表占满剩余空间 */
@media (max-width: 900px) {
  .result-body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 38%) minmax(0, 1fr);
    gap: 10px;
  }

  .groups-pane {
    padding-left: 0;
    border-left: none;
    border-top: 1px solid var(--border-soft);
    padding-top: 12px;
  }

  .toolbar {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
