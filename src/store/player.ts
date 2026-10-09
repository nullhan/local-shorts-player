import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

import type {
  ActionId,
  DeleteMode,
  DuplicateScanProgress,
  FitMode,
  Keymap,
  LoopMode,
  OsdMessage,
  PanelType,
  PlayerPrefs,
  PlaylistMode,
  PulseMessage,
  ScanProgress,
  SortDir,
  SortKey,
  SourceMode,
  TrashRecord,
  VideoItem,
  VideoSource
} from '@/types'
import { ACTION_LABELS, DEFAULT_KEYMAP } from '@/utils/keymap'
import { clamp, hashString, naturalCompare } from '@/utils/media'
import { findDuplicates, supportsContentHash, type DuplicateGroup } from '@/utils/hash'
import {
  TRASH_DIR,
  ensureWritePermission,
  restoreFromTrash,
  revokeItems,
  scanByFileList,
  scanByHandle,
  trashByHandle,
  type ScanSource
} from '@/utils/fs'
import {
  clearAllHandles,
  loadSourceHandles,
  migrateLegacyRootHandle,
  removeSourceHandle,
  saveSourceHandle
} from '@/utils/idb'
import { DEFAULT_PREFS, clearPrefs, loadPrefs, savePrefs } from '@/utils/prefs'
import {
  callHelper,
  loadFolderRoots,
  resolveFolderRoot,
  saveFolderRoots,
  type FolderRootMap
} from '@/utils/reveal'
import {
  IDENTITY_TRANSFORM,
  clearTransforms,
  loadTransforms,
  nextRotation,
  saveTransforms,
  type VideoTransform
} from '@/utils/transforms'

const VOLUME_STEP = 0.05
const SEEK_STEP = 5
const OSD_DURATION = 1200
const PULSE_DURATION = 620
/** 偏好写盘防抖，避免拖音量滑块时高频写 localStorage */
const PREFS_SAVE_DELAY = 300

/** 切换排序字段时的默认方向：名称升序，体积 / 时间以降序更符合直觉 */
const SORT_DEFAULT_DIR: Record<SortKey, SortDir> = {
  default: 'asc',
  name: 'asc',
  size: 'desc',
  mtime: 'desc'
}

export type { DeleteMode, FitMode, LoopMode, PanelType, PlaylistMode, SourceMode, SortKey, SortDir }

export const PLAYLIST_MODE_LABELS: Record<PlaylistMode, string> = {
  merged: '合并为一个列表',
  separate: '每个文件夹独立'
}

export const FIT_MODE_LABELS: Record<FitMode, string> = {
  contain: '完整显示',
  cover: '填满裁切',
  fill: '拉伸铺满'
}

export const SORT_LABELS: Record<SortKey, string> = {
  default: '路径',
  name: '名称',
  size: '大小',
  mtime: '修改时间'
}

export const usePlayerStore = defineStore('player', () => {
  /**
   * 所有来源扫描出的全部视频，是唯一的数据源。
   * 界面上看到的 playlist 由它按「播放列表模式」派生，不再直接改 playlist。
   */
  const allItems = ref<VideoItem[]>([])
  const sources = ref<VideoSource[]>([])
  const currentId = ref<string | null>(null)
  /** separate 模式下当前正在看哪个来源 */
  const activeSourceId = ref<string | null>(null)

  // 首屏即读取上次偏好，避免出现"先默认再跳变"
  const initial = loadPrefs()

  const volume = ref(initial.volume)
  const muted = ref(initial.muted)
  const playbackRate = ref(initial.playbackRate)
  const seekStep = ref(initial.seekStep)
  const loopMode = ref<LoopMode>(initial.loopMode)
  const autoPlay = ref(initial.autoPlay)
  const deleteMode = ref<DeleteMode>(initial.deleteMode)
  /** 默认保留原始长宽比、完整显示画面 */
  const fitMode = ref<FitMode>(initial.fitMode)
  /** 是否显示播放类操作提示（音量 / 进度 / 倍速） */
  const osdEnabled = ref(initial.osdEnabled)
  /** 是否显示重要提示（删除 / 导入结果 / 权限错误等） */
  const osdImportant = ref(initial.osdImportant)
  const sortKey = ref<SortKey>(initial.sortKey)
  const sortDir = ref<SortDir>(initial.sortDir)
  const keymap = ref<Keymap>({ ...initial.keybindings })
  /** 多个来源合并成一个列表，还是按来源分开播放 */
  const playlistMode = ref<PlaylistMode>(initial.playlistMode)
  /** 强制重排用的版本号：排序规则本身没变但需要重新计算时用 */
  const sortVersion = ref(0)
  /** 设置面板正在录制按键时为 true，全局快捷键暂时让位 */
  const capturingKey = ref(false)

  const osd = ref<OsdMessage | null>(null)
  const pulse = ref<PulseMessage | null>(null)
  const trash = ref<TrashRecord[]>([])
  /** 逐视频的画面转向（旋转 / 镜像），key 为 VideoItem.contentKey */
  const transforms = ref<Record<string, VideoTransform>>(loadTransforms())
  /** 内容重复的视频分组，item 用 allItems 里的条目 */
  const duplicates = ref<DuplicateGroup<VideoItem>[]>([])
  const duplicateScan = ref<DuplicateScanProgress>({
    scanning: false,
    doneBytes: 0,
    totalBytes: 0,
    doneFiles: 0,
    totalFiles: 0
  })
  /** 是否已经跑完过一次扫描（用于区分"还没扫"和"扫了但没重复"） */
  const duplicatesScanned = ref(false)
  let duplicateSignal: { aborted: boolean } | null = null
  const scan = ref<ScanProgress>({ found: 0, dirs: 0, scanning: false })
  const loading = ref(false)
  /** 右侧/底部活动面板，同时只允许打开一个 */
  const activePanel = ref<PanelType>(null)
  /**
   * 面板里"当前关注"的条目（重复视频面板会写它）。
   * 「打开所在文件夹」这类动作需要知道"给谁开"：面板打开时听面板的，否则听正在播放的。
   * 由面板在挂载期间设置、卸载时清空，避免面板关掉后还指向旧条目。
   */
  const contextItem = ref<VideoItem | null>(null)

  /**
   * 应用内跳转：把播放列表收窄到某个文件夹（`null` = 显示全部）。
   * 与「本地小助手」共用同一个 O 键 —— 小助手可用时真的打开资源管理器，
   * 不可用时退化成这个筛选，保证按键永远有反馈。
   */
  const folderFilter = ref<{ sourceId: string; parentPath: string } | null>(null)

  /** 各来源登记的根目录绝对路径（浏览器不给，只能用户手填一次） */
  const folderRoots = ref<FolderRootMap>(loadFolderRoots())

  let osdTimer: number | undefined
  let osdSeq = 0
  let pulseTimer: number | undefined
  let pulseSeq = 0
  let prefsTimer: number | undefined

  /* ---------------- 派生：播放列表 ---------------- */

  /** separate 模式下正在看的来源；没显式选过就取第一个 */
  const effectiveSourceId = computed(() => {
    if (!sources.value.length) return null
    const exists = sources.value.some((source) => source.id === activeSourceId.value)
    return exists ? activeSourceId.value : sources.value[0].id
  })

  /**
   * 当前播放列表。
   * - merged：所有来源合并，按 sortKey 排序
   * - separate：只取当前来源，按 sortKey 排序
   * - 若开了「文件夹筛选」（按 O 的应用内跳转），再收窄到某一个文件夹
   */
  const scopedPlaylist = computed<VideoItem[]>(() => {
    // 读取 sortVersion 让排序规则外的变化（如手动刷新）也能触发重算
    void sortVersion.value
    const scoped =
      playlistMode.value === 'separate' && effectiveSourceId.value
        ? allItems.value.filter((item) => item.sourceId === effectiveSourceId.value)
        : allItems.value
    const dir = sortDir.value === 'asc' ? 1 : -1
    const key = sortKey.value
    return [...scoped].sort((a, b) => dir * compareItems(a, b, key))
  })

  const playlist = computed<VideoItem[]>(() => {
    const filter = folderFilter.value
    if (!filter) return scopedPlaylist.value
    return scopedPlaylist.value.filter(
      (item) => item.sourceId === filter.sourceId && item.parentPath === filter.parentPath
    )
  })

  const playlistCount = computed(() => playlist.value.length)
  /** 未受文件夹筛选影响的条目数，用于「显示全部（N）」 */
  const playlistTotal = computed(() => scopedPlaylist.value.length)
  const isEmpty = computed(() => playlist.value.length === 0)
  const currentIndex = computed(() =>
    playlist.value.findIndex((item) => item.id === currentId.value)
  )
  const current = computed<VideoItem | null>(
    () => playlist.value[currentIndex.value] ?? null
  )
  const sourceCount = computed(() => sources.value.length)

  /** 当前来源（separate 模式或界面展示用） */
  const activeSource = computed<VideoSource | null>(
    () => sources.value.find((source) => source.id === effectiveSourceId.value) ?? null
  )

  /** 是否至少有一个来源处于可读写模式（决定能否真实删除） */
  const canRealDelete = computed(() =>
    sources.value.some((source) => source.mode === 'handle' && source.handle)
  )

  /** 由于本次会话内的删除/还原而变化，用于让 playlist 重新计算 */
  function touchPlaylist() {
    sortVersion.value += 1
  }

  /** 有可撤销的删除，且原来源仍可用 */
  const canUndo = computed(() =>
    trash.value.some((record) => Boolean(findSource(record.sourceId)?.handle))
  )

  /** 当前视频的画面转向（没有记录就是原始方向） */
  const currentTransform = computed<VideoTransform>(() => {
    const item = current.value
    if (!item) return IDENTITY_TRANSFORM
    return transforms.value[item.contentKey] ?? IDENTITY_TRANSFORM
  })

  /** 当前视频是否被调整过转向，供界面显示状态 */
  const hasTransform = computed(
    () => currentTransform.value.rotate !== 0 || currentTransform.value.flip
  )

  const transformLabel = computed(() => {
    const { rotate, flip } = currentTransform.value
    if (rotate === 0 && !flip) return '原始方向'
    return `${rotate}°${flip ? ' · 镜像' : ''}`
  })

  /** 收集当前需要持久化的偏好（只含用户可调项，不含播放列表 / 目录） */
  function collectPrefs(): PlayerPrefs {
    return {
      volume: volume.value,
      muted: muted.value,
      playbackRate: playbackRate.value,
      seekStep: seekStep.value,
      loopMode: loopMode.value,
      autoPlay: autoPlay.value,
      deleteMode: deleteMode.value,
      fitMode: fitMode.value,
      osdEnabled: osdEnabled.value,
      osdImportant: osdImportant.value,
      sortKey: sortKey.value,
      sortDir: sortDir.value,
      keybindings: { ...keymap.value },
      playlistMode: playlistMode.value
    }
  }

  // 防抖写盘：音量滑块会高频触发，避免每次 input 都写 localStorage
  watch(
    [
      volume,
      muted,
      playbackRate,
      seekStep,
      loopMode,
      autoPlay,
      deleteMode,
      fitMode,
      osdEnabled,
      osdImportant,
      sortKey,
      sortDir,
      keymap,
      playlistMode
    ],
    () => {
      if (prefsTimer) window.clearTimeout(prefsTimer)
      prefsTimer = window.setTimeout(() => {
        savePrefs(collectPrefs())
      }, PREFS_SAVE_DELAY)
    }
  )

  /** 关闭页面前把挂起的写盘立刻落盘 */
  function flushPrefs() {
    if (prefsTimer) {
      window.clearTimeout(prefsTimer)
      prefsTimer = undefined
    }
    savePrefs(collectPrefs())
  }

  function resetPrefs() {
    const next = { ...DEFAULT_PREFS }
    volume.value = next.volume
    muted.value = next.muted
    playbackRate.value = next.playbackRate
    seekStep.value = next.seekStep
    loopMode.value = next.loopMode
    autoPlay.value = next.autoPlay
    deleteMode.value = next.deleteMode
    fitMode.value = next.fitMode
    osdEnabled.value = next.osdEnabled
    osdImportant.value = next.osdImportant
    sortKey.value = next.sortKey
    sortDir.value = next.sortDir
    keymap.value = { ...DEFAULT_KEYMAP }
    applySort()
    clearPrefs()
    showOsd('已恢复默认设置', 'info')
  }

  /**
   * 提示统一从「总开关」`osdEnabled` 出去：关掉它，一个浮层提示都不会出现。
   * 在此之上再分两级：
   * - `showFeedback`：音量 / 进度 / 倍速 / 画面适配等高频轻提示，画面中央或 ghost 样式
   * - `showOsd`：删除 / 导入结果 / 权限失败等重要提示，另受 `osdImportant` 控制，底部居中显示
   */
  function pushOsd(text: string, icon: OsdMessage['icon'], variant: OsdMessage['variant']) {
    osdSeq += 1
    osd.value = { id: osdSeq, text, icon, variant }
    if (osdTimer) window.clearTimeout(osdTimer)
    osdTimer = window.setTimeout(() => {
      osd.value = null
    }, OSD_DURATION)
  }

  /** 重要提示：删除 / 导入 / 权限等（底部居中，不挡画面主体） */
  function showOsd(
    text: string,
    icon: OsdMessage['icon'] = 'info',
    variant: OsdMessage['variant'] = 'toast'
  ) {
    if (!osdEnabled.value || !osdImportant.value) return
    pushOsd(text, icon, variant)
  }

  /** 轻量操作提示：音量 / 进度 / 倍速 / 画面适配 */
  function showFeedback(
    text: string,
    icon: OsdMessage['icon'] = 'info',
    variant: OsdMessage['variant'] = 'pill'
  ) {
    if (!osdEnabled.value) return
    pushOsd(text, icon, variant)
  }

  /** 播放 / 暂停的大图标闪现（替代原来的深色胶囊提示） */
  function pulsePlay(kind: PulseMessage['kind']) {
    pulseSeq += 1
    pulse.value = { id: pulseSeq, kind }
    if (pulseTimer) window.clearTimeout(pulseTimer)
    pulseTimer = window.setTimeout(() => {
      pulse.value = null
    }, PULSE_DURATION)
  }

  function select(id: string) {
    if (playlist.value.some((item) => item.id === id)) currentId.value = id
  }

  function step(delta: number) {
    const total = playlist.value.length
    if (!total) return
    let index = currentIndex.value
    if (index < 0) index = 0
    let next = index + delta
    if (loopMode.value === 'loop') {
      next = (next + total) % total
    } else {
      next = clamp(next, 0, total - 1)
    }
    currentId.value = playlist.value[next].id
  }

  const next = () => step(1)
  const prev = () => step(-1)

  /* ---------------- 排序 ---------------- */

  function compareItems(a: VideoItem, b: VideoItem, key: SortKey): number {
    switch (key) {
      case 'name':
        return naturalCompare(a.name, b.name)
      case 'size':
        return a.size - b.size
      case 'mtime':
        return a.mtime - b.mtime
      default:
        return naturalCompare(a.relativePath, b.relativePath)
    }
  }

  /**
   * playlist 已经是按 sortKey/sortDir 派生的，这里只需要触发重算。
   * 保留这个方法名是为了不改动各处的调用点。
   */
  function applySort() {
    touchPlaylist()
  }

  function setSort(key: SortKey) {
    sortKey.value = key
    sortDir.value = SORT_DEFAULT_DIR[key]
  }

  function toggleSortDir() {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  }

  /* ---------------- 按键绑定 ---------------- */

  function setKeybinding(action: ActionId, combo: string) {
    const nextMap: Keymap = { ...keymap.value }
    if (combo) {
      for (const id of Object.keys(nextMap) as ActionId[]) {
        if (id !== action && nextMap[id] === combo) {
          nextMap[id] = ''
          showOsd(`已解除「${ACTION_LABELS[id] || id}」的按键绑定`, 'info')
        }
      }
    }
    nextMap[action] = combo
    keymap.value = nextMap
  }

  function resetKeybindings() {
    keymap.value = { ...DEFAULT_KEYMAP }
    showOsd('按键已恢复默认', 'info')
  }

  /* ---------------- 音量 / 倍速 ---------------- */

  function setVolume(value: number, silent = false) {
    volume.value = clamp(Number(value.toFixed(2)), 0, 1)
    if (volume.value > 0) muted.value = false
    if (!silent) {
      showFeedback(
        muted.value || volume.value === 0 ? '静音' : `音量 ${Math.round(volume.value * 100)}%`,
        muted.value || volume.value === 0 ? 'mute' : 'volume'
      )
    }
  }

  function adjustVolume(delta: number) {
    setVolume(volume.value + delta)
  }

  function toggleMute() {
    muted.value = !muted.value
    showFeedback(
      muted.value ? '静音' : `音量 ${Math.round(volume.value * 100)}%`,
      muted.value ? 'mute' : 'volume'
    )
  }

  function setPlaybackRate(rate: number) {
    playbackRate.value = clamp(Number(rate.toFixed(2)), 0.25, 4)
    showFeedback(`倍速 ${playbackRate.value}x`, 'info')
  }

  /** 进度提示走 ghost 样式：无深色底、只留一行浅色文字，不再遮挡画面 */
  function showSeekOsd(delta: number) {
    const arrow = delta > 0 ? '快进' : '快退'
    showFeedback(`${arrow} ${Math.abs(delta)} 秒`, 'seek', 'ghost')
  }

  /* ---------------- 来源管理 ---------------- */

  /** 生成不会与现有来源冲突的 id（同名文件夹也能各占一条） */
  function makeSourceId(name: string): string {
    const base = hashString(`${name}|${Date.now()}|${Math.random()}`)
    return sources.value.some((source) => source.id === base) ? `${base}-${Date.now()}` : base
  }

  function findSource(id: string): VideoSource | null {
    return sources.value.find((source) => source.id === id) ?? null
  }

  /** 某个来源下的条目（不受 merged/separate 影响，用于删除后补位等） */
  function itemsOfSource(id: string): VideoItem[] {
    return allItems.value.filter((item) => item.sourceId === id)
  }

  /**
   * 把一次扫描结果作为一个新来源接入。
   * 已存在相同名字且相同句柄的来源会被替换（重新选同一个文件夹时避免重复），
   * 否则追加为新的来源。
   */
  async function addSource(
    source: VideoSource,
    result: Awaited<ReturnType<typeof scanByHandle>>
  ): Promise<{ added: number; replaced: boolean }> {
    // 命中已有来源：同 id，或者同名的可读写句柄（isSameEntry 判断为同一目录）
    let target = findSource(source.id)
    let replaced = false
    if (!target && source.handle) {
      for (const existing of sources.value) {
        if (!existing.handle || existing.name !== source.name) continue
        try {
          if (existing.handle.isSameEntry && (await existing.handle.isSameEntry(source.handle))) {
            target = existing
            break
          }
        } catch {
          /* 句柄失效则当新来源处理 */
        }
      }
    }

    const sourceId = target ? target.id : source.id
    const items = result.items.map((item) => ({ ...item, sourceId }))

    if (target) {
      // 换掉旧来源的条目
      revokeItems(itemsOfSource(target.id))
      allItems.value = allItems.value.filter((item) => item.sourceId !== target.id)
      sources.value = sources.value.map((entry) =>
        entry.id === target!.id
          ? { ...entry, handle: source.handle, mode: source.mode, name: source.name }
          : entry
      )
      replaced = true
    } else {
      sources.value = [...sources.value, { ...source, id: sourceId }]
    }

    allItems.value = [...allItems.value, ...items]
    if (source.handle) {
      await saveSourceHandle({ ...source, id: sourceId })
    }
    touchPlaylist()
    return { added: items.length, replaced }
  }

  /** 导入完成后统一收尾：定位当前视频 + 提示 */
  function finishImport(total: number, skipped: number, hint = '') {
    if (!currentId.value || !playlist.value.some((item) => item.id === currentId.value)) {
      currentId.value = playlist.value.length ? playlist.value[0].id : null
    }
    if (!total) {
      showOsd('未找到视频文件', 'info')
      return
    }
    const suffix = skipped > 0 ? `，跳过 ${skipped} 个非视频文件` : ''
    showOsd(`已导入 ${total} 个视频${suffix}${hint}`, 'info')
  }

  /** 首选：目录选择器。可连续调用以一次添加多个文件夹 */
  async function importByPicker(): Promise<boolean> {
    if (!window.showDirectoryPicker) {
      showOsd('当前浏览器不支持目录选择，请使用拖拽或「选择文件夹」', 'info')
      return false
    }
    loading.value = true
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
      const source: VideoSource = {
        id: makeSourceId(handle.name),
        name: handle.name,
        handle,
        mode: 'handle',
        addedAt: Date.now()
      }
      const result = await scanByHandle(handle, source, (progress) => {
        scan.value = progress
      })
      const { added, replaced } = await addSource(source, result)
      activeSourceId.value = source.id
      finishImport(added, result.skipped, replaced ? '（已更新该文件夹）' : '')
      return true
    } catch (error) {
      const name = (error as DOMException)?.name
      if (name !== 'AbortError') {
        showOsd('目录导入失败，请重试或改用拖拽方式', 'info')
      }
      return false
    } finally {
      loading.value = false
    }
  }

  /** 直接基于已有的目录句柄导入（拖拽目录时浏览器会给出句柄） */
  async function importByDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<boolean> {
    loading.value = true
    try {
      const source: VideoSource = {
        id: makeSourceId(handle.name),
        name: handle.name,
        handle,
        mode: 'handle',
        addedAt: Date.now()
      }
      const result = await scanByHandle(handle, source, (progress) => {
        scan.value = progress
      })
      const { added, replaced } = await addSource(source, result)
      activeSourceId.value = source.id
      finishImport(added, result.skipped, replaced ? '（已更新该文件夹）' : '')
      return result.items.length > 0
    } catch {
      showOsd('目录读取失败，请改用其它方式导入', 'info')
      return false
    } finally {
      loading.value = false
    }
  }

  /** 降级：input[webkitdirectory] 或拖拽，仅能得到文件列表 */
  async function importByFileList(fileList: FileList | File[]): Promise<boolean> {
    loading.value = true
    try {
      const files = Array.from(fileList)
      // 用 webkitRelativePath 的顶层目录名作为来源名；纯文件拖拽时用时间戳兜底
      const first = files[0] as File & { webkitRelativePath?: string }
      const topDir = first?.webkitRelativePath?.split('/')[0]
      const name = topDir || `拖入的文件夹 ${sources.value.length + 1}`

      const source: VideoSource = {
        id: makeSourceId(name),
        name,
        handle: null,
        mode: 'fallback',
        addedAt: Date.now()
      }
      const result = await scanByFileList(files, source, (progress) => {
        scan.value = progress
      })
      const { added } = await addSource(source, result)
      activeSourceId.value = source.id
      finishImport(
        added,
        result.skipped,
        added ? '（浏览器限制：这些视频只能移出列表，无法删除磁盘文件）' : ''
      )
      return result.items.length > 0
    } finally {
      loading.value = false
    }
  }

  /** 是否至少记住了一个可恢复的来源 */
  async function hasSavedSession(): Promise<boolean> {
    const stored = await loadSourceHandles()
    if (stored.length) return true
    return Boolean(await migrateLegacyRootHandle())
  }

  /** 尝试恢复上次的全部来源（需要用户手势触发权限确认） */
  async function restoreLastSession(): Promise<boolean> {
    // 旧版本单目录记忆迁移
    await migrateLegacyRootHandle()
    const stored = await loadSourceHandles()
    if (!stored.length) return false

    loading.value = true
    let restored = 0
    let videos = 0
    let skippedFiles = 0
    try {
      for (const record of stored) {
        const handle = record.handle
        const granted = handle.queryPermission
          ? (await handle.queryPermission({ mode: 'readwrite' })) === 'granted'
          : true
        if (!granted) {
          // 没有被授权就跳过，但保留记忆，下次仍可再试
          continue
        }
        const source: VideoSource = {
          id: record.id,
          name: record.name,
          handle,
          mode: 'handle',
          addedAt: record.addedAt
        }
        const result = await scanByHandle(handle, source, (progress) => {
          scan.value = progress
        })
        const { added } = await addSource(source, result)
        videos += added
        skippedFiles += result.skipped
        restored += 1
      }
    } finally {
      loading.value = false
    }

    if (!restored) {
      showOsd('上次的目录已失效，请重新选择', 'info')
      return false
    }
    finishImport(videos, skippedFiles, restored > 1 ? `（来自 ${restored} 个文件夹）` : '')
    return true
  }

  /** 只移除来源及其条目，不碰磁盘文件 */
  function removeSource(id: string): void {
    const source = findSource(id)
    if (!source) return
    const items = itemsOfSource(id)
    revokeItems(items)
    const ids = new Set(items.map((item) => item.id))
    allItems.value = allItems.value.filter((item) => item.sourceId !== id)
    sources.value = sources.value.filter((entry) => entry.id !== id)
    trash.value = trash.value.filter((record) => record.sourceId !== id)
    duplicates.value = duplicates.value
      .map((group) => ({ ...group, items: group.items.filter((item) => !ids.has(item.id)) }))
      .filter((group) => group.items.length > 1)
    if (activeSourceId.value === id) activeSourceId.value = null
    void removeSourceHandle(id)
    touchPlaylist()
    if (currentId.value && ids.has(currentId.value)) {
      currentId.value = playlist.value.length ? playlist.value[0].id : null
    }
    showOsd(`已移除来源：${source.name}（磁盘文件未改动）`, 'info')
  }

  function removeAllSources(): void {
    revokeItems(allItems.value)
    sources.value = []
    allItems.value = []
    currentId.value = null
    activeSourceId.value = null
    trash.value = []
    duplicates.value = []
    duplicatesScanned.value = false
    activePanel.value = null
    void clearAllHandles()
    showOsd('已移除全部来源（磁盘文件未改动）', 'info')
  }

  /** 清空「记住的文件夹」，下次不再自动恢复 */
  async function forgetSession() {
    await clearAllHandles()
    showOsd('已清除记住的文件夹', 'info')
  }

  /** separate 模式下切换正在浏览的来源 */
  function setActiveSource(id: string) {
    if (!findSource(id)) return
    activeSourceId.value = id
    // 切换来源后当前视频若不在该来源里，落到该来源第一个
    if (current.value === null || current.value.sourceId !== id) {
      currentId.value = playlist.value.length ? playlist.value[0].id : null
    }
  }

  function setPlaylistMode(mode: PlaylistMode) {
    playlistMode.value = mode
    // 切到 separate 后确保当前视频属于正在看的来源
    if (mode === 'separate') {
      const item = current.value
      if (item) activeSourceId.value = item.sourceId
      else if (!activeSourceId.value && sources.value.length) {
        activeSourceId.value = sources.value[0].id
      }
    }
    showFeedback(`播放列表：${PLAYLIST_MODE_LABELS[mode]}`, 'info')
  }

  /**
   * 从 allItems 中摘掉若干条目，并把当前视频落到「原来所在的列表」的下一个。
   * 注意 fallback 要在变更前算好，因为 playlist 是派生出来的。
   */
  function detachItems(removed: VideoItem[]): void {
    if (!removed.length) return
    const ids = new Set(removed.map((item) => item.id))
    // 变更前先记下后续位置
    const list = playlist.value
    const anchor = currentId.value ? list.findIndex((item) => item.id === currentId.value) : -1
    const remaining = list.filter((item) => !ids.has(item.id))
    const fallback = remaining[Math.min(Math.max(anchor, 0), remaining.length - 1)]

    revokeItems(removed)
    allItems.value = allItems.value.filter((item) => !ids.has(item.id))
    currentId.value = fallback ? fallback.id : null
    touchPlaylist()
  }

  /** 删除当前视频：可读写来源真实删除，其他来源只移出列表 */
  async function removeCurrent(): Promise<void> {
    const item = current.value
    if (!item) return

    const source = findSource(item.sourceId)
    const canDelete = source?.mode === 'handle' && source.handle && item.handle
    if (!canDelete) {
      detachItems([item])
      showOsd('已从列表移除（浏览器限制，磁盘文件未删除）', 'delete')
      return
    }
    const root = source!.handle as FileSystemDirectoryHandle

    if (deleteMode.value === 'trash') {
      const granted = await ensureWritePermission(root)
      if (!granted) {
        showOsd('未获得写入权限，无法移动文件', 'info')
        return
      }
    }

    try {
      let trashPath: string[] = []
      if (deleteMode.value === 'trash') {
        trashPath = await trashByHandle(root, item)
      } else {
        await item.handle!.remove()
      }

      // 先算好落点，再真正移除条目
      const list = playlist.value
      const index = list.findIndex((entry) => entry.id === item.id)
      const remaining = list.filter((entry) => entry.id !== item.id)
      const fallback = remaining[Math.min(index, remaining.length - 1)]

      revokeItems([item])
      allItems.value = allItems.value.filter((entry) => entry.id !== item.id)
      currentId.value = fallback ? fallback.id : null
      touchPlaylist()

      if (deleteMode.value === 'trash') {
        trash.value.push({
          item,
          trashPath,
          parentPath: item.parentPath,
          sourceId: item.sourceId
        })
        showOsd(`已移入回收站：${item.name}（Ctrl+Z 撤销）`, 'delete')
      } else {
        showOsd(`已永久删除：${item.name}`, 'delete')
      }
    } catch {
      showOsd('删除失败，请确认目录写入权限', 'info')
    }
  }

  /** 撤销上一次删除（还原回它原本所属的来源） */
  async function undoDelete(): Promise<void> {
    const record = trash.value.pop()
    if (!record) {
      showOsd('没有可撤销的删除', 'info')
      return
    }
    const source = findSource(record.sourceId)
    if (!source?.handle) {
      trash.value.push(record)
      showOsd('原文件夹已移除，无法还原', 'info')
      return
    }

    try {
      const handle = await restoreFromTrash(source.handle, record)
      const restored: VideoItem = {
        ...record.item,
        handle,
        url: URL.createObjectURL(record.item.file)
      }
      allItems.value = [...allItems.value, restored]
      // 还原后按当前排序规则归位，而不是塞到末尾
      touchPlaylist()
      // separate 模式下还原的可能属于另一个文件夹：先切过去，否则当前视频会"悬空"成 null
      if (playlistMode.value === 'separate') activeSourceId.value = restored.sourceId
      currentId.value = restored.id
      showOsd(`已还原：${restored.name}`, 'undo')
    } catch {
      trash.value.push(record)
      showOsd('还原失败，文件可能已被移动', 'info')
    }
  }

  /* ---------------- 重复视频 ---------------- */

  /**
   * 需要做内容校验的文件数。
   * 注意用 allItems 而不是 playlist：重复检测应该覆盖所有来源，
   * 否则 separate 模式下就只能发现"当前文件夹内部"的重复，跨文件夹的重复会被漏掉。
   */
  const duplicateCandidateCount = computed(() => {
    const counter = new Map<number, number>()
    for (const item of allItems.value) counter.set(item.size, (counter.get(item.size) ?? 0) + 1)
    let count = 0
    for (const size of counter.values()) if (size > 1) count += size
    return count
  })

  /** 汇总：组数 / 可删掉的份数 / 可释放字节 */
  const duplicateStats = computed(() => {
    let removable = 0
    let bytes = 0
    for (const group of duplicates.value) {
      removable += group.items.length - 1
      bytes += (group.items.length - 1) * group.size
    }
    return { groups: duplicates.value.length, removable, bytes }
  })

  const duplicateSupported = computed(() => supportsContentHash())

  async function scanDuplicates(): Promise<void> {
    if (duplicateScan.value.scanning) return
    if (!supportsContentHash()) {
      showOsd('当前环境不支持内容校验（需要 https 或 localhost 打开）', 'info')
      return
    }
    if (!allItems.value.length) {
      showOsd('播放列表为空', 'info')
      return
    }

    duplicateSignal = { aborted: false }
    duplicatesScanned.value = false
    duplicateScan.value = {
      scanning: true,
      doneBytes: 0,
      totalBytes: 0,
      doneFiles: 0,
      totalFiles: 0
    }

    try {
      const groups = await findDuplicates(
        allItems.value.map((item) => ({ value: item, file: item.file })),
        {
          signal: duplicateSignal,
          onProgress: (progress) => {
            duplicateScan.value = { scanning: true, ...progress }
          }
        }
      )
      duplicates.value = groups
      duplicatesScanned.value = true
      const crossSource = groups.filter(
        (group) => new Set(group.items.map((item) => item.sourceId)).size > 1
      ).length
      const suffix = crossSource ? `，其中 ${crossSource} 组跨文件夹` : ''
      showOsd(
        groups.length ? `发现 ${groups.length} 组重复视频${suffix}` : '没有发现重复视频',
        'info'
      )
    } catch {
      if (!duplicateSignal?.aborted) showOsd('扫描重复视频失败', 'info')
    } finally {
      duplicateScan.value = {
        scanning: false,
        doneBytes: 0,
        totalBytes: 0,
        doneFiles: 0,
        totalFiles: 0
      }
      duplicateSignal = null
    }
  }

  function cancelDuplicateScan() {
    if (duplicateSignal) duplicateSignal.aborted = true
  }

  function clearDuplicates() {
    duplicates.value = []
    duplicatesScanned.value = false
  }

  /**
   * 批量删除（重复视频清理用），按每个条目自己所属的来源分别处理。
   * 可读写来源按当前删除方式真实处理；只读来源只把条目移出列表。
   * 返回真正处理成功的条目。
   */
  async function removeMany(items: VideoItem[]): Promise<VideoItem[]> {
    if (!items.length) return []

    const detachable = items.filter((item) => {
      const source = findSource(item.sourceId)
      return !(source?.mode === 'handle' && source.handle && item.handle)
    })
    const deletable = items.filter((item) => !detachable.includes(item))

    // 只读来源：仅移出列表
    if (detachable.length) detachItems(detachable)

    const succeeded: VideoItem[] = []
    const granted = new Map<string, boolean>()

    for (const item of deletable) {
      const source = findSource(item.sourceId)
      const root = source?.handle
      if (!root || !item.handle) continue

      if (deleteMode.value === 'trash') {
        // 每个来源只申请一次写权限
        if (!granted.has(source!.id)) {
          granted.set(source!.id, await ensureWritePermission(root))
        }
        if (!granted.get(source!.id)) continue
      }

      try {
        if (deleteMode.value === 'trash') {
          const trashPath = await trashByHandle(root, item)
          trash.value.push({
            item,
            trashPath,
            parentPath: item.parentPath,
            sourceId: item.sourceId
          })
        } else {
          await item.handle.remove()
        }
        succeeded.push(item)
      } catch {
        /* 单个失败不影响其余 */
      }
    }

    if (succeeded.length) detachItems(succeeded)

    const verb = deleteMode.value === 'trash' ? '已移入回收站' : '已永久删除'
    if (succeeded.length) {
      const failed = deletable.length - succeeded.length
      showOsd(
        failed > 0
          ? `${verb} ${succeeded.length} 个，${failed} 个失败`
          : `${verb} ${succeeded.length} 个`,
        'delete'
      )
    } else if (detachable.length) {
      showOsd(`已从列表移除 ${detachable.length} 个（浏览器限制，磁盘文件未删除）`, 'delete')
    } else {
      showOsd('删除失败，请确认目录写入权限', 'info')
    }

    return [...detachable, ...succeeded]
  }

  /** 删除选中的重复文件，并把已删除项从分组里剔除 */
  async function removeDuplicateItems(items: VideoItem[]): Promise<void> {
    const removed = await removeMany(items)
    if (!removed.length) return
    const gone = new Set(removed.map((item) => item.id))
    duplicates.value = duplicates.value
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => !gone.has(item.id))
      }))
      .filter((group) => group.items.length > 1)
  }

  function reset() {
    revokeItems(allItems.value)
    allItems.value = []
    sources.value = []
    currentId.value = null
    activeSourceId.value = null
    trash.value = []
    duplicates.value = []
    duplicatesScanned.value = false
    activePanel.value = null
    void forgetSession()
  }

  function togglePanel(panel: Exclude<PanelType, null>) {
    activePanel.value = activePanel.value === panel ? null : panel
  }

  /** 循环切换三种适配方式，便于用快捷键快速切换 */
  function cycleFitMode() {
    const order: FitMode[] = ['contain', 'cover', 'fill']
    const next = order[(order.indexOf(fitMode.value) + 1) % order.length]
    fitMode.value = next
    showFeedback(`画面：${FIT_MODE_LABELS[next]}`, 'info')
  }

  function closePanel() {
    activePanel.value = null
    contextItem.value = null
  }

  /* ---------------- 打开所在文件夹 ---------------- */

  /** 面板可以借此声明"我现在关注的是哪一条" */
  function setContextItem(item: VideoItem | null): void {
    contextItem.value = item
  }

  /** 当前视频所在文件夹的显示名（筛选条上用） */
  const folderFilterLabel = computed(() => {
    const filter = folderFilter.value
    if (!filter) return ''
    const tail = filter.parentPath.split('/').filter(Boolean).pop()
    return tail || findSource(filter.sourceId)?.name || '根目录'
  })

  /**
   * 应用内跳转：只看这个文件夹。
   * 筛选后当前视频可能不在列表里（例如在重复面板里选中的副本属于别的文件夹），
   * 那就直接切到你操作的那一条，避免播放器突然变空。
   */
  function applyFolderFilter(item: VideoItem): void {
    folderFilter.value = { sourceId: item.sourceId, parentPath: item.parentPath }
    if (!playlist.value.some((each) => each.id === currentId.value)) select(item.id)
  }

  function clearFolderFilter(): void {
    folderFilter.value = null
  }

  function toggleFolderFilter(item: VideoItem): void {
    const filter = folderFilter.value
    if (filter && filter.sourceId === item.sourceId && filter.parentPath === item.parentPath) {
      folderFilter.value = null
    } else {
      applyFolderFilter(item)
    }
  }

  // 该文件夹里的条目被删光时自动解除筛选，否则会卡在一个空列表上
  watch([folderFilter, allItems], () => {
    const filter = folderFilter.value
    if (!filter) return
    const alive = allItems.value.some(
      (item) => item.sourceId === filter.sourceId && item.parentPath === filter.parentPath
    )
    if (!alive) folderFilter.value = null
  })

  /* ---------------- 根目录登记 ---------------- */

  function setFolderRoot(sourceId: string, path: string, sourceName: string): void {
    folderRoots.value = {
      ...folderRoots.value,
      [sourceId]: { path: path.trim(), sourceName, at: Date.now() }
    }
    saveFolderRoots(folderRoots.value)
  }

  function removeFolderRoot(sourceId: string): void {
    const next = { ...folderRoots.value }
    delete next[sourceId]
    folderRoots.value = next
    saveFolderRoots(next)
  }

  /**
   * 在系统资源管理器中打开「当前关注的那个视频」所在的文件夹。
   *
   * 两条路：
   * 1. 小助手在运行且该来源登记过根目录 → 真的打开资源管理器并选中文件
   * 2. 否则退化成应用内筛选（保证按键永远有反馈）
   */
  async function openFolder(): Promise<void> {
    const item = contextItem.value ?? current.value
    if (!item) {
      showOsd('没有可定位的视频', 'info')
      return
    }

    const source = findSource(item.sourceId)
    const record = resolveFolderRoot(folderRoots.value, item.sourceId, source?.name ?? '')

    if (record) {
      const result = await callHelper('/reveal', record.path, item.relativePath)

      if (result.status === 'ok') {
        showFeedback(
          result.target.folderOnly
            ? '文件已不在，已打开它所在的文件夹'
            : `已在资源管理器中选中：${item.name}`,
          'info',
          'toast'
        )
        return
      }
      if (result.status === 'not-found') {
        showOsd('小助手按登记的路径找不到文件，请在「设置 → 文件夹」核对根目录路径', 'info')
        return
      }
      if (result.status === 'error') {
        showOsd(`小助手出错：${result.message}`, 'info')
        return
      }
      // unreachable → 落到下面的退化分支
    }

    toggleFolderFilter(item)
    const reason = record ? '本地小助手未运行' : '还没登记该文件夹的路径'
    showFeedback(
      folderFilter.value ? `${reason}，已改为在播放列表里筛选这个文件夹` : '已恢复显示全部',
      'info',
      'toast'
    )
  }

  /* ---------------- 画面转向（逐视频） ---------------- */

  /** 写入某个视频的转向记录；回到"原始方向"的条目会被删掉，避免记录无限膨胀 */
  function applyTransform(contentKey: string, next: VideoTransform) {
    const map = { ...transforms.value }
    if (next.rotate === 0 && !next.flip) delete map[contentKey]
    else map[contentKey] = next
    transforms.value = map
    saveTransforms(map)
  }

  /** 顺时针旋转 90° 循环：0 → 90 → 180 → 270 → 0 */
  function rotateVideo() {
    const item = current.value
    if (!item) return
    const cur = transforms.value[item.contentKey] ?? IDENTITY_TRANSFORM
    const next: VideoTransform = { ...cur, rotate: nextRotation(cur.rotate) }
    applyTransform(item.contentKey, next)
    showFeedback(`画面转向 ${next.rotate}°`, 'info')
  }

  /** 水平镜像（左右翻转） */
  function toggleFlip() {
    const item = current.value
    if (!item) return
    const cur = transforms.value[item.contentKey] ?? IDENTITY_TRANSFORM
    const next: VideoTransform = { ...cur, flip: !cur.flip }
    applyTransform(item.contentKey, next)
    showFeedback(`水平镜像：${next.flip ? '开' : '关'}`, 'info')
  }

  /** 把当前视频复位成原始方向 */
  function resetTransform() {
    const item = current.value
    if (!item) return
    applyTransform(item.contentKey, { ...IDENTITY_TRANSFORM })
    showFeedback('已复位画面转向', 'info')
  }

  /** 清空所有视频的转向记录（只动本地记录，不碰文件） */
  function clearAllTransforms() {
    transforms.value = {}
    clearTransforms()
    showOsd('已清除全部画面转向记录', 'info')
  }

  return {
    // state
    allItems,
    sources,
    playlist,
    currentId,
    activeSourceId,
    playlistMode,
    volume,
    muted,
    playbackRate,
    seekStep,
    loopMode,
    autoPlay,
    deleteMode,
    fitMode,
    osdEnabled,
    osdImportant,
    sortKey,
    sortDir,
    keymap,
    capturingKey,
    osd,
    pulse,
    trash,
    transforms,
    duplicates,
    duplicateScan,
    duplicatesScanned,
    scan,
    loading,
    activePanel,
    contextItem,
    folderFilter,
    folderRoots,
    // getters
    playlistCount,
    playlistTotal,
    folderFilterLabel,
    isEmpty,
    currentIndex,
    current,
    sourceCount,
    activeSource,
    effectiveSourceId,
    canRealDelete,
    canUndo,
    currentTransform,
    hasTransform,
    transformLabel,
    duplicateCandidateCount,
    duplicateStats,
    duplicateSupported,
    // actions
    showOsd,
    showFeedback,
    pulsePlay,
    select,
    next,
    prev,
    step,
    applySort,
    setSort,
    toggleSortDir,
    setKeybinding,
    resetKeybindings,
    setVolume,
    adjustVolume,
    toggleMute,
    setPlaybackRate,
    showSeekOsd,
    importByPicker,
    importByDirectoryHandle,
    importByFileList,
    restoreLastSession,
    hasSavedSession,
    forgetSession,
    removeSource,
    removeAllSources,
    setActiveSource,
    setPlaylistMode,
    removeCurrent,
    undoDelete,
    reset,
    togglePanel,
    closePanel,
    setContextItem,
    openFolder,
    applyFolderFilter,
    clearFolderFilter,
    toggleFolderFilter,
    setFolderRoot,
    removeFolderRoot,
    cycleFitMode,
    rotateVideo,
    toggleFlip,
    resetTransform,
    clearAllTransforms,
    scanDuplicates,
    cancelDuplicateScan,
    clearDuplicates,
    removeDuplicateItems,
    flushPrefs,
    resetPrefs,
    VOLUME_STEP,
    SEEK_STEP,
    TRASH_DIR
  }
})
