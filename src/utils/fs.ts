import type { ScanProgress, SourceMode, VideoItem } from '@/types'
import { hashString, isVideoFile, naturalCompare } from './media'

export const TRASH_DIR = '.shorts-trash'

export interface ScanResult {
  items: VideoItem[]
  mode: SourceMode
  skipped: number
}

/** 扫描时已经确定的来源信息（句柄 / 来源 id / 名称） */
export interface ScanSource {
  id: string
  name: string
  handle: FileSystemDirectoryHandle | null
}

/**
 * 生成「跨会话稳定」的内容标识：相对路径 + 体积 + 修改时间。
 * 不含来源，所以同一个文件夹重新导入后不变 —— 画面转向记录靠它关联。
 */
export function buildContentKey(
  relativePath: string,
  size: number,
  mtime: number
): string {
  return hashString(`${relativePath}|${size}|${mtime}`)
}

function buildItem(
  file: File,
  relativePath: string,
  handle: FileSystemFileHandle | null,
  source: ScanSource
): VideoItem {
  const segments = relativePath.split('/')
  const parentPath = segments.slice(0, -1).join('/')
  const mtime = file.lastModified || 0
  const contentKey = buildContentKey(relativePath, file.size, mtime)
  return {
    // 列表内唯一必须带上来源，否则两个文件夹里的同名同体积文件会撞 id
    id: `${source.id}:${contentKey}`,
    contentKey,
    sourceId: source.id,
    name: segments[segments.length - 1],
    url: URL.createObjectURL(file),
    file,
    handle,
    size: file.size,
    relativePath,
    parentPath,
    mtime
  }
}

function isUnderTrash(relativePath: string): boolean {
  return relativePath.split('/').includes(TRASH_DIR)
}

/**
 * 递归扫描目录句柄。
 * 使用 entries() 而非 values()，以便同时拿到子项名字。
 */
async function walkDirectory(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  onProgress: (progress: ScanProgress) => void,
  state: ScanProgress,
  items: VideoItem[],
  source: ScanSource
): Promise<number> {
  let skipped = 0
  for await (const [name, entry] of dir.entries()) {
    if (name.startsWith('.')) continue
    const relativePath = prefix ? `${prefix}/${name}` : name
    if (isUnderTrash(relativePath)) continue

    if (entry.kind === 'directory') {
      state.dirs += 1
      onProgress({ ...state })
      skipped += await walkDirectory(
        entry as FileSystemDirectoryHandle,
        relativePath,
        onProgress,
        state,
        items,
        source
      )
      continue
    }

    if (!isVideoFile(name)) {
      skipped += 1
      continue
    }

    try {
      const file = await (entry as FileSystemFileHandle).getFile()
      items.push(buildItem(file, relativePath, entry as FileSystemFileHandle, source))
      state.found = items.length
      onProgress({ ...state })
    } catch {
      skipped += 1
    }
  }
  return skipped
}

/** 通过 showDirectoryPicker 的目录句柄扫描（推荐，支持自动递归 + 真实删除） */
export async function scanByHandle(
  root: FileSystemDirectoryHandle,
  source: ScanSource,
  onProgress: (progress: ScanProgress) => void
): Promise<ScanResult> {
  const state: ScanProgress = { found: 0, dirs: 0, scanning: true }
  const items: VideoItem[] = []
  onProgress({ ...state })

  const skipped = await walkDirectory(root, '', onProgress, state, items, source)

  state.scanning = false
  onProgress({ ...state })
  items.sort((a, b) => naturalCompare(a.relativePath, b.relativePath))

  return { items, mode: 'handle', skipped }
}

/**
 * 降级扫描：<input type="file" webkitdirectory> 或拖拽目录。
 * 只能拿到 File 列表，浏览器隐藏了绝对路径，用 webkitRelativePath 兜底。
 */
export async function scanByFileList(
  fileList: FileList | File[],
  source: ScanSource,
  onProgress: (progress: ScanProgress) => void
): Promise<ScanResult> {
  const files = Array.from(fileList)
  const state: ScanProgress = { found: 0, dirs: 0, scanning: true }
  const items: VideoItem[] = []
  const seen = new Set<string>()
  let skipped = 0

  onProgress({ ...state })
  for (const file of files) {
    const relativePath =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    if (seen.has(relativePath) || isUnderTrash(relativePath)) continue
    seen.add(relativePath)

    if (!isVideoFile(file.name)) {
      skipped += 1
      continue
    }
    items.push(buildItem(file, relativePath, null, source))
    state.found = items.length
  }

  state.scanning = false
  onProgress({ ...state })
  items.sort((a, b) => naturalCompare(a.relativePath, b.relativePath))

  return { items, mode: 'fallback', skipped }
}

/** 释放已生成的 blob url */
export function revokeItems(items: VideoItem[]): void {
  items.forEach((item) => URL.revokeObjectURL(item.url))
}

async function resolveDirectory(
  root: FileSystemDirectoryHandle,
  segments: string[],
  create = false
): Promise<FileSystemDirectoryHandle> {
  let current = root
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment, { create })
  }
  return current
}

/**
 * 通过目录句柄真实删除文件，并移动到 .shorts-trash 回收站。
 * 返回回收站内的路径，失败抛错。
 */
export async function trashByHandle(
  root: FileSystemDirectoryHandle,
  item: VideoItem
): Promise<string[]> {
  if (!item.handle) throw new Error('该条目没有文件句柄，无法真实删除')
  const trashDir = await resolveDirectory(root, [TRASH_DIR], true)

  const segments = item.relativePath.split('/')
  const fileName = segments[segments.length - 1]
  const parentInTrash = segments.slice(0, -1)
  const targetDir = parentInTrash.length
    ? await resolveDirectory(trashDir, parentInTrash, true)
    : trashDir

  // 目录句柄 API 没有 rename，逐字节复制文件流后删除原文件
  const sourceFile = await item.handle.getFile()
  const targetHandle = await targetDir.getFileHandle(fileName, { create: true })
  const writable = await targetHandle.createWritable()
  await writable.write(sourceFile)
  await writable.close()

  await item.handle.remove()

  return [TRASH_DIR, ...parentInTrash, fileName]
}

/** 从回收站还原 */
export async function restoreFromTrash(
  root: FileSystemDirectoryHandle,
  record: { trashPath: string[]; parentPath: string }
): Promise<FileSystemFileHandle> {
  const fileName = record.trashPath[record.trashPath.length - 1]
  const trashSegments = record.trashPath.slice(0, -1)
  const trashDir = await resolveDirectory(root, trashSegments, false)
  const trashHandle = await trashDir.getFileHandle(fileName)

  const file = await trashHandle.getFile()
  const destDir = record.parentPath
    ? await resolveDirectory(root, record.parentPath.split('/'), true)
    : root
  const destHandle = await destDir.getFileHandle(fileName, { create: true })

  const writable = await destHandle.createWritable()
  await writable.write(file)
  await writable.close()

  await trashHandle.remove()

  return destHandle
}

/** 确保句柄拥有 readwrite 权限 */
export async function ensureWritePermission(
  root: FileSystemDirectoryHandle
): Promise<boolean> {
  if (!root.queryPermission || !root.requestPermission) return true
  const current = await root.queryPermission({ mode: 'readwrite' })
  if (current === 'granted') return true
  const next = await root.requestPermission({ mode: 'readwrite' })
  return next === 'granted'
}
