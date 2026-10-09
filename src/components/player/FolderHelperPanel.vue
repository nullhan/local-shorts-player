<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import SvgIcon from '@/components/SvgIcon.vue'
import { usePlayerStore } from '@/store/player'
import type { VideoSource } from '@/types'
import {
  HELPER_COMMAND,
  HELPER_ORIGIN,
  HELPER_PORT,
  callHelper,
  probeHelper,
  type HelperInfo
} from '@/utils/reveal'

const store = usePlayerStore()

type ProbeState = 'probing' | 'online' | 'offline'

const probeState = ref<ProbeState>('probing')
const helperInfo = ref<HelperInfo | null>(null)

/** 每个来源一行：输入框里的路径 + 校验结果 */
const drafts = ref<Record<string, string>>({})
const checks = ref<Record<string, string>>({})

const sources = computed(() => store.sources)

function itemsOf(sourceId: string) {
  return store.allItems.filter((item) => item.sourceId === sourceId)
}

function registeredPath(sourceId: string): string {
  return store.folderRoots[sourceId]?.path ?? ''
}

/** 出问题时把小助手尝试过的路径列出来，用户一眼能看出登记歪在哪 */
const triedPaths = computed(() => {
  const lines: string[] = []
  for (const [sourceId, text] of Object.entries(checks.value)) {
    if (!text.startsWith('找不到')) continue
    const source = sources.value.find((each) => each.id === sourceId)
    const prefix = source ? `${source.name}：` : ''
    lines.push(`${prefix}${text.replace(/^找不到，试过：/, '')}`)
  }
  return lines
})

async function probe() {
  probeState.value = 'probing'
  const info = await probeHelper()
  helperInfo.value = info
  probeState.value = info ? 'online' : 'offline'
}

onMounted(() => {
  for (const source of store.sources) {
    drafts.value[source.id] = registeredPath(source.id)
  }
  void probe()
})

async function copyCommand() {
  try {
    await navigator.clipboard.writeText(HELPER_COMMAND)
    store.showFeedback('启动命令已复制', 'info', 'toast')
  } catch {
    store.showOsd('复制失败，请手动选中命令', 'info')
  }
}

/** 校验 + 保存：拿该来源的第一个视频去问小助手"拼出来的路径存在吗" */
async function save(source: VideoSource) {
  const path = (drafts.value[source.id] ?? '').trim()
  if (!path) {
    checks.value = { ...checks.value, [source.id]: '请先填入根目录的完整路径' }
    return
  }

  const sample = itemsOf(source.id)[0]
  if (!sample) {
    checks.value = { ...checks.value, [source.id]: '这个来源里没有视频，无法校验' }
    return
  }

  const online = helperInfo.value ?? (await probeHelper())
  if (!online) {
    checks.value = { ...checks.value, [source.id]: '小助手未运行，无法校验（但可以先保存）' }
    store.setFolderRoot(source.id, path, source.name)
    return
  }

  const result = await callHelper('/check', path, sample.relativePath)
  if (result.status === 'ok') {
    store.setFolderRoot(source.id, path, source.name)
    checks.value = {
      ...checks.value,
      [source.id]: result.target.folderOnly
        ? '已保存（该视频已不在，但文件夹存在）'
        : '已保存，路径正确'
    }
    return
  }
  if (result.status === 'not-found') {
    checks.value = {
      ...checks.value,
      [source.id]: `找不到，试过：${result.tried.join('  |  ')}`
    }
    return
  }
  checks.value = { ...checks.value, [source.id]: result.status === 'unreachable' ? '小助手未运行' : `校验失败：${result.message}` }
}

function clear(source: VideoSource) {
  store.removeFolderRoot(source.id)
  drafts.value = { ...drafts.value, [source.id]: '' }
  checks.value = { ...checks.value, [source.id]: '已清除登记' }
}
</script>

<template>
  <div class="fh-mask" @click.self="store.closePanel()">
    <div class="fh-panel">
      <header class="head">
        <h3>
          <SvgIcon name="folder" :size="16" />
          打开所在文件夹
        </h3>
        <button class="close" title="关闭 (Esc)" @click="store.closePanel()">
          <SvgIcon name="close" :size="16" />
        </button>
      </header>

      <div class="body">
        <p class="intro">
          浏览器<strong>故意</strong>不提供两样东西：打开系统资源管理器的接口，以及文件/文件夹的绝对路径
          （<code>FileSystemHandle</code> 只给名字，防止网站探你的磁盘结构）。
          所以真正的「在资源管理器中显示」要借一个跑在本机的小程序完成。
        </p>

        <!-- 小助手状态 -->
        <section class="block">
          <div class="block-head">
            <span class="status" :class="probeState">
              <template v-if="probeState === 'probing'">检测中…</template>
              <template v-else-if="probeState === 'online'">已连接</template>
              <template v-else>未运行</template>
            </span>
            <span class="addr">{{ HELPER_ORIGIN }}</span>
            <button class="mini ghost" @click="probe()">重新检测</button>
          </div>

          <template v-if="probeState === 'online'">
            <p class="note">
              小助手 v{{ helperInfo?.version }} · 端口 {{ helperInfo?.port }}
              <template v-if="helperInfo?.dryRun">
                · <strong>dry-run 模式</strong>（只打印命令，不会真的打开窗口）
              </template>
            </p>
          </template>
          <template v-else-if="probeState === 'offline'">
            <p class="note">在项目目录里启动它（保持窗口开着即可）：</p>
            <div class="cmd">
              <code>{{ HELPER_COMMAND }}</code>
              <button class="mini ghost" @click="copyCommand()">复制</button>
            </div>
            <p class="note">
              可以先加 <code>--dry-run</code> 试一下：它只打印将要执行的命令，不开窗口。
              启动后回到这里点「重新检测」。
            </p>
            <p class="note">
              如果确认它在运行却一直显示「未运行」：多半是页面部署在 https 上、请求本机被浏览器拦了。
              改用本地地址打开页面即可（<code>npm run dev</code> 或 <code>npm run preview</code>）
              —— 本机页面访问本机服务不受这条限制。
            </p>
          </template>
        </section>

        <!-- 根目录登记 -->
        <section class="block">
          <div class="block-title">根目录登记</div>
          <p class="note">
            把每个来源文件夹的<strong>完整路径</strong>粘进来（可在资源管理器地址栏直接复制），
            例如 <code>D:\videos</code>。因为浏览器不告诉我们绝对路径，这一步只能手动做一次。
          </p>

          <div v-if="!sources.length" class="tip">还没有导入任何文件夹。</div>

          <div v-for="source in sources" :key="source.id" class="root-row">
            <div class="root-head">
              <span class="name">{{ source.name }}</span>
              <span class="count">{{ itemsOf(source.id).length }} 个视频</span>
              <span v-if="registeredPath(source.id)" class="ok">已登记</span>
            </div>
            <div class="root-input">
              <input
                v-model="drafts[source.id]"
                type="text"
                spellcheck="false"
                placeholder="D:\videos"
                @keydown.enter="save(source)"
              />
              <button class="mini" @click="save(source)">校验并保存</button>
              <button class="mini ghost" @click="clear(source)">清除</button>
            </div>
            <p v-if="checks[source.id]" class="check">{{ checks[source.id] }}</p>
          </div>
        </section>

        <p v-if="triedPaths.length" class="tip">
          小助手会按几种组合尝试拼接路径（句柄模式与拖拽导入的相对路径含义不同）。
          上面的「试过」列出的路径都对不上时，通常是根目录填错了 —— 常见的是少填/多填了一层目录。
        </p>

        <p class="note foot-note">配好后回到播放页按 <kbd>O</kbd>：会用资源管理器打开并选中当前视频。</p>
      </div>
    </div>
  </div>
</template>

<style scoped lang="less">
.fh-mask {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(6, 6, 10, 0.68);
}

.fh-panel {
  width: 100%;
  height: 100%;
  max-width: 720px;
  max-height: 760px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--bg-panel);
  box-shadow: var(--shadow-panel);
  overflow: hidden;
  animation: fh-in 0.2s var(--ease);
}

@keyframes fh-in {
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

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 18px 18px;
}

.intro {
  margin-bottom: 14px;
  color: var(--text-secondary);
  font-size: 12.5px;
  line-height: 1.75;

  code {
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.08);
  }
}

.block {
  margin-bottom: 16px;
  padding: 12px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
}

.block-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.block-title {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
}

.status {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11.5px;

  &.online {
    background: rgba(61, 220, 132, 0.16);
    color: #6fe0a3;
  }

  &.offline {
    background: rgba(255, 190, 90, 0.16);
    color: #ffc978;
  }

  &.probing {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-secondary);
  }
}

.addr {
  flex: 1;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note {
  margin-top: 8px;
  color: var(--text-muted);
  font-size: 11.5px;
  line-height: 1.7;

  code {
    padding: 1px 4px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-secondary);
  }

  strong {
    color: var(--text-secondary);
  }
}

.foot-note {
  margin-top: 14px;
}

.cmd {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: rgba(0, 0, 0, 0.28);

  code {
    flex: 1;
    padding: 0;
    background: none;
    color: #9fe1cb;
    font-size: 12px;
    font-family: var(--font-mono, monospace);
  }
}

.root-row {
  margin-top: 10px;
  padding: 10px;
  border-radius: var(--radius-sm);
  background: rgba(255, 255, 255, 0.04);
}

.root-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;

  .name {
    overflow: hidden;
    font-size: 13px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    color: var(--text-muted);
    font-size: 11px;
  }

  .ok {
    margin-left: auto;
    padding: 1px 7px;
    border-radius: 999px;
    background: rgba(61, 220, 132, 0.16);
    color: #6fe0a3;
    font-size: 10.5px;
  }
}

.root-input {
  display: flex;
  gap: 7px;

  input {
    flex: 1;
    min-width: 0;
    height: 30px;
    padding: 0 10px;
    border: 1px solid var(--border-soft);
    border-radius: var(--radius-sm);
    background: rgba(0, 0, 0, 0.24);
    color: var(--text-primary);
    font-size: 12.5px;
    font-family: var(--font-mono, monospace);

    &:focus {
      outline: none;
      border-color: var(--accent);
    }
  }
}

.check {
  margin-top: 7px;
  color: #ffc978;
  font-size: 11px;
  line-height: 1.6;
  word-break: break-all;
}

.tip {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: rgba(255, 190, 90, 0.1);
  color: #ffc978;
  font-size: 11.5px;
  line-height: 1.7;
}

.mini {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-primary);
  font-size: 12px;
  white-space: nowrap;
  transition: all 0.16s var(--ease);

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.13);
  }

  &.ghost {
    background: transparent;
    color: var(--text-secondary);
  }
}
</style>
