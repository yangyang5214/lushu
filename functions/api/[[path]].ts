/// <reference types="@cloudflare/workers-types" />
//
// 路书 API · Cloudflare Pages Function（底层就是 Worker）
//
// 路由：
//   GET    /api/books/:id   → 读一本（公开书人人可读；私密书仅 owner 可读，其余 404）
//   GET    /api/books       → 公开路书列表（只含 visibility='public'，按更新时间倒序）
//   PUT    /api/books/:id   → 写一本（X-Edit-Token + 会话/X-Owner-Key 授权）
//                             新建（该 id 还不存在）必须带有效会话，匿名只能读
//   PUT    /api/books/:id/visibility → 只改可见性（不动内容，owner 或编辑口令均可）
//   DELETE /api/books/:id   → 删一本（同上）
//   GET    /api/library     → 我的书架（会话优先，没会话回退 X-Owner-Key）
//   GET    /api/auth/me       → 当前登录用户
//   PUT    /api/auth/me       → 改昵称（需登录；最多 5 字，允许重复）
//   POST   /api/auth/login    → 登录（邮箱 + 口令）
//   POST   /api/auth/register → 注册（邮箱 + 口令），发激活邮件；无论邮箱是否已注册
//                                都回 200 友好的 pending（不泄露邮箱是否已存在）
//   GET    /api/auth/activate → 点击邮件链接激活账号并登录
//   POST   /api/auth/resend-activation → 重发激活邮件（限流 + 可选 Turnstile）
//   POST   /api/auth/logout   → 退出登录
//   GET    /api/admin/me        → 管理员会话探测（需 ADMIN_SECRET + 登录）
//   POST   /api/admin/login     → 管理员登录（ADMIN_SECRET 口令）
//   POST   /api/admin/logout    → 退出管理后台
//   GET    /api/admin/stats     → 概览统计
//   GET    /api/admin/users     → 用户列表（分页 / 搜索）
//   GET    /api/admin/users/:id → 用户详情 + 路书
//   GET    /api/admin/books     → 路书列表（分页 / 搜索 / 可见性筛选）
//   GET    /api/admin/books/:id → 路书详情（含完整 doc）
//   GET    /api/config     → 公开前端配置（高德 JS API key / 安全密钥）
//   GET    /api/stats      → 公开统计（首页上的用户数）
//   GET    /api/places?q=   → 高德 POI 检索（搜索添加目的地）+ Cache API 缓存
//   GET    /api/poi?lng=&lat=&z= → 点击地图某点的高德地点卡片（逆地理 + 周边检索）+ 缓存
//   GET    /api/route?coords= → 单段驾车路线：高德驾车规划 + Cache API 缓存
//   POST   /api/route         → 多段批量（body.segments），缓存命中并行、回源统一限 3 次/秒
//
// 暴露面控制（公开仓库 = 端点形状全部公开，所以防线必须在服务端）：
//   1. 不下发 CORS 头：只服务同源 SPA，第三方站点无法用访客浏览器打这个 API。
//   2. 新建必须登录（匿名 401），再走可选 Turnstile 闸门（配了 TURNSTILE_SECRET 才启用）。
//   3. 全局容量上限（stats 计数），即使被刷也刷不满 D1 的 5 GB。
//   4. 文档体积上限，单行最多 MAX_DOC_BYTES。
//   5. 口令 PBKDF2-SHA256 加盐迭代，会话 cookie 只存 token 摘要，泄库换不到登录态。
//   6. 可见性：新建默认 private；缺字段的老书仍当 public；private 不进公开列表。
//   7. 细节：id 必须是 24-hex 形态、token 恒定时间比较、上游代理 host 写死（无 SSRF）。
//   8. 账号 id（users.id）不是 bearer 凭证：没会话时它不参与鉴权，只有匿名书架密钥
//      （从未注册为账号的 32-hex）能当回退凭证，账号 id 泄露也换不到数据。
//   9. 书归属只落到无主书或当前 owner：仅凭编辑口令不足以把别人的书过户走。
//  10. 认证入口（登录 / 注册 / 重发激活 / 管理登录）有 D1 固定窗口限流（rate_limits）。
//  11. 待激活账号不会被再次注册覆盖口令，避免「先注册 → 冒名重注册 → 点激活」接管。
//   另外建议在 Cloudflare 控制台给 /api/* 加一条免费的速率限制规则（见 README）。

import {
  type AuthUser,
  activateUser,
  adoptBooks,
  clearedCookie,
  createSession,
  createUser,
  destroySession,
  emailHashId,
  ensureHashId,
  findUserByEmail,
  findUserById,
  ID_RE as OWNER_ID_RE,
  isUserActivated,
  normalizeDisplayName,
  normalizeEmail,
  readUser,
  safeEqual,
  sessionCookie,
  toUser,
  updateDisplayName,
  validateEmail,
  validateLoginPassword,
  validatePassword,
  verifyPassword,
} from '../lib/auth'
import {
  normalizeChosenDisplayName,
  validateDisplayName,
} from '../../shared/display-name'
import {
  canSendActivation,
  generateActivationToken,
  normalizeActivationToken,
  storeActivationToken,
  validateActivationTokenFormat,
  verifyAndConsumeActivation,
} from '../lib/email-activation'
import { sendAccountExistsEmail, sendActivationEmail } from '../lib/mail'
import {
  adminConfigured,
  adminLogin,
  adminLogoutCookie,
  isAdmin,
} from '../lib/admin'
import {
  adminGetBook,
  adminGetUser,
  adminListBooks,
  adminListUsers,
  adminStats,
} from '../lib/admin-data'
import { gcj02ToWgs84, wgs84ToGcj02 } from '../../shared/coords'
import { haversineKm, isSamePlace, orderRoute, type LoopDir } from '../../shared/geo'
import type { PoiCard } from '../../shared/poi'
import type { PublicConfig } from '../../shared/public-config'
import type { PublicStats } from '../../shared/public-stats'
import { clientIp, rateLimited } from '../lib/rate-limit'

type Env = {
  DB: D1Database
  /** 管理后台口令，部署时用 wrangler pages secret put ADMIN_SECRET。 */
  ADMIN_SECRET?: string
  /** 可选。设置后，注册发码与新建路书必须带有效 Turnstile token。 */
  TURNSTILE_SECRET?: string
  /** Resend API 密钥，部署时用 wrangler pages secret put RESEND_API_KEY。 */
  RESEND_API_KEY?: string
  /** 发件人，例如 "路书 <noreply@yourdomain.com>" */
  EMAIL_FROM?: string
  /**
   * 高德 Web 服务 key。可配多个（用 `;` 分隔），会轮换分摊配额并互相兜底；
   * `/api/places`、`/api/route` 都依赖它，一个都没配时返回 5xx。
   */
  AMAP_KEY?: string
  /** 高德「Web端(JS API)」key，经 GET /api/config 下发给前端画地图。 */
  AMAP_JS_KEY?: string
  /** 可选：JS API 2.0 安全密钥，与 AMAP_JS_KEY 一起下发。 */
  AMAP_SECURITY_CODE?: string
  /** 可选，默认 20000。0 表示不限。 */
  MAX_BOOKS?: string
  /** 可选，默认 262144（256 KB）。 */
  MAX_DOC_BYTES?: string
  /** 可选，登录态有效期（天），默认 30。 */
  SESSION_TTL_DAYS?: string
}

type Ctx = EventContext<Env, string, unknown>

type BookRow = {
  doc: string
  edit_token: string
  owner_key: string | null
  updated_at: number
}

/** 可见性：新建默认 private；缺字段的老书当 public，只有显式 'private' 才算私密。 */
type Visibility = 'public' | 'private'

function asVisibility(raw: unknown): Visibility {
  return raw === 'private' ? 'private' : 'public'
}

/** 解析路书 JSON；不是对象 / 解析失败 → null（区别于"空对象"）。 */
function parseDoc(docText: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(docText) as unknown
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    /* 脏数据当没有 */
  }
  return null
}

/** 从路书 JSON 里读可见性（可见性只存在 doc 里，没有单独的列）。 */
function visibilityOf(docText: string): Visibility {
  return asVisibility(parseDoc(docText)?.visibility)
}

/** 书名去重键：忽略大小写与首尾空白；空名不参与去重。 */
function titleDedupeKey(title: unknown): string | null {
  if (typeof title !== 'string') return null
  const key = title.trim().toLowerCase()
  return key || null
}

/** 同一 owner 下是否已有同名路书（excludeId 用于更新时排除自身）。 */
async function hasDuplicateTitle(
  env: Env,
  ownerKey: string,
  title: unknown,
  excludeId?: string,
): Promise<boolean> {
  const key = titleDedupeKey(title)
  if (!key) return false
  const row = await env.DB.prepare(
    `SELECT id FROM books
      WHERE owner_key = ?
        AND LOWER(TRIM(json_extract(doc, '$.title'))) = ?
        AND (? IS NULL OR id != ?)
      LIMIT 1`,
  )
    .bind(ownerKey, key, excludeId ?? null, excludeId ?? null)
    .first<{ id: string }>()
  return Boolean(row)
}

const GEO_TTL = 60 * 60 * 24 * 3 // 地理编码缓存 3 天
const ROUTE_TTL = 60 * 60 * 24 * 3 // 路线几何缓存 3 天（路网不常变，拉长命中）
const DEFAULT_MAX_DOC_BYTES = 262_144 // 256 KB（300 个地点约 33 KB）
const DEFAULT_MAX_BOOKS = 20_000
const BOOK_ID_RE = /^[0-9a-f]{24}$/

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

function num(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  })
}

/** 下发前端画地图用的公开 key。Git 构建读不到 gitignore 的 wrangler.toml，靠这个补上。 */
function publicConfig(env: Env): Response {
  const body: PublicConfig = {
    amapJsKey: env.AMAP_JS_KEY?.trim() ?? '',
    amapSecurityCode: env.AMAP_SECURITY_CODE?.trim() ?? '',
  }
  return json(body, 200, { 'cache-control': 'no-store' })
}

/**
 * 公开统计：首页「已有 N 位旅行者」用。只回数字，不下发任何账号信息。
 * 直接数 users 全表（含待激活账号）。读库结果交给边缘缓存，首页刷量不会
 * 变成 D1 读量。
 */
async function publicStats(env: Env): Promise<Response> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>()
  const body: PublicStats = { users: row?.n ?? 0 }
  return json(body, 200, { 'cache-control': 'public, max-age=300, s-maxage=600' })
}

async function readBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}

// ── Turnstile（可选）────────────────────────────────────────────────────────

/** Turnstile widget 固定用的 action；服务端校验它，防止 token 被跨用途重放。 */
const TURNSTILE_ACTION = 'lushu'

async function verifyTurnstile(env: Env, request: Request, token: string): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET
  if (!secret) return true
  const form = new FormData()
  form.append('secret', secret)
  form.append('response', token)
  const ip = request.headers.get('cf-connecting-ip')
  if (ip) form.append('remoteip', ip)
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    })
    if (!res.ok) return false
    const data = (await res.json()) as { success?: boolean; hostname?: string; action?: string }
    if (data.success !== true) return false
    // 校验 token 是在本站点、且是本用途下解出的，防止别处拿到的 token 被重放。
    // 本地 pages:dev 用 Turnstile 测试 key 时会回固定 hostname，故对 localhost 放宽。
    const host = new URL(request.url).hostname
    const isLocal = host === 'localhost' || host === '127.0.0.1'
    if (!isLocal && data.hostname && data.hostname !== host) return false
    if (data.action && data.action !== TURNSTILE_ACTION) return false
    return true
  } catch {
    return false
  }
}

// ── 容量上限 ────────────────────────────────────────────────────────────────

/** 建库前占一个名额；超限时回滚并返回 false。计数漂移无所谓，只是软上限。 */
async function reserveSlot(env: Env): Promise<boolean> {
  const max = num(env.MAX_BOOKS, DEFAULT_MAX_BOOKS)
  if (max <= 0) return true
  const row = await env.DB.prepare(
    "INSERT INTO stats (k, n) VALUES ('books', 1) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n",
  ).first<{ n: number }>()
  if ((row?.n ?? 1) > max) {
    await env.DB.prepare("UPDATE stats SET n = n - 1 WHERE k = 'books'").run()
    return false
  }
  return true
}

async function releaseSlot(env: Env): Promise<void> {
  await env.DB.prepare("UPDATE stats SET n = MAX(n - 1, 0) WHERE k = 'books'").run()
}

// ── 身份（书架的 owner）──────────────────────────────────────────────────────

/** 校验一个 32-hex 的账号 / 书架密钥，非法返回空串。 */
function normalizeOwnerKey(raw: unknown): string {
  const key = String(raw ?? '').trim().toLowerCase()
  return OWNER_ID_RE.test(key) ? key : ''
}

/** 本机的旧书架密钥（32-hex），没账号时的回退凭证。 */
function ownerHeader(request: Request): string {
  return normalizeOwnerKey(request.headers.get('x-owner-key'))
}

/**
 * 解析请求归属：登录态优先；未登录时只接受「匿名书架密钥」。
 * 账号 id 也是 32-hex，但它不是可以当 bearer 用的凭证——如果这个 key 已经是一个
 * 账号，就必须带会话，否则一律拒绝（即使账号 id 泄漏也换不到登录态 / 数据）。
 */
async function resolveOwner(env: Env, request: Request, user: AuthUser | null): Promise<string> {
  if (user) return user.id
  const key = ownerHeader(request)
  if (!key) return ''
  if (await findUserById(env, key)) return ''
  return key
}

/**
 * 书架归属：登录后用账号 id，没登录时回退到本机的 X-Owner-Key。
 * 有会话时才读库（1 行读），没登录的匿名请求只在带了 header 时多查一次 users。
 */
async function ownerFrom(ctx: Ctx): Promise<string> {
  const user = await readUser(ctx.request, ctx.env)
  return resolveOwner(ctx.env, ctx.request, user)
}

/**
 * 书主的公开短 ID（= 账号页展示的「用户 ID」），由邮箱派生，用作路书链接里的 userId。
 * 老账号 hash_id 还没回填时按邮箱现算，不必为此多写一次库；匿名书架的 owner_key
 * 不是账号，没有公开 ID，返回空串。
 */
async function ownerHashId(
  email: string | null | undefined,
  stored: string | null | undefined,
): Promise<string> {
  if (stored) return stored
  if (!email) return ''
  return emailHashId(email)
}

// ── auth ────────────────────────────────────────────────────────────────────

/** 把本机旧密钥名下的路书过户到账号，登录/注册成功后调用。 */
function adoptOwnBooks(env: Env, from: string, to: string): Promise<number> {
  return adoptBooks(env, from, to)
}

/**
 * 登录/注册时把本机匿名书（以 X-Owner-Key 为 owner）过户到账号。
 * 若这个 key 已经是一个账号 id，就不动（共享设备上避免把别人的书搬进来）。
 */
async function adoptIfAnonymous(env: Env, raw: unknown, to: string): Promise<number> {
  const from = normalizeOwnerKey(raw)
  if (!from || from === to) return 0
  const known = await findUserById(env, from)
  if (known) return 0
  return adoptOwnBooks(env, from, to)
}

async function authMe(ctx: Ctx): Promise<Response> {
  const user = await readUser(ctx.request, ctx.env)
  return json({ user })
}

/** 改昵称：必须登录；2–20 个 Unicode 字符，仅限中英文、数字和 _ - .，允许重复。 */
async function authUpdateMe(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx
  const user = await readUser(request, env)
  if (!user) return json({ error: 'unauthorized' }, 401)

  if (await rateLimited(env, `profile:user:${user.id}`, 30, 600_000)) {
    return json({ error: 'rate_limited' }, 429)
  }

  const body = await readBody<{ displayName?: unknown }>(request)
  const displayName = normalizeChosenDisplayName(body?.displayName)
  const nameError = validateDisplayName(displayName)
  if (nameError) return json({ error: nameError }, 400)

  await updateDisplayName(env, user.id, displayName)
  return json({ user: { ...user, displayName } })
}

/** 登录：邮箱必须已经注册过；不存在或口令不对都返回 invalid_credentials（不泄露账号是否存在）。 */
async function authLogin(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx
  const body = await readBody<{ email?: unknown; username?: unknown; password?: unknown; ownerKey?: unknown }>(request)
  const email = normalizeEmail(body?.email ?? body?.username)
  const password = String(body?.password ?? '')

  const emailError = validateEmail(email)
  if (emailError) return json({ error: emailError }, 400)
  const pwError = validateLoginPassword(password)
  if (pwError) return json({ error: pwError }, 400)

  // 口令爆破防线：按 IP 与邮箱双维度限流。
  if (await rateLimited(env, `login:ip:${clientIp(request)}`, 50, 600_000)) {
    return json({ error: 'rate_limited' }, 429)
  }
  if (await rateLimited(env, `login:email:${email}`, 10, 600_000)) {
    return json({ error: 'rate_limited' }, 429)
  }

  const row = await findUserByEmail(env, email)
  if (!row || !(await verifyPassword(password, row.pass_hash))) {
    return json({ error: 'invalid_credentials' }, 401)
  }
  if (!isUserActivated(row)) {
    return json({ error: 'email_not_activated' }, 403)
  }
  const user = toUser(await ensureHashId(env, row))
  await adoptIfAnonymous(env, body?.ownerKey, user.id)
  const { token, expiresAt } = await createSession(env, user.id)
  return json({ user }, 200, { 'set-cookie': sessionCookie(request, token, expiresAt) })
}

function activationUrl(request: Request, token: string): string {
  const origin = new URL(request.url).origin
  return `${origin}/api/auth/activate?token=${encodeURIComponent(token)}`
}

async function requireTurnstile(ctx: Ctx): Promise<Response | null> {
  const { request, env } = ctx
  if (!env.TURNSTILE_SECRET) return null
  const tsToken = request.headers.get('x-turnstile-token') ?? ''
  if (!tsToken) return json({ error: 'turnstile_required' }, 428)
  if (!(await verifyTurnstile(env, request, tsToken))) {
    return json({ error: 'turnstile_failed' }, 403)
  }
  return null
}

/** 向邮箱发送激活链接；限流 + 可选 Turnstile 防刷信。 */
async function sendActivationForEmail(
  ctx: Ctx,
  email: string,
): Promise<Response | { token: string }> {
  const { request, env } = ctx
  const gate = await canSendActivation(env, email)
  if (gate === 'cooldown') return json({ error: 'activation_cooldown' }, 429)
  if (gate === 'rate_limit') return json({ error: 'activation_rate_limit' }, 429)

  const token = generateActivationToken()
  await storeActivationToken(env, email, token)

  const sent = await sendActivationEmail(env, email, activationUrl(request, token))
  if (sent === 'failed') return json({ error: 'email_failed' }, 503)

  return { token }
}

/** 注册：创建待激活账号并发送激活邮件；已激活邮箱返回 409。 */
async function authRegister(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx
  const body = await readBody<{
    email?: unknown
    username?: unknown
    password?: unknown
    ownerKey?: unknown
  }>(request)
  const email = normalizeEmail(body?.email ?? body?.username)
  const password = String(body?.password ?? '')
  const displayName = normalizeDisplayName(undefined, email)

  const emailError = validateEmail(email)
  if (emailError) return json({ error: emailError }, 400)
  const pwError = validatePassword(password)
  if (pwError) return json({ error: pwError }, 400)

  const tsErr = await requireTurnstile(ctx)
  if (tsErr) return tsErr

  if (await rateLimited(env, `register:ip:${clientIp(request)}`, 60, 3_600_000)) {
    return json({ error: 'rate_limited' }, 429)
  }

  const existing = await findUserByEmail(env, email)
  if (existing && isUserActivated(existing)) {
    // 不告诉调用方邮箱是否已注册：只给邮箱主人发一封提醒，对外统一回 pending。
    // 已激活账号的口令绝不因为这次「注册」而被改动。
    if (!(await rateLimited(env, `notice:email:${email}`, 3, 3_600_000))) {
      await sendAccountExistsEmail(env, email)
    }
    return json({ ok: true, pending: true }, 201)
  }

  if (existing) {
    // 待激活账号：只重发激活信，绝不覆盖口令。否则第二个「注册」者可以设好
    // 自己的口令，等邮箱主人在自己邮箱里点下激活链接后，账号就归他了。
    const sent = await sendActivationForEmail(ctx, email)
    if (sent instanceof Response) return sent
    return json({ ok: true, pending: true }, 201)
  }

  let user: AuthUser
  try {
    user = await createUser(env, { email, displayName, password })
  } catch {
    // 并发注册撞唯一约束：和「已存在」同款响应，不泄露内部状态。
    return json({ ok: true, pending: true }, 201)
  }
  await adoptIfAnonymous(env, body?.ownerKey, user.id)

  const sent = await sendActivationForEmail(ctx, email)
  if (sent instanceof Response) return sent

  return json({ ok: true, pending: true }, 201)
}

/** 点击邮件链接：激活账号并建立会话，重定向到账户页。 */
async function authActivate(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx
  const url = new URL(request.url)
  const token = normalizeActivationToken(url.searchParams.get('token'))

  const accountUrl = `${url.origin}/account`
  if (!validateActivationTokenFormat(token)) {
    return Response.redirect(`${accountUrl}?activate=invalid`, 302)
  }

  const verified = await verifyAndConsumeActivation(env, token)
  if (verified.result !== 'ok') {
    const reason = verified.result === 'expired' ? 'expired' : 'invalid'
    return Response.redirect(`${accountUrl}?activate=${reason}`, 302)
  }

  const row = await activateUser(env, verified.email)
  if (!row || !isUserActivated(row)) {
    return Response.redirect(`${accountUrl}?activate=invalid`, 302)
  }

  const user = toUser(await ensureHashId(env, row))
  const { token: sessionToken, expiresAt } = await createSession(env, user.id)
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${accountUrl}?activated=1`,
      'set-cookie': sessionCookie(request, sessionToken, expiresAt),
    },
  })
}

/** 重发激活邮件（账号存在且尚未激活）。 */
async function authResendActivation(ctx: Ctx): Promise<Response> {
  const { env } = ctx
  const body = await readBody<{ email?: unknown; username?: unknown }>(ctx.request)
  const email = normalizeEmail(body?.email ?? body?.username)

  const emailError = validateEmail(email)
  if (emailError) return json({ error: emailError }, 400)

  const tsErr = await requireTurnstile(ctx)
  if (tsErr) return tsErr

  if (await rateLimited(env, `resend:ip:${clientIp(ctx.request)}`, 30, 3_600_000)) {
    return json({ error: 'rate_limited' }, 429)
  }

  const row = await findUserByEmail(env, email)
  if (!row || isUserActivated(row)) {
    // 不泄露邮箱是否已注册 / 已激活。
    return json({ ok: true })
  }

  const sent = await sendActivationForEmail(ctx, email)
  if (sent instanceof Response) return sent

  return json({ ok: true })
}

async function authLogout(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx
  await destroySession(request, env)
  return json({ ok: true }, 200, { 'set-cookie': clearedCookie(request) })
}

// ── admin ───────────────────────────────────────────────────────────────────

async function requireAdmin(ctx: Ctx): Promise<Response | null> {
  if (!adminConfigured(ctx.env)) return json({ error: 'not_found' }, 404)
  if (!(await isAdmin(ctx.request, ctx.env))) return json({ error: 'unauthorized' }, 401)
  return null
}

async function adminMe(ctx: Ctx): Promise<Response> {
  if (!adminConfigured(ctx.env)) return json({ error: 'not_found' }, 404)
  const ok = await isAdmin(ctx.request, ctx.env)
  return json({ ok })
}

async function adminAuthLogin(ctx: Ctx): Promise<Response> {
  if (!adminConfigured(ctx.env)) return json({ error: 'not_found' }, 404)
  if (await rateLimited(ctx.env, `admin:ip:${clientIp(ctx.request)}`, 10, 600_000)) {
    return json({ error: 'rate_limited' }, 429)
  }
  const body = await readBody<{ token?: unknown }>(ctx.request)
  const result = await adminLogin(ctx.request, ctx.env, String(body?.token ?? ''))
  if (!result.ok) return json({ error: 'invalid_credentials' }, 401)
  return json({ ok: true }, 200, { 'set-cookie': result.cookie })
}

async function adminAuthLogout(ctx: Ctx): Promise<Response> {
  if (!adminConfigured(ctx.env)) return json({ error: 'not_found' }, 404)
  return json({ ok: true }, 200, { 'set-cookie': adminLogoutCookie(ctx.request) })
}

async function adminStatsHandler(ctx: Ctx): Promise<Response> {
  const gate = await requireAdmin(ctx)
  if (gate) return gate
  return json(await adminStats(ctx.env))
}

async function adminUsersHandler(ctx: Ctx): Promise<Response> {
  const gate = await requireAdmin(ctx)
  if (gate) return gate
  return json(await adminListUsers(ctx.env, ctx.request))
}

async function adminUserDetail(ctx: Ctx, userId: string): Promise<Response> {
  const gate = await requireAdmin(ctx)
  if (gate) return gate
  if (!OWNER_ID_RE.test(userId)) return json({ error: 'bad_id' }, 400)
  const data = await adminGetUser(ctx.env, userId)
  if (!data) return json({ error: 'not_found' }, 404)
  return json(data)
}

async function adminBooksHandler(ctx: Ctx): Promise<Response> {
  const gate = await requireAdmin(ctx)
  if (gate) return gate
  return json(await adminListBooks(ctx.env, ctx.request))
}

async function adminBookDetail(ctx: Ctx, bookId: string): Promise<Response> {
  const gate = await requireAdmin(ctx)
  if (gate) return gate
  if (!BOOK_ID_RE.test(bookId)) return json({ error: 'bad_id' }, 400)
  const data = await adminGetBook(ctx.env, bookId)
  if (!data) return json({ error: 'not_found' }, 404)
  return json(data)
}

// ── books ───────────────────────────────────────────────────────────────────

async function getBook(ctx: Ctx, id: string): Promise<Response> {
  const row = await ctx.env.DB.prepare(
    `SELECT b.doc AS doc, b.owner_key AS owner_key, b.updated_at AS updated_at,
            u.username AS owner_email, u.hash_id AS owner_hash_id,
            u.display_name AS owner_name
       FROM books b LEFT JOIN users u ON u.id = b.owner_key
      WHERE b.id = ?`,
  )
    .bind(id)
    .first<{
      doc: string
      owner_key: string | null
      updated_at: number
      owner_email: string | null
      owner_hash_id: string | null
      owner_name: string | null
    }>()
  if (!row) return json({ error: 'not_found' }, 404)

  // 私密书只给 owner 看；对其他人一律当作不存在，不泄露它存在。
  const visibility = visibilityOf(row.doc)
  if (visibility === 'private') {
    const owner = await ownerFrom(ctx)
    if (!owner || !row.owner_key || !safeEqual(row.owner_key, owner)) {
      return json({ error: 'not_found' }, 404)
    }
  }

  const owner = await ownerHashId(row.owner_email, row.owner_hash_id)
  return json({
    id,
    owner,
    author: (row.owner_name ?? '').trim(),
    doc: { ...(parseDoc(row.doc) ?? {}), visibility },
    updatedAt: row.updated_at,
  })
}

async function putBook(ctx: Ctx, id: string): Promise<Response> {
  const { request, env } = ctx
  const token = request.headers.get('x-edit-token') ?? ''
  const user = await readUser(request, env)
  const owner = await resolveOwner(env, request, user)
  if (token.length < 16) return json({ error: 'token_required' }, 400)

  const body = await readBody<{ doc?: unknown; baseUpdatedAt?: number }>(request)
  if (
    !body ||
    typeof body.doc !== 'object' ||
    body.doc === null ||
    Array.isArray(body.doc)
  ) {
    return json({ error: 'bad_body' }, 400)
  }
  const rawDoc = body.doc as Record<string, unknown>
  // 老版本前端不带 visibility：**不能**当成"改回公开/私密"。新建按私密，
  // 更新沿用库里当前值，否则一次旧客户端的保存就能把私密书发出去。
  const asked = rawDoc.visibility
  const askedVisibility: Visibility | null =
    asked === 'public' || asked === 'private' ? asked : null
  const maxBytes = num(env.MAX_DOC_BYTES, DEFAULT_MAX_DOC_BYTES)
  if (JSON.stringify(rawDoc).length > maxBytes) return json({ error: 'too_large' }, 413)

  const existing = await env.DB.prepare(
    'SELECT doc, edit_token, owner_key, updated_at FROM books WHERE id = ?',
  )
    .bind(id)
    .first<BookRow>()

  const now = Date.now()

  if (!existing) {
    // 新建必须登录：匿名只能通过分享链接读，不能凭空造书。
    if (!user) return json({ error: 'login_required' }, 401)
    if (owner && (await hasDuplicateTitle(env, owner, rawDoc.title))) {
      return json({ error: 'duplicate_title' }, 409)
    }
    // 再过 Turnstile（若启用），然后占容量名额。
    if (env.TURNSTILE_SECRET) {
      const tsToken = request.headers.get('x-turnstile-token') ?? ''
      if (!tsToken) return json({ error: 'turnstile_required' }, 428)
      if (!(await verifyTurnstile(env, request, tsToken))) {
        return json({ error: 'turnstile_failed' }, 403)
      }
    }
    if (!(await reserveSlot(env))) return json({ error: 'capacity' }, 503)

    const doc = JSON.stringify({ ...rawDoc, visibility: askedVisibility ?? 'private' })
    if (doc.length > maxBytes) return json({ error: 'too_large' }, 413)

    await env.DB.prepare(
      'INSERT INTO books (id, doc, edit_token, owner_key, created_at, updated_at) VALUES (?,?,?,?,?,?)',
    )
      .bind(id, doc, token, owner || null, now, now)
      .run()
    return json({ id, updatedAt: now })
  }

  const authorized =
    safeEqual(existing.edit_token, token) ||
    (!!owner && !!existing.owner_key && safeEqual(existing.owner_key, owner))
  if (!authorized) return json({ error: 'forbidden' }, 403)

  const base = body.baseUpdatedAt
  if (typeof base === 'number' && existing.updated_at > base) {
    return json(
      { error: 'conflict', updatedAt: existing.updated_at, doc: parseDoc(existing.doc) },
      409,
    )
  }

  // 归属只写到「本来无主」或「请求方就是当前 owner」的书上：仅凭编辑口令
  // （例如口令外泄）不足以把别人的书过户到自己名下。
  const nextOwner =
    owner && (!existing.owner_key || safeEqual(existing.owner_key, owner))
      ? owner
      : existing.owner_key
  if (nextOwner && (await hasDuplicateTitle(env, nextOwner, rawDoc.title, id))) {
    return json({ error: 'duplicate_title' }, 409)
  }

  const doc = JSON.stringify({
    ...rawDoc,
    visibility: askedVisibility ?? visibilityOf(existing.doc),
  })
  if (doc.length > maxBytes) return json({ error: 'too_large' }, 413)

  await env.DB.prepare(
    'UPDATE books SET doc = ?, owner_key = ?, updated_at = ? WHERE id = ?',
  )
    .bind(doc, nextOwner, now, id)
    .run()
  return json({ id, updatedAt: now })
}

/** 授权：编辑口令（本机创建者）或 owner（账号 / 书架密钥）都算。 */
function isAuthorized(
  row: Pick<BookRow, 'edit_token' | 'owner_key'>,
  token: string,
  owner: string,
): boolean {
  return (
    safeEqual(row.edit_token, token) ||
    (!!owner && !!row.owner_key && safeEqual(row.owner_key, owner))
  )
}

/**
 * 只改可见性（不动路书内容）。
 * 「我的路书」里本机没有整本 doc 的书（换设备后从云端列出来的那些）走这条路；
 * 本机有 doc 的书走常规编辑推送。两条路最终都是写进同一本书的 doc。
 */
async function putVisibility(ctx: Ctx, id: string): Promise<Response> {
  const { request, env } = ctx
  const body = await readBody<{ visibility?: unknown }>(request)
  if (!body || (body.visibility !== 'public' && body.visibility !== 'private')) {
    return json({ error: 'bad_visibility' }, 400)
  }
  const visibility = asVisibility(body.visibility)
  const token = request.headers.get('x-edit-token') ?? ''
  const owner = await ownerFrom(ctx)
  const row = await env.DB.prepare(
    'SELECT doc, edit_token, owner_key, updated_at FROM books WHERE id = ?',
  )
    .bind(id)
    .first<Pick<BookRow, 'doc' | 'edit_token' | 'owner_key' | 'updated_at'>>()
  if (!row) return json({ error: 'not_found' }, 404)
  if (!isAuthorized(row, token, owner)) return json({ error: 'forbidden' }, 403)

  const now = Date.now()
  const doc = JSON.stringify({ ...(parseDoc(row.doc) ?? {}), visibility })
  if (doc.length > num(env.MAX_DOC_BYTES, DEFAULT_MAX_DOC_BYTES)) {
    return json({ error: 'too_large' }, 413)
  }
  await env.DB.prepare('UPDATE books SET doc = ?, updated_at = ? WHERE id = ?')
    .bind(doc, now, id)
    .run()
  return json({ id, visibility, updatedAt: now })
}

async function deleteBook(ctx: Ctx, id: string): Promise<Response> {
  const { request, env } = ctx
  const token = request.headers.get('x-edit-token') ?? ''
  const owner = await ownerFrom(ctx)
  const row = await env.DB.prepare('SELECT edit_token, owner_key FROM books WHERE id = ?')
    .bind(id)
    .first<Pick<BookRow, 'edit_token' | 'owner_key'>>()
  if (!row) return json({ error: 'not_found' }, 404)
  if (!isAuthorized(row, token, owner)) return json({ error: 'forbidden' }, 403)
  await env.DB.prepare('DELETE FROM books WHERE id = ?').bind(id).run()
  await releaseSlot(env)
  return new Response(null, { status: 204 })
}

// ── library ─────────────────────────────────────────────────────────────────

type Summary = {
  id: string
  title: string
  startDate: string
  places: number
  visibility: Visibility
  updatedAt: number
  /** 书主的公开短 ID（本人），拼路书详情链接用。 */
  owner: string
}

async function library(ctx: Ctx): Promise<Response> {
  const { env } = ctx
  // 会话优先：登录后 owner 是账号 id，同时能拿到本人的公开短 ID。
  const user = await readUser(ctx.request, env)
  const owner = await resolveOwner(env, ctx.request, user)
  if (!owner) return json({ books: [] })
  const ownerId = user?.hashId ?? ''
  const res = await env.DB.prepare(
    'SELECT id, doc, updated_at FROM books WHERE owner_key = ? ORDER BY updated_at DESC LIMIT 200',
  )
    .bind(owner)
    .all<{ id: string; doc: string; updated_at: number }>()

  const books: Summary[] = (res.results ?? []).map((row) => {
    const parsed = (parseDoc(row.doc) ?? {}) as {
      title?: unknown
      startDate?: unknown
      places?: unknown
      visibility?: unknown
    }
    return {
      id: row.id,
      title: typeof parsed.title === 'string' ? parsed.title : '',
      startDate: typeof parsed.startDate === 'string' ? parsed.startDate : '',
      places: Array.isArray(parsed.places) ? parsed.places.length : 0,
      visibility: asVisibility(parsed.visibility),
      updatedAt: row.updated_at,
      owner: ownerId,
    }
  })
  return json({ books })
}

// ── 公开路书（主页默认展示）────────────────────────────────────────────────

/** 从 Book JSON 里只抽预览需要的字段，不给前端下发完整 doc。 */
type PublicPlace = { id: string; name: string; lng: number; lat: number }

type PublicBook = {
  id: string
  title: string
  startDate: string
  places: number
  days: number
  km: number
  from: string
  to: string
  isLoop: boolean
  /** 书主的公开短 ID（= 账号页的「用户 ID」），拼路书详情链接用。 */
  owner: string
  /** 书主昵称；匿名书架为空串。 */
  author: string
  /** 有序坐标 [lng, lat]（环线已把起点补回终点），抽样到 ≤ 60 个点，供卡片画缩略线路。 */
  points: [number, number][]
  /** points 里每天起点的下标；与「我的路书」用同一套切天规则，卡片据此按天着色。 */
  dayBreaks: number[]
  updatedAt: number
}

/** 缩略图最多画这么多点（够看清形状，又不至于把公开列表撑大）。 */
const MAX_PREVIEW_POINTS = 60

function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4
}

function asPlace(raw: unknown): PublicPlace | null {
  if (typeof raw !== 'object' || raw === null) return null
  const p = raw as Record<string, unknown>
  if (typeof p.id !== 'string') return null
  if (typeof p.lng !== 'number' || typeof p.lat !== 'number') return null
  if (!Number.isFinite(p.lng) || !Number.isFinite(p.lat)) return null
  return { id: p.id, name: typeof p.name === 'string' ? p.name : '', lng: p.lng, lat: p.lat }
}

function toPublicBook(
  id: string,
  docText: string,
  updatedAt: number,
  owner: string,
  author: string,
): PublicBook | null {
  const doc = parseDoc(docText)
  if (!doc) return null

  const places = (Array.isArray(doc.places) ? doc.places : [])
    .map(asPlace)
    .filter((p): p is PublicPlace => Boolean(p))
  const byId = new Map(places.map((p) => [p.id, p]))
  const start = typeof doc.startId === 'string' ? byId.get(doc.startId) : undefined
  const end = typeof doc.endId === 'string' ? byId.get(doc.endId) : undefined
  const ready = Boolean(start && end)
  const isLoop = Boolean(start && end && isSamePlace(start, end))
  // 库里的 orderedIds 可能来自扩展导入（AI 给的地点没有顺序）或旧版本，
  // 所以定好起终点后一律按起点/终点重推，不信任存量值；未定起终点时按录入顺序展示。
  // 环线还要带上用户选的绕行方向，缩略图 / 天数才和编辑页一致。
  const loopDir: LoopDir | undefined =
    doc.loopDir === 'cw' || doc.loopDir === 'ccw' ? doc.loopDir : undefined
  const ordered = start && end ? orderRoute(places, start.id, end.id, { loopDir }) : places
  const splitIds = new Set(
    (Array.isArray(doc.splitIds) ? doc.splitIds : []).filter(
      (x): x is string => typeof x === 'string',
    ),
  )

  // 和前端 buildJourney / splitIntoDays 对齐：环线把起点补回终点，切天只认有序列表里
  // 真实存在的点（且不在第 0 位）。公开列表的公里数用库存驾车里程，不用球面直线。
  const route = isLoop && ordered.length > 1 ? [...ordered, ordered[0]] : ordered
  const cuts: number[] = []
  ordered.forEach((place, i) => {
    if (i > 0 && splitIds.has(place.id)) cuts.push(i)
  })
  cuts.sort((a, b) => a - b)
  const days = ready ? cuts.length + 1 : 0
  const driveKm = typeof doc.driveKm === 'number' ? doc.driveKm : 0
  const km = ready && Number.isFinite(driveKm) && driveKm > 0 ? Math.round(driveKm) : 0

  // 抽样到 ≤ MAX_PREVIEW_POINTS，但每天的起点 / 终点必须保留，缩略图才和编辑页同形。
  const keep = new Set<number>()
  const stride = Math.max(1, Math.ceil(route.length / MAX_PREVIEW_POINTS))
  for (let i = 0; i < route.length; i += stride) keep.add(i)
  if (route.length > 0) keep.add(route.length - 1)
  cuts.forEach((cut) => keep.add(cut))
  const indexes = [...keep].sort((a, b) => a - b)
  const points = indexes
    .filter((i) => i >= 0 && i < route.length)
    .map((i) => [round4(route[i].lng), round4(route[i].lat)] as [number, number])
  const dayBreaks = days > 0 && cuts.length > 0 ? [0, ...cuts.map((c) => indexes.indexOf(c))] : [0]

  return {
    id,
    title: typeof doc.title === 'string' ? doc.title : '',
    startDate: typeof doc.startDate === 'string' ? doc.startDate : '',
    places: places.length,
    days,
    km: ready ? km : 0,
    from: start?.name ?? '',
    to: end?.name ?? '',
    isLoop,
    owner,
    author,
    points,
    dayBreaks,
    updatedAt,
  }
}

async function listPublic(env: Env, request: Request): Promise<Response> {
  // 注意别写成 Number(get('limit'))：没带参数时 get 返回 null，Number(null) === 0，
  // 会被当成合法值算成 limit = 1，公开列表就只剩最新一本。
  const asked = new URL(request.url).searchParams.get('limit')
  const raw = asked === null ? Number.NaN : Number(asked)
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.floor(raw), 1), 100) : 60
  const res = await env.DB.prepare(
    `SELECT b.id AS id, b.doc AS doc, b.updated_at AS updated_at,
            u.username AS owner_email, u.hash_id AS owner_hash_id,
            u.display_name AS owner_name
       FROM books b LEFT JOIN users u ON u.id = b.owner_key
      WHERE COALESCE(json_extract(b.doc, '$.visibility'), 'public') = 'public'
      ORDER BY b.updated_at DESC LIMIT ?`,
  )
    .bind(limit)
    .all<{
      id: string
      doc: string
      updated_at: number
      owner_email: string | null
      owner_hash_id: string | null
      owner_name: string | null
    }>()

  const books: PublicBook[] = []
  for (const row of res.results ?? []) {
    const owner = await ownerHashId(row.owner_email, row.owner_hash_id)
    const author = (row.owner_name ?? '').trim()
    const book = toPublicBook(row.id, row.doc, row.updated_at, owner, author)
    if (book) books.push(book)
  }
  return json({ books })
}

type RoutePoint = { lng: number; lat: number }

/** /api/places 的统一形状，坐标一律 WGS84（和地点、线路的存储约定一致）。 */
type PlaceHit = { name: string; address: string; lng: number; lat: number }

type AmapPoi = {
  name?: string
  location?: string
  address?: string | string[]
  pname?: string
  cityname?: string | string[]
  adname?: string | string[]
}

/** 高德偶尔把空字段回成 `[]`，统一取首个字符串。 */
function amapText(value: string | string[] | undefined): string {
  const text = Array.isArray(value) ? value[0] : value
  return (text ?? '').trim()
}

/** 评分：`0` / `0.0`（高德表示没评分）也当空，前端就不显示星。 */
function amapRating(value: string | string[] | undefined): string {
  const text = amapText(value)
  const score = Number.parseFloat(text)
  return Number.isFinite(score) && score > 0 ? text : ''
}

/** 高德 POI 响应 → /api/places 形状。坐标是 GCJ02，要转回 WGS84。 */
function parseAmapPlaces(data: unknown): PlaceHit[] {
  const payload = data as { status?: string; pois?: AmapPoi[] }
  if (payload?.status !== '1') return []
  const hits: PlaceHit[] = []
  for (const poi of payload.pois ?? []) {
    const [glng, glat] = (poi.location ?? '').split(',').map(Number)
    if (!Number.isFinite(glng) || !Number.isFinite(glat)) continue
    const name = amapText(poi.name) || amapText(poi.address)
    if (!name) continue
    const address = [amapText(poi.pname), amapText(poi.cityname), amapText(poi.adname), amapText(poi.address)]
      .filter((part, i, arr) => part && part !== name && arr.indexOf(part) === i)
      .slice(0, 3)
      .join(' · ')
    const [lng, lat] = gcj02ToWgs84(glng, glat)
    hits.push({ name, address, lng, lat })
  }
  return hits
}

/**
 * AMAP_KEY 支持配多个 key，用 `;` 分隔（如 `key1;key2`）：
 * 多个 key 之间轮换分摊配额，单个 key 失败时自动换下一个。
 */
function amapKeys(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(';')
    .map((key) => key.trim())
    .filter(Boolean)
}

/** 多 key 轮换游标，isolate 内共享。 */
let amapKeyCursor = 0

/** 从游标处错开起点，多个 key 之间大致均摊调用量。 */
function amapKeyOrder(keys: string[]): string[] {
  const start = amapKeyCursor % keys.length
  amapKeyCursor = (amapKeyCursor + 1) % 1_000_003
  return [...keys.slice(start), ...keys.slice(0, start)]
}

/** 高德 v3 响应解包：`status=1` 为成功，其余把 infocode 带回来决定重试/换 key。 */
type AmapResult = { ok: true; value: unknown } | { ok: false; infocode: string }

async function amapFetch(url: string): Promise<AmapResult> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(9000),
    })
    if (!res.ok) return { ok: false, infocode: `http_${res.status}` }
    const data = (await res.json()) as { status?: string; infocode?: string }
    if (data?.status === '1') return { ok: true, value: data }
    return { ok: false, infocode: String(data?.infocode ?? 'unknown') }
  } catch {
    return { ok: false, infocode: 'network' }
  }
}

/**
 * 高德单 key 请求：`status=1` 交给 parse；限流（10004 / 10020 等）按退避重试，
 * 其余错误直接返回 null，交由调用方换下一个 key。
 */
async function amapJson<T>(url: string, parse: (data: unknown) => T): Promise<T | null> {
  for (let attempt = 0; ; attempt += 1) {
    const result = await amapFetch(url)
    if (result.ok) return parse(result.value)
    if (AMAP_RETRYABLE.has(result.infocode) && attempt < AMAP_RETRY_DELAYS.length) {
      await sleep(AMAP_RETRY_DELAYS[attempt])
      continue
    }
    return null
  }
}

/** 多个 key 依次尝试，全失败返回 null（空结果不算失败）。 */
async function amapEachKey<T>(
  keys: string[],
  call: (key: string) => Promise<T | null>,
): Promise<T | null> {
  for (const key of amapKeyOrder(keys)) {
    const value = await call(key)
    if (value !== null) return value
  }
  return null
}

const AMAP_PLACE_URL = 'https://restapi.amap.com/v3/place/text'

/** 单 key POI 检索。 */
function amapPlaceOnce(key: string, q: string): Promise<PlaceHit[] | null> {
  const params = new URLSearchParams({
    key,
    keywords: q,
    offset: '25',
    page: '1',
    extensions: 'base',
  })
  return amapJson(`${AMAP_PLACE_URL}?${params.toString()}`, parseAmapPlaces)
}

/** 高德 POI 检索（v3 place/text）：多个 key 依次尝试，全失败返回 null 交给前端兜底。 */
function amapPlaces(keys: string[], q: string): Promise<PlaceHit[] | null> {
  return amapEachKey(keys, (key) => amapPlaceOnce(key, q))
}

/**
 * /api/places?q= → 搜索添加目的地的上游。
 * 没配 AMAP_KEY 或高德失败时回 5xx，前端只用本地地名库兜底（不再回落到其他地图服务）。
 */
async function places(ctx: Ctx): Promise<Response> {
  const q = (new URL(ctx.request.url).searchParams.get('q') ?? '').trim()
  if (!q) return json({ error: 'missing_q' }, 400)
  if (q.length > 200) return json({ error: 'q_too_long' }, 400)
  const keys = amapKeys(ctx.env.AMAP_KEY)
  if (!keys.length) return json({ error: 'amap_unconfigured' }, 501)

  // 缓存键不带 key，换 key 不用失效；缓存的是已经转好坐标的统一形状。
  const cache = typeof caches !== 'undefined' ? caches.default : undefined
  const cacheKey = new Request(`https://lushu.internal/api/places/v2?q=${encodeURIComponent(q)}`, {
    method: 'GET',
  })
  if (cache) {
    try {
      const hit = await cache.match(cacheKey)
      if (hit) {
        return new Response(hit.body, {
          status: 200,
          headers: {
            ...JSON_HEADERS,
            'x-lushu-cache': 'hit',
            'cache-control': `public, max-age=${GEO_TTL}`,
          },
        })
      }
    } catch {
      /* 缓存不可用就直接回源 */
    }
  }

  const hits = await amapPlaces(keys, q)
  if (!hits) return json({ error: 'upstream' }, 502)

  const body = JSON.stringify(hits)
  if (cache) {
    try {
      ctx.waitUntil(
        cache.put(
          cacheKey,
          new Response(body, {
            headers: { ...JSON_HEADERS, 'cache-control': `public, max-age=${GEO_TTL}` },
          }),
        ),
      )
    } catch {
      /* 写缓存失败不影响响应 */
    }
  }
  return new Response(body, {
    status: 200,
    headers: {
      ...JSON_HEADERS,
      'x-lushu-cache': 'miss',
      'cache-control': `public, max-age=${GEO_TTL}`,
    },
  })
}

const AMAP_AROUND_URL = 'https://restapi.amap.com/v5/place/around'
const AMAP_REGEO_URL = 'https://restapi.amap.com/v3/geocode/regeo'
const AMAP_DETAIL_URL = 'https://restapi.amap.com/v3/place/detail'
const POI_TTL = 60 * 60 * 24 // 地点卡片缓存 1 天：评分 / 图片会变，别缓太久
/** 一次最多给几个「附近地点」（第一个就是卡片主体）。 */
const POI_MAX = 5
/**
 * 卡片主体怎么选：「有名有姓」的大点（车站 / 商场 / 景区 / 楼盘）只有逆地理给得出来，
 * 周边检索里全是街边小店，两边结果合并后按距离排，再由 pickPrimary 挑出排第一的那张。
 *
 * 手指底下多近算「就是它」：点招牌的误差也就几个像素，20 米足够容下。
 */
const POI_AT_M = 20
/**
 * 高德把「某个地方的一部分」也当成 POI：站台 / 候车室 / 检票口 / 出入口 / 售票处，
 * 还有「生活服务场所」这种兜底分类。它们不是能去的地方：手指落在它们身上时，
 * 不该顶掉所在的那个「地方」（点进人民公园，出的该是人民公园而不是海洋磨盘售票处）。
 */
const POI_FACILITY = /场所|出入口|入口|出口|站台|候车|检票|售票|退票|制证|建筑物门|道路名|地名/
/** 视野很近时也留一点余量：大点的参考点（车站正中）可能离点击处几百米。 */
const POI_REACH_MIN_M = 500

/** 一次点击的所有候选点。 */
type PoiHit = {
  cards: PoiCard[]
  /** 点击处「进去的那个地方」（景区 / 车站 / 商场）：逆地理的包含面。 */
  area: PoiCard | null
}

/** v5 place/around 里我们用到的字段（缺字段时高德会整个省略）。 */
type AmapAroundPoi = {
  id?: string
  name?: string
  location?: string
  distance?: string
  type?: string
  address?: string | string[]
  pname?: string
  cityname?: string | string[]
  adname?: string | string[]
  photos?: Array<{ url?: string | string[] }>
  business?: {
    rating?: string | string[]
    cost?: string | string[]
    tel?: string | string[]
    keytag?: string | string[]
    tag?: string | string[]
    opentime_today?: string | string[]
    opentime_week?: string | string[]
  }
}

/** v3 geocode/regeo 里的 POI：只有名字 / 地址 / 分类，没有评分和图片。 */
type AmapRegeoPoi = {
  id?: string
  name?: string
  location?: string
  distance?: string
  type?: string
  address?: string | string[]
  tel?: string | string[]
}

/** v3 place/detail 里的字段：点到 POI 招牌时卡片就是它。 */
type AmapDetailPoi = {
  id?: string
  name?: string
  location?: string
  type?: string
  address?: string | string[]
  pname?: string
  cityname?: string | string[]
  adname?: string | string[]
  tel?: string | string[]
  photos?: Array<{ url?: string | string[] }>
  keytag?: string | string[]
  atag?: string | string[]
  tag?: string | string[]
  biz_ext?: { rating?: string | string[]; cost?: string | string[]; opentime2?: string | string[] } | string
}

/** 标签的可能来源：v5 周边检索放在 business 下，v3 详情放在顶层。 */
type AmapTagFields = {
  type?: string
  keytag?: string | string[]
  atag?: string | string[]
  tag?: string | string[]
  business?: { keytag?: string | string[]; tag?: string | string[] }
}

/**
 * 点击处周围多大范围找一个地点：视野越远，一点能代表的地方越大，半径就放开一些。
 * `z` 是点击时的地图级别，认不出（老前端不带参数）时按「城区级」处理。
 */
function poiRadius(z: number): number {
  if (!Number.isFinite(z)) return 600
  if (z <= 8) return 5000
  if (z <= 11) return 2000
  if (z <= 13) return 800
  if (z <= 15) return 400
  return 200
}

/** 高德分类（`风景名胜;风景名胜;国家级景点`）取最后一级当「类别」。 */
function poiCategory(poi: { type?: string }): string {
  const parts = amapText(poi.type)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

/** 标签：keytag 在前，tag 里的词在后，去重截断；都没有时退回分类。 */
function poiTags(poi: AmapTagFields): string[] {
  // keytag 也可能自带逗号（`餐饮服务,快餐厅,快餐厅`），一并拆开。
  const raw = [
    amapText(poi.business?.keytag) || amapText(poi.keytag),
    amapText(poi.business?.tag) || amapText(poi.tag) || amapText(poi.atag),
  ]
    .join(',')
    .split(/[,，]/)
  const seen = new Set<string>()
  const tags: string[] = []
  for (const item of raw) {
    const tag = item.trim()
    if (!tag || seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }
  if (tags.length === 0) {
    const category = poiCategory(poi)
    if (category) tags.push(category)
  }
  return tags.slice(0, 6)
}

/** 高德图片只认 https，别的（空、相对路径、异常协议）丢掉，避免把脏东西塞进 <img>。 */
function poiPhotos(poi: { photos?: Array<{ url?: string | string[] }> }): string[] {
  const out: string[] = []
  for (const photo of poi.photos ?? []) {
    const url = amapText(photo.url)
    if (!url.startsWith('https://') || out.includes(url)) continue
    out.push(url)
    if (out.length >= 9) break
  }
  return out
}

/** 高德周边 POI → /api/poi 的统一形状；坐标保持 GCJ02（底图直接用）。 */
function parseAmapPoi(poi: AmapAroundPoi): PoiCard | null {
  const id = amapText(poi.id)
  const name = amapText(poi.name)
  if (!id || !name) return null
  const [lng, lat] = amapText(poi.location).split(',').map(Number)
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  const distance = Number(amapText(poi.distance))
  const address = [
    amapText(poi.pname),
    amapText(poi.cityname),
    amapText(poi.adname),
    amapText(poi.address),
  ]
    .filter((part, i, arr) => part && part !== name && arr.indexOf(part) === i)
    .join(' · ')
  return {
    id,
    name,
    address,
    category: poiCategory(poi),
    url: `https://www.amap.com/detail/${encodeURIComponent(id)}`,
    distance: Number.isFinite(distance) ? Math.round(distance) : 0,
    lng,
    lat,
    rating: amapRating(poi.business?.rating),
    cost: amapText(poi.business?.cost),
    tel: amapText(poi.business?.tel),
    tags: poiTags(poi),
    opentimeToday: amapText(poi.business?.opentime_today),
    opentimeWeek: amapText(poi.business?.opentime_week),
    photos: poiPhotos(poi),
  }
}

/** 高德周边检索结果 → 卡片列表（按距离升序，最多 POI_MAX 个）。 */
function parseAmapAround(data: unknown): PoiCard[] {
  const payload = data as { status?: string; pois?: AmapAroundPoi[] }
  if (payload?.status !== '1') return []
  return (payload.pois ?? [])
    .map(parseAmapPoi)
    .filter((poi): poi is PoiCard => poi !== null)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, POI_MAX)
}

/**
 * 高德逆地理（extensions=all）→ 候选点。这里出的才是「这一点属于哪个地方」：
 * 火车站、商场、景区、楼盘这类大点不会出现在周边检索里（搜出来的全是旁边的小店）。
 * `limit` 把 3 公里外的景区之类收掉，保持和周边检索差不多的视野。
 */
function parseAmapRegeo(data: unknown, limit: number): PoiHit {
  const payload = data as {
    regeocode?: {
      addressComponent?: { province?: string; city?: string; district?: string }
      pois?: AmapRegeoPoi[]
      aois?: Array<{ id?: string }>
    }
  }
  const reg = payload?.regeocode
  if (!reg) return { cards: [], area: null }
  const comp = reg.addressComponent ?? {}
  const cards: PoiCard[] = []
  for (const poi of reg.pois ?? []) {
    const id = amapText(poi.id)
    const name = amapText(poi.name)
    const [lng, lat] = amapText(poi.location).split(',').map(Number)
    const distance = Number(amapText(poi.distance))
    if (!id || !name || !Number.isFinite(lng) || !Number.isFinite(lat)) continue
    if (!Number.isFinite(distance) || distance > limit) continue
    const address = [
      amapText(comp.province),
      amapText(comp.city),
      amapText(comp.district),
      amapText(poi.address),
    ]
      .filter((part, i, arr) => part && part !== name && arr.indexOf(part) === i)
      .join(' · ')
    cards.push({
      id,
      name,
      address,
      category: poiCategory(poi),
      url: `https://www.amap.com/detail/${encodeURIComponent(id)}`,
      distance: Math.round(distance),
      lng,
      lat,
      rating: '',
      cost: '',
      tel: amapText(poi.tel),
      tags: poiTags(poi),
      opentimeToday: '',
      opentimeWeek: '',
      photos: [],
    })
  }
  // 包含面（aois 的第一个就是最具体的那个）：点落在哪个「地方」里面。
  // 只认能和同一份响应里的 POI 对上 id 的 —— 对不上的（商圈 / 开发区）没有分类和地址，
  // 而且大到不像一个能加进路书的地方。
  const aoi = (reg.aois ?? [])[0]
  const aoiId = amapText(aoi?.id)
  const area = (aoiId && cards.find((card) => card.id === aoiId)) || null
  return { cards, area }
}

/** 高德 POI 详情 → 补进卡片：只填空的字段，不盖掉周边检索已经给好的那份。 */
function applyAmapDetail(card: PoiCard, detail: AmapDetailPoi): PoiCard {
  const biz = typeof detail.biz_ext === 'object' && detail.biz_ext !== null ? detail.biz_ext : {}
  return {
    ...card,
    rating: card.rating || amapRating(biz.rating),
    cost: card.cost || amapText(biz.cost),
    tel: card.tel || amapText(detail.tel),
    // place/detail 只有一组营业时间，当作「今日」用。
    opentimeToday: card.opentimeToday || amapText(biz.opentime2),
    photos: card.photos.length ? card.photos : poiPhotos(detail),
  }
}

/**
 * 高德 POI 详情（点到 POI 招牌时用）→ 整张卡片。坐标用它自己的点，
 * 「直线距离」还是从用户点的那一处算。
 */
function parseAmapDetail(poi: AmapDetailPoi, lng: number, lat: number): PoiCard | null {
  const id = amapText(poi.id)
  const name = amapText(poi.name)
  const [plng, plat] = amapText(poi.location).split(',').map(Number)
  if (!id || !name || !Number.isFinite(plng) || !Number.isFinite(plat)) return null
  const biz = typeof poi.biz_ext === 'object' && poi.biz_ext !== null ? poi.biz_ext : {}
  const address = [
    amapText(poi.pname),
    amapText(poi.cityname),
    amapText(poi.adname),
    amapText(poi.address),
  ]
    .filter((part, i, arr) => part && part !== name && arr.indexOf(part) === i)
    .join(' · ')
  return {
    id,
    name,
    address,
    category: poiCategory(poi),
    url: `https://www.amap.com/detail/${encodeURIComponent(id)}`,
    distance: Math.round(haversineKm({ lng, lat }, { lng: plng, lat: plat }) * 1000),
    lng: plng,
    lat: plat,
    rating: amapRating(biz.rating),
    cost: amapText(biz.cost),
    tel: amapText(poi.tel),
    tags: poiTags(poi),
    opentimeToday: amapText(biz.opentime2),
    opentimeWeek: '',
    photos: poiPhotos(poi),
  }
}

/** 逆地理的点 + 周边检索的点：按高德 id 去重（周边检索那份有评分 / 图片，用它），按距离升序。 */
function mergePois(regeo: PoiCard[], around: PoiCard[]): PoiCard[] {
  const cards = new Map<string, PoiCard>()
  regeo.forEach((card) => cards.set(card.id, card))
  around.forEach((card) => cards.set(card.id, card))
  return [...cards.values()].sort((a, b) => a.distance - b.distance)
}

/**
 * 卡片主体（排第一的那张）：
 *   1. 点就落在这个「地方」身上（20 米内）→ 就是它。车站 / 商场 / 景区的参考点在正中，
 *      点它的招牌一定落在里面，旁边的「送车点」「售票处」「站台」不该顶掉它；
 *   2. 否则手指底下（20 米内）最近的那个正经点 → 点在店招牌上时出的就是那家店；
 *   3. 都没有 → 这个「地方」（点进公园 / 景区深处）或最近的那个点。
 *
 * 点在 POI 招牌上时走不到这里：JS API 直接给了那个点的 id（见 /api/poi 的 id 参数）。
 */
function pickPrimary(cards: PoiCard[], area: PoiCard | null): number {
  if (!cards.length) return -1
  const indexOf = (card: PoiCard) => cards.findIndex((item) => item.id === card.id)
  const areaIndex = area ? indexOf(area) : -1
  if (areaIndex >= 0 && area && area.distance <= POI_AT_M) return areaIndex
  const near = cards.findIndex(
    (card) => card.distance <= POI_AT_M && !POI_FACILITY.test(card.category),
  )
  if (near >= 0) return near
  return areaIndex >= 0 ? areaIndex : 0
}

/** 逆地理 + 周边检索 → 卡片列表：pickPrimary 挑出的那张排第一，大点再补一次详情。 */
async function rankPois(
  regeo: PoiHit | null,
  around: PoiCard[] | null,
  keys: string[],
): Promise<PoiCard[] | null> {
  if (!regeo && !around) return null
  const cards = mergePois(regeo?.cards ?? [], around ?? [])
  const primary = pickPrimary(cards, regeo?.area ?? null)
  const ordered = primary > 0 ? [cards[primary], ...cards.filter((_, i) => i !== primary)] : cards
  const pois = ordered.slice(0, POI_MAX)
  const top = pois[0]
  // 逆地理挑出来的「大点」没有评分 / 图片 / 营业时间，补一份详情（周边检索里有的不用补）。
  if (top && !(around ?? []).some((card) => card.id === top.id)) {
    const detail = await amapDetail(keys, top.id)
    if (detail) pois[0] = applyAmapDetail(top, detail)
  }
  return pois
}

/**
 * 一次点击拿到哪些地点（最多 POI_MAX 张）；null 表示两个上游都挂了。
 *
 * 点了 POI 招牌时 JS API 会把那个点的 id 一起送来（`hotspotclick`），高德自家地图
 * 就是这么做到「点哪个是哪个」的：直接拿 id 查详情，不靠坐标猜。
 */
async function lookupPois(
  keys: string[],
  lng: number,
  lat: number,
  radius: number,
  poiId: string,
): Promise<PoiCard[] | null> {
  // 两个分支都要周边检索（用来列「附近地点」），先发出去。
  const aroundPromise = amapAround(keys, lng, lat, radius)
  if (poiId) {
    const [detail, around] = await Promise.all([amapDetail(keys, poiId), aroundPromise])
    const card = detail ? parseAmapDetail(detail, lng, lat) : null
    if (card) {
      return [card, ...(around ?? []).filter((item) => item.id !== card.id)].slice(0, POI_MAX)
    }
    // 详情查不到（点到的可能不是 POI，而是路名 / 楼栋）：退回按坐标那一套。
    return rankPois(await amapRegeo(keys, lng, lat, radius), around, keys)
  }
  const [regeo, around] = await Promise.all([amapRegeo(keys, lng, lat, radius), aroundPromise])
  return rankPois(regeo, around, keys)
}

/** 单 key 周边检索。 */
function amapAroundOnce(
  key: string,
  lng: number,
  lat: number,
  radius: number,
): Promise<PoiCard[] | null> {
  const params = new URLSearchParams({
    key,
    // 固定 6 位小数：缓存键的写法差异不会漏到这里。
    location: `${lng.toFixed(6)},${lat.toFixed(6)}`,
    radius: String(radius),
    page_size: '10',
    page: '1',
    sortrule: 'distance',
    show_fields: 'business,photos',
  })
  return amapJson(`${AMAP_AROUND_URL}?${params.toString()}`, parseAmapAround)
}

/** 单 key 逆地理（extensions=all，带周边 POI）。 */
function amapRegeoOnce(
  key: string,
  lng: number,
  lat: number,
  radius: number,
): Promise<PoiHit | null> {
  const reach = Math.max(radius, POI_REACH_MIN_M)
  const params = new URLSearchParams({
    key,
    location: `${lng.toFixed(6)},${lat.toFixed(6)}`,
    // regeo 的 radius 上限是 3000；返回的 pois 不受它严格约束，解析时再收一次。
    radius: String(Math.min(3000, reach)),
    extensions: 'all',
  })
  return amapJson(`${AMAP_REGEO_URL}?${params.toString()}`, (data) => parseAmapRegeo(data, reach))
}

/** 单 key POI 详情。 */
function amapDetailOnce(key: string, id: string): Promise<AmapDetailPoi | null> {
  const params = new URLSearchParams({ key, id, extensions: 'all' })
  return amapJson(`${AMAP_DETAIL_URL}?${params.toString()}`, (data) => {
    const payload = data as { pois?: AmapDetailPoi[] }
    return payload?.pois?.[0] ?? null
  })
}

/** 高德周边检索（v5 place/around）：全失败返回 null 交给前端提示。 */
function amapAround(keys: string[], lng: number, lat: number, radius: number): Promise<PoiCard[] | null> {
  return amapEachKey(keys, (key) => amapAroundOnce(key, lng, lat, radius))
}

/** 高德逆地理：全失败返回 null（还能靠周边检索出卡片）。 */
function amapRegeo(keys: string[], lng: number, lat: number, radius: number): Promise<PoiHit | null> {
  return amapEachKey(keys, (key) => amapRegeoOnce(key, lng, lat, radius))
}

/** 高德 POI 详情：全失败返回 null（卡片少几个字段而已）。 */
function amapDetail(keys: string[], id: string): Promise<AmapDetailPoi | null> {
  return amapEachKey(keys, (key) => amapDetailOnce(key, id))
}

/** 中国大陆大致经纬度范围（含近海）：范围外的点不可能是高德收录的地点。 */
function inChina(lng: number, lat: number): boolean {
  return lng >= 73 && lng <= 136 && lat >= 3 && lat <= 54
}

/**
 * /api/poi?lng=&lat=&z=&id= → 点击地图某点时那一点的高德地点（评分 / 图片 / 电话 /
 * 营业时间）。坐标是 GCJ02（底图坐标系），不是路书里的 WGS84；只读，不落库。
 *
 * `id` 是点在 POI 招牌上时高德 JS API（`hotspotclick`）直接给的 POI id —— 有它就直接
 * 出那个点（高德自家地图就是这么做到「点哪个是哪个」的），其余拿它列「附近地点」。
 * 没有 `id` 时靠坐标推断：逆地理（regeo）才知道「这一点落在哪个大点上」（车站 / 商场 /
 * 景区，周边检索给不出这些），周边检索（place/around）才有评分 / 图片和附近的小店。
 * 两边合并后由 pickPrimary 挑出卡片主体；主体是周边检索里没有的大点时再补一次详情。
 * 没配 AMAP_KEY 或上游都失败时回 5xx，前端在卡片里提示，不影响地图本身。
 */
async function poi(ctx: Ctx): Promise<Response> {
  const params = new URL(ctx.request.url).searchParams
  const lng = Number(params.get('lng'))
  const lat = Number(params.get('lat'))
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || !inChina(lng, lat)) {
    return json({ error: 'bad_location' }, 400)
  }
  // 高德 POI id（`B001C8WIJI` 这种）。只当查询参数用，上游 host 写死，没有拼串风险。
  const poiId = (params.get('id') ?? '').trim()
  if (poiId && !/^[A-Za-z0-9]{4,32}$/.test(poiId)) return json({ error: 'bad_id' }, 400)
  const keys = amapKeys(ctx.env.AMAP_KEY)
  if (!keys.length) return json({ error: 'amap_unconfigured' }, 501)
  const radius = poiRadius(Number(params.get('z')))

  // 缓存键把坐标收到 4 位小数（约 11 米）：在同一点附近反复点会打中同一份，
  // 又不会把两个地点混成一张卡片。半径不进键 —— 同一处视野变化时结果基本一致。
  const cache = typeof caches !== 'undefined' ? caches.default : undefined
  // v3：招牌点哪个是哪个（多了 id） + 卡片主体优先取点击处「进去的那个地方」。
  const cacheKey = new Request(
    `https://lushu.internal/api/poi/v3?lng=${lng.toFixed(4)}&lat=${lat.toFixed(4)}&id=${encodeURIComponent(poiId)}`,
    { method: 'GET' },
  )
  if (cache) {
    try {
      const hit = await cache.match(cacheKey)
      if (hit) {
        return new Response(hit.body, {
          status: 200,
          headers: {
            ...JSON_HEADERS,
            'x-lushu-cache': 'hit',
            'cache-control': `public, max-age=${POI_TTL}`,
          },
        })
      }
    } catch {
      /* 缓存不可用就直接回源 */
    }
  }

  const pois = await lookupPois(keys, lng, lat, radius, poiId)
  if (!pois) return json({ error: 'upstream' }, 502)

  // 空结果也缓存：海上、荒野点一下不该每次都去问高德。
  const body = JSON.stringify({ pois })
  if (cache) {
    try {
      ctx.waitUntil(
        cache.put(
          cacheKey,
          new Response(body, {
            headers: { ...JSON_HEADERS, 'cache-control': `public, max-age=${POI_TTL}` },
          }),
        ),
      )
    } catch {
      /* 写缓存失败不影响响应 */
    }
  }
  return new Response(body, {
    status: 200,
    headers: {
      ...JSON_HEADERS,
      'x-lushu-cache': 'miss',
      'cache-control': `public, max-age=${POI_TTL}`,
    },
  })
}

/** /api/route 的统一返回：线路坐标一律 GCJ02，直接贴合高德底图。 */
type RouteLine = {
  source: 'amap'
  line: [number, number][]
  distanceKm: number
  durationMin: number
}

/** 高德驾车 v3 的 waypoints 上限 16 个，加上起终点每段最多 18 个点。 */
const AMAP_MAX_POINTS = 18
const MAX_ROUTE_SEGMENTS = 24
const COORDS_RE = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?(;-?\d+(\.\d+)?,-?\d+(\.\d+)?)*$/

function parseCoords(coords: string): RoutePoint[] | null {
  const points: RoutePoint[] = []
  for (const pair of coords.split(';')) {
    const [lng, lat] = pair.split(',').map(Number)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
    points.push({ lng, lat })
  }
  return points.length >= 2 ? points : null
}

function parseRouteCoords(coords: string): RoutePoint[] | null {
  const trimmed = coords.trim()
  if (!COORDS_RE.test(trimmed)) return null
  return parseCoords(trimmed)
}

/** 缓存键用 5 位小数（约 1 m），避免浮点写法差异打不中。 */
function normalizeCoords(points: RoutePoint[]): string {
  return points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';')
}

function routeCacheKey(normCoords: string): Request {
  return new Request(`https://lushu.internal/api/route/v2?coords=${encodeURIComponent(normCoords)}`, {
    method: 'GET',
  })
}

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5
}

function perpDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Douglas-Peucker，epsilon 约 0.00025°（赤道 ~28 m），地图缩放级下看不出差别。 */
function simplifyLine(points: [number, number][], eps: number): [number, number][] {
  if (points.length <= 2) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length) {
    const [start, end] = stack.pop()!
    let maxD = 0
    let maxI = start
    const a = points[start]
    const b = points[end]
    for (let i = start + 1; i < end; i += 1) {
      const d = perpDist(points[i], a, b)
      if (d > maxD) {
        maxD = d
        maxI = i
      }
    }
    if (maxD > eps) {
      keep[maxI] = 1
      stack.push([start, maxI], [maxI, end])
    }
  }
  return points.filter((_, i) => keep[i])
}

function compactLine(line: [number, number][]): [number, number][] {
  if (line.length < 2) return line
  const rounded: [number, number][] = []
  for (const [lng, lat] of line) {
    const pt: [number, number] = [round5(lng), round5(lat)]
    const last = rounded[rounded.length - 1]
    if (last && last[0] === pt[0] && last[1] === pt[1]) continue
    rounded.push(pt)
  }
  return simplifyLine(rounded, 0.00025)
}

function finalizeRoute(route: RouteLine): RouteLine {
  return { ...route, line: compactLine(route.line) }
}

/** 高德驾车响应 → 统一线路（polyline 本来就是 GCJ02，原样返回）。 */
function parseAmap(data: unknown): RouteLine | null {
  const payload = data as {
    status?: string
    route?: {
      paths?: Array<{
        distance?: string
        duration?: string
        steps?: Array<{ polyline?: string }>
      }>
    }
  }
  if (payload?.status !== '1') return null
  const path = payload.route?.paths?.[0]
  if (!path) return null
  const line: [number, number][] = []
  for (const step of path.steps ?? []) {
    for (const pair of (step.polyline ?? '').split(';')) {
      if (!pair) continue
      const [lng, lat] = pair.split(',').map(Number)
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
      // 高德相邻 step 会重复首尾点，去掉零长度段
      const last = line[line.length - 1]
      if (last && last[0] === lng && last[1] === lat) continue
      line.push([lng, lat])
    }
  }
  if (line.length < 2) return null
  const distanceKm = Number(path.distance) / 1000
  const durationMin = Math.round(Number(path.duration) / 60)
  return finalizeRoute({
    source: 'amap',
    line,
    distanceKm: Number.isFinite(distanceKm) ? distanceKm : 0,
    durationMin: Number.isFinite(durationMin) ? durationMin : 0,
  })
}

function amapDriveUrl(key: string, points: RoutePoint[]): string {
  const fmt = (p: RoutePoint) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`
  const params = new URLSearchParams({
    key,
    origin: fmt(points[0]),
    destination: fmt(points[points.length - 1]),
    extensions: 'base',
    strategy: '0',
  })
  if (points.length > 2) params.set('waypoints', points.slice(1, -1).map(fmt).join(';'))
  return `https://restapi.amap.com/v3/direction/driving?${params.toString()}`
}

/** 高德限流/频繁类错误：换一息重试一次，别直接放弃。 */
const AMAP_RETRYABLE = new Set(['10004', '10020', '10021'])
const AMAP_RETRY_DELAYS = [400, 900]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 高德驾车接口唯一的一条限流：3 次/秒。所有驾车请求（含失败重试）先在这里排队，
 * 1 秒滑动窗口内最多放行 3 次，避免自己打自己出 10004/10020。
 * 计数在 isolate 内共享；多实例各自限流，不会互相感知。
 */
const AMAP_DRIVE_QPS = 3
const AMAP_DRIVE_WINDOW_MS = 1000
const driveWindow: number[] = []
let driveGate: Promise<void> = Promise.resolve()

/** 串行分配 3 次/秒额度：窗口满了就等最早的请求滑出窗口再放行。 */
async function waitDriveRate(): Promise<void> {
  const next = driveGate.then(async () => {
    for (;;) {
      const now = Date.now()
      while (driveWindow.length && now - driveWindow[0] >= AMAP_DRIVE_WINDOW_MS) {
        driveWindow.shift()
      }
      if (driveWindow.length < AMAP_DRIVE_QPS) {
        driveWindow.push(now)
        return
      }
      await sleep(AMAP_DRIVE_WINDOW_MS - (now - driveWindow[0]) + 5)
    }
  })
  // 链条不能因为某个请求出错而断掉
  driveGate = next.catch(() => undefined)
  await next
}

/** 单 key 单段驾车请求：先过 3 次/秒的闸口，遇限流按退避重试，失败交给下一个 key。 */
async function amapChunkOnce(key: string, points: RoutePoint[]): Promise<RouteLine | null> {
  const url = amapDriveUrl(key, points)
  for (let attempt = 0; ; attempt += 1) {
    await waitDriveRate()
    const result = await amapFetch(url)
    if (result.ok) return parseAmap(result.value)
    if (AMAP_RETRYABLE.has(result.infocode) && attempt < AMAP_RETRY_DELAYS.length) {
      await sleep(AMAP_RETRY_DELAYS[attempt])
      continue
    }
    return null
  }
}

/** 单段驾车请求：多个 key 依次兜底，全失败才放弃。 */
async function amapChunk(keys: string[], points: RoutePoint[]): Promise<RouteLine | null> {
  for (const key of amapKeyOrder(keys)) {
    const part = await amapChunkOnce(key, points)
    if (part) return part
  }
  return null
}

/**
 * 高德驾车规划。点太多就按 18 个一段切开再拼回一条线；
 * 每段都在 key 之间轮换，任一段失败就整体放弃，避免出现半截路线。
 */
async function amapRoute(keys: string[], points: RoutePoint[]): Promise<RouteLine | null> {
  const line: [number, number][] = []
  let distanceKm = 0
  let durationMin = 0
  for (let i = 0; i < points.length; i += AMAP_MAX_POINTS - 1) {
    const chunk = points.slice(i, i + AMAP_MAX_POINTS)
    if (chunk.length < 2) break
    const part = await amapChunk(keys, chunk)
    if (!part) return null
    line.push(...(line.length ? part.line.slice(1) : part.line))
    distanceKm += part.distanceKm
    durationMin += part.durationMin
  }
  return line.length >= 2 ? finalizeRoute({ source: 'amap', line, distanceKm, durationMin }) : null
}

async function matchRouteCache(cache: Cache | undefined, key: Request): Promise<RouteLine | null> {
  if (!cache) return null
  try {
    const hit = await cache.match(key)
    if (!hit) return null
    const data = (await hit.json()) as RouteLine
    return Array.isArray(data?.line) && data.line.length >= 2 ? data : null
  } catch {
    return null
  }
}

function putRouteCache(ctx: Ctx, cache: Cache | undefined, key: Request, route: RouteLine): void {
  if (!cache) return
  try {
    ctx.waitUntil(
      cache.put(
        key,
        new Response(JSON.stringify(route), {
          headers: { ...JSON_HEADERS, 'cache-control': `public, max-age=${ROUTE_TTL}` },
        }),
      ),
    )
  } catch {
    /* 写缓存失败不影响响应 */
  }
}

function routeJson(route: RouteLine, cacheStatus: 'hit' | 'miss'): Response {
  return new Response(JSON.stringify(route), {
    status: 200,
    headers: {
      ...JSON_HEADERS,
      'x-lushu-cache': cacheStatus,
      'cache-control': `public, max-age=${ROUTE_TTL}`,
    },
  })
}

/** 高德要 GCJ02，地点本身是 WGS84：先转再发。没配 key 或高德失败即整体失败。 */
async function computeRoute(ctx: Ctx, points: RoutePoint[]): Promise<RouteLine | null> {
  const keys = amapKeys(ctx.env.AMAP_KEY)
  if (!keys.length) return null
  return amapRoute(
    keys,
    points.map((p) => {
      const [lng, lat] = wgs84ToGcj02(p.lng, p.lat)
      return { lng, lat }
    }),
  )
}

async function resolveRoute(
  ctx: Ctx,
  points: RoutePoint[],
  compute: (pts: RoutePoint[]) => Promise<RouteLine | null>,
): Promise<{ route: RouteLine | null; cacheStatus: 'hit' | 'miss' }> {
  const cache = typeof caches !== 'undefined' ? caches.default : undefined
  const key = routeCacheKey(normalizeCoords(points))
  const hit = await matchRouteCache(cache, key)
  if (hit) return { route: hit, cacheStatus: 'hit' }
  const route = await compute(points)
  if (route) putRouteCache(ctx, cache, key, route)
  return { route, cacheStatus: 'miss' }
}

async function routeProxy(ctx: Ctx): Promise<Response> {
  const coords = (new URL(ctx.request.url).searchParams.get('coords') ?? '').trim()
  const points = parseRouteCoords(coords)
  if (!points) return json({ error: 'bad_coords' }, 400)
  if (points.length > 100) return json({ error: 'too_many_points' }, 400)

  const { route, cacheStatus } = await resolveRoute(ctx, points, (pts) => computeRoute(ctx, pts))
  if (!route) return json({ error: 'upstream' }, 502)
  return routeJson(route, cacheStatus)
}

/**
 * 多天路线一次提交：缓存命中的段立刻返回，未命中的段一起回源；
 * 3 次/秒的节流在 waitDriveRate 里统一排队，浏览器只付一次往返。
 */
async function routeBatch(ctx: Ctx): Promise<Response> {
  const body = await readBody<{ segments?: unknown }>(ctx.request)
  const raw = body?.segments
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ROUTE_SEGMENTS) {
    return json({ error: 'bad_segments' }, 400)
  }

  const parsed: RoutePoint[][] = []
  for (const item of raw) {
    if (typeof item !== 'string') return json({ error: 'bad_segments' }, 400)
    const points = parseRouteCoords(item)
    if (!points) return json({ error: 'bad_coords' }, 400)
    if (points.length > 100) return json({ error: 'too_many_points' }, 400)
    parsed.push(points)
  }

  const memo = new Map<string, Promise<RouteLine | null>>()

  const routes = await Promise.all(
    parsed.map((points) => {
      const norm = normalizeCoords(points)
      let pending = memo.get(norm)
      if (!pending) {
        pending = resolveRoute(ctx, points, (pts) => computeRoute(ctx, pts)).then((r) => r.route)
        memo.set(norm, pending)
      }
      return pending
    }),
  )

  return new Response(JSON.stringify({ routes }), {
    status: 200,
    headers: { ...JSON_HEADERS, 'cache-control': 'no-store' },
  })
}

// ── router ──────────────────────────────────────────────────────────────────

async function handle(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx
  const path = new URL(request.url).pathname.replace(/^\/api\/?/, '')
  const seg = path.split('/').filter(Boolean)
  const method = request.method

  if (seg[0] === 'books' && seg.length === 1 && method === 'GET') {
    return listPublic(env, request)
  }

  if (seg[0] === 'books' && (seg.length === 2 || (seg.length === 3 && seg[2] === 'visibility'))) {
    const id = decodeURIComponent(seg[1])
    if (!BOOK_ID_RE.test(id)) return json({ error: 'bad_id' }, 400)
    if (seg.length === 3) {
      if (method === 'PUT') return putVisibility(ctx, id)
      return json({ error: 'method_not_allowed' }, 405)
    }
    if (method === 'GET') return getBook(ctx, id)
    if (method === 'PUT') return putBook(ctx, id)
    if (method === 'DELETE') return deleteBook(ctx, id)
    return json({ error: 'method_not_allowed' }, 405)
  }

  if (seg[0] === 'library' && seg.length === 1 && method === 'GET') {
    return library(ctx)
  }

  if (seg[0] === 'admin') {
    if (!adminConfigured(env)) return json({ error: 'not_found' }, 404)
    if (seg[1] === 'me' && seg.length === 2 && method === 'GET') return adminMe(ctx)
    if (seg[1] === 'login' && seg.length === 2 && method === 'POST') return adminAuthLogin(ctx)
    if (seg[1] === 'logout' && seg.length === 2 && method === 'POST') return adminAuthLogout(ctx)
    if (seg[1] === 'stats' && seg.length === 2 && method === 'GET') return adminStatsHandler(ctx)
    if (seg[1] === 'users' && seg.length === 2 && method === 'GET') return adminUsersHandler(ctx)
    if (seg[1] === 'users' && seg.length === 3) {
      const userId = decodeURIComponent(seg[2])
      if (method === 'GET') return adminUserDetail(ctx, userId)
    }
    if (seg[1] === 'books' && seg.length === 2 && method === 'GET') return adminBooksHandler(ctx)
    if (seg[1] === 'books' && seg.length === 3) {
      const bookId = decodeURIComponent(seg[2])
      if (method === 'GET') return adminBookDetail(ctx, bookId)
    }
    return json({ error: 'not_found' }, 404)
  }

  if (seg[0] === 'auth') {
    if (seg[1] === 'me' && seg.length === 2 && method === 'GET') return authMe(ctx)
    if (seg[1] === 'me' && seg.length === 2 && method === 'PUT') return authUpdateMe(ctx)
    if (seg[1] === 'login' && seg.length === 2 && method === 'POST') return authLogin(ctx)
    if (seg[1] === 'register' && seg.length === 2 && method === 'POST') return authRegister(ctx)
    if (seg[1] === 'activate' && seg.length === 2 && method === 'GET') return authActivate(ctx)
    if (seg[1] === 'resend-activation' && seg.length === 2 && method === 'POST') {
      return authResendActivation(ctx)
    }
    if (seg[1] === 'logout' && seg.length === 2 && method === 'POST') return authLogout(ctx)
    return json({ error: 'not_found' }, 404)
  }

  if (seg[0] === 'config' && seg.length === 1 && method === 'GET') return publicConfig(env)
  if (seg[0] === 'stats' && seg.length === 1 && method === 'GET') return publicStats(env)
  if (seg[0] === 'places' && method === 'GET') return places(ctx)
  if (seg[0] === 'poi' && seg.length === 1 && method === 'GET') return poi(ctx)
  if (seg[0] === 'route' && method === 'GET') return routeProxy(ctx)
  if (seg[0] === 'route' && method === 'POST') return routeBatch(ctx)

  return json({ error: 'not_found' }, 404)
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  // 同源部署不需要 CORS；跨源请求会被浏览器拦下，这正是我们想要的。
  if (ctx.request.method === 'OPTIONS') return new Response(null, { status: 204 })
  try {
    return await handle(ctx)
  } catch (err) {
    return json(
      { error: 'server_error', message: err instanceof Error ? err.message : String(err) },
      500,
    )
  }
}
