import type { Book, Visibility } from '../types'
import { getMeta, ownerKey } from './keys'

/** 后端 / Worker 不可达时的统一提示（纯前端 dev 或 wrangler.toml 未配时会看到）。 */
export const BACKEND_UNAVAILABLE =
  '连不上后端：请确认已配置 wrangler.toml 并运行 pnpm pages:dev，或已完成部署'

export type RemoteBook = { id: string; doc: Book; updatedAt: number; owner: string }
export type BookSummary = {
  id: string
  title: string
  startDate: string
  places: number
  visibility: Visibility
  updatedAt: number
  /** 书主的公开短 ID（= 账号页的「用户 ID」），拼路书详情链接用。 */
  owner: string
}

/** 主页「公开路书」卡片：服务端只下发预览需要的字段，不含完整 doc。 */
export type PublicBook = {
  id: string
  title: string
  startDate: string
  places: number
  days: number
  km: number
  from: string
  to: string
  isLoop: boolean
  /** 书主的公开短 ID（= 账号页的「用户 ID」），路书详情链接里的 userId。 */
  owner: string
  points: [number, number][]
  /** `points` 里每天起点的下标；与「我的路书」同一套切天规则，用于按天着色。 */
  dayBreaks: number[]
  updatedAt: number
}

export type SaveResult =
  | { ok: true; updatedAt: number }
  | {
      ok: false
      reason: 'forbidden' | 'conflict' | 'turnstile' | 'capacity' | 'login' | 'error'
      status: number
      remote?: RemoteBook
    }

const TIMEOUT_MS = 12_000

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(path, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

function isJson(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').includes('application/json')
}

/** 服务端返回的 doc / 摘要里的可见性：缺字段（老版本写入）一律当公开。 */
function asVisibility(raw: unknown): Visibility {
  return raw === 'private' ? 'private' : 'public'
}

function normalizeVisibility(doc: Book): Book {
  return { ...doc, visibility: asVisibility(doc.visibility) }
}

export async function fetchBook(id: string): Promise<RemoteBook | null> {
  const res = await request(`/api/books/${encodeURIComponent(id)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`fetch book ${res.status}`)
  if (!isJson(res)) throw new Error('api unavailable')
  const data = (await res.json()) as { doc: Book; updatedAt: number; owner?: string }
  return {
    id,
    owner: data.owner ?? '',
    doc: normalizeVisibility({ ...data.doc, id }),
    updatedAt: data.updatedAt,
  }
}

export async function saveBook(
  book: Book,
  opts: { token: string; base?: number; turnstile?: string },
): Promise<SaveResult> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-edit-token': opts.token,
    'x-owner-key': ownerKey(),
  }
  if (opts.turnstile) headers['x-turnstile-token'] = opts.turnstile

  const res = await request(`/api/books/${encodeURIComponent(book.id)}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ doc: book, baseUpdatedAt: opts.base }),
  })

  // 后端不可达：SPA fallback 会把 /api/* 当页面返回 HTML。
  if (!isJson(res)) return { ok: false, reason: 'error', status: res.status }

  if (res.ok) {
    const data = (await res.json()) as { updatedAt: number }
    return { ok: true, updatedAt: data.updatedAt }
  }

  if (res.status === 401) return { ok: false, reason: 'login', status: 401 }
  if (res.status === 403) return { ok: false, reason: 'forbidden', status: 403 }
  if (res.status === 428) return { ok: false, reason: 'turnstile', status: 428 }
  if (res.status === 503) return { ok: false, reason: 'capacity', status: 503 }

  if (res.status === 409) {
    const data = (await res.json()) as { doc?: Book; updatedAt: number }
    return {
      ok: false,
      reason: 'conflict',
      status: 409,
      remote: data.doc
        ? {
            id: book.id,
            owner: '',
            doc: normalizeVisibility({ ...data.doc, id: book.id }),
            updatedAt: data.updatedAt,
          }
        : undefined,
    }
  }

  return { ok: false, reason: 'error', status: res.status }
}

/** 只改可见性（不动内容）：本机没有整本 doc 的路书走这条。 */
export async function saveVisibility(id: string, visibility: Visibility): Promise<boolean> {
  const meta = getMeta(id)
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-owner-key': ownerKey(),
  }
  if (meta.token) headers['x-edit-token'] = meta.token
  try {
    const res = await request(`/api/books/${encodeURIComponent(id)}/visibility`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ visibility }),
    })
    return res.ok && isJson(res)
  } catch {
    return false
  }
}

export async function deleteRemoteBook(id: string, token: string): Promise<boolean> {
  const res = await request(`/api/books/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'x-edit-token': token, 'x-owner-key': ownerKey() },
  })
  return res.ok || res.status === 404
}

export async function listRemoteBooks(): Promise<BookSummary[]> {
  const key = ownerKey()
  if (!key) return []
  const res = await request('/api/library', { headers: { 'x-owner-key': key } })
  if (!res.ok || !isJson(res)) throw new Error(`library ${res.status}`)
  const data = (await res.json()) as { books?: BookSummary[] }
  return (data.books ?? []).map((b) => ({ ...b, visibility: asVisibility(b.visibility) }))
}

/** 主页默认展示的公开路书（按更新时间倒序）。失败时抛错，由调用方显式报错。 */
export async function listPublicBooks(): Promise<PublicBook[]> {
  const res = await request('/api/books')
  if (!res.ok || !isJson(res)) throw new Error(`public books ${res.status}`)
  const data = (await res.json()) as { books?: PublicBook[] }
  return (data.books ?? []).map((b) => ({ ...b, owner: b.owner ?? '' }))
}
