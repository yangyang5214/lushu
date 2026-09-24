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

// 子进程是独立进程组（detached），所以要对负的 pid 发信号，
// 否则 wrangler 拉起来的 workerd 会变成孤儿进程继续占着端口。
function killTree(pid, signal) {
  if (WIN) {
    try {
      process.kill(pid, signal)
    } catch {}
    return
  }
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {}
  }
}

const alive = () => children.filter((c) => c.exitCode === null && !c.signalCode)

function shutdown(code = 0) {
  if (closing) {
    // 再按一次 Ctrl-C：立刻强杀，不要再等
    for (const child of alive()) killTree(child.pid, 'SIGKILL')
    // wrangler 会把 workerd 放到别的进程组，按子进程 PID 杀不干净
    try {
      freePort(API_PORT, '本地 Worker', isOurWorker, { kill: true, quiet: true })
      freePort(WEB_PORT, 'Vite', isOurWeb, { kill: true, quiet: true })
    } catch {}
    process.exit(code)
  }
  closing = true
  console.log(dim('\n正在关闭本地开发进程…'))
  for (const child of alive()) killTree(child.pid, 'SIGTERM')

  // 等子进程真的退出再退出自己，否则孤儿进程会占住端口
  let waited = 0
  const timer = setInterval(() => {
    waited += 120
    if (alive().length === 0 || waited >= 2500) {
      clearInterval(timer)
      for (const child of alive()) killTree(child.pid, 'SIGKILL')
      try {
        freePort(API_PORT, '本地 Worker', isOurWorker, { kill: true, quiet: true })
        freePort(WEB_PORT, 'Vite', isOurWeb, { kill: true, quiet: true })
      } catch {}
      setTimeout(() => process.exit(code), 150)
    }
  }, 120)
}

// 兜底：任何退出路径都不留孤儿进程（含终端关闭的 SIGHUP）
process.on('exit', () => {
  for (const child of alive()) killTree(child.pid, 'SIGKILL')
})

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
process.on('SIGHUP', () => shutdown(0))

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

// ── 3.5 端口占用：清掉上次残留，别让用户撞 "Address already in use" ──────────
// npm script 的 PATH 常常不含 /usr/sbin，必须写绝对路径，否则 lsof 静默失败、
// 脚本以为端口空闲，随后 wrangler 再撞上残留 workerd。
const LSOF = existsSync('/usr/sbin/lsof') ? '/usr/sbin/lsof' : 'lsof'
const PS = existsSync('/bin/ps') ? '/bin/ps' : 'ps'

function portListeners(port) {
  const res = spawnSync(LSOF, ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
    encoding: 'utf8',
  })
  if (res.error || res.status !== 0) return []
  return [...new Set((res.stdout ?? '').split('\n').map((s) => s.trim()).filter(Boolean))]
}

function psField(pid, field) {
  const res = spawnSync(PS, ['-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8' })
  return res.status === 0 ? (res.stdout ?? '').trim() : ''
}

function procCwd(pid) {
  const res = spawnSync(LSOF, ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
    encoding: 'utf8',
  })
  if (res.error || res.status !== 0) return ''
  // lsof -Fn：n/path
  const line = (res.stdout ?? '').split('\n').find((l) => l.startsWith('n'))
  return line ? line.slice(1) : ''
}

// 同步 sleep，不 spawn 外部命令（跨平台）
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

function belongsToProject(pid) {
  const cmd = psField(pid, 'command')
  if (cmd.includes(ROOT)) return true
  const cwd = procCwd(pid)
  return cwd === ROOT || cwd.startsWith(`${ROOT}/`)
}

// 本脚本默认独占 API_PORT；凡是 wrangler/workerd 占着就当残留清掉，
// 避免「识别失败 → 静默跳过 → Address already in use」
function isOurWorker(pid) {
  return /wrangler|workerd|miniflare/i.test(psField(pid, 'command'))
}

function isOurWeb(pid) {
  const cmd = psField(pid, 'command')
  if (!/(^|[\s/])vite(\.js|\s|$)/.test(cmd) && !/\/vite\//.test(cmd)) return false
  return belongsToProject(pid)
}

/**
 * 端口清理：如果是本项目上一次 dev 残留的进程就收掉，否则原样返回。
 * 返回 'free' | 'stale' | 'busy'。
 */
function freePort(port, what, isOurs, { kill = true, quiet = false } = {}) {
  const pids = portListeners(port)
  if (pids.length === 0) return 'free'

  const stale = pids.filter(isOurs)
  const onlyOurs = stale.length === pids.length && stale.length > 0
  if (!onlyOurs) return 'busy'
  if (!kill) {
    if (!quiet) {
      warn(`端口 ${port} 被上次残留的${what}占用（PID ${stale.join(', ')}），启动时会先清理。`)
    }
    return 'stale'
  }

  if (!quiet) step(`清理上次残留的${what}（占用 ${port}：PID ${stale.join(', ')}）`)
  const killOwners = (signal) => {
    for (const pid of stale) {
      // 子进程是独立进程组，杀组才能带走 workerd / vite 的子进程
      const pgid = WIN ? pid : psField(pid, 'pgid') || pid
      killTree(Number(pgid), signal)
      // 再补一刀 PID 本身（进程组已散时 pgid 杀不到）
      if (!WIN) killTree(Number(pid), signal)
    }
  }
  killOwners('SIGTERM')
  const deadline = Date.now() + 4000
  while (Date.now() < deadline && portListeners(port).length > 0) sleepSync(150)
  killOwners('SIGKILL')
  sleepSync(200)
  if (portListeners(port).length === 0) {
    if (!quiet) note(`端口 ${port} 已释放`)
    return 'free'
  }
  return 'busy'
}

function describePortHolders(port) {
  console.log(dim('  占用进程：'))
  for (const pid of portListeners(port)) {
    console.log(dim(`  ${pid}  ${psField(pid, 'command').slice(0, 120)}`))
  }
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

const apiPort = freePort(API_PORT, '本地 Worker', isOurWorker, { kill: !CHECK_ONLY })
const webPort = freePort(WEB_PORT, 'Vite', isOurWeb, { kill: !CHECK_ONLY })
const portOk = apiPort !== 'busy'

if (CHECK_ONLY) {
  note('--check：检查完成，未启动任何服务')
  process.exit(portOk ? 0 : 1)
}

if (!portOk) {
  warn(`端口 ${API_PORT} 被其他进程占用，换个端口：pnpm dev:all --api-port ${API_PORT + 2}`)
  describePortHolders(API_PORT)
  process.exit(1)
}

if (webPort === 'busy') {
  warn(`端口 ${WEB_PORT} 被其他进程占用，Vite 会自动换一个端口（下面看实际地址）。`)
  describePortHolders(WEB_PORT)
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
