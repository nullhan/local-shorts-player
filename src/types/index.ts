/** 视频条目 */
export interface VideoItem {
  /** 稳定唯一 id：相对路径 + 体积 + 修改时间 */
  id: string
  /** 文件名 */
  name: string
  /** blob: 播放地址 */
  url: string
  /** 源文件（导入时的快照） */
  file: File
  /** 目录句柄，用于真实删除；降级导入时为 null */
  handle: FileSystemFileHandle | null
  size: number
  /** 相对根目录的路径，例如 子目录/a.mp4 */
  relativePath: string
  /** 所在父目录的相对路径，例如 子目录 */
  parentPath: string
  /** 文件最后修改时间（毫秒时间戳） */
  mtime: number
}

export type DeleteMode = 'trash' | 'permanent'

/** 列表循环 / 播完暂停 */
export type LoopMode = 'loop' | 'once'

/** 视频适配方式，对应 CSS object-fit */
export type FitMode = 'contain' | 'cover' | 'fill'

export type SourceMode = 'handle' | 'fallback'

export type PanelType = 'playlist' | 'settings' | 'help' | 'duplicates' | null

/** 播放列表排序字段 */
export type SortKey = 'default' | 'name' | 'size' | 'mtime'

/** 排序方向 */
export type SortDir = 'asc' | 'desc'

/**
 * 可自定义绑定的动作。
 * 新增动作时同步补 ACTIONS / DEFAULT_KEYMAP（utils/keymap.ts）即可。
 */
export type ActionId =
  | 'prevVideo'
  | 'nextVideo'
  | 'seekBackward'
  | 'seekForward'
  | 'volumeUp'
  | 'volumeDown'
  | 'togglePlay'
  | 'toggleMute'
  | 'rateUp'
  | 'rateDown'
  | 'deleteCurrent'
  | 'undoDelete'
  | 'togglePlaylist'
  | 'toggleSettings'
  | 'toggleHelp'
  | 'cycleFit'
  | 'rotateVideo'
  | 'flipVideo'
  | 'toggleFullscreen'

/** 动作 → 组合键（'' 表示未绑定） */
export type Keymap = Record<ActionId, string>

/** 需要跨会话保留的播放偏好 */
export interface PlayerPrefs {
  volume: number
  muted: boolean
  playbackRate: number
  seekStep: number
  loopMode: LoopMode
  autoPlay: boolean
  deleteMode: DeleteMode
  fitMode: FitMode
  /** 提示总开关：关闭后不会出现任何浮层提示 */
  osdEnabled: boolean
  /** 重要提示（删除 / 导入结果 / 权限错误等），仅在总开关打开时有效 */
  osdImportant: boolean
  /** 播放列表排序字段 */
  sortKey: SortKey
  /** 排序方向 */
  sortDir: SortDir
  /** 自定义按键绑定 */
  keybindings: Keymap
}

/** 屏上提示（音量 / 进度 / 删除反馈） */
export interface OsdMessage {
  id: number
  text: string
  /** 简单图标语义 */
  icon?: 'volume' | 'mute' | 'seek' | 'delete' | 'undo' | 'info' | 'play' | 'pause'
  /**
   * pill：画面中央的深色胶囊（音量 / 静音）
   * ghost：画面中央的无底色轻提示（进度拖动）
   * toast：底部居中条（删除 / 导入结果等重要提示，不挡画面主体）
   */
  variant?: 'pill' | 'ghost' | 'toast'
}

/** 播放 / 暂停的图标闪现（参考抖音，不带任何底色） */
export interface PulseMessage {
  id: number
  kind: 'play' | 'pause'
}

/** 一条删除记录，用于撤销 */
export interface TrashRecord {
  item: VideoItem
  /** 在回收站目录中的相对路径，如 ['.shorts-trash', 'a.mp4'] */
  trashPath: string[]
  /** 原父目录相对路径 */
  parentPath: string
}

export interface ScanProgress {
  found: number
  dirs: number
  scanning: boolean
}

/** 一组内容相同的视频的定义见 utils/hash.ts（与算法放在一起，避免两处重复声明） */
export interface DuplicateScanProgress {
  scanning: boolean
  doneBytes: number
  totalBytes: number
  doneFiles: number
  totalFiles: number
}
