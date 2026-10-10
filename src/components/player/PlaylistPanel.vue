<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { usePlayerStore } from '@/store/player'
import type { SortKey } from '@/types'
import { comboText } from '@/utils/keymap'
import { formatDateTime, formatSize } from '@/utils/media'

const store = usePlayerStore()
const keyword = ref('')
const listRef = ref<HTMLDivElement | null>(null)

const sortOptions: Array<{ value: SortKey; label: string }> = [
  { value: 'default', label: '路径' },
  { value: 'name', label: '名称' },
  { value: 'size', label: '大小' },
  { value: 'mtime', label: '时间' }
]

const filtered = computed(() => {
  const query = keyword.value.trim().toLowerCase()
  const items = store.playlist
  if (!query) return items
  return items.filter((item) => item.relativePath.toLowerCase().includes(query))
})

/** 只有多来源时才需要标出"这条来自哪个文件夹" */
const showSource = computed(() => store.sourceCount > 1)

function sourceName(sourceId: string): string {
  return store.sources.find((source) => source.id === sourceId)?.name ?? '未知来源'
}

/** 按修改时间排序时，顺带把日期显示出来，方便核对顺序 */
const showMtime = computed(() => store.sortKey === 'mtime')

watch(
  () => store.currentId,
  async () => {
    await nextTick()
    const active = listRef.value?.querySelector<HTMLElement>('.item.active')
    active?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
)

function pick(id: string) {
  store.select(id)
  store.closePanel()
}
</script>

<template>
  <aside class="playlist-panel">
    <header class="head">
      <h3>
        <SvgIcon name="list" :size="16" />
        播放列表
        <em>{{ store.playlistCount }}</em>
      </h3>
      <button class="close" title="关闭 (N)" @click="store.closePanel()">
        <SvgIcon name="close" :size="16" />
      </button>
    </header>

    <!-- 文件夹筛选（按 O 的应用内跳转） -->
    <div v-if="store.folderFilter" class="folder-bar">
      <SvgIcon name="folder" :size="13" />
      <span class="label">只看</span>
      <span class="name" :title="store.folderFilter.parentPath">{{ store.folderFilterLabel }}</span>
      <span class="count">{{ store.playlistCount }} / {{ store.playlistTotal }}</span>
      <button class="clear" @click="store.clearFolderFilter()">显示全部</button>
    </div>

    <div class="search">
      <input v-model="keyword" type="text" placeholder="搜索文件名 / 路径…" />
    </div>

    <div class="sortbar">
      <span class="sort-label">排序</span>
      <button
        v-for="option in sortOptions"
        :key="option.value"
        class="sort-chip"
        :class="{ on: store.sortKey === option.value }"
        @click="store.setSort(option.value)"
      >
        {{ option.label }}
      </button>
      <button
        class="sort-dir"
        :title="store.sortDir === 'asc' ? '当前升序，点击切换为降序' : '当前降序，点击切换为升序'"
        @click="store.toggleSortDir()"
      >
        <SvgIcon :name="store.sortDir === 'asc' ? 'chevronUp' : 'chevronDown'" :size="14" />
      </button>
    </div>

    <div ref="listRef" class="list">
      <button
        v-for="(item, index) in filtered"
        :key="item.id"
        class="item"
        :class="{ active: item.id === store.currentId }"
        @click="pick(item.id)"
      >
        <span class="index">{{ index + 1 }}</span>
        <span class="info">
          <span class="name">{{ item.name }}</span>
          <span class="path">
            <template v-if="showSource">
              <em class="from">{{ sourceName(item.sourceId) }}</em> ·
            </template>
            {{ item.parentPath || '根目录' }} · {{ formatSize(item.size) }}
            <template v-if="showMtime"> · {{ formatDateTime(item.mtime) }}</template>
          </span>
        </span>
        <SvgIcon v-if="item.id === store.currentId" name="play" :size="14" />
      </button>

      <p v-if="!filtered.length" class="empty">
        {{ store.playlistCount ? '没有匹配的视频' : '播放列表为空' }}
      </p>
    </div>

    <footer class="foot">
      <span>
        {{ comboText(store.keymap.prevVideo) }} / {{ comboText(store.keymap.nextVideo) }} 切换 ·
        <kbd>滚轮</kbd> · {{ comboText(store.keymap.deleteCurrent) }} 删除当前
      </span>
    </footer>
  </aside>
</template>

<style scoped lang="less">
.playlist-panel {
  position: absolute;
  top: 16px;
  right: 16px;
  bottom: 96px;
  width: 340px;
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

.folder-bar {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 14px 8px;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  background: rgba(143, 196, 255, 0.14);
  color: #8fc4ff;
  font-size: 11.5px;

  .label {
    color: var(--text-secondary);
  }

  .name {
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    flex: none;
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }

  .clear {
    flex: none;
    margin-left: auto;
    padding: 0 8px;
    height: 22px;
    border-radius: 999px;
    background: rgba(143, 196, 255, 0.22);
    color: #cfe6ff;
    font-size: 11px;

    &:hover {
      background: rgba(143, 196, 255, 0.34);
    }
  }
}

.search {
  padding: 0 14px 8px;

  input {
    width: 100%;
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--border-soft);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-primary);
    font-size: 13px;
    outline: none;

    &::placeholder {
      color: var(--text-muted);
    }

    &:focus {
      border-color: var(--accent);
    }
  }
}

.sortbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px 10px;

  .sort-label {
    color: var(--text-muted);
    font-size: 11px;
  }

  .sort-chip {
    height: 24px;
    padding: 0 10px;
    border: 1px solid var(--border-soft);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-secondary);
    font-size: 11.5px;
    transition: all 0.16s var(--ease);

    &:hover {
      color: var(--text-primary);
    }

    &.on {
      border-color: transparent;
      background: var(--accent);
      color: #fff;
    }
  }

  .sort-dir {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    margin-left: auto;
    border: 1px solid var(--border-soft);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-secondary);

    &:hover {
      background: rgba(255, 255, 255, 0.14);
      color: var(--text-primary);
    }
  }
}

.list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px;
}

.item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  text-align: left;
  content-visibility: auto;
  contain-intrinsic-size: 54px;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  &.active {
    background: var(--accent-soft);
    color: #fff;

    .index {
      background: var(--accent);
      color: #fff;
    }
  }

  .index {
    display: grid;
    place-items: center;
    flex: none;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.08);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;

    .name {
      overflow: hidden;
      color: inherit;
      font-size: 13px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .path {
      overflow: hidden;
      color: var(--text-muted);
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;

      .from {
        color: #8fc4ff;
        font-style: normal;
      }
    }
  }
}

.empty {
  padding: 28px 10px;
  color: var(--text-muted);
  font-size: 13px;
  text-align: center;
}

.foot {
  padding: 10px 14px;
  border-top: 1px solid var(--border-soft);
  color: var(--text-muted);
  font-size: 11px;
}

/* 手机上让出整屏，列表项加大到可点尺寸 */
@media (hover: none), (max-width: 820px) {
  .playlist-panel {
    top: var(--safe-top);
    right: 0;
    bottom: 0;
    left: 0;
    width: auto;
    border: none;
    border-radius: 0;
    padding-bottom: var(--safe-bottom);
  }

  .head {
    padding: 12px 14px 8px;
  }

  .head .close,
  .foot {
    display: none;
  }

  .search input {
    height: 38px;
    font-size: 15px; /* ≥16px 才不会触发 iOS 自动缩放，这里折中 */
  }

  .item {
    padding: 12px 10px;
    contain-intrinsic-size: 62px;
  }

  .sort-chip,
  .sort-dir {
    height: 30px;
  }
}
</style>
