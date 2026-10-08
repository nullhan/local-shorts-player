<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { usePlayerStore } from '@/store/player'
import type { VideoItem } from '@/types'
import { formatDateTime, formatSize } from '@/utils/media'

const store = usePlayerStore()

const selected = ref<Set<string>>(new Set())
const confirming = ref(false)

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
</script>

<template>
  <aside class="dup-panel">
    <header class="head">
      <h3>
        <SvgIcon name="copy" :size="16" />
        重复视频
        <em v-if="store.duplicates.length">{{ store.duplicates.length }} 组</em>
      </h3>
      <button class="close" title="关闭" @click="store.closePanel()">
        <SvgIcon name="close" :size="16" />
      </button>
    </header>

    <div class="body">
      <!-- 还没扫描 -->
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

      <!-- 扫描中 -->
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

      <!-- 扫完没重复 -->
      <template v-else-if="!store.duplicates.length">
        <p class="tip ok">
          <SvgIcon name="check" :size="15" />
          没有发现重复视频
        </p>
        <button class="wide ghost" @click="store.scanDuplicates()">重新扫描</button>
      </template>

      <!-- 结果 -->
      <template v-else>
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
          <button class="mini ghost" @click="store.clearDuplicates()">重新扫描</button>
        </div>

        <div class="groups">
          <section v-for="group in store.duplicates" :key="group.fingerprint" class="group">
            <div class="group-head">
              <strong>{{ group.items.length }} 个相同文件</strong>
              <span>{{ formatSize(group.size) }} / 个</span>
            </div>
            <div class="group-body">
              <label
                v-for="(item, index) in group.items"
                :key="item.id"
                class="file"
                :class="{ picked: isSelected(item.id) }"
              >
                <input
                  type="checkbox"
                  :checked="isSelected(item.id)"
                  @change="toggle(item)"
                />
                <span class="info">
                  <span class="name">
                    {{ item.name }}
                    <em v-if="index === 0 && !isSelected(item.id)" class="keep">保留</em>
                  </span>
                  <span class="path">{{ item.parentPath || '根目录' }}</span>
                  <span class="date">
                    {{ formatSize(item.size) }} · {{ formatDateTime(item.mtime) }}
                  </span>
                </span>
              </label>
            </div>
          </section>
        </div>
      </template>
    </div>

    <!-- 底部操作条 -->
    <footer v-if="store.duplicates.length" class="foot">
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
          <button
            class="mini danger"
            :disabled="!selectedItems.length"
            @click="confirming = true"
          >
            <SvgIcon name="trash" :size="13" />
            删除选中
          </button>
        </div>
      </template>
    </footer>
  </aside>
</template>

<style scoped lang="less">
.dup-panel {
  position: absolute;
  top: 16px;
  right: 16px;
  bottom: 96px;
  width: 420px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  box-shadow: var(--shadow-panel);
  overflow: hidden;
  z-index: 20;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 14px 10px;

  h3 {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 14px;
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
    width: 26px;
    height: 26px;
    border-radius: 7px;
    color: var(--text-secondary);

    &:hover {
      background: rgba(255, 255, 255, 0.12);
      color: var(--text-primary);
    }
  }
}

.body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 14px 14px;
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

.summary {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;

  span {
    flex: 1;
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
  margin-bottom: 12px;
}

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
}

.group-body {
  padding: 4px;
}

.file {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 7px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.16s var(--ease);

  &:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  &.picked {
    background: rgba(217, 44, 63, 0.14);

    .name {
      color: #ff9aa8;
    }
  }

  input {
    flex: none;
    width: 15px;
    height: 15px;
    margin-top: 2px;
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

  .keep {
    flex: none;
    padding: 0 6px;
    border-radius: 999px;
    background: rgba(61, 220, 132, 0.16);
    color: #6fe0a3;
    font-size: 10px;
    font-style: normal;
  }

  .path,
  .date {
    overflow: hidden;
    color: var(--text-muted);
    font-size: 11px;
    text-overflow: ellipsis;
    white-space: nowrap;
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

.foot {
  padding: 10px 14px;
  border-top: 1px solid var(--border-soft);
}

.foot-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
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
</style>
