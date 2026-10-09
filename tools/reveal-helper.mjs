#!/usr/bin/env node
/**
 * 「打开所在文件夹」的本地小助手。
 *
 * 为什么需要它：浏览器**没有**任何接口能打开系统资源管理器，而且出于隐私设计，
 * 页面拿不到文件/文件夹的绝对路径（`FileSystemHandle` 只给 `name`）。
 * 所以由这个零依赖的小程序来补上最后一步：页面上按 O → 请求本机 → `explorer /select,<文件>`。
 *
 * 用法：
 *   node tools/reveal-helper.mjs                 # 默认监听 127.0.0.1:17897
 *   node tools/reveal-helper.mjs --port 18000
 *   node tools/reveal-helper.mjs --dry-run       # 只打印将要执行的命令，不真的打开窗口
 *   node tools/reveal-helper.mjs --allow-origin https://example.com
 *
 * 页面端配合：在播放页「设置 → 文件夹」里登记每个来源根目录的完整路径（浏览器不给，只能手填）。
 */
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { parseArgs } from 'node:util'

const VERSION = 1
const DEFAULT_PORT = 17897

/** 页面可能部署在这些来源上；其它来源一律拒绝（防止任意网站调用本机程序） */
const DEFAULT_ORIGINS = ['https://nullhan.github.io']
/** 本机开发/预览服务器总是允许 */
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

const { values } = parseArgs({
  options: {
    port: { type: 'string' },
    'dry-run': { type: 'boolean' },
    'allow-origin': { type: 'string', multiple: true },
    help: { type: 'boolean', short: 'h' }
  }
})

if (values.help) {
  console.log(`本地小助手 v${VERSION}

node tools/reveal-helper.mjs [选项]

  --port <n>              监听端口（默认 ${DEFAULT_PORT}）
  --dry-run               只打印将执行的命令，不真的打开资源管理器
  --allow-origin <origin> 额外允许一个网页来源，可重复
  -h, --help              显示本帮助
`)
  process.exit(0)
}

const port = Number(values.port) || DEFAULT_PORT
const dryRun = Boolean(values['dry-run'])
const extraOrigins = values['allow-origin'] ?? []
const allowedOrigins = [...DEFAULT_ORIGINS, ...extraOrigins]

function log(...parts) {
  const time = new Date().toTimeString().slice(0, 8)
  console.log(`[${time}]`, ...parts)
}

/* ------------------------------------------------------------------
 * 路径解析
 *
 * 页面只会告诉我们「登记的根目录」+「条目在来源内的相对路径」，两者拼接可能不吻合，
 * 因为两种导入模式下相对路径的含义不同：
 *   - 句柄模式（showDirectoryPicker）：相对路径不含根目录名  → root/rel
 *   - 兼容模式（拖拽 / input）：webkitRelativePath 含根目录名 → 需要剥掉或改用 root 的父目录
 * 所以这里按顺序尝试几种组合，**以磁盘上是否真实存在为准**，并回报最终采用的路径。
 * ------------------------------------------------------------------ */

/** 段里出现这些就拒绝，避免路径穿越 */
function isBadSegment(segment) {
  return segment === '..' || /^[a-zA-Z]:$/.test(segment)
}

function resolveTarget(root, rel) {
  const segments = String(rel)
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
  if (segments.some(isBadSegment)) return { error: 'bad-relative-path', tried: [] }

  const rootAbs = path.resolve(String(root))
  const candidates = [path.join(rootAbs, ...segments)]

  // 相对路径里已经带了根目录名（兼容模式）
  if (segments.length && segments[0].toLowerCase() === path.basename(rootAbs).toLowerCase()) {
    candidates.push(path.join(rootAbs, ...segments.slice(1)))
  }
  // 登记的是被拖入文件夹的父目录
  candidates.push(path.resolve(rootAbs, '..', ...segments))

  const tried = [...new Set(candidates)]
  for (const candidate of tried) {
    if (existsSync(candidate)) return { absPath: candidate, tried }
  }
  // 文件没了但文件夹还在：退一步打开文件夹，比直接报错有用
  const parent = path.dirname(tried[0])
  if (existsSync(parent)) return { absPath: parent, folderOnly: true, tried }
  return { absPath: null, tried }
}

/** explorer 的怪癖：选中文件要用 `/select,<路径>` 且路径带空格也没问题；目录则直接传 */
function reveal(target) {
  const isDir = statSync(target).isDirectory()
  const arg = isDir ? target : `/select,${target}`
  if (dryRun) {
    log(`[dry-run] explorer.exe "${arg}"`)
    return
  }
  const child = spawn('explorer.exe', [arg], { detached: true, stdio: 'ignore' })
  child.on('error', (error) => log('启动 explorer 失败:', error.message))
  child.unref()
}

/* ------------------------------------------------------------------ */

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    // 页面若部署在 https 上，请求本机需要过 Private Network Access 预检
    'Access-Control-Allow-Private-Network': 'true',
    Vary: 'Origin'
  }
}

function isAllowedOrigin(origin) {
  if (!origin) return true // 非浏览器请求（如 curl）
  return allowedOrigins.includes(origin) || LOCAL_ORIGIN.test(origin)
}

function sendJson(res, origin, status, payload) {
  const body = JSON.stringify(payload, null, 2)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...corsHeaders(origin)
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 64 * 1024) reject(new Error('body too large'))
    })
    req.on('end', () => {
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('invalid json'))
      }
    })
    req.on('error', reject)
  })
}

const STATUS_PAGE = (origin) => `<!doctype html>
<meta charset="utf-8">
<title>本地小助手正在运行</title>
<style>
  body { margin: 0; padding: 40px; background: #14141a; color: #e8e8ef;
         font: 14px/1.7 system-ui, "Microsoft YaHei", sans-serif; }
  code { padding: 2px 6px; border-radius: 4px; background: #26262f; }
  .ok { color: #6fe0a3; }
</style>
<h1>本地小助手正在运行</h1>
<p class="ok">监听 127.0.0.1:${port}${dryRun ? '（dry-run 模式：只打印不打开）' : ''}</p>
<p>播放页里按 <code>O</code> 就会用资源管理器打开相应文件夹。</p>
<p>允许的网页来源：<code>${origin}</code></p>
<p>关闭窗口或按 Ctrl+C 即可停止。</p>`

const server = createServer(async (req, res) => {
  const origin = req.headers.origin ?? ''
  const host = origin || '（无来源）'
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`)

  res.on('finish', () => {
    log(`${req.method} ${url.pathname} → ${res.statusCode}  [${host}]`)
  })

  if (!isAllowedOrigin(origin)) {
    return sendJson(res, '', 403, {
      ok: false,
      error: 'origin-not-allowed',
      message: `来源 ${origin} 不在允许列表里。用 --allow-origin ${origin} 启动即可放行。`,
      allowed: allowedOrigins
    })
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin || '*'))
    return res.end()
  }

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      ...corsHeaders(origin || '*')
    })
    return res.end(STATUS_PAGE(origin || '（浏览器直接打开）'))
  }

  if (req.method === 'GET' && url.pathname === '/ping') {
    return sendJson(res, origin || '*', 200, {
      ok: true,
      name: 'local-shorts-player reveal helper',
      version: VERSION,
      port,
      dryRun
    })
  }

  if (req.method === 'POST' && (url.pathname === '/check' || url.pathname === '/reveal')) {
    let body
    try {
      body = await readBody(req)
    } catch (error) {
      return sendJson(res, origin || '*', 400, { ok: false, error: error.message })
    }

    if (typeof body.root !== 'string' || !body.root.trim()) {
      return sendJson(res, origin || '*', 400, { ok: false, error: 'missing-root' })
    }

    const resolved = resolveTarget(body.root, body.rel ?? '')
    if (resolved.error) {
      return sendJson(res, origin || '*', 400, { ok: false, error: resolved.error, tried: resolved.tried })
    }
    if (!resolved.absPath) {
      return sendJson(res, origin || '*', 404, {
        ok: false,
        error: 'not-found',
        message: '按登记的根目录拼出来的路径在磁盘上不存在，请检查登记是否正确。',
        tried: resolved.tried
      })
    }

    if (url.pathname === '/check') {
      return sendJson(res, origin || '*', 200, {
        ok: true,
        found: true,
        absPath: resolved.absPath,
        folderOnly: Boolean(resolved.folderOnly),
        tried: resolved.tried
      })
    }

    try {
      reveal(resolved.absPath)
    } catch (error) {
      return sendJson(res, origin || '*', 500, { ok: false, error: 'reveal-failed', message: error.message })
    }
    log(`${dryRun ? '（dry-run）' : '已打开'} ${resolved.absPath}`)
    return sendJson(res, origin || '*', 200, {
      ok: true,
      revealed: resolved.absPath,
      folderOnly: Boolean(resolved.folderOnly),
      dryRun
    })
  }

  return sendJson(res, origin || '*', 404, { ok: false, error: 'not-found-route', path: url.pathname })
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n端口 ${port} 已被占用。换个端口：--port ${port + 1}\n`)
  } else {
    console.error('\n启动失败：', error.message, '\n')
  }
  process.exit(1)
})

server.listen(port, '127.0.0.1', () => {
  console.log('')
  console.log(`  本地小助手已启动 v${VERSION}`)
  console.log(`  监听        http://127.0.0.1:${port}`)
  console.log(`  模式        ${dryRun ? 'dry-run（只打印，不打开窗口）' : '正常（会打开资源管理器）'}`)
  console.log(`  允许来源    ${allowedOrigins.join('  ')}`)
  console.log(`              以及任意 http://localhost:* / http://127.0.0.1:*`)
  console.log('')
  console.log('  浏览器打开上面的地址可以看到状态页；按 Ctrl+C 退出。')
  console.log('')
})
