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
  PulseMessage,
  ScanProgress,
  SortDir,
  SortKey,
  SourceMode,
  TrashRecord,
  VideoItem
} from '@/types'
import { ACTION_LABELS, DEFAULT_KEYMAP } from '@/utils/keymap'
import { clamp, naturalCompare } from '@/utils/media'
import { findDuplicates, supportsContentHash, type DuplicateGroup } from '@/utils/hash'
import {
  TRASH_DIR,
  ensureWritePermission,
  restoreFromTrash,
  revokeItems,
  scanByFileList,
  scanByHandle,
  trashByHandle
} from '@/utils/fs'
import { clearRootHandle, loadRootHandle, saveRootHandle } from '@/utils/idb'
import { DEFAULT_PREFS, clearPrefs, loadPrefs, savePrefs } from '@/utils/prefs'
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

export type { DeleteMode, FitMode, LoopMode, PanelType, SourceMode, SortKey, SortDir }

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
  const playlist = ref<VideoItem[]>([])
  const currentId = ref<string | null>(null)
  const rootName = ref('')

  const root = ref<FileSystemDirectoryHandle | null>(null)
  const mode = ref<SourceMode>('fallback')

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
  /** 设置面板正在录制按键时为 true，全局快捷键暂时让位 */
  const capturingKey = ref(false)

  const osd = ref<OsdMessage | null>(null)
  const pulse = ref<PulseMessage | null>(null)
  const trash = ref<TrashRecord[]>([])
  /** 逐视频的画面转向（旋转 / 镜像），key 为 VideoItem.id */
  const transforms = ref<Record<string, VideoTransform>>(loadTransforms())
  /** 内容重复的视频分组 */
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

  let osdTimer: number | undefined
  let osdSeq = 0
  let pulseTimer: number | undefined
  let pulseSeq = 0
  let prefsTimer: number | undefined

  const playlistCount = computed(() => playlist.value.length)
  const isEmpty = computed(() => playlist.value.length === 0)
  const currentIndex = computed(() =>
    playlist.value.findIndex((item) => item.id === currentId.value)
  )
  const current = computed<VideoItem | null>(
    () => playlist.value[currentIndex.value] ?? null
  )
  const canUndo = computed(() => trash.value.length > 0 && mode.value === 'handle')

  /** 当前视频的画面转向（没有记录就是原始方向） */
  const currentTransform = computed<VideoTransform>(() => {
    const id = currentId.value
    if (!id) return IDENTITY_TRANSFORM
    return transforms.value[id] ?? IDENTITY_TRANSFORM
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
      keybindings: { ...keymap.value }
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
      keymap
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

  function setPlaylist(items: VideoItem[]) {
    revokeItems(playlist.value)
    playlist.value = items
    currentId.value = items.length ? items[0].id : null
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

  /** 按当前 sortKey / sortDir 原地重排播放列表（当前视频不变，索引跟随） */
  function applySort() {
    const dir = sortDir.value === 'asc' ? 1 : -1
    const key = sortKey.value
    const sorted = [...playlist.value].sort((a, b) => dir * compareItems(a, b, key))
    playlist.value = sorted
  }

  function setSort(key: SortKey) {
    sortKey.value = key
    sortDir.value = SORT_DEFAULT_DIR[key]
    applySort()
  }

  function toggleSortDir() {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
    applySort()
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

  /* ---------------- 导入 ---------------- */

  async function applyScan(result: Awaited<ReturnType<typeof scanByHandle>>) {
    mode.value = result.mode
    root.value = result.root
    setPlaylist(result.items)
    applySort()
    if (result.items.length === 0) {
      showOsd('未找到视频文件', 'info')
    } else {
      showOsd(`已导入 ${result.items.length} 个视频`, 'info')
    }
  }

  /** 首选：目录选择器（支持自动递归 + 真实删除 + 会话恢复） */
  async function importByPicker(): Promise<boolean> {
    if (!window.showDirectoryPicker) {
      showOsd('当前浏览器不支持目录选择，请使用拖拽或「选择文件夹」', 'info')
      return false
    }
    loading.value = true
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
      rootName.value = handle.name
      const result = await scanByHandle(handle, (progress) => {
        scan.value = progress
      })
      await applyScan(result)
      await saveRootHandle(handle)
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
      rootName.value = handle.name
      const result = await scanByHandle(handle, (progress) => {
        scan.value = progress
      })
      await applyScan(result)
      await saveRootHandle(handle)
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
      const result = await scanByFileList(fileList, (progress) => {
        scan.value = progress
      })
      root.value = null
      await applyScan(result)
      if (result.items.length) {
        showOsd(
          `已导入 ${result.items.length} 个视频（浏览器限制：删除仅移出列表）`,
          'info'
        )
      }
      return result.items.length > 0
    } finally {
      loading.value = false
    }
  }

  /** 尝试恢复上次的目录，需要用户手势触发权限确认 */
  async function restoreLastSession(): Promise<boolean> {
    const handle = await loadRootHandle()
    if (!handle) return false
    const granted = handle.queryPermission
      ? (await handle.queryPermission({ mode: 'readwrite' })) === 'granted'
      : true
    if (!granted) return false
    rootName.value = handle.name
    const result = await scanByHandle(handle, (progress) => {
      scan.value = progress
    })
    await applyScan(result)
    return true
  }

  async function hasSavedSession(): Promise<boolean> {
    return Boolean(await loadRootHandle())
  }

  async function forgetSession() {
    await clearRootHandle()
    rootName.value = ''
  }

  /** 删除当前视频：目录句柄模式真实移入回收站，降级模式仅移出列表 */
  async function removeCurrent(): Promise<void> {
    const item = current.value
    if (!item) return

    if (mode.value !== 'handle' || !root.value || !item.handle) {
      const index = currentIndex.value
      const [removed] = playlist.value.splice(index, 1)
      if (removed) URL.revokeObjectURL(removed.url)
      const fallback = playlist.value[Math.min(index, playlist.value.length - 1)]
      currentId.value = fallback ? fallback.id : null
      showOsd('已从列表移除（浏览器限制，磁盘文件未删除）', 'delete')
      return
    }

    if (deleteMode.value === 'trash') {
      const granted = await ensureWritePermission(root.value)
      if (!granted) {
        showOsd('未获得写入权限，无法移动文件', 'info')
        return
      }
    }

    try {
      let trashPath: string[] = []
      if (deleteMode.value === 'trash') {
        trashPath = await trashByHandle(root.value, item)
      } else {
        await item.handle.remove()
      }

      const index = currentIndex.value
      playlist.value.splice(index, 1)
      URL.revokeObjectURL(item.url)

      const fallback = playlist.value[Math.min(index, playlist.value.length - 1)]
      currentId.value = fallback ? fallback.id : null

      if (deleteMode.value === 'trash') {
        trash.value.push({ item, trashPath, parentPath: item.parentPath })
        showOsd(`已移入回收站：${item.name}（Ctrl+Z 撤销）`, 'delete')
      } else {
        showOsd(`已永久删除：${item.name}`, 'delete')
      }
    } catch {
      showOsd('删除失败，请确认目录写入权限', 'info')
    }
  }

  /** 撤销上一次删除 */
  async function undoDelete(): Promise<void> {
    const record = trash.value.pop()
    if (!record) {
      showOsd('没有可撤销的删除', 'info')
      return
    }
    if (!root.value) return

    try {
      const handle = await restoreFromTrash(root.value, record)
      const restored: VideoItem = {
        ...record.item,
        handle,
        url: URL.createObjectURL(record.item.file)
      }
      playlist.value.push(restored)
      // 还原后按当前排序规则归位，而不是塞到末尾
      applySort()
      currentId.value = restored.id
      showOsd(`已还原：${restored.name}`, 'undo')
    } catch {
      trash.value.push(record)
      showOsd('还原失败，文件可能已被移动', 'info')
    }
  }

  /* ---------------- 重复视频 ---------------- */

  /** 需要做内容校验的文件数（体积不重复的文件不可能内容相同，先排除掉） */
  const duplicateCandidateCount = computed(() => {
    const counter = new Map<number, number>()
    for (const item of playlist.value) counter.set(item.size, (counter.get(item.size) ?? 0) + 1)
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
    if (!playlist.value.length) {
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
        playlist.value.map((item) => ({ value: item, file: item.file })),
        {
          signal: duplicateSignal,
          onProgress: (progress) => {
            duplicateScan.value = { scanning: true, ...progress }
          }
        }
      )
      duplicates.value = groups
      duplicatesScanned.value = true
      showOsd(
        groups.length ? `发现 ${groups.length} 组重复视频` : '没有发现重复视频',
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
   * 批量删除（重复视频清理用）。
   * 目录句柄模式下按删除方式真实处理，兼容模式只把条目移出列表。
   * 返回真正处理成功的条目。
   */
  async function removeMany(items: VideoItem[]): Promise<VideoItem[]> {
    if (!items.length) return []
    const index = currentIndex.value

    const detach = (removed: VideoItem[]) => {
      const ids = new Set(removed.map((item) => item.id))
      revokeItems(removed)
      playlist.value = playlist.value.filter((item) => !ids.has(item.id))
      if (currentId.value && ids.has(currentId.value)) {
        const fallback = playlist.value[Math.min(index, playlist.value.length - 1)]
        currentId.value = fallback ? fallback.id : null
      }
    }

    if (mode.value !== 'handle' || !root.value) {
      detach(items)
      showOsd(`已从列表移除 ${items.length} 个（浏览器限制，磁盘文件未删除）`, 'delete')
      return items
    }

    if (deleteMode.value === 'trash') {
      const granted = await ensureWritePermission(root.value)
      if (!granted) {
        showOsd('未获得写入权限，无法移动文件', 'info')
        return []
      }
    }

    const succeeded: VideoItem[] = []
    for (const item of items) {
      if (!item.handle) continue
      try {
        if (deleteMode.value === 'trash') {
          const trashPath = await trashByHandle(root.value, item)
          trash.value.push({ item, trashPath, parentPath: item.parentPath })
        } else {
          await item.handle.remove()
        }
        succeeded.push(item)
      } catch {
        /* 单个失败不影响其余 */
      }
    }

    if (!succeeded.length) {
      showOsd('删除失败，请确认目录写入权限', 'info')
      return []
    }

    detach(succeeded)
    const verb = deleteMode.value === 'trash' ? '已移入回收站' : '已永久删除'
    const failed = items.length - succeeded.length
    showOsd(
      failed > 0 ? `${verb} ${succeeded.length} 个，${failed} 个失败` : `${verb} ${succeeded.length} 个`,
      'delete'
    )
    return succeeded
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
    revokeItems(playlist.value)
    playlist.value = []
    currentId.value = null
    root.value = null
    mode.value = 'fallback'
    rootName.value = ''
    trash.value = []
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
  }

  /* ---------------- 画面转向（逐视频） ---------------- */

  /** 写入某个视频的转向记录；回到"原始方向"的条目会被删掉，避免记录无限膨胀 */
  function applyTransform(id: string, next: VideoTransform) {
    const map = { ...transforms.value }
    if (next.rotate === 0 && !next.flip) delete map[id]
    else map[id] = next
    transforms.value = map
    saveTransforms(map)
  }

  /** 顺时针旋转 90° 循环：0 → 90 → 180 → 270 → 0 */
  function rotateVideo() {
    const id = currentId.value
    if (!id) return
    const current = transforms.value[id] ?? IDENTITY_TRANSFORM
    const next: VideoTransform = { ...current, rotate: nextRotation(current.rotate) }
    applyTransform(id, next)
    showFeedback(`画面转向 ${next.rotate}°`, 'info')
  }

  /** 水平镜像（左右翻转） */
  function toggleFlip() {
    const id = currentId.value
    if (!id) return
    const current = transforms.value[id] ?? IDENTITY_TRANSFORM
    const next: VideoTransform = { ...current, flip: !current.flip }
    applyTransform(id, next)
    showFeedback(`水平镜像：${next.flip ? '开' : '关'}`, 'info')
  }

  /** 把当前视频复位成原始方向 */
  function resetTransform() {
    const id = currentId.value
    if (!id) return
    applyTransform(id, { ...IDENTITY_TRANSFORM })
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
    playlist,
    currentId,
    rootName,
    mode,
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
    // getters
    playlistCount,
    isEmpty,
    currentIndex,
    current,
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
    removeCurrent,
    undoDelete,
    reset,
    togglePanel,
    closePanel,
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
