/** 常见视频容器格式 */
export const VIDEO_EXTENSIONS = [
  'mp4',
  'm4v',
  'webm',
  'mkv',
  'mov',
  'avi',
  'flv',
  'wmv',
  'ogv',
  'ogg',
  'ts',
  'm2ts',
  'mpg',
  'mpeg',
  '3gp',
  '3g2',
  'rm',
  'rmvb',
  'asf',
  'vob',
  'f4v'
] as const

/**
 * 常见音频格式。
 * 注意 ogg / webm 同时出现在两边：容器本身既能放音频也能放视频，
 * 所以判定顺序上「视频优先」—— 一个 .ogg 更可能是音乐，
 * 但真正的依据是浏览器解出来的轨道，这里只能按扩展名先给个近似。
 */
export const AUDIO_EXTENSIONS = [
  'mp3',
  'm4a',
  'aac',
  'flac',
  'wav',
  'wma',
  'opus',
  'oga',
  'mka',
  'aiff',
  'aif',
  'ape',
  'alac',
  'amr',
  'mid',
  'midi'
] as const

/** 视频侧独有的扩展名（用于把 .ogg/.webm 这类歧义容器归到音频时更保守） */
const AMBIGUOUS_EXTENSIONS = ['ogg', 'ogv', 'webm']

export type MediaKind = 'video' | 'audio'

export function getExtension(name: string): string {
  const index = name.lastIndexOf('.')
  return index < 0 ? '' : name.slice(index + 1).toLowerCase()
}

export function isVideoFile(name: string): boolean {
  return (VIDEO_EXTENSIONS as readonly string[]).includes(getExtension(name))
}

export function isAudioFile(name: string): boolean {
  return (AUDIO_EXTENSIONS as readonly string[]).includes(getExtension(name))
}

export function isMediaFile(name: string): boolean {
  return isVideoFile(name) || isAudioFile(name)
}

/**
 * 判断条目是音频还是视频。
 * - 只命中音频扩展名 → 音频
 * - 只命中视频扩展名 → 视频
 * - 两边都命中（.ogg/.webm 这类歧义容器）→ 归为视频，交给播放器按轨道自动处理
 */
export function mediaKindOf(name: string): MediaKind {
  const ext = getExtension(name)
  const inAudio = (AUDIO_EXTENSIONS as readonly string[]).includes(ext)
  const inVideo = (VIDEO_EXTENSIONS as readonly string[]).includes(ext)
  if (inAudio && inVideo) return 'video'
  if (inAudio) return 'audio'
  return 'video'
}

/** 导入时用的 accept 串，覆盖音视频两类 */
export const MEDIA_ACCEPT = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS]
  .map((ext) => `.${ext}`)
  .join(',')

/** 自然排序：a2 < a10 */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
}

/** 秒 -> mm:ss / h:mm:ss */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00'
  const total = Math.floor(seconds)
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`
}

/** 时间戳 -> YYYY-MM-DD HH:mm */
export function formatDateTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '未知'
  const date = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 简易字符串 hash，用于生成条目 id */
export function hashString(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

/**
 * 去掉扩展名，作为没有内嵌标签时的显示标题。
 * 「01 - 周杰伦 - 晴天」这类常见命名顺手拆一下，拆不出来就原样返回。
 */
export function titleFromFileName(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** 判断扩展名是否属于歧义容器（界面上提示"按视频处理"时用得上） */
export function isAmbiguousExtension(name: string): boolean {
  return AMBIGUOUS_EXTENSIONS.includes(getExtension(name))
}
