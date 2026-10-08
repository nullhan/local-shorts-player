<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import OsdToast from '@/components/player/OsdToast.vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { usePlayerStore } from '@/store/player'

const router = useRouter()
const store = usePlayerStore()

const fileInput = ref<HTMLInputElement | null>(null)
const dragging = ref(false)
const hasSession = ref(false)
const restoring = ref(false)

const supportsPicker = typeof window !== 'undefined' && Boolean(window.showDirectoryPicker)

onMounted(async () => {
  hasSession.value = await store.hasSavedSession()
})

async function startPlay() {
  if (store.isEmpty) return
  await router.push({ name: 'play' })
}

async function handlePick() {
  const ok = await store.importByPicker()
  if (ok) await startPlay()
}

async function handleRestore() {
  restoring.value = true
  try {
    const ok = await store.restoreLastSession()
    if (ok) await startPlay()
    else store.showOsd('上次的目录已失效，请重新选择', 'info')
  } finally {
    restoring.value = false
  }
}

function openFileDialog() {
  fileInput.value?.click()
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.files?.length) return
  const ok = await store.importByFileList(input.files)
  input.value = ''
  if (ok) await startPlay()
}

async function handleDrop(event: DragEvent) {
  dragging.value = false
  const items = event.dataTransfer?.items
  const files = event.dataTransfer?.files
  if (!files?.length) return

  // 拖拽目录优先尝试走 File System Access（Chrome 支持 getAsFileSystemHandle）
  const getAsFileSystemHandle = (
    items?.[0] as DataTransferItem & {
      getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>
    }
  )?.getAsFileSystemHandle

  if (getAsFileSystemHandle) {
    try {
      const handle = await getAsFileSystemHandle.call(items![0])
      if (handle && handle.kind === 'directory') {
        const ok = await store.importByDirectoryHandle(handle as FileSystemDirectoryHandle)
        if (ok) await startPlay()
        return
      }
    } catch {
      /* 落回普通文件列表 */
    }
  }

  const ok = await store.importByFileList(files)
  if (ok) await startPlay()
}
</script>

<template>
  <div
    class="import-view"
    :class="{ dragging }"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="handleDrop"
  >
    <div class="glow" />

    <section class="hero">
      <div class="logo">
        <SvgIcon name="play" :size="26" />
      </div>
      <h1>本地短视频播放器</h1>
      <p class="subtitle">
        <kbd>↑</kbd><kbd>↓</kbd> 切换视频 · 滚轮切换 · <kbd>Delete</kbd> 快速删除 · 按键全部可自定义
      </p>

      <div class="actions">
        <button v-if="supportsPicker" class="btn primary" :disabled="store.loading" @click="handlePick">
          <SvgIcon name="folder" :size="18" />
          <span>{{ store.loading ? '正在扫描…' : '选择视频文件夹' }}</span>
        </button>
        <button class="btn" :disabled="store.loading" @click="openFileDialog">
          <SvgIcon name="import" :size="18" />
          <span>选择文件夹（兼容模式）</span>
        </button>
        <button v-if="hasSession" class="btn ghost" :disabled="restoring" @click="handleRestore">
          <SvgIcon name="undo" :size="18" />
          <span>{{ restoring ? '恢复中…' : `恢复上次：${store.rootName || '上次目录'}` }}</span>
        </button>
      </div>

      <p class="hint">
        {{ supportsPicker
          ? '推荐方式支持自动递归子目录，并能把删除的文件真实移入回收站'
          : '当前浏览器不支持目录选择器，建议使用 Chrome / Edge 获得完整删除能力' }}
      </p>
      <p class="hint">也可以直接把文件夹拖拽到本页面</p>

      <div v-if="store.scan.scanning || store.playlistCount" class="scan-bar">
        <template v-if="store.scan.scanning">
          <span class="spinner" />
          <span>正在扫描… 已发现 {{ store.scan.found }} 个视频 / {{ store.scan.dirs }} 个目录</span>
        </template>
        <template v-else>
          <span class="ok">
            <SvgIcon name="check" :size="16" />
            已就绪：{{ store.playlistCount }} 个视频
          </span>
          <button class="btn tiny primary" @click="startPlay">开始播放</button>
        </template>
      </div>
    </section>

    <section class="shortcuts">
      <h2>
        <SvgIcon name="keyboard" :size="18" />
        快捷键
      </h2>
      <ul>
        <li><kbd>↑</kbd><kbd>↓</kbd><span>上一个 / 下一个视频</span></li>
        <li><kbd>滚轮</kbd><span>切换视频</span></li>
        <li><kbd>←</kbd><kbd>→</kbd><span>快退 / 快进</span></li>
        <li><kbd>Shift</kbd><span>+</span><kbd>↑</kbd><kbd>↓</kbd><span>音量加减</span></li>
        <li><kbd>Space</kbd><span>播放 / 暂停</span></li>
        <li><kbd>M</kbd><span>静音开关</span></li>
        <li><kbd>Delete</kbd><span>快速删除当前视频</span></li>
        <li><kbd>Ctrl</kbd><span>+</span><kbd>Z</kbd><span>撤销删除</span></li>
        <li><kbd>N</kbd><span>播放列表</span></li>
        <li><kbd>S</kbd><span>设置</span></li>
        <li><kbd>A</kbd><span>切换画面适配</span></li>
        <li><kbd>R</kbd><span>画面转向 90°</span></li>
        <li><kbd>Shift</kbd><span>+</span><kbd>R</kbd><span>水平镜像</span></li>
        <li><kbd>F</kbd><span>全屏</span></li>
        <li><kbd>H</kbd><span>快捷键一览</span></li>
      </ul>
      <p class="shortcuts-note">
        以上按键都可以在「设置 → 快捷键」里重新绑定（点击按键按钮后直接按下新键即可）。
        进度键按住 <kbd>Shift</kbd> 可走 3 倍步长。
      </p>
    </section>

    <div v-if="dragging" class="drop-mask">
      <div class="drop-inner">
        <SvgIcon name="import" :size="42" />
        <p>松开鼠标，导入视频文件夹</p>
      </div>
    </div>

    <input
      ref="fileInput"
      class="hidden-input"
      type="file"
      webkitdirectory
      multiple
      accept="video/*"
      @change="handleFileChange"
    />

    <!-- 导入页也需要提示出口，「恢复上次」失效之类的消息才有地方显示 -->
    <OsdToast :message="store.osd" />
  </div>
</template>

<style scoped lang="less">
.import-view {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: 32px;
  align-items: center;
  min-height: 100%;
  padding: 6vh 6vw;
  overflow: auto;
}

.glow {
  position: fixed;
  inset: -30% -10% auto -10%;
  height: 70vh;
  background: radial-gradient(closest-side, rgba(254, 44, 85, 0.22), transparent 70%),
    radial-gradient(closest-side, rgba(65, 118, 255, 0.16), transparent 72%);
  filter: blur(20px);
  pointer-events: none;
}

.hero {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 18px;

  .logo {
    display: grid;
    place-items: center;
    width: 58px;
    height: 58px;
    border-radius: 18px;
    background: linear-gradient(135deg, #fe2c55, #ff6a3d);
    box-shadow: 0 14px 34px rgba(254, 44, 85, 0.36);
    color: #fff;
  }

  h1 {
    font-size: 40px;
    line-height: 1.2;
    letter-spacing: -0.02em;
  }

  .subtitle {
    color: var(--text-secondary);
    font-size: 15px;
  }
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 42px;
  padding: 0 18px;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-primary);
  font-weight: 500;
  transition: all 0.2s var(--ease);

  &:hover:not(:disabled) {
    border-color: var(--border-strong);
    background: rgba(255, 255, 255, 0.12);
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  &.primary {
    border-color: transparent;
    background: linear-gradient(135deg, #fe2c55, #ff5f45);
    box-shadow: 0 12px 28px rgba(254, 44, 85, 0.32);

    &:hover:not(:disabled) {
      box-shadow: 0 16px 34px rgba(254, 44, 85, 0.42);
    }
  }

  &.ghost {
    background: transparent;
  }

  &.tiny {
    height: 32px;
    padding: 0 14px;
    font-size: 13px;
  }
}

.hint {
  color: var(--text-muted);
  font-size: 13px;
}

.scan-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
  padding: 12px 16px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--bg-panel);
  color: var(--text-secondary);
  font-size: 13px;

  .ok {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #3ddc84;
  }
}

.spinner {
  width: 15px;
  height: 15px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.shortcuts {
  position: relative;
  padding: 24px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  box-shadow: var(--shadow-panel);

  h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
    font-size: 15px;
    font-weight: 600;
  }

  ul {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 18px;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-secondary);
    font-size: 13px;

    span {
      margin-left: 2px;
    }
  }

  .shortcuts-note {
    margin-top: 16px;
    color: var(--text-muted);
    font-size: 12px;
  }
}

.drop-mask {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(10, 10, 16, 0.82);
  backdrop-filter: blur(6px);
  z-index: 40;
}

.drop-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 54px 76px;
  border: 2px dashed var(--accent);
  border-radius: 20px;
  color: var(--accent);
  font-size: 16px;
}

.hidden-input {
  display: none;
}

@media (max-width: 900px) {
  .import-view {
    grid-template-columns: 1fr;
    padding: 5vh 6vw;
  }

  .hero h1 {
    font-size: 30px;
  }
}
</style>
