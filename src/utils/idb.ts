/**
 * 用 IndexedDB 持久化目录句柄。
 * FileSystemDirectoryHandle 可结构化克隆，因此可跨会话保存，
 * 配合 queryPermission/requestPermission 实现"下次直接恢复上次的目录"。
 */
const DB_NAME = 'local-shorts-player'
const STORE = 'handles'
const ROOT_KEY = 'root-dir'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  try {
    const db = await openDb()
    const result = await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = run(tx.objectStore(STORE))
      request.onsuccess = () => resolve((request.result as T) ?? null)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return result
  } catch {
    return null
  }
}

export function saveRootHandle(handle: FileSystemDirectoryHandle): Promise<unknown> {
  return withStore('readwrite', (store) => store.put(handle, ROOT_KEY))
}

export function loadRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  return withStore<FileSystemDirectoryHandle>('readonly', (store) => store.get(ROOT_KEY))
}

export function clearRootHandle(): Promise<unknown> {
  return withStore('readwrite', (store) => store.delete(ROOT_KEY))
}
