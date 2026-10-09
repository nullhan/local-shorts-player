import type { ActionId, Keymap } from '@/types'

/**
 * 按键绑定工具。
 *
 * 组合键统一用字符串表示，形如 `ArrowUp` / `Shift+ArrowUp` / `Ctrl+Shift+Z`。
 * 主键优先用 `KeyboardEvent.code` 推导（KeyA → A、Digit1 → 1），
 * 这样不受输入法与键盘布局影响，展示也更接近「键盘输入绑定」类产品的习惯。
 */

export interface ActionMeta {
  id: ActionId
  label: string
  /** 设置面板里的分组标题 */
  group: string
  /** 补充说明 */
  tip?: string
}

export const ACTIONS: ActionMeta[] = [
  { id: 'prevVideo', label: '上一个视频', group: '切换' },
  { id: 'nextVideo', label: '下一个视频', group: '切换' },
  { id: 'seekBackward', label: '快退', group: '进度', tip: '按住 Shift 走 3 倍步长' },
  { id: 'seekForward', label: '快进', group: '进度', tip: '按住 Shift 走 3 倍步长' },
  { id: 'volumeUp', label: '音量 +', group: '音量' },
  { id: 'volumeDown', label: '音量 −', group: '音量' },
  { id: 'toggleMute', label: '静音开关', group: '音量' },
  { id: 'togglePlay', label: '播放 / 暂停', group: '播放' },
  { id: 'rateUp', label: '倍速 +', group: '播放' },
  { id: 'rateDown', label: '倍速 −', group: '播放' },
  { id: 'deleteCurrent', label: '删除当前视频', group: '播放' },
  { id: 'undoDelete', label: '撤销删除', group: '播放' },
  { id: 'cycleFit', label: '切换画面适配', group: '画面' },
  { id: 'rotateVideo', label: '画面转向（顺时针 90°）', group: '画面', tip: '只影响当前这一个视频' },
  { id: 'flipVideo', label: '水平镜像（左右翻转）', group: '画面' },
  { id: 'togglePlaylist', label: '播放列表', group: '界面' },
  { id: 'toggleSettings', label: '设置面板', group: '界面' },
  { id: 'toggleHelp', label: '快捷键帮助', group: '界面' },
  { id: 'toggleFullscreen', label: '全屏切换', group: '界面' },
  {
    id: 'openFolder',
    label: '打开所在文件夹',
    group: '界面',
    tip: '在资源管理器中打开并选中当前视频；小助手未运行时改为在播放列表里筛选该文件夹'
  }
]

export const ACTION_IDS = ACTIONS.map((action) => action.id)

export const ACTION_LABELS = ACTIONS.reduce<Record<string, string>>((acc, action) => {
  acc[action.id] = action.label
  return acc
}, {})

/** 默认绑定：↑↓ 切视频，←→ 调进度，音量让位到 Shift + ↑↓（音量不常用） */
export const DEFAULT_KEYMAP: Keymap = {
  prevVideo: 'ArrowUp',
  nextVideo: 'ArrowDown',
  seekBackward: 'ArrowLeft',
  seekForward: 'ArrowRight',
  volumeUp: 'Shift+ArrowUp',
  volumeDown: 'Shift+ArrowDown',
  toggleMute: 'M',
  togglePlay: 'Space',
  rateUp: ']',
  rateDown: '[',
  deleteCurrent: 'Delete',
  undoDelete: 'Ctrl+Z',
  togglePlaylist: 'N',
  toggleSettings: 'S',
  toggleHelp: 'H',
  cycleFit: 'A',
  rotateVideo: 'R',
  flipVideo: 'Shift+R',
  toggleFullscreen: 'F',
  // O = Open folder（单字母里没有语义冲突的一批里挑的）
  openFolder: 'O'
}

/** 只按下了修饰键本身，不算一次有效绑定 */
const MODIFIER_KEYS = [
  'Control',
  'Shift',
  'Alt',
  'Meta',
  'AltGraph',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Dead',
  'Unidentified'
]

export function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.includes(key)
}

function mainToken(event: KeyboardEvent): string {
  const code = event.code || ''
  const key = event.key
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^Numpad\d$/.test(code)) return `Num${code.slice(6)}`
  // 标点统一按物理键位还原成基础字符，
  // 否则 Shift+= 会得到 "+"，组合键拼成 "Shift++"，拆分展示就乱了
  const punctuation: Record<string, string> = {
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/'
  }
  if (punctuation[code]) return punctuation[code]
  if (key === ' ') return 'Space'
  if (key === 'Escape') return 'Esc'
  if (key.length === 1) return key.toUpperCase()
  return key
}

/** 把键盘事件压成组合键字符串；只按修饰键时返回 null */
export function comboFromEvent(event: KeyboardEvent): string | null {
  if (isModifierKey(event.key)) return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Meta')
  parts.push(mainToken(event))
  return parts.join('+')
}

const TOKEN_LABELS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: '空格',
  Esc: 'Esc',
  Enter: 'Enter',
  Tab: 'Tab',
  Insert: 'Ins',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Home: 'Home',
  End: 'End',
  CapsLock: 'Caps',
  Backspace: '⌫'
}

/** 组合键 → 用于界面展示的按键片段数组 */
export function formatCombo(combo: string): string[] {
  if (!combo) return ['未绑定']
  return combo.split('+').map((token) => TOKEN_LABELS[token] ?? token)
}

/** 组合键 → 单行文本 */
export function comboText(combo: string): string {
  return formatCombo(combo).join(' + ')
}

/** 反查表：组合键 → 动作 */
export function buildIndex(keymap: Keymap): Partial<Record<string, ActionId>> {
  const index: Partial<Record<string, ActionId>> = {}
  for (const action of ACTION_IDS) {
    const combo = keymap[action]
    if (combo) index[combo] = action
  }
  return index
}
