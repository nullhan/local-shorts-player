/**
 * 「打开所在文件夹」的两块能力。
 *
 * 1) **本地小助手客户端** —— 浏览器没有任何接口能打开系统资源管理器，
 *    而且出于隐私设计连文件/文件夹的绝对路径都不给（`FileSystemHandle` 只有 `name`）。
 *    所以真正的「在资源管理器中显示」必须借一个小程序完成：`tools/reveal-helper.mjs`。
 * 2) **根目录登记表** —— 因为拿不到绝对路径，每个来源的根目录要由用户登记一次
 *    （浏览器不给，就只能手填），保存在 localStorage，按来源 id 关联、按来源名兜底匹配。
 *
 * 小助手不可用时，调用方会退化成「应用内筛选」（见 store 的 openFolder）。
 */

export const HELPER_PORT = 17897
export const HELPER_ORIGIN = `http://127.0.0.1:${HELPER_PORT}`
export const HELPER_COMMAND = 'node tools/reveal-helper.mjs'

const STORAGE_KEY = 'local-shorts-player:folder-roots'

export interface FolderRootRecord {
  /** 用户登记的根目录绝对路径，例如 D:\videos */
  path: string
  /** 登记时的来源名。来源 id 会因重新导入而变化，用它兜底匹配 */
  sourceName: string
  /** 登记时间戳 */
  at: number
}

export type FolderRootMap = Record<string, FolderRootRecord>

export interface HelperTarget {
  absPath: string
  folderOnly: boolean
  tried: string[]
}

export type HelperResult =
  | { status: 'ok'; target: HelperTarget }
  | { status: 'not-found'; tried: string[]; message?: string }
  | { status: 'unreachable' }
  | { status: 'error'; message: string }

export interface HelperInfo {
  version: number
  port: number
  dryRun: boolean
}

/* ---------------- 存储 ---------------- */

function sanitize(input: unknown): FolderRootMap {
  if (!input || typeof input !== 'object') return {}
  const output: FolderRootMap = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!key || !value || typeof value !== 'object') continue
    const raw = value as Record<string, unknown>
    if (typeof raw.path !== 'string' || !raw.path.trim()) continue
    output[key] = {
      path: raw.path.trim(),
      sourceName: typeof raw.sourceName === 'string' ? raw.sourceName : '',
      at: typeof raw.at === 'number' ? raw.at : 0
    }
  }
  return output
}

export function loadFolderRoots(): FolderRootMap {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return sanitize(JSON.parse(raw))
  } catch {
    return {}
  }
}

export function saveFolderRoots(map: FolderRootMap): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* 隐私模式下写不进去也不该炸 */
  }
}

/**
 * 找一个来源登记的根目录。
 * 先按来源 id 精确匹配；来源 id 会随"重新导入同一个文件夹"变化，所以再按来源名兜底。
 */
export function resolveFolderRoot(
  map: FolderRootMap,
  sourceId: string,
  sourceName: string
): FolderRootRecord | null {
  const exact = map[sourceId]
  if (exact) return exact
  if (!sourceName) return null
  const byName = Object.values(map).find((record) => record.sourceName === sourceName)
  return byName ?? null
}

/* ---------------- 小助手客户端 ---------------- */

async function request(path: string, body: unknown, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(`${HELPER_ORIGIN}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    })
  } finally {
    window.clearTimeout(timer)
  }
}

/** 探测小助手是否在运行。超时故意设短：不在运行时不该让按键卡住 */
export async function probeHelper(timeoutMs = 900): Promise<HelperInfo | null> {
  try {
    const response = await request('/ping', undefined, timeoutMs)
    if (!response.ok) return null
    const data = (await response.json()) as HelperInfo & { ok?: boolean }
    return data?.ok ? data : null
  } catch {
    return null
  }
}

/**
 * 调用 /check（只校验）或 /reveal（真的打开资源管理器）。
 * 页面只上报「登记的根目录 + 条目在来源内的相对路径」，
 * 具体怎么拼成绝对路径、以及在两种导入模式下如何容错，由小助手负责。
 */
export async function callHelper(
  route: '/check' | '/reveal',
  root: string,
  rel: string,
  timeoutMs = 4000
): Promise<HelperResult> {
  let response: Response
  try {
    response = await request(route, { root, rel }, timeoutMs)
  } catch {
    return { status: 'unreachable' }
  }

  let data: {
    ok?: boolean
    absPath?: string
    folderOnly?: boolean
    tried?: string[]
    message?: string
    error?: string
  }
  try {
    data = await response.json()
  } catch {
    return { status: 'error', message: `小助手返回了非 JSON 内容（HTTP ${response.status}）` }
  }

  if (data.ok && typeof data.absPath === 'string') {
    return {
      status: 'ok',
      target: {
        absPath: data.absPath,
        folderOnly: Boolean(data.folderOnly),
        tried: data.tried ?? []
      }
    }
  }

  if (response.status === 404) {
    return { status: 'not-found', tried: data.tried ?? [], message: data.message }
  }
  return { status: 'error', message: data.message ?? data.error ?? `HTTP ${response.status}` }
}
