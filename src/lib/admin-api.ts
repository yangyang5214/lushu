import { t } from './i18n'

const TIMEOUT_MS = 12_000

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(path, { ...init, signal: ctrl.signal, credentials: 'same-origin' })
  } finally {
    clearTimeout(timer)
  }
}

function isJson(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').includes('application/json')
}

export type AdminStats = {
  users: number
  books: number
  publicBooks: number
  privateBooks: number
}

export type AdminUser = {
  id: string
  hashId: string
  email: string
  displayName: string
  createdAt: number
  activated: boolean
  bookCount: number
}

export type AdminBookSummary = {
  id: string
  title: string
  startDate: string
  places: number
  visibility: 'public' | 'private'
  updatedAt: number
  createdAt: number
  ownerId: string | null
  ownerEmail: string | null
  ownerHashId: string | null
}

export type AdminBookDetail = {
  id: string
  doc: Record<string, unknown>
  updatedAt: number
  createdAt: number
  ownerId: string | null
  ownerEmail: string | null
  ownerHashId: string | null
}

export type AdminProbe = 'loading' | 'guest' | 'admin' | 'disabled' | 'offline'

export async function probeAdmin(): Promise<AdminProbe> {
  try {
    const res = await request('/api/admin/me')
    if (res.status === 404) return 'disabled'
    if (!isJson(res)) return 'offline'
    const data = (await res.json()) as { ok?: boolean }
    return data.ok ? 'admin' : 'guest'
  } catch {
    return 'offline'
  }
}

export async function adminLogin(
  token: string,
): Promise<'ok' | 'invalid' | 'disabled' | 'offline' | 'rate_limited'> {
  try {
    const res = await request('/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (res.status === 404) return 'disabled'
    if (res.status === 401) return 'invalid'
    if (res.status === 429) return 'rate_limited'
    if (!res.ok || !isJson(res)) return 'offline'
    return 'ok'
  } catch {
    return 'offline'
  }
}

export async function adminLogout(): Promise<void> {
  try {
    await request('/api/admin/logout', { method: 'POST' })
  } catch {
    /* 清 cookie 失败也不阻塞 UI */
  }
}

export async function fetchAdminStats(): Promise<AdminStats> {
  const res = await request('/api/admin/stats')
  if (!isJson(res)) throw new Error(t('common.backendUnavailable'))
  if (res.status === 401) throw new Error('unauthorized')
  if (!res.ok) throw new Error(`stats ${res.status}`)
  return (await res.json()) as AdminStats
}

export async function fetchAdminUsers(opts: {
  limit?: number
  offset?: number
  q?: string
}): Promise<{ users: AdminUser[]; total: number }> {
  const params = new URLSearchParams()
  if (opts.limit) params.set('limit', String(opts.limit))
  if (opts.offset) params.set('offset', String(opts.offset))
  if (opts.q?.trim()) params.set('q', opts.q.trim())
  const res = await request(`/api/admin/users?${params}`)
  if (!isJson(res)) throw new Error(t('common.backendUnavailable'))
  if (res.status === 401) throw new Error('unauthorized')
  if (!res.ok) throw new Error(`users ${res.status}`)
  return (await res.json()) as { users: AdminUser[]; total: number }
}

export async function fetchAdminUser(id: string): Promise<{
  user: AdminUser
  books: Array<{
    id: string
    title: string
    startDate: string
    places: number
    visibility: 'public' | 'private'
    updatedAt: number
  }>
}> {
  const res = await request(`/api/admin/users/${encodeURIComponent(id)}`)
  if (!isJson(res)) throw new Error(t('common.backendUnavailable'))
  if (res.status === 401) throw new Error('unauthorized')
  if (res.status === 404) throw new Error('not_found')
  if (!res.ok) throw new Error(`user ${res.status}`)
  return (await res.json()) as {
    user: AdminUser
    books: Array<{
      id: string
      title: string
      startDate: string
      places: number
      visibility: 'public' | 'private'
      updatedAt: number
    }>
  }
}

export async function fetchAdminBooks(opts: {
  limit?: number
  offset?: number
  q?: string
  visibility?: 'all' | 'public' | 'private'
}): Promise<{ books: AdminBookSummary[]; total: number }> {
  const params = new URLSearchParams()
  if (opts.limit) params.set('limit', String(opts.limit))
  if (opts.offset) params.set('offset', String(opts.offset))
  if (opts.q?.trim()) params.set('q', opts.q.trim())
  if (opts.visibility && opts.visibility !== 'all') params.set('visibility', opts.visibility)
  const res = await request(`/api/admin/books?${params}`)
  if (!isJson(res)) throw new Error(t('common.backendUnavailable'))
  if (res.status === 401) throw new Error('unauthorized')
  if (!res.ok) throw new Error(`books ${res.status}`)
  return (await res.json()) as { books: AdminBookSummary[]; total: number }
}

export async function fetchAdminBook(id: string): Promise<AdminBookDetail> {
  const res = await request(`/api/admin/books/${encodeURIComponent(id)}`)
  if (!isJson(res)) throw new Error(t('common.backendUnavailable'))
  if (res.status === 401) throw new Error('unauthorized')
  if (res.status === 404) throw new Error('not_found')
  if (!res.ok) throw new Error(`book ${res.status}`)
  return (await res.json()) as AdminBookDetail
}

/** 删除一本路书（硬删，不可恢复）。 */
export async function deleteAdminBook(id: string): Promise<void> {
  const res = await request(`/api/admin/books/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!isJson(res)) throw new Error(t('common.backendUnavailable'))
  if (res.status === 401) throw new Error('unauthorized')
  if (res.status === 404) throw new Error('not_found')
  if (!res.ok) throw new Error(`delete book ${res.status}`)
}

/** 删除一个账号（连同其路书与会话，硬删不可恢复）。 */
export async function deleteAdminUser(id: string): Promise<{ books: number }> {
  const res = await request(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!isJson(res)) throw new Error(t('common.backendUnavailable'))
  if (res.status === 401) throw new Error('unauthorized')
  if (res.status === 404) throw new Error('not_found')
  if (!res.ok) throw new Error(`delete user ${res.status}`)
  return (await res.json()) as { books: number }
}
