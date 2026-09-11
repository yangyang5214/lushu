/// <reference types="@cloudflare/workers-types" />
//
// 路书 API · Cloudflare Pages Function（底层就是 Worker）
//
// 路由：
//   GET    /api/books/:id   → 读一本（公开，URL 里的 24-hex 即只读凭证）
//   PUT    /api/books/:id   → 写一本（X-Edit-Token 或 X-Owner-Key 授权）
//   DELETE /api/books/:id   → 删一本（同上）
//   GET    /api/library     → 我的书架（X-Owner-Key）
//   GET    /api/geocode?q=  → Nominatim 代理 + Cache API 缓存
//   GET    /api/route?coords= → OSRM 代理 + Cache API 缓存
//
// 暴露面控制（公开仓库 = 端点形状全部公开，所以防线必须在服务端）：
//   1. 不下发 CORS 头：只服务同源 SPA，第三方站点无法用访客浏览器打这个 API。
//   2. 新建走可选 Turnstile 闸门（配了 TURNSTILE_SECRET 才启用），挡住脚本批量刷。
//   3. 全局容量上限（stats 计数），即使被刷也刷不满 D1 的 5 GB。
//   4. 文档体积上限，单行最多 MAX_DOC_BYTES。
//   5. 细节：id 必须是 24-hex 形态、token 恒定时间比较、上游代理 host 写死（无 SSRF）。
//   另外建议在 Cloudflare 控制台给 /api/* 加一条免费的速率限制规则（见 README）。

type Env = {
  DB: D1Database
  /** 可选。设置后，新建路书必须带有效 Turnstile token。 */
  TURNSTILE_SECRET?: string
  /** 可选，默认 20000。0 表示不限。 */
  MAX_BOOKS?: string
  /** 可选，默认 262144（256 KB）。 */
  MAX_DOC_BYTES?: string
}

type Ctx = EventContext<Env, string, unknown>

type BookRow = {
  doc: string
  edit_token: string
  owner_key: string | null
  updated_at: number
}

const GEO_TTL = 60 * 60 * 24 * 7 // 地理编码缓存 7 天
const ROUTE_TTL = 60 * 60 * 6 // 路线几何缓存 6 小时
const DEFAULT_MAX_DOC_BYTES = 262_144 // 256 KB（300 个地点约 33 KB）
const DEFAULT_MAX_BOOKS = 20_000
const ID_RE = /^[0-9a-f]{24}$/

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

/** 恒定时间比较，避免 token 校验被计时侧信道猜。 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
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

// ── books ───────────────────────────────────────────────────────────────────

async function getBook(env: Env, id: string): Promise<Response> {
  const row = await env.DB.prepare('SELECT doc, updated_at FROM books WHERE id = ?')
    .bind(id)
    .first<Pick<BookRow, 'doc' | 'updated_at'>>()
  if (!row) return json({ error: 'not_found' }, 404)
  try {
    return json({ id, doc: JSON.parse(row.doc), updatedAt: row.updated_at })
  } catch {
    return json({ error: 'corrupt' }, 500)
  }
}

async function putBook(ctx: Ctx, id: string): Promise<Response> {
  const { request, env } = ctx
  const token = request.headers.get('x-edit-token') ?? ''
  const owner = request.headers.get('x-owner-key') ?? ''
  if (token.length < 16) return json({ error: 'token_required' }, 400)

  const body = await readBody<{ doc?: unknown; baseUpdatedAt?: number }>(request)
  if (!body || typeof body.doc !== 'object' || body.doc === null) {
    return json({ error: 'bad_body' }, 400)
  }
  const doc = JSON.stringify(body.doc)
  if (doc.length > num(env.MAX_DOC_BYTES, DEFAULT_MAX_DOC_BYTES)) {
    return json({ error: 'too_large' }, 413)
  }

  const existing = await env.DB.prepare(
    'SELECT doc, edit_token, owner_key, updated_at FROM books WHERE id = ?',
  )
    .bind(id)
    .first<BookRow>()

  const now = Date.now()

  if (!existing) {
    // 新建：先过 Turnstile（若启用），再占容量名额。
    if (env.TURNSTILE_SECRET) {
      const tsToken = request.headers.get('x-turnstile-token') ?? ''
      if (!tsToken) return json({ error: 'turnstile_required' }, 428)
      if (!(await verifyTurnstile(env, request, tsToken))) {
        return json({ error: 'turnstile_failed' }, 403)
      }
    }
    if (!(await reserveSlot(env))) return json({ error: 'capacity' }, 503)

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
    let remoteDoc: unknown = null
    try {
      remoteDoc = JSON.parse(existing.doc)
    } catch {
      remoteDoc = null
    }
    return json({ error: 'conflict', updatedAt: existing.updated_at, doc: remoteDoc }, 409)
  }

  await env.DB.prepare(
    'UPDATE books SET doc = ?, owner_key = COALESCE(?, owner_key), updated_at = ? WHERE id = ?',
  )
    .bind(doc, owner || null, now, id)
    .run()
  return json({ id, updatedAt: now })
}

async function deleteBook(request: Request, env: Env, id: string): Promise<Response> {
  const token = request.headers.get('x-edit-token') ?? ''
  const owner = request.headers.get('x-owner-key') ?? ''
  const row = await env.DB.prepare('SELECT edit_token, owner_key FROM books WHERE id = ?')
    .bind(id)
    .first<Pick<BookRow, 'edit_token' | 'owner_key'>>()
  if (!row) return json({ error: 'not_found' }, 404)
  const authorized =
    safeEqual(row.edit_token, token) ||
    (!!owner && !!row.owner_key && safeEqual(row.owner_key, owner))
  if (!authorized) return json({ error: 'forbidden' }, 403)
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
  updatedAt: number
}

async function library(request: Request, env: Env): Promise<Response> {
  const owner = request.headers.get('x-owner-key') ?? ''
  if (!owner) return json({ books: [] })
  const res = await env.DB.prepare(
    'SELECT id, doc, updated_at FROM books WHERE owner_key = ? ORDER BY updated_at DESC LIMIT 200',
  )
    .bind(owner)
    .all<{ id: string; doc: string; updated_at: number }>()

  const books: Summary[] = (res.results ?? []).map((row) => {
    let parsed: { title?: unknown; startDate?: unknown; places?: unknown } = {}
    try {
      parsed = JSON.parse(row.doc) as typeof parsed
    } catch {
      parsed = {}
    }
    return {
      id: row.id,
      title: typeof parsed.title === 'string' ? parsed.title : '',
      startDate: typeof parsed.startDate === 'string' ? parsed.startDate : '',
      places: Array.isArray(parsed.places) ? parsed.places.length : 0,
      updatedAt: row.updated_at,
    }
  })
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

  if (seg[0] === 'books' && seg.length === 2) {
    const id = decodeURIComponent(seg[1])
    if (!ID_RE.test(id)) return json({ error: 'bad_id' }, 400)
    if (method === 'GET') return getBook(env, id)
    if (method === 'PUT') return putBook(ctx, id)
    if (method === 'DELETE') return deleteBook(request, env, id)
    return json({ error: 'method_not_allowed' }, 405)
  }

  if (seg[0] === 'library' && seg.length === 1 && method === 'GET') {
    return library(request, env)
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
