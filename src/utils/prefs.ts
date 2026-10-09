import type {
  DeleteMode,
  FitMode,
  Keymap,
  LoopMode,
  PlayerPrefs,
  PlaylistMode,
  SortDir,
  SortKey
} from '@/types'
import { ACTION_IDS, DEFAULT_KEYMAP } from './keymap'

/**
 * 播放偏好持久化。
 *
 * 与 utils/idb.ts 的分工：
 * - idb.ts 存目录句柄（FileSystemDirectoryHandle 无法 JSON 序列化，只能走 IndexedDB）
 * - 这里存普通偏好（体积小、需要同步读取以避免首屏闪变），所以用 localStorage
 *
 * 注意：不持久化「目录记忆」和「播放进度」这类隐私/易失效信息，
 * 仅保存用户显式调整过的播放偏好。
 */
const STORAGE_KEY = 'local-shorts-player:prefs'

const FIT_MODES: FitMode[] = ['contain', 'cover', 'fill']
const LOOP_MODES: LoopMode[] = ['loop', 'once']
const DELETE_MODES: DeleteMode[] = ['trash', 'permanent']
const SORT_KEYS: SortKey[] = ['default', 'name', 'size', 'mtime']
const SORT_DIRS: SortDir[] = ['asc', 'desc']
const PLAYLIST_MODES: PlaylistMode[] = ['merged', 'separate']

/** 方向键步进允许的范围（秒） */
export const SEEK_STEP_MIN = 1
export const SEEK_STEP_MAX = 600

export const DEFAULT_PREFS: PlayerPrefs = {
  volume: 1,
  muted: false,
  playbackRate: 1,
  seekStep: 5,
  loopMode: 'loop',
  autoPlay: true,
  deleteMode: 'trash',
  fitMode: 'contain',
  osdEnabled: true,
  osdImportant: true,
  sortKey: 'default',
  sortDir: 'asc',
  keybindings: { ...DEFAULT_KEYMAP },
  playlistMode: 'merged'
}

function pickEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && (allowed as string[]).includes(value)
    ? (value as T)
    : fallback
}

function pickNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

function pickBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** 按键绑定逐动作兜底：缺失 / 类型不对的动作回落到默认绑定 */
function pickKeymap(value: unknown): Keymap {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const output = {} as Keymap
  for (const action of ACTION_IDS) {
    const raw = input[action]
    output[action] = typeof raw === 'string' ? raw : DEFAULT_KEYMAP[action]
  }
  return output
}

/** 逐字段校验，避免旧版本 / 被手改的脏数据把状态带崩 */
function sanitize(raw: unknown): PlayerPrefs {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_PREFS, keybindings: { ...DEFAULT_KEYMAP } }
  }
  const input = raw as Record<string, unknown>
  return {
    volume: pickNumber(input.volume, 0, 1, DEFAULT_PREFS.volume),
    muted: pickBool(input.muted, DEFAULT_PREFS.muted),
    playbackRate: pickNumber(input.playbackRate, 0.25, 4, DEFAULT_PREFS.playbackRate),
    // 步进现在是任意秒数（可手动输入），只做范围钳制
    seekStep: Math.round(
      pickNumber(input.seekStep, SEEK_STEP_MIN, SEEK_STEP_MAX, DEFAULT_PREFS.seekStep)
    ),
    loopMode: pickEnum(input.loopMode, LOOP_MODES, DEFAULT_PREFS.loopMode),
    autoPlay: pickBool(input.autoPlay, DEFAULT_PREFS.autoPlay),
    deleteMode: pickEnum(input.deleteMode, DELETE_MODES, DEFAULT_PREFS.deleteMode),
    fitMode: pickEnum(input.fitMode, FIT_MODES, DEFAULT_PREFS.fitMode),
    osdEnabled: pickBool(input.osdEnabled, DEFAULT_PREFS.osdEnabled),
    osdImportant: pickBool(input.osdImportant, DEFAULT_PREFS.osdImportant),
    sortKey: pickEnum(input.sortKey, SORT_KEYS, DEFAULT_PREFS.sortKey),
    sortDir: pickEnum(input.sortDir, SORT_DIRS, DEFAULT_PREFS.sortDir),
    keybindings: pickKeymap(input.keybindings),
    playlistMode: pickEnum(input.playlistMode, PLAYLIST_MODES, DEFAULT_PREFS.playlistMode)
  }
}

export function loadPrefs(): PlayerPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PREFS, keybindings: { ...DEFAULT_KEYMAP } }
    return sanitize(JSON.parse(raw))
  } catch {
    // 隐私模式 / 存储被禁用 / JSON 损坏时静默回落到默认值
    return { ...DEFAULT_PREFS, keybindings: { ...DEFAULT_KEYMAP } }
  }
}

export function savePrefs(prefs: PlayerPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* 存储不可用时忽略，不影响播放 */
  }
}

export function clearPrefs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* 忽略 */
  }
}
