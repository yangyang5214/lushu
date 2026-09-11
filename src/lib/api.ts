import type { Book } from '../types'
import { ownerKey } from './keys'

export type RemoteBook = { id: string; doc: Book; updatedAt: number }
export type BookSummary = {
  id: string
  title: string
  startDate: string
  places: number
  updatedAt: number
}

export type SaveResult =
  | { ok: true; updatedAt: number }
  | {
      ok: false
      /** unavailable = 后端没部署（纯静态托管），不是错误 */
      reason: 'forbidden' | 'conflict' | 'turnstile' | 'capacity' | 'unavailable' | 'error'
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

export async function fetchBook(id: string): Promise<RemoteBook | null> {
  const res = await request(`/api/books/${encodeURIComponent(id)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`fetch book ${res.status}`)
  if (!isJson(res)) throw new Error('api unavailable')
  const data = (await res.json()) as { doc: Book; updatedAt: number }
  return { id, doc: { ...data.doc, id }, updatedAt: data.updatedAt }
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

  // 纯静态托管时，SPA fallback 会把 /api/* 当页面返回 HTML。
  if (!isJson(res)) return { ok: false, reason: 'unavailable', status: res.status }

  if (res.ok) {
    const data = (await res.json()) as { updatedAt: number }
    return { ok: true, updatedAt: data.updatedAt }
  }

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
        ? { id: book.id, doc: { ...data.doc, id: book.id }, updatedAt: data.updatedAt }
        : undefined,
    }
  }

  return { ok: false, reason: 'error', status: res.status }
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
  if (!res.ok || !isJson(res)) return []
  const data = (await res.json()) as { books?: BookSummary[] }
  return data.books ?? []
}
