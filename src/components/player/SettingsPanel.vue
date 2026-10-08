<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { videoNativeHeight, videoNativeWidth } from '@/composables/useVideoControl'
import type { FitMode } from '@/store/player'
import { usePlayerStore } from '@/store/player'
import type { ActionId, SortKey } from '@/types'
import { ACTIONS, comboFromEvent, comboText, isModifierKey } from '@/utils/keymap'
import { SEEK_STEP_MAX, SEEK_STEP_MIN } from '@/utils/prefs'

const store = usePlayerStore()

const volumePercent = computed(() => Math.round(store.volume * 100))

const supportsRealDelete = computed(() => store.mode === 'handle' && Boolean(store.rootName))

const seekOptions = [3, 5, 10, 15, 30]
const rateOptions = [0.5, 0.75, 1, 1.25, 1.5, 2]

const fitModes: Array<{ value: FitMode; label: string }> = [
  { value: 'contain', label: '完整显示' },
  { value: 'cover', label: '填满裁切' },
  { value: 'fill', label: '拉伸铺满' }
]

const sortOptions: Array<{ value: SortKey; label: string }> = [
  { value: 'default', label: '路径' },
  { value: 'name', label: '名称' },
  { value: 'size', label: '大小' },
  { value: 'mtime', label: '修改时间' }
]

/* ---------------- 自定义步进 ---------------- */

const seekStepInput = ref(String(store.seekStep))

watch(
  () => store.seekStep,
  (value) => {
    seekStepInput.value = String(value)
  }
)

function commitSeekStep() {
  const parsed = Number(seekStepInput.value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    seekStepInput.value = String(store.seekStep)
    return
  }
  const next = Math.min(Math.max(Math.round(parsed), SEEK_STEP_MIN), SEEK_STEP_MAX)
  store.seekStep = next
  seekStepInput.value = String(next)
  store.showFeedback(`方向键步进 ${next} 秒`, 'info')
}

/* ---------------- 按键录制 ---------------- */

const recording = ref<ActionId | null>(null)

/** 分组展示，保留 ACTIONS 的声明顺序 */
const actionGroups = computed(() => {
  const groups: Array<{ title: string; items: typeof ACTIONS }> = []
  for (const action of ACTIONS) {
    const last = groups[groups.length - 1]
    if (last && last.title === action.group) last.items.push(action)
    else groups.push({ title: action.group, items: [action] })
  }
  return groups
})

function startRecord(id: ActionId) {
  recording.value = id
  store.capturingKey = true
}

function stopRecord() {
  recording.value = null
  store.capturingKey = false
}

/**
 * 用捕获阶段监听并阻止继续传播：
 * 这样全局快捷键（useShortcuts 注册在冒泡阶段）不会同时触发，
 * 另外 store.capturingKey 作为双保险。
 */
function onRecordKeydown(event: KeyboardEvent) {
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') {
    stopRecord()
    return
  }
  if (isModifierKey(event.key)) return
  const combo = comboFromEvent(event)
  if (!combo) return
  const action = recording.value
  if (!action) return
  store.setKeybinding(action, combo)
  stopRecord()
}

watch(recording, (value) => {
  if (value) window.addEventListener('keydown', onRecordKeydown, { capture: true })
  else window.removeEventListener('keydown', onRecordKeydown, { capture: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onRecordKeydown, { capture: true })
  store.capturingKey = false
})

function clearBinding(id: ActionId) {
  store.setKeybinding(id, '')
}
</script>

<template>
  <aside class="settings-panel">
    <header class="head">
      <h3>
        <SvgIcon name="gear" :size="16" />
        设置
      </h3>
      <button class="close" title="关闭" @click="store.closePanel()">
        <SvgIcon name="close" :size="16" />
      </button>
    </header>

    <div class="body">
      <section class="group">
        <div class="group-title">操作</div>

        <label class="row">
          <span>显示提示</span>
          <input v-model="store.osdEnabled" type="checkbox" class="switch" />
        </label>

        <label class="row sub" :class="{ disabled: !store.osdEnabled }">
          <span>
            重要提示
            <em>删除 / 导入结果 / 权限失败</em>
          </span>
          <input
            v-model="store.osdImportant"
            type="checkbox"
            class="switch"
            :disabled="!store.osdEnabled"
          />
        </label>

        <p class="note">
          「显示提示」是总开关，<strong>关掉后不会出现任何浮层提示</strong>（含删除、导入结果）。
          只想屏蔽音量 / 进度 / 倍速这类高频反馈，就把它留在打开、再单独关掉「重要提示」。
          播放 / 暂停不受影响，始终只在画面中央闪一下图标。
        </p>

        <div class="row column">
          <span>方向键步进</span>
          <div class="chips">
            <button
              v-for="step in seekOptions"
              :key="step"
              class="chip"
              :class="{ on: store.seekStep === step }"
              @click="store.seekStep = step"
            >
              {{ step }}s
            </button>
          </div>
          <label class="custom-input">
            <span>自定义</span>
            <input
              v-model="seekStepInput"
              type="number"
              :min="SEEK_STEP_MIN"
              :max="SEEK_STEP_MAX"
              step="1"
              @change="commitSeekStep"
              @keydown.enter="commitSeekStep"
            />
            <span>秒（{{ SEEK_STEP_MIN }}–{{ SEEK_STEP_MAX }}）</span>
          </label>
          <p class="note">
            进度键按住 <kbd>Shift</kbd> 会走 3 倍步长，例如 {{ store.seekStep }}s /
            {{ store.seekStep * 3 }}s。
          </p>
        </div>
      </section>

      <section class="group">
        <div class="group-title">快捷键</div>

        <div v-for="group in actionGroups" :key="group.title" class="key-group">
          <div class="key-group-title">{{ group.title }}</div>
          <div
            v-for="action in group.items"
            :key="action.id"
            class="key-row"
            :class="{ recording: recording === action.id }"
          >
            <span class="key-label">
              {{ action.label }}
              <em v-if="action.tip">{{ action.tip }}</em>
            </span>
            <button
              class="key-btn"
              :class="{ empty: !store.keymap[action.id], active: recording === action.id }"
              :title="recording === action.id ? '按下要绑定的按键，Esc 取消' : '点击后按下新按键'"
              @click="recording === action.id ? stopRecord() : startRecord(action.id)"
            >
              <template v-if="recording === action.id">按下按键…</template>
              <template v-else>{{ comboText(store.keymap[action.id]) }}</template>
            </button>
            <button
              class="key-clear"
              :disabled="!store.keymap[action.id]"
              title="解除绑定"
              @click="clearBinding(action.id)"
            >
              <SvgIcon name="close" :size="12" />
            </button>
          </div>
        </div>

        <p class="note">
          点击按键按钮后按下新的按键即可重新绑定；若与其他动作冲突，会解除对方的绑定。方向键、滚轮、鼠标点击不受影响。
        </p>

        <button class="wide ghost" @click="store.resetKeybindings()">
          <SvgIcon name="undo" :size="15" />
          恢复默认按键
        </button>
      </section>

      <section class="group">
        <div class="group-title">画面</div>

        <div class="row column">
          <span>画面适配</span>
          <div class="chips">
            <button
              v-for="mode in fitModes"
              :key="mode.value"
              class="chip"
              :class="{ on: store.fitMode === mode.value }"
              @click="store.fitMode = mode.value"
            >
              {{ mode.label }}
            </button>
          </div>
        </div>

        <p class="note">
          默认「完整显示」保留原始长宽比、不裁切画面
          <template v-if="videoNativeWidth && videoNativeHeight">
            （当前 {{ videoNativeWidth }}×{{ videoNativeHeight }}）
          </template>
          。「填满裁切」会去掉上下 / 左右黑边，但画面两侧或上下会被截断。
        </p>

        <div class="row">
          <span>当前视频转向</span>
          <strong class="value">{{ store.transformLabel }}</strong>
        </div>

        <div class="chips row-chips">
          <button class="chip" @click="store.rotateVideo()">
            <SvgIcon name="rotate" :size="13" />
            顺时针 90°
          </button>
          <button class="chip" :class="{ on: store.currentTransform.flip }" @click="store.toggleFlip()">
            <SvgIcon name="flip" :size="13" />
            水平镜像
          </button>
          <button class="chip" :disabled="!store.hasTransform" @click="store.resetTransform()">
            复位
          </button>
        </div>

        <p class="note">
          有些视频是斜着拍甚至整个倒过来的，这里可以单独纠正。
          <strong>转向按视频逐个记录</strong>（靠文件名 + 体积 + 修改时间关联），
          切换上下视频不会互相影响，重新打开同一个文件夹也仍然有效。
          快捷键：<kbd>{{ comboText(store.keymap.rotateVideo) }}</kbd> 旋转、
          <kbd>{{ comboText(store.keymap.flipVideo) }}</kbd> 镜像。
        </p>

        <button class="wide ghost" @click="store.clearAllTransforms()">
          <SvgIcon name="undo" :size="15" />
          清除全部转向记录
        </button>
      </section>

      <section class="group">
        <div class="group-title">播放</div>

        <label class="row">
          <span>切换后自动播放</span>
          <input v-model="store.autoPlay" type="checkbox" class="switch" />
        </label>

        <div class="row column">
          <span>播放模式</span>
          <div class="chips">
            <button
              class="chip"
              :class="{ on: store.loopMode === 'loop' }"
              @click="store.loopMode = 'loop'"
            >
              列表循环
            </button>
            <button
              class="chip"
              :class="{ on: store.loopMode === 'once' }"
              @click="store.loopMode = 'once'"
            >
              播完暂停
            </button>
          </div>
        </div>

        <div class="row column">
          <span>默认音量 {{ volumePercent }}%</span>
          <input
            class="slider"
            type="range"
            min="0"
            max="100"
            :value="volumePercent"
            :style="{ '--value': `${volumePercent}%` }"
            @input="store.setVolume(Number(($event.target as HTMLInputElement).value) / 100, true)"
          />
        </div>

        <div class="row column">
          <span>倍速</span>
          <div class="chips">
            <button
              v-for="rate in rateOptions"
              :key="rate"
              class="chip"
              :class="{ on: store.playbackRate === rate }"
              @click="store.setPlaybackRate(rate)"
            >
              {{ rate }}x
            </button>
          </div>
        </div>
      </section>

      <section class="group">
        <div class="group-title">播放列表</div>

        <div class="row column">
          <span>默认排序</span>
          <div class="chips">
            <button
              v-for="option in sortOptions"
              :key="option.value"
              class="chip"
              :class="{ on: store.sortKey === option.value }"
              @click="store.setSort(option.value)"
            >
              {{ option.label }}
            </button>
            <button class="chip" @click="store.toggleSortDir()">
              {{ store.sortDir === 'asc' ? '升序 ↑' : '降序 ↓' }}
            </button>
          </div>
        </div>

        <p class="note">
          排序会直接改变播放列表顺序，因此也决定上下切换的顺序；在播放列表面板顶部也能随时切换。
        </p>
      </section>

      <section class="group">
        <div class="group-title">重复视频</div>

        <div class="row">
          <span>内容完全相同的视频</span>
          <strong class="value">
            {{ store.duplicates.length ? `${store.duplicates.length} 组` : '未扫描' }}
          </strong>
        </div>

        <button class="wide" @click="store.togglePanel('duplicates')">
          <SvgIcon name="copy" :size="15" />
          扫描并清理重复视频
        </button>

        <p class="note">
          按<strong>文件内容</strong>对比，不看文件名 —— 同一段视频改了名字、散在不同子目录里也能找出来。
          先用体积排除掉不可能相同的文件，再对体积相同的文件计算内容指纹（分块 SHA-256）。
          删除沿用上面的「Delete 键行为」设置。
        </p>
      </section>

      <section class="group">
        <div class="group-title">删除</div>

        <div class="row column">
          <span>Delete 键行为</span>
          <div class="chips">
            <button
              class="chip"
              :class="{ on: store.deleteMode === 'trash' }"
              @click="store.deleteMode = 'trash'"
            >
              移入回收站
            </button>
            <button
              class="chip danger"
              :class="{ on: store.deleteMode === 'permanent' }"
              @click="store.deleteMode = 'permanent'"
            >
              永久删除
            </button>
          </div>
        </div>

        <p class="note" :class="{ warn: store.deleteMode === 'permanent' }">
          <template v-if="!supportsRealDelete">
            当前为兼容模式（拖拽 / 文件夹选择），浏览器不允许网页删除本地原文件，Delete 只会把条目移出列表。
          </template>
          <template v-else-if="store.deleteMode === 'permanent'">
            永久删除会直接调用文件系统接口，文件不会进入回收站，删除后无法通过 Ctrl+Z 撤销。
          </template>
          <template v-else>
            删除的文件会复制到所选目录下的 <code>.shorts-trash</code> 文件夹，按 Ctrl+Z 可还原。
          </template>
        </p>

        <button v-if="store.canUndo" class="wide" @click="store.undoDelete()">
          <SvgIcon name="undo" :size="15" />
          撤销最近一次删除（{{ store.trash.length }}）
        </button>
      </section>

      <section class="group">
        <div class="group-title">数据源</div>

        <div class="source">
          <span class="label">目录</span>
          <span class="value">{{ store.rootName || '未绑定目录' }}</span>
          <span class="tag">{{ store.mode === 'handle' ? '可读写' : '只读（兼容模式）' }}</span>
        </div>

        <div class="source-actions">
          <button class="wide" @click="store.importByPicker()">
            <SvgIcon name="folder" :size="15" />
            切换文件夹
          </button>
          <button class="wide ghost" @click="store.forgetSession()">清除记忆的目录</button>
        </div>
      </section>

      <section class="group">
        <div class="group-title">偏好</div>
        <p class="note">按键绑定、排序、音量、倍速等设置会自动保存，下次打开自动恢复。</p>
        <button class="wide ghost" @click="store.resetPrefs()">
          <SvgIcon name="undo" :size="15" />
          恢复默认设置
        </button>
      </section>
    </div>
  </aside>
</template>

<style scoped lang="less">
.settings-panel {
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
  padding: 4px 14px 18px;
}

.group {
  padding: 12px 0 16px;

  & + .group {
    border-top: 1px solid var(--border-soft);
  }
}

.group-title {
  margin-bottom: 10px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 0;
  color: var(--text-secondary);
  font-size: 13px;

  &.column {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  /* 子开关：缩进一级，并在总开关关闭时整行置灰 */
  &.sub {
    margin-top: 2px;
    padding-left: 10px;
    border-left: 2px solid var(--border-soft);

    em {
      display: block;
      color: var(--text-muted);
      font-size: 10.5px;
      font-style: normal;
    }

    &.disabled {
      opacity: 0.45;

      .switch {
        cursor: not-allowed;
      }
    }
  }
}

.switch {
  appearance: none;
  position: relative;
  flex: none;
  width: 38px;
  height: 21px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  cursor: pointer;
  transition: background 0.2s var(--ease);

  &::after {
    content: '';
    position: absolute;
    top: 2.5px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s var(--ease);
  }

  &:checked {
    background: var(--accent);

    &::after {
      transform: translateX(16px);
    }
  }
}

.slider {
  width: 100%;
  height: 4px;
  appearance: none;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--accent) 0%,
    var(--accent) var(--value),
    rgba(255, 255, 255, 0.18) var(--value),
    rgba(255, 255, 255, 0.18) 100%
  );
  cursor: pointer;

  &::-webkit-slider-thumb {
    appearance: none;
    width: 13px;
    height: 13px;
    border-radius: 50%;
    background: #fff;
  }

  &::-moz-range-thumb {
    width: 13px;
    height: 13px;
    border: none;
    border-radius: 50%;
    background: #fff;
  }
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

/* 直接放在 section 里（不在 .row 内）的 chips 需要自己补上间距 */
.row-chips {
  margin-top: 10px;
}

.row .value {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 27px;
  padding: 0 12px;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-secondary);
  font-size: 12px;
  transition: all 0.16s var(--ease);

  &:hover {
    border-color: var(--border-strong);
    color: var(--text-primary);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;

    &:hover {
      border-color: var(--border-soft);
      color: var(--text-secondary);
    }
  }

  &.on {
    border-color: transparent;
    background: var(--accent);
    color: #fff;
  }

  &.danger.on {
    background: #d92c3f;
  }
}

.custom-input {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  font-size: 12px;

  input {
    width: 84px;
    height: 28px;
    padding: 0 9px;
    border: 1px solid var(--border-soft);
    border-radius: var(--radius-sm);
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-primary);
    font-size: 12px;
    outline: none;

    &:focus {
      border-color: var(--accent);
    }
  }
}

.note {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.65;

  code {
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-secondary);
    font-size: 11px;
  }

  strong {
    color: var(--text-secondary);
    font-weight: 600;
  }

  kbd {
    min-width: 18px;
    height: 18px;
    font-size: 10px;
  }

  &.warn {
    background: rgba(217, 44, 63, 0.14);
    color: #ff9aa8;
  }
}

.key-group {
  margin-bottom: 12px;
}

.key-group-title {
  margin-bottom: 6px;
  color: var(--text-muted);
  font-size: 11px;
}

.key-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;

  &.recording {
    position: relative;
  }
}

.key-label {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  color: var(--text-secondary);
  font-size: 12.5px;

  em {
    color: var(--text-muted);
    font-size: 10.5px;
    font-style: normal;
  }
}

.key-btn {
  flex: none;
  min-width: 78px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border-strong);
  border-bottom-width: 2px;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.07);
  color: var(--text-primary);
  font-size: 12px;
  white-space: nowrap;
  transition: all 0.16s var(--ease);

  &:hover {
    background: rgba(255, 255, 255, 0.14);
  }

  &.empty {
    color: var(--text-muted);
    font-style: italic;
  }

  &.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: #fff;
  }
}

.key-clear {
  flex: none;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--text-muted);

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
    color: var(--text-primary);
  }

  &:disabled {
    opacity: 0.25;
    cursor: not-allowed;
  }
}

.wide {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  width: 100%;
  height: 34px;
  margin-top: 10px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-primary);
  font-size: 13px;
  transition: background 0.16s var(--ease);

  &:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  &.ghost {
    background: transparent;
    color: var(--text-secondary);
  }
}

.source {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.05);
  font-size: 12px;

  .label {
    color: var(--text-muted);
  }

  .value {
    overflow: hidden;
    color: var(--text-primary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag {
    grid-column: 2;
    color: var(--text-muted);
  }
}

.source-actions {
  display: flex;
  gap: 8px;

  .wide {
    margin-top: 8px;
  }
}
</style>
