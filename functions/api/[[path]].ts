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
//   DELETE /api/admin/books/:id → 删除路书
//   DELETE /api/admin/users/:id → 删除用户（连同其路书与会话）
//   GET    /api/geocode?q=  → Nominatim 代理 + Cache API 缓存（高德不可用时的兜底）
//   GET    /api/places?q=   → 高德 POI 检索（搜索添加目的地首选）+ Cache API 缓存
//   GET    /api/route?coords= → 单段驾车路线：优先高德，失败回落 OSRM，Cache API 缓存
//   POST   /api/route         → 多段批量（body.segments），缓存命中并行、回源限并发
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
  adminDeleteBook,
  adminDeleteUser,
  adminGetBook,
  adminGetUser,
  adminListBooks,
  adminListUsers,
  adminStats,
} from '../lib/admin-data'
import { gcj02ToWgs84, wgs84ToGcj02 } from '../../shared/coords'
import { isSamePlace, orderRoute, pathDistanceKm } from '../../shared/geo'
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
  /** 可选。高德 Web 服务 key；配了就走高德驾车规划，没配或失败回落 OSRM。 */
  AMAP_KEY?: string
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

const GEO_TTL = 60 * 60 * 24 * 7 // 地理编码缓存 7 天
const ROUTE_TTL = 60 * 60 * 24 * 7 // 路线几何缓存 7 天（路网不常变，拉长命中）
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

/** 改昵称：必须登录；1–5 个字，允许和其他人重复。 */
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

async function adminBookDelete(ctx: Ctx, bookId: string): Promise<Response> {
  const gate = await requireAdmin(ctx)
  if (gate) return gate
  if (!BOOK_ID_RE.test(bookId)) return json({ error: 'bad_id' }, 400)
  const deleted = await adminDeleteBook(ctx.env, bookId)
  if (!deleted) return json({ error: 'not_found' }, 404)
  return json({ ok: true })
}

async function adminUserDelete(ctx: Ctx, userId: string): Promise<Response> {
  const gate = await requireAdmin(ctx)
  if (gate) return gate
  if (!OWNER_ID_RE.test(userId)) return json({ error: 'bad_id' }, 400)
  const result = await adminDeleteUser(ctx.env, userId)
  if (!result) return json({ error: 'not_found' }, 404)
  return json({ ok: true, books: result.books })
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
  const ordered = start && end ? orderRoute(places, start.id, end.id) : places
  const splitIds = new Set(
    (Array.isArray(doc.splitIds) ? doc.splitIds : []).filter(
      (x): x is string => typeof x === 'string',
    ),
  )

  // 和前端 buildJourney / splitIntoDays 对齐：环线把起点补回终点，切天只认有序列表里
  // 真实存在的点（且不在第 0 位）。否则「我的路书」和「公开路书」的总公里 / 天数会对不上。
  const route = isLoop && ordered.length > 1 ? [...ordered, ordered[0]] : ordered
  const cuts: number[] = []
  ordered.forEach((place, i) => {
    if (i > 0 && splitIds.has(place.id)) cuts.push(i)
  })
  cuts.sort((a, b) => a - b)
  const days = ready ? cuts.length + 1 : 0

  const km = pathDistanceKm(route)

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
    km: ready ? Math.round(km) : 0,
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

// ── upstream proxies（带 Cache API，不占 KV 额度）─────────────────────────────

async function cachedProxy(
  ctx: Ctx,
  target: string,
  ttl: number,
  upstreamHeaders: Record<string, string>,
): Promise<Response> {
  const cache = typeof caches !== 'undefined' ? caches.default : undefined
  const cacheKey = new Request(target, { method: 'GET' })

  if (cache) {
    try {
      const hit = await cache.match(cacheKey)
      if (hit) {
        return new Response(hit.body, {
          status: 200,
          headers: {
            ...JSON_HEADERS,
            'x-lushu-cache': 'hit',
            'cache-control': `public, max-age=${ttl}`,
          },
        })
      }
    } catch {
      /* 缓存不可用就直接回源 */
    }
  }

  let upstream: Response
  try {
    upstream = await fetch(target, {
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(9000),
    })
  } catch (err) {
    return json(
      { error: 'upstream_unreachable', message: err instanceof Error ? err.message : String(err) },
      504,
    )
  }
  if (!upstream.ok) return json({ error: 'upstream', status: upstream.status }, 502)

  const text = await upstream.text()
  const payload = new Response(text, {
    status: 200,
    headers: { ...JSON_HEADERS, 'cache-control': `public, max-age=${ttl}` },
  })
  if (cache) {
    try {
      ctx.waitUntil(cache.put(new Request(target, { method: 'GET' }), payload.clone()))
    } catch {
      /* 写缓存失败不影响响应 */
    }
  }
  return new Response(payload.body, {
    status: 200,
    headers: { ...JSON_HEADERS, 'x-lushu-cache': 'miss', 'cache-control': `public, max-age=${ttl}` },
  })
}

function geocode(ctx: Ctx): Promise<Response> {
  const q = (new URL(ctx.request.url).searchParams.get('q') ?? '').trim()
  if (!q) return Promise.resolve(json({ error: 'missing_q' }, 400))
  if (q.length > 200) return Promise.resolve(json({ error: 'q_too_long' }, 400))
  const target =
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}` +
    '&format=json&addressdetails=1&limit=6'
  return cachedProxy(ctx, target, GEO_TTL, {
    'User-Agent': 'LushuRoutePlanner/1.0 (+https://github.com/yangyang5214/lushu)',
    'Accept-Language': 'zh',
    Accept: 'application/json',
  })
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

const AMAP_PLACE_URL = 'https://restapi.amap.com/v3/place/text'

/** 高德 POI 检索（v3 place/text），限流按退避重试；失败返回 null 交给前端兜底。 */
async function amapPlaces(key: string, q: string): Promise<PlaceHit[] | null> {
  const params = new URLSearchParams({
    key,
    keywords: q,
    offset: '10',
    page: '1',
    extensions: 'base',
  })
  const url = `${AMAP_PLACE_URL}?${params.toString()}`
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(9000),
      })
      if (!res.ok) return null
      const data = (await res.json()) as { status?: string; infocode?: string }
      if (data?.status === '1') return parseAmapPlaces(data)
      if (AMAP_RETRYABLE.has(String(data?.infocode)) && attempt < AMAP_RETRY_DELAYS.length) {
        await sleep(AMAP_RETRY_DELAYS[attempt])
        continue
      }
      return null
    } catch {
      return null
    }
  }
}

/**
 * /api/places?q= → 搜索添加目的地的首选上游。
 * 没配 AMAP_KEY 或高德失败时回 5xx，前端自动回落到 /api/geocode + Photon。
 */
async function places(ctx: Ctx): Promise<Response> {
  const q = (new URL(ctx.request.url).searchParams.get('q') ?? '').trim()
  if (!q) return json({ error: 'missing_q' }, 400)
  if (q.length > 200) return json({ error: 'q_too_long' }, 400)
  const key = ctx.env.AMAP_KEY?.trim()
  if (!key) return json({ error: 'amap_unconfigured' }, 501)

  // 缓存键不带 key，换 key 不用失效；缓存的是已经转好坐标的统一形状。
  const cache = typeof caches !== 'undefined' ? caches.default : undefined
  const cacheKey = new Request(`https://lushu.internal/api/places/v1?q=${encodeURIComponent(q)}`, {
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

  const hits = await amapPlaces(key, q)
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

/** /api/route 的统一返回：线路坐标一律 GCJ02，直接贴合高德底图。 */
type RouteLine = {
  source: 'amap' | 'osrm'
  line: [number, number][]
  distanceKm: number
  durationMin: number
}

/** 高德驾车 v3 的 waypoints 上限 16 个，加上起终点每段最多 18 个点。 */
const AMAP_MAX_POINTS = 18
const AMAP_CONCURRENCY = 3
const MAX_ROUTE_SEGMENTS = 24
const ROUTE_UA = 'LushuRoutePlanner/1.0 (+https://github.com/yangyang5214/lushu)'
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

function pool(limit: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let active = 0
  const wait: Array<() => void> = []
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((ok) => wait.push(ok))
    active += 1
    try {
      return await fn()
    } finally {
      active -= 1
      wait.shift()?.()
    }
  }
}

/** OSRM 原始响应 → 统一线路（WGS84 转成 GCJ02）。 */
function parseOsrm(data: unknown): RouteLine | null {
  const first = (
    data as {
      routes?: Array<{
        geometry?: { coordinates?: [number, number][] }
        distance?: number
        duration?: number
      }>
    }
  ).routes?.[0]
  const coords = first?.geometry?.coordinates
  if (!coords?.length) return null
  if (!coords.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))) return null
  const distance = first?.distance
  const duration = first?.duration
  return finalizeRoute({
    source: 'osrm',
    line: coords.map(([lng, lat]) => wgs84ToGcj02(lng, lat)),
    distanceKm: typeof distance === 'number' && Number.isFinite(distance) ? distance / 1000 : 0,
    durationMin: typeof duration === 'number' && Number.isFinite(duration) ? Math.round(duration / 60) : 0,
  })
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

/** 高德限流/频繁类错误：换一息重试一次，别直接交给 OSRM。 */
const AMAP_RETRYABLE = new Set(['10004', '10020', '10021'])
const AMAP_RETRY_DELAYS = [400, 900]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 单段高德驾车请求，遇限流按退避重试。 */
async function amapChunk(key: string, points: RoutePoint[]): Promise<RouteLine | null> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await fetch(amapDriveUrl(key, points), {
        signal: AbortSignal.timeout(9000),
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) return null
      const data = (await res.json()) as { status?: string; infocode?: string }
      if (data?.status === '1') return parseAmap(data)
      if (AMAP_RETRYABLE.has(String(data?.infocode)) && attempt < AMAP_RETRY_DELAYS.length) {
        await sleep(AMAP_RETRY_DELAYS[attempt])
        continue
      }
      return null
    } catch {
      return null
    }
  }
}

/**
 * 高德驾车规划。点太多就按 18 个一段切开再拼回一条线；
 * 任一段失败整体放弃，交给 OSRM 兜底，避免出现半截路线。
 */
async function amapRoute(key: string, points: RoutePoint[]): Promise<RouteLine | null> {
  const line: [number, number][] = []
  let distanceKm = 0
  let durationMin = 0
  for (let i = 0; i < points.length; i += AMAP_MAX_POINTS - 1) {
    const chunk = points.slice(i, i + AMAP_MAX_POINTS)
    if (chunk.length < 2) break
    const part = await amapChunk(key, chunk)
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

/** 高德要 GCJ02，地点本身是 WGS84：先转再发；失败回落 OSRM。 */
async function computeRoute(ctx: Ctx, points: RoutePoint[]): Promise<RouteLine | null> {
  const amapKey = ctx.env.AMAP_KEY?.trim()
  let route = amapKey
    ? await amapRoute(
        amapKey,
        points.map((p) => {
          const [lng, lat] = wgs84ToGcj02(p.lng, p.lat)
          return { lng, lat }
        }),
      )
    : null

  if (!route) {
    const coords = points.map((p) => `${p.lng},${p.lat}`).join(';')
    const target =
      `https://router.project-osrm.org/route/v1/driving/${coords}` +
      '?overview=full&geometries=geojson&continue_straight=false'
    const upstream = await cachedProxy(ctx, target, ROUTE_TTL, {
      Accept: 'application/json',
      'User-Agent': ROUTE_UA,
    })
    if (upstream.ok) route = parseOsrm(await upstream.json())
  }
  return route
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
 * 多天路线一次提交：缓存命中的段立刻返回，未命中的段在 Worker 里限并发回源，
 * 浏览器只付一次往返，不再按天串行 + 间隔。
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

  const gate = pool(AMAP_CONCURRENCY)
  const memo = new Map<string, Promise<RouteLine | null>>()
  const compute = (pts: RoutePoint[]) => gate(() => computeRoute(ctx, pts))

  const routes = await Promise.all(
    parsed.map((points) => {
      const norm = normalizeCoords(points)
      let pending = memo.get(norm)
      if (!pending) {
        pending = resolveRoute(ctx, points, compute).then((r) => r.route)
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
      if (method === 'DELETE') return adminUserDelete(ctx, userId)
    }
    if (seg[1] === 'books' && seg.length === 2 && method === 'GET') return adminBooksHandler(ctx)
    if (seg[1] === 'books' && seg.length === 3) {
      const bookId = decodeURIComponent(seg[2])
      if (method === 'GET') return adminBookDetail(ctx, bookId)
      if (method === 'DELETE') return adminBookDelete(ctx, bookId)
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

  if (seg[0] === 'geocode' && method === 'GET') return geocode(ctx)
  if (seg[0] === 'places' && method === 'GET') return places(ctx)
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
