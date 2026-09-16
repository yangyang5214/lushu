#!/usr/bin/env node
/**
 * 一条命令起本地全栈开发环境：Vite(HMR) + 本地 Worker + 本地 D1。
 *
 *   pnpm dev:all                                  # 等价于 node scripts/dev.mjs
 *   pnpm dev:all --web-port 5174 --api-port 8790   # 换端口
 *   pnpm dev:all --skip-db-init --skip-build       # 跳过初始化（秒起）
 *   pnpm dev:all --check                           # 只做启动前检查，不起服务
 *
 * 做的事：
 *   1. 没有 wrangler.toml 就从 wrangler.toml.example 复制一份，并提示要填的字段
 *   2. 幂等地跑一遍 schema.sql 到本地 D1（可重复执行）
 *   3. dist/ 不存在时先 build 一次（`wrangler pages dev` 需要它当静态资源目录）
 *   4. 起 `wrangler pages dev dist`（本地 Worker + D1，默认 8788）
 *   5. 等 Worker 起来后起 Vite（默认 5173），/api 由 Vite 代理到 Worker（同源，无需 CORS）
 *   6. Ctrl-C 一次同时收掉两个子进程
 */
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

function argValue(name) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}`) return argv[i + 1]
    if (argv[i].startsWith(`--${name}=`)) return argv[i].slice(name.length + 3)
  }
  return undefined
}
const hasFlag = (name) => argv.includes(`--${name}`)

const API_PORT = Number(argValue('api-port') ?? process.env.LUSHU_API_PORT ?? 8788)
const WEB_PORT = Number(argValue('web-port') ?? process.env.LUSHU_WEB_PORT ?? 5173)
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`
const SKIP_DB_INIT = hasFlag('skip-db-init')
const SKIP_BUILD = hasFlag('skip-build')
const CHECK_ONLY = hasFlag('check')

// ── 输出 ────────────────────────────────────────────────────────────────────
const tty = process.stdout.isTTY
const paint = (code, s) => (tty ? `\u001b[${code}m${s}\u001b[0m` : s)
const dim = (s) => paint('2', s)
const bold = (s) => paint('1', s)
const API_COLOR = '36'
const WEB_COLOR = '32'
const step = (msg) => console.log(`\n${bold('▸')} ${msg}`)
const note = (msg) => console.log(`  ${dim(msg)}`)
const warn = (msg) => console.log(`  ${paint('33', `! ${msg}`)}`)

// ── 命令解析：优先用 node_modules/.bin（不依赖 PATH），没有就退回 PATH ────────
const WIN = process.platform === 'win32'
function binCmd(name) {
  const local = path.join(ROOT, 'node_modules', '.bin', WIN ? `${name}.cmd` : name)
  return existsSync(local) ? { cmd: local, shell: WIN } : { cmd: name, shell: WIN }
}

let closing = false
const children = []

function shutdown(code = 0) {
  if (closing) return
  closing = true
  console.log(dim('\n正在关闭本地开发进程…'))
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode) continue
    try {
      if (WIN) child.kill()
      else process.kill(-child.pid, 'SIGTERM')
    } catch {
      try {
        child.kill('SIGTERM')
      } catch {}
    }
  }
  const force = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode !== null) continue
      try {
        if (WIN) child.kill('SIGKILL')
        else process.kill(-child.pid, 'SIGKILL')
      } catch {}
    }
  }, 3000)
  force.unref()
  setTimeout(() => process.exit(code), 400)
}

process.on('SIGINT', () => (closing ? process.exit(0) : shutdown(0)))
process.on('SIGTERM', () => (closing ? process.exit(0) : shutdown(0)))

function start(label, color, binName, args, env) {
  const { cmd, shell } = binCmd(binName)
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    // 独立进程组，退出时能一次性收掉子进程树
    detached: !WIN,
    shell,
  })
  children.push(child)

  const tag = paint(color, `[${label}]`)
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => {
      console.log(`${tag} ${line}`)
      const hit = /Local:\s+(https?:\/\/\S+)/.exec(line)
      if (hit && label === 'web') {
        console.log(`\n  ${bold('前端已就绪：')} ${paint(WEB_COLOR, hit[1])}\n`)
      }
    })
  }
  child.on('error', (err) => {
    warn(`${label} 启动失败：${err.message}`)
    shutdown(1)
  })
  child.on('exit', (code, signal) => {
    if (closing) return
    warn(`${label} 进程退出（${code ?? signal}），关闭全部进程`)
    shutdown(code ?? 1)
  })
  return child
}

function runSync(binName, args) {
  const { cmd, shell } = binCmd(binName)
  return spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell, env: process.env })
}

// ── 1. wrangler.toml ───────────────────────────────────────────────────────
function ensureWranglerToml() {
  const toml = path.join(ROOT, 'wrangler.toml')
  const example = path.join(ROOT, 'wrangler.toml.example')
  if (!existsSync(toml)) {
    if (existsSync(example)) copyFileSync(example, toml)
    warn('没有 wrangler.toml，已从 wrangler.toml.example 复制一份。')
    note('把 [[d1_databases]].database_id 换成自己的（pnpm wrangler d1 create lushu），')
    note('并在 [vars] 填 AMAP_JS_KEY / AMAP_KEY，否则地图底图和搜索 / 路线不可用。')
    return
  }
  const text = readFileSync(toml, 'utf8')
  const vars = (key) =>
    new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']*)["']`, 'm').exec(text)?.[1]?.trim() ?? ''
  if (/database_id\s*=\s*["']YOUR_DATABASE_ID_HERE["']/.test(text)) {
    warn('wrangler.toml 的 database_id 还是占位值，本地 D1 可能不可用。')
  }
  if (!vars('AMAP_JS_KEY')) warn('wrangler.toml 缺 [vars].AMAP_JS_KEY：地图底图无法渲染。')
  if (!vars('AMAP_KEY') && !existsSync(path.join(ROOT, '.dev.vars'))) {
    warn('没有 AMAP_KEY（[vars] 或 .dev.vars）：搜索 / 驾车路线会 501。')
  }
}

// ── 2. 本地 D1 ─────────────────────────────────────────────────────────────
function ensureD1() {
  if (SKIP_DB_INIT) {
    note('跳过本地 D1 初始化（--skip-db-init）')
    return
  }
  step('初始化本地 D1（schema.sql 幂等，可重复执行）')
  const res = runSync('wrangler', ['d1', 'execute', 'lushu', '--local', '--file=./schema.sql'])
  if (res.status === 0) {
    note('.wrangler/state 下的本地 D1 表结构就绪')
    return
  }
  warn('本地 D1 初始化失败，依赖数据库的接口会报错；可手动重试 pnpm db:init:local')
  const tail = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim().split('\n').slice(-15).join('\n')
  if (tail) console.log(dim(tail))
}

// ── 3. dist（Worker 的静态资源目录） ────────────────────────────────────────
function ensureDist() {
  if (existsSync(path.join(ROOT, 'dist', 'index.html')) || SKIP_BUILD) return
  step('首次运行：构建 dist（wrangler pages dev 的静态资源目录）')
  note('只跑 vite build，不做类型检查；类型检查请用 pnpm build')
  const res = runSync('vite', ['build'])
  if (res.status === 0) return
  warn('构建失败：')
  console.log(dim(`${res.stdout ?? ''}${res.stderr ?? ''}`.trim().split('\n').slice(-25).join('\n')))
  process.exit(1)
}

async function waitForApi(child, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (closing || child.exitCode !== null) return false
    try {
      const res = await fetch(`${API_ORIGIN}/api/config`, { signal: AbortSignal.timeout(1500) })
      if (res.ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

// ── main ───────────────────────────────────────────────────────────────────
console.log(`\n${bold('路书 · 本地开发')}  ${dim(ROOT)}`)

ensureWranglerToml()
ensureD1()
ensureDist()

if (CHECK_ONLY) {
  note('--check：检查完成，未启动任何服务')
  process.exit(0)
}

console.log(`
  ${paint(WEB_COLOR, '前端 (HMR)')}    http://localhost:${WEB_PORT}   ${dim('← 用这个')}
  ${paint(API_COLOR, '本地 Worker')}   ${API_ORIGIN}          ${dim('真实 Functions + 本地 D1')}
  ${dim('接口')}          http://localhost:${WEB_PORT}/api/*  → 代理到 Worker
  ${dim('退出')}          Ctrl-C（两个进程一起关）
`)

step('启动本地 Worker（wrangler pages dev dist）')
const api = start('api', API_COLOR, 'wrangler', [
  'pages',
  'dev',
  'dist',
  '--ip',
  '127.0.0.1',
  '--port',
  String(API_PORT),
])

const ready = await waitForApi(api)

if (closing) {
  // Worker 起不来，shutdown() 已经在退出流程里了
} else {
  if (ready) note(`Worker 就绪：${API_ORIGIN}`)
  else warn('Worker 在 45s 内没就绪，仍然启动 Vite；此时 /api 会 502。')

  step('启动 Vite（HMR，/api 代理到本地 Worker）')
  start('web', WEB_COLOR, 'vite', ['--port', String(WEB_PORT)], { LUSHU_API: API_ORIGIN })
}
