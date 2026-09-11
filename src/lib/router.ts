export type Route =
  | { name: 'list' }
  | { name: 'mine' }
  | { name: 'public' }
  | { name: 'account' }
  | { name: 'book'; bookId: string }

export const ROOT_PATH = '/'
export const MINE_PATH = '/list'
export const PUBLIC_PATH = '/public'
export const ACCOUNT_PATH = '/account'

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * `/` → 首页（含怎么用），`/list` → 我的路书，`/public` → 公开路书，
 * `/account` → 账户，`/abbe26963b3f90f90b8ea659` → 某本路书。
 * 每个导航项都是独立页面，URL 里不再出现 `#`。
 */
export function parsePath(pathname: string): Route {
  const clean = pathname.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!clean) return { name: 'list' }
  const segment = clean.split('/')[0]
  if (!segment || segment.includes('.')) return { name: 'list' }
  const decoded = safeDecode(segment)
  // 旧的 /how 已并入首页，老链接直接落在首页。
  if (decoded === 'how') return { name: 'list' }
  if (decoded === 'list') return { name: 'mine' }
  if (decoded === 'public') return { name: 'public' }
  if (decoded === 'account') return { name: 'account' }
  return { name: 'book', bookId: decoded }
}

export function readRoute(): Route {
  if (typeof window === 'undefined') return { name: 'list' }
  return parsePath(window.location.pathname)
}

export function bookPath(id: string): string {
  return `/${encodeURIComponent(id)}`
}

function go(path: string): void {
  if (window.location.pathname !== path) {
    window.history.pushState(null, '', path)
  }
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function navigateBook(id: string): void {
  go(bookPath(id))
}

export function navigateList(): void {
  go(ROOT_PATH)
}

export function navigateMine(): void {
  go(MINE_PATH)
}

export function navigatePublic(): void {
  go(PUBLIC_PATH)
}

export function navigateAccount(): void {
  go(ACCOUNT_PATH)
}
