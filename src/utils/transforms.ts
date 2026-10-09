/**
 * 画面转向（旋转 / 水平镜像）持久化。
 *
 * 按**视频内容标识（contentKey）**逐个记录：有些视频是斜着拍甚至整个倒过来的，
 * 需要单独纠正，不能做成全局设置 —— 否则修好一个就会弄坏其它正常的视频。
 *
 * 这里用 contentKey（相对路径 + 体积 + 修改时间）而不是 VideoItem.id：
 * - VideoItem.id 带来源前缀（多文件夹时用来区分同名文件），换个文件夹导入就会变
 * - contentKey 与来源无关，同一个文件夹重新导入后不变，记录依然有效
 *
 * 与 utils/prefs.ts 的分工：
 * - prefs.ts 存"用户偏好"（音量、按键、排序…），是一份配置
 * - 这里存"逐文件数据"，跟着文件走
 */
export type Rotation = 0 | 90 | 180 | 270

export interface VideoTransform {
  /** 顺时针旋转角度 */
  rotate: Rotation
  /** 水平镜像（左右翻转） */
  flip: boolean
}

export const IDENTITY_TRANSFORM: VideoTransform = { rotate: 0, flip: false }

const STORAGE_KEY = 'local-shorts-player:transforms'
const ROTATIONS: Rotation[] = [0, 90, 180, 270]

export function isIdentityTransform(value: VideoTransform): boolean {
  return value.rotate === 0 && !value.flip
}

/** 只保留合法角度，并丢掉"没有任何调整"的条目，避免记录无限膨胀 */
function sanitize(raw: unknown): Record<string, VideoTransform> {
  if (!raw || typeof raw !== 'object') return {}
  const output: Record<string, VideoTransform> = {}
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || !value || typeof value !== 'object') continue
    const input = value as Record<string, unknown>
    const rotate = ROTATIONS.includes(input.rotate as Rotation)
      ? (input.rotate as Rotation)
      : 0
    const flip = input.flip === true
    if (rotate === 0 && !flip) continue
    output[id] = { rotate, flip }
  }
  return output
}

export function loadTransforms(): Record<string, VideoTransform> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return sanitize(JSON.parse(raw))
  } catch {
    // 隐私模式 / 存储被禁用 / JSON 损坏时静默回落
    return {}
  }
}

export function saveTransforms(map: Record<string, VideoTransform>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitize(map)))
  } catch {
    /* 存储不可用时忽略，不影响播放 */
  }
}

export function clearTransforms(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* 忽略 */
  }
}

/** 顺时针旋转 90° 循环：0 → 90 → 180 → 270 → 0 */
export function nextRotation(current: Rotation): Rotation {
  return ((((current + 90) % 360) + 360) % 360) as Rotation
}
