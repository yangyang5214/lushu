export type Route = { bookId: string | null }

export const ROOT_PATH = '/'

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** `/abbe26963b3f90f90b8ea659` → book, `/` → list. */
export function parsePath(pathname: string): Route {
  const clean = pathname.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!clean) return { bookId: null }
  const segment = clean.split('/')[0]
  if (!segment || segment.includes('.')) return { bookId: null }
  return { bookId: safeDecode(segment) }
}

export function readRoute(): Route {
  if (typeof window === 'undefined') return { bookId: null }
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
