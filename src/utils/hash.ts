/**
 * 内容指纹与重复文件检测。
 *
 * 为什么不是 MD5：
 * - 浏览器没有内置 MD5，纯 JS 实现要自己扛 GB 级数据，速度只有几十 MB/s；
 * - 用 `crypto.subtle` 的 SHA-256，由浏览器原生实现，快得多，而且比 MD5 更强。
 *
 * 为什么分块：
 * `crypto.subtle.digest` 只接受完整 Buffer，几 GB 的视频一次性读进内存会把页面撑爆。
 * 所以对每块单独摘要，最后把「文件长度 + 各块摘要」再摘要一次作为整体指纹。
 * 内存占用恒定为一个块的大小。
 *
 * ⚠️ 这个指纹**依赖分块大小**：同一个文件用 8MB 和 64KB 分块会得到不同结果。
 * 对本功能无影响，因为：findDuplicates 先用体积分桶，**比较的双方体积必然相同**，
 * 同体积 ⇒ 分块方式完全一致 ⇒ 该摘要等价于"整份内容的指纹"。
 * 但也因此它**不是一个可以拿去和外部工具（如 md5sum/sha256sum）对照的标准摘要**，
 * 不要把这个值当 SHA-256 用。
 */
export const HASH_CHUNK_SIZE = 8 * 1024 * 1024

export interface HashSignal {
  aborted: boolean
}

export interface HashFileOptions {
  chunkSize?: number
  signal?: HashSignal
  /** 每读完一块回调，参数是本块字节数 */
  onChunk?: (bytes: number) => void
}

export interface DuplicateProgress {
  doneBytes: number
  totalBytes: number
  doneFiles: number
  totalFiles: number
}

export interface DuplicateGroup<T> {
  fingerprint: string
  size: number
  items: T[]
}

/** 当前环境是否支持内容哈希（需要安全上下文：https / localhost） */
export function supportsContentHash(): boolean {
  return (
    typeof crypto !== 'undefined' &&
    typeof crypto.subtle !== 'undefined' &&
    typeof crypto.subtle.digest === 'function'
  )
}

async function digestHex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  const bytes = new Uint8Array(digest)
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/** 计算单个文件的内容指纹（分块 SHA-256） */
export async function hashFile(file: File, options: HashFileOptions = {}): Promise<string> {
  const chunkSize = options.chunkSize ?? HASH_CHUNK_SIZE
  const chunks = Math.max(1, Math.ceil(file.size / chunkSize))
  const parts: string[] = []

  for (let index = 0; index < chunks; index += 1) {
    if (options.signal?.aborted) throw new Error('hash-aborted')
    const start = index * chunkSize
    const end = Math.min(start + chunkSize, file.size)
    const buffer = await file.slice(start, end).arrayBuffer()
    parts.push(await digestHex(buffer))
    options.onChunk?.(end - start)
  }

  // 把长度也揉进去，避免空文件与"只有块摘要数组"之间的歧义
  const tail = new TextEncoder().encode(`${file.size}|${parts.join('')}`)
  return digestHex(tail)
}

/**
 * 找出内容重复的项。
 *
 * 先用**文件体积**分桶：体积不同的文件不可能内容相同，
 * 于是绝大多数文件在这一步就被排除，不需要读盘，这是性能的关键。
 * 只对同体积的文件算内容指纹。体积相同但内容不同的文件（例如同一段视频的两种不同码率
 * 恰好体积一致）会被指纹区分开，不会误判。
 */
export async function findDuplicates<T>(
  entries: Array<{ value: T; file: File }>,
  options: {
    signal?: HashSignal
    onProgress?: (progress: DuplicateProgress) => void
  } = {}
): Promise<Array<DuplicateGroup<T>>> {
  const bySize = new Map<number, Array<{ value: T; file: File }>>()
  for (const entry of entries) {
    const bucket = bySize.get(entry.file.size)
    if (bucket) bucket.push(entry)
    else bySize.set(entry.file.size, [entry])
  }

  const candidates: Array<{ value: T; file: File }> = []
  for (const bucket of bySize.values()) {
    if (bucket.length > 1) candidates.push(...bucket)
  }

  const totalBytes = candidates.reduce((sum, entry) => sum + entry.file.size, 0)
  let doneBytes = 0
  let doneFiles = 0
  options.onProgress?.({ doneBytes, totalBytes, doneFiles, totalFiles: candidates.length })

  const byHash = new Map<string, { value: T; file: File }[]>()
  for (const entry of candidates) {
    if (options.signal?.aborted) throw new Error('hash-aborted')
    const fingerprint = await hashFile(entry.file, {
      signal: options.signal,
      onChunk: (bytes) => {
        doneBytes += bytes
        options.onProgress?.({
          doneBytes,
          totalBytes,
          doneFiles,
          totalFiles: candidates.length
        })
      }
    })
    const bucket = byHash.get(fingerprint)
    if (bucket) bucket.push(entry)
    else byHash.set(fingerprint, [entry])
    doneFiles += 1
    options.onProgress?.({ doneBytes, totalBytes, doneFiles, totalFiles: candidates.length })
  }

  const groups: Array<DuplicateGroup<T>> = []
  for (const [fingerprint, bucket] of byHash) {
    if (bucket.length > 1) {
      groups.push({
        fingerprint,
        size: bucket[0].file.size,
        items: bucket.map((entry) => entry.value)
      })
    }
  }

  // 先列出"删掉最划算"的（多余份数 × 体积）
  groups.sort(
    (a, b) => b.size * (b.items.length - 1) - a.size * (a.items.length - 1)
  )
  return groups
}

/** 按体积估算：有多少个文件需要真正做内容校验（用于扫描前提示） */
export function countCandidatesBySize(entries: Array<{ file: File }>): number {
  const counter = new Map<number, number>()
  for (const entry of entries) counter.set(entry.file.size, (counter.get(entry.file.size) ?? 0) + 1)
  let count = 0
  for (const size of counter.values()) if (size > 1) count += size
  return count
}
