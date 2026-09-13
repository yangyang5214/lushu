export type Route =
  | { name: 'list' }
  | { name: 'mine' }
  | { name: 'public' }
  | { name: 'account' }
  | { name: 'admin' }
  /**
   * 路书详情：`/d/{userId}/{bookId}`。userId 是书主的公开短 ID（账号页的「用户 ID」），
   * 老链接 / 匿名书架的书只有 bookId 时 userId 为 null。
   * 旧的无前缀链接 `/{userId}/{bookId}` 也能解析，只是会被规范化成带前缀的形式。
   */
  | { name: 'book'; bookId: string; userId: string | null }

export const ROOT_PATH = '/'
export const MINE_PATH = '/list'
export const PUBLIC_PATH = '/public'
export const ACCOUNT_PATH = '/account'
export const ADMIN_PATH = '/admin'
/** 管理后台左侧 tab；概览是默认页。 */
export type AdminTab = 'overview' | 'users' | 'books'
/** 管理后台当前页：tab + 可选的详情 ID。 */
export type AdminRoute = { tab: AdminTab; id: string | null }
/** 路书详情的前缀：`/d/{userId}/{bookId}`，一眼能看出是路书而不是别的页面。 */
export const BOOK_PATH_PREFIX = '/d'

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * `/` → 首页（含怎么用），`/list` → 我的路书，`/public` → 公开路书，
 * `/account` → 账户，`/d/1a2b3c4d5e/abbe26963b3f90f90b8ea659` → 某人的某本路书，
 * `/d/abbe26963b3f90f90b8ea659` → 同一本（老链接 / 匿名书架没有 userId）。
 * 旧的无前缀链接 `/{userId}/{bookId}`、`/{bookId}` 仍然兼容。
 * 每个导航项都是独立页面，URL 里不再出现 `#`。
 */
export function parsePath(pathname: string): Route {
  const clean = pathname.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!clean) return { name: 'list' }
  const segments = clean.split('/')
  // 带扩展名的路径（favicon.ico 之类）不是页面。
  if (segments.some((seg) => !seg || seg.includes('.'))) return { name: 'list' }
  const first = safeDecode(segments[0])
  // 导航页优先，即使后面误跟了别的段也落在同一页。
  // 旧的 /how 已并入首页，老链接直接落在首页。
  if (first === 'how') return { name: 'list' }
  if (first === 'list') return { name: 'mine' }
  if (first === 'public') return { name: 'public' }
  if (first === 'account') return { name: 'account' }
  if (first === 'admin') return { name: 'admin' }
  // 带前缀的新链接去掉 `/r` 这一段，再按路书解析；没有前缀的老链接原样解析。
  const rest = first === BOOK_PATH_PREFIX.slice(1) ? segments.slice(1) : segments
  // `/d/{userId}/{bookId}`：第一段是书主公开 ID，第二段是路书 ID。
  if (rest.length >= 2) {
    return { name: 'book', bookId: safeDecode(rest[1]), userId: safeDecode(rest[0]) || null }
  }
  // `/d/{bookId}` 或旧链接 `/{bookId}`：只有路书 ID。
  if (rest.length === 1) return { name: 'book', bookId: safeDecode(rest[0]), userId: null }
  // 只写了前缀（`/r`）没有后续段：当作首页。
  return { name: 'list' }
}

export function readRoute(): Route {
  if (typeof window === 'undefined') return { name: 'list' }
  return parsePath(window.location.pathname)
}

/**
 * 路书详情的路径（带 `/d` 前缀）：有书主公开 ID 就是 `/d/{userId}/{bookId}`，
 * 否则退回 `/d/{bookId}`。
 */
export function bookPath(bookId: string, userId?: string | null): string {
  const book = encodeURIComponent(bookId)
  return userId
    ? `${BOOK_PATH_PREFIX}/${encodeURIComponent(userId)}/${book}`
    : `${BOOK_PATH_PREFIX}/${book}`
}

/**
 * 进入路书之前停在哪一页，存在 sessionStorage 里：刷新、前进后退都还在。
 * 返回时用这个，而不是固定回「我的路书」。
 */
const ORIGIN_KEY = 'lushu-book-origin'

function rememberPath(pathname: string): void {
  const name = parsePath(pathname).name
  // 已经在某本路书里，或停在登录页（「新建路书」要先登录，登录后再打开）时，
  // 都沿用原来的那一页，别把来源写成路书 / 账户页。
  if (name === 'book' || name === 'account' || name === 'admin') return
  try {
    sessionStorage.setItem(ORIGIN_KEY, pathname)
  } catch {
    /* 隐私模式：退化成默认返回 */
  }
}

/** 记下「从哪一页点进路书」。新建 / 登录这类跳转前也要先记一次。 */
export function markBookOrigin(): void {
  if (typeof window === 'undefined') return
  rememberPath(window.location.pathname)
}

/** 路书页的返回目标：进入时的那一页；直接粘链接 / 新标签打开时回「我的路书」。 */
export function bookOrigin(fallback: string = MINE_PATH): string {
  try {
    return sessionStorage.getItem(ORIGIN_KEY) || fallback
  } catch {
    return fallback
  }
}

function go(path: string): void {
  if (window.location.pathname !== path) {
    window.history.pushState(null, '', path)
  }
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function navigateBook(id: string, userId?: string | null): void {
  markBookOrigin()
  go(bookPath(id, userId))
}

/** 从路书页返回：回到进入这本路书的那一页。 */
export function navigateBookOrigin(fallback?: string): void {
  go(bookOrigin(fallback))
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

/**
 * 管理后台路径：`/admin`、`/admin/users`、`/admin/users/{id}`、
 * `/admin/books`、`/admin/books/{id}`。
 */
export function adminPath(tab: AdminTab, id?: string | null): string {
  if (tab === 'overview') return ADMIN_PATH
  return id ? `${ADMIN_PATH}/${tab}/${encodeURIComponent(id)}` : `${ADMIN_PATH}/${tab}`
}

/** 从当前地址解析管理后台 tab 与详情 ID；认不出的段一律回概览。 */
export function readAdminRoute(): AdminRoute {
  if (typeof window === 'undefined') return { tab: 'overview', id: null }
  const segments = window.location.pathname.replace(/^\/+/, '').replace(/\/+$/, '').split('/')
  const sub = segments[0] === 'admin' ? segments[1] : ''
  if (sub !== 'users' && sub !== 'books') return { tab: 'overview', id: null }
  return { tab: sub, id: segments[2] ? safeDecode(segments[2]) : null }
}
