export type Route =
  | { name: 'list' }
  | { name: 'mine' }
  | { name: 'public' }
  | { name: 'account' }
  /**
   * 路书详情：`/{userId}/{bookId}`。userId 是书主的公开短 ID（账号页的「用户 ID」），
   * 老链接 / 匿名书架的书只有 bookId 时 userId 为 null。
   */
  | { name: 'book'; bookId: string; userId: string | null }

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
 * `/account` → 账户，`/1a2b3c4d5e/abbe26963b3f90f90b8ea659` → 某人的某本路书，
 * `/abbe26963b3f90f90b8ea659` → 同一本（老链接 / 匿名书架没有 userId）。
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
  // `/{userId}/{bookId}`：第一段是书主公开 ID，第二段是路书 ID。
  if (segments.length >= 2) {
    return { name: 'book', bookId: safeDecode(segments[1]), userId: first || null }
  }
  return { name: 'book', bookId: first, userId: null }
}

export function readRoute(): Route {
  if (typeof window === 'undefined') return { name: 'list' }
  return parsePath(window.location.pathname)
}

/** 路书详情的路径：有书主公开 ID 就是 `/{userId}/{bookId}`，否则退回 `/{bookId}`。 */
export function bookPath(bookId: string, userId?: string | null): string {
  const book = encodeURIComponent(bookId)
  return userId ? `/${encodeURIComponent(userId)}/${book}` : `/${book}`
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
  if (name === 'book' || name === 'account') return
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
