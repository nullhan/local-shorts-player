import type { SourceMode, VideoSource } from '@/types'

/**
 * 用 IndexedDB 持久化目录句柄。
 * FileSystemDirectoryHandle 可结构化克隆，因此可跨会话保存，
 * 配合 queryPermission/requestPermission 实现"下次直接恢复上次的目录"。
 *
 * 支持多个来源：每个文件夹一条记录，键为来源 id。
 * 旧版本只存了单个 root-dir，这里保留迁移逻辑，避免用户升级后丢记忆。
 */
const DB_NAME = 'local-shorts-player'
const STORE = 'handles'
const LEGACY_ROOT_KEY = 'root-dir'
const SOURCE_PREFIX = 'source:'

interface StoredSource {
  id: string
  name: string
  mode: SourceMode
  addedAt: number
  handle: FileSystemDirectoryHandle
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest
): Promise<T | null> {
  try {
    const db = await openDb()
    const result = await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = action(tx.objectStore(STORE))
      request.onsuccess = () => resolve((request.result as T) ?? null)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return result
  } catch {
    return null
  }
}

function sourceKey(id: string): string {
  return `${SOURCE_PREFIX}${id}`
}

/** 写入 / 覆盖一个来源句柄 */
export function saveSourceHandle(source: VideoSource): Promise<unknown> {
  if (!source.handle) return Promise.resolve(null)
  const payload: StoredSource = {
    id: source.id,
    name: source.name,
    mode: source.mode,
    addedAt: source.addedAt,
    handle: source.handle
  }
  return run('readwrite', (store) => store.put(payload, sourceKey(source.id)))
}

export function removeSourceHandle(id: string): Promise<unknown> {
  return run('readwrite', (store) => store.delete(sourceKey(id)))
}

/** 读取全部已记忆的来源句柄 */
export async function loadSourceHandles(): Promise<StoredSource[]> {
  const keys = await run<IDBValidKey[]>('readonly', (store) => store.getAllKeys())
  if (!keys?.length) return []

  const sourceKeys = keys.filter(
    (key): key is string => typeof key === 'string' && key.startsWith(SOURCE_PREFIX)
  )

  const output: StoredSource[] = []
  for (const key of sourceKeys) {
    const record = await run<StoredSource>('readonly', (store) => store.get(key))
    if (record?.handle && record.id) output.push(record)
  }
  output.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0))
  return output
}

/**
 * 迁移旧版本的单目录记忆。
 * 返回迁移出来的来源；同时把旧的 key 清掉，避免每次启动都重复迁移。
 */
export async function migrateLegacyRootHandle(): Promise<StoredSource | null> {
  const legacy = await run<FileSystemDirectoryHandle>('readonly', (store) =>
    store.get(LEGACY_ROOT_KEY)
  )
  if (!legacy) return null

  const migrated: StoredSource = {
    id: `legacy-${legacy.name || 'root'}`,
    name: legacy.name || '上次的目录',
    mode: 'handle',
    addedAt: Date.now(),
    handle: legacy
  }
  await run('readwrite', (store) => store.put(migrated, sourceKey(migrated.id)))
  await run('readwrite', (store) => store.delete(LEGACY_ROOT_KEY))
  return migrated
}

export function clearAllHandles(): Promise<unknown> {
  return run('readwrite', (store) => store.clear())
}
