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
//   POST   /api/auth/login    → 登录（邮箱 + 口令）
//   POST   /api/auth/register → 注册（邮箱 + 口令），邮箱已存在则 409
//   POST   /api/auth/logout   → 退出登录
//   GET    /api/geocode?q=  → Nominatim 代理 + Cache API 缓存
//   GET    /api/route?coords= → OSRM 代理 + Cache API 缓存
//
// 暴露面控制（公开仓库 = 端点形状全部公开，所以防线必须在服务端）：
//   1. 不下发 CORS 头：只服务同源 SPA，第三方站点无法用访客浏览器打这个 API。
//   2. 新建必须登录（匿名 401），再走可选 Turnstile 闸门（配了 TURNSTILE_SECRET 才启用）。
//   3. 全局容量上限（stats 计数），即使被刷也刷不满 D1 的 5 GB。
//   4. 文档体积上限，单行最多 MAX_DOC_BYTES。
//   5. 口令 PBKDF2-SHA256 加盐迭代，会话 cookie 只存 token 摘要，泄库换不到登录态。
//   6. 可见性：默认 public；private 的书不进公开列表，直接读也要求 owner 身份。
//   7. 细节：id 必须是 24-hex 形态、token 恒定时间比较、上游代理 host 写死（无 SSRF）。
//   另外建议在 Cloudflare 控制台给 /api/* 加一条免费的速率限制规则（见 README）。

import {
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
  normalizeDisplayName,
  normalizeEmail,
  readUser,
  safeEqual,
  sessionCookie,
  toUser,
  validateEmail,
  validatePassword,
  verifyPassword,
} from '../lib/auth'

type Env = {
  DB: D1Database
  /** 可选。设置后，新建路书必须带有效 Turnstile token。 */
  TURNSTILE_SECRET?: string
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

/** 可见性：默认 public；只有显式的 'private' 才算私密，脏数据一律当公开。 */
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

const GEO_TTL = 60 * 60 * 24 * 7 // 地理编码缓存 7 天
const ROUTE_TTL = 60 * 60 * 6 // 路线几何缓存 6 小时
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
    const data = (await res.json()) as { success?: boolean }
    return data.success === true
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
 * 书架归属：登录后用账号 id，没登录时回退到本机的 X-Owner-Key。
 * 有会话时才读库（1 行读），没登录的匿名请求完全不碰 users/sessions。
 */
async function ownerFrom(ctx: Ctx): Promise<string> {
  const user = await readUser(ctx.request, ctx.env)
  if (user) return user.id
  return ownerHeader(ctx.request)
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

/** 登录：邮箱必须已经注册过；不存在或口令不对都返回 invalid_credentials（不泄露账号是否存在）。 */
async function authLogin(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx
  const body = await readBody<{ email?: unknown; username?: unknown; password?: unknown; ownerKey?: unknown }>(request)
  const email = normalizeEmail(body?.email ?? body?.username)
  const password = String(body?.password ?? '')

  const emailError = validateEmail(email)
  if (emailError) return json({ error: emailError }, 400)
  const pwError = validatePassword(password)
  if (pwError) return json({ error: pwError }, 400)

  const row = await findUserByEmail(env, email)
  if (!row || !(await verifyPassword(password, row.pass_hash))) {
    return json({ error: 'invalid_credentials' }, 401)
  }
  const user = toUser(await ensureHashId(env, row))
  await adoptIfAnonymous(env, body?.ownerKey, user.id)
  const { token, expiresAt } = await createSession(env, user.id)
  return json({ user }, 200, { 'set-cookie': sessionCookie(request, token, expiresAt) })
}

/** 注册：邮箱已被占用返回 409；成功后直接建立会话。 */
async function authRegister(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx
  const body = await readBody<{ email?: unknown; username?: unknown; password?: unknown; ownerKey?: unknown }>(request)
  const email = normalizeEmail(body?.email ?? body?.username)
  const password = String(body?.password ?? '')
  const displayName = normalizeDisplayName(undefined, email)

  const emailError = validateEmail(email)
  if (emailError) return json({ error: emailError }, 400)
  const pwError = validatePassword(password)
  if (pwError) return json({ error: pwError }, 400)

  if (env.TURNSTILE_SECRET) {
    const tsToken = request.headers.get('x-turnstile-token') ?? ''
    if (!tsToken) return json({ error: 'turnstile_required' }, 428)
    if (!(await verifyTurnstile(env, request, tsToken))) {
      return json({ error: 'turnstile_failed' }, 403)
    }
  }

  if (await findUserByEmail(env, email)) {
    return json({ error: 'email_taken' }, 409)
  }

  let user
  try {
    user = await createUser(env, { email, displayName, password })
  } catch {
    // 并发抢注：别人先建了同名账号。
    return json({ error: 'email_taken' }, 409)
  }
  await adoptIfAnonymous(env, body?.ownerKey, user.id)
  const { token, expiresAt } = await createSession(env, user.id)
  return json({ user }, 201, { 'set-cookie': sessionCookie(request, token, expiresAt) })
}

async function authLogout(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx
  await destroySession(request, env)
  return json({ ok: true }, 200, { 'set-cookie': clearedCookie(request) })
}

// ── books ───────────────────────────────────────────────────────────────────

async function getBook(ctx: Ctx, id: string): Promise<Response> {
  const row = await ctx.env.DB.prepare(
    `SELECT b.doc AS doc, b.owner_key AS owner_key, b.updated_at AS updated_at,
            u.username AS owner_email, u.hash_id AS owner_hash_id
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
    doc: { ...(parseDoc(row.doc) ?? {}), visibility },
    updatedAt: row.updated_at,
  })
}

async function putBook(ctx: Ctx, id: string): Promise<Response> {
  const { request, env } = ctx
  const token = request.headers.get('x-edit-token') ?? ''
  const user = await readUser(request, env)
  const owner = user ? user.id : ownerHeader(request)
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
  // 老版本前端不带 visibility：**不能**当成"改回公开"。新建按公开，
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
    // 再过 Turnstile（若启用），然后占容量名额。
    if (env.TURNSTILE_SECRET) {
      const tsToken = request.headers.get('x-turnstile-token') ?? ''
      if (!tsToken) return json({ error: 'turnstile_required' }, 428)
      if (!(await verifyTurnstile(env, request, tsToken))) {
        return json({ error: 'turnstile_failed' }, 403)
      }
    }
    if (!(await reserveSlot(env))) return json({ error: 'capacity' }, 503)

    const doc = JSON.stringify({ ...rawDoc, visibility: askedVisibility ?? 'public' })
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

  const doc = JSON.stringify({
    ...rawDoc,
    visibility: askedVisibility ?? visibilityOf(existing.doc),
  })
  if (doc.length > maxBytes) return json({ error: 'too_large' }, 413)

  await env.DB.prepare(
    'UPDATE books SET doc = ?, owner_key = COALESCE(?, owner_key), updated_at = ? WHERE id = ?',
  )
    .bind(doc, owner || null, now, id)
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
  const owner = user ? user.id : ownerHeader(ctx.request)
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

function haversineKm(a: PublicPlace, b: PublicPlace): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 环线判定阈值（米）：与前端 geo.isSamePlace 完全一致，否则环线会一边算一边不算。 */
const LOOP_METERS = 280

function samePlace(a: PublicPlace, b: PublicPlace): boolean {
  return a.id === b.id || haversineKm(a, b) * 1000 <= LOOP_METERS
}

function toPublicBook(
  id: string,
  docText: string,
  updatedAt: number,
  owner: string,
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
  const isLoop = Boolean(start && end && samePlace(start, end))
  const orderedIds = (Array.isArray(doc.orderedIds) ? doc.orderedIds : []).filter(
    (x): x is string => typeof x === 'string',
  )
  // 未定起点终点时展示录入顺序（与前端 buildJourney 一致），定了才按最优顺序。
  const ordered = (ready ? orderedIds : places.map((p) => p.id))
    .map((pid) => byId.get(pid))
    .filter((p): p is PublicPlace => Boolean(p))
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

  let km = 0
  for (let i = 1; i < route.length; i += 1) km += haversineKm(route[i - 1], route[i])

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
            u.username AS owner_email, u.hash_id AS owner_hash_id
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
    }>()

  const books: PublicBook[] = []
  for (const row of res.results ?? []) {
    const owner = await ownerHashId(row.owner_email, row.owner_hash_id)
    const book = toPublicBook(row.id, row.doc, row.updated_at, owner)
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

function routeProxy(ctx: Ctx): Promise<Response> {
  const coords = (new URL(ctx.request.url).searchParams.get('coords') ?? '').trim()
  if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?(;-?\d+(\.\d+)?,-?\d+(\.\d+)?)*$/.test(coords)) {
    return Promise.resolve(json({ error: 'bad_coords' }, 400))
  }
  if (coords.split(';').length > 100) return Promise.resolve(json({ error: 'too_many_points' }, 400))
  const target =
    `https://router.project-osrm.org/route/v1/driving/${coords}` +
    '?overview=full&geometries=geojson&continue_straight=false'
  return cachedProxy(ctx, target, ROUTE_TTL, {
    Accept: 'application/json',
    'User-Agent': 'LushuRoutePlanner/1.0 (+https://github.com/yangyang5214/lushu)',
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

  if (seg[0] === 'auth' && seg.length === 2) {
    if (seg[1] === 'me' && method === 'GET') return authMe(ctx)
    if (seg[1] === 'login' && method === 'POST') return authLogin(ctx)
    if (seg[1] === 'register' && method === 'POST') return authRegister(ctx)
    if (seg[1] === 'logout' && method === 'POST') return authLogout(ctx)
    return json({ error: 'not_found' }, 404)
  }

  if (seg[0] === 'geocode' && method === 'GET') return geocode(ctx)
  if (seg[0] === 'route' && method === 'GET') return routeProxy(ctx)

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
