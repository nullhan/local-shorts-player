/**
 * 一个视频来源（一个文件夹）。
 * 目录句柄模式下会持久化到 IndexedDB，恢复后 id 保持不变。
 */
export interface VideoSource {
  /** 来源标识（会话内唯一，句柄模式下跨会话稳定） */
  id: string
  /** 文件夹名 */
  name: string
  /** 目录句柄；兼容模式（拖拽 / input 选择）下为 null */
  handle: FileSystemDirectoryHandle | null
  mode: SourceMode
  /** 导入时间戳 */
  addedAt: number
}

/** 多个来源如何组织成播放列表 */
export type PlaylistMode = 'merged' | 'separate'

/** 条目是音频还是视频 —— 决定用哪个渲染器、以及界面走哪套布局 */
export type MediaKind = 'video' | 'audio'

/** 媒体条目（视频或音频） */
export interface VideoItem {
  /**
   * 播放列表内唯一，已按来源作用域化。
   * 用于 Vue key / currentId / 删除记录 —— 这些都必须区分"哪个文件夹里的那个文件"。
   */
  id: string
  /**
   * 跨会话稳定的内容标识：相对路径 + 体积 + 修改时间。
   * 与来源无关，因此同一个文件夹被重新导入后仍然一致。
   * 画面转向等「跟着文件走」的记录用它做 key。
   */
  contentKey: string
  /** 所属来源 id，删除 / 还原时用于定位正确的目录句柄 */
  sourceId: string
  /** 文件名 */
  name: string
  /**
   * 音频 / 视频。按扩展名初判，视频侧的实际轨道以浏览器解出来的为准
   * （`.ogg` / `.webm` 这类歧义容器会先归到视频，避免把带画面的文件当音乐播）。
   */
  kind: MediaKind
  /** blob: 播放地址 */
  url: string
  /** 源文件（导入时的快照） */
  file: File
  /** 文件句柄，用于真实删除；降级导入时为 null */
  handle: FileSystemFileHandle | null
  size: number
  /** 相对所属来源根目录的路径，例如 子目录/a.mp4 */
  relativePath: string
  /** 所在父目录的相对路径，例如 子目录 */
  parentPath: string
  /** 文件最后修改时间（毫秒时间戳） */
  mtime: number
}

/** 一个网盘 / 远程来源（后续接入，见 README 的技术分析） */
export interface RemoteSourceMeta {
  /** 协议类型 */
  protocol: 'webdav' | 'local-helper' | 'http'
  /** 服务地址 */
  endpoint: string
  /** 用户名（可选） */
  username?: string
}

export type DeleteMode = 'trash' | 'permanent'

/** 列表循环 / 播完暂停 */
export type LoopMode = 'loop' | 'once'

/** 视频适配方式，对应 CSS object-fit */
export type FitMode = 'contain' | 'cover' | 'fill'

export type SourceMode = 'handle' | 'fallback'

/** 来源种类：本地文件夹 or 远程（网盘） */
export type SourceKind = 'local' | 'remote'

export type PanelType =
  | 'playlist'
  | 'settings'
  | 'help'
  | 'duplicates'
  | 'folderHelper'
  | 'nowPlaying'
  | null

/** 音频的界面呈现方式 */
export type ViewMode = 'auto' | 'video' | 'music'

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
  | 'cycleView'
  | 'rotateVideo'
  | 'flipVideo'
  | 'toggleFullscreen'
  | 'openFolder'

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
  /** 多个来源合并成同一列表，还是按来源分开 */
  playlistMode: PlaylistMode
  /** 界面呈现：自动（认音频就进音乐模式）/ 强制视频 / 强制音乐 */
  viewMode: ViewMode
  /** 移动端：锁屏与通知栏显示媒体信息（Media Session） */
  mediaSession: boolean
  /** 播放时阻止屏幕自动休眠（Wake Lock） */
  keepAwake: boolean
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
  /** 所属来源 id —— 还原时必须回到同一个文件夹，不能落到别的来源 */
  sourceId: string
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
