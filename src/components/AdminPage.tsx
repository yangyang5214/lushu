import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  adminLogin,
  adminLogout,
  fetchAdminBook,
  fetchAdminBooks,
  fetchAdminStats,
  fetchAdminUser,
  fetchAdminUsers,
  probeAdmin,
  type AdminBookDetail,
  type AdminBookSummary,
  type AdminProbe,
  type AdminStats,
  type AdminUser,
} from '../lib/admin-api'
import { useMemo } from 'react'
import { buildJourney } from '../lib/journey'
import { adminT, type AdminMsgKey } from '../lib/i18n'
import { adminPath, bookPath, navigateList, readAdminRoute, type AdminRoute, type AdminTab } from '../lib/router'
import type { Journey, Place } from '../types'
import { BrandMark } from './BrandMark'
import { RouteMap } from './RouteMap'

type Tab = AdminTab

const PAGE_SIZE = 30

const TAB_KEY: Record<Tab, AdminMsgKey> = {
  overview: 'admin.overview',
  users: 'admin.users',
  books: 'admin.books',
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', { hour12: false })
}

function visLabel(v: 'public' | 'private'): string {
  return v === 'private' ? adminT('admin.visPrivate') : adminT('admin.visPublic')
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function asId(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

function asIds(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** 后台详情只有服务端原样的 doc（未经类型校验）：逐字段挑出可用的地点。 */
function placesFromDoc(doc: Record<string, unknown>): Place[] {
  const raw = Array.isArray(doc.places) ? doc.places : []
  const out: Place[] = []
  raw.forEach((item, i) => {
    if (!item || typeof item !== 'object') return
    const p = item as Record<string, unknown>
    const lng = Number(p.lng)
    const lat = Number(p.lat)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
    out.push({
      id: asId(p.id) ?? `place-${i}`,
      name: asString(p.name),
      address: asString(p.address),
      lng,
      lat,
    })
  })
  return out
}

/** 把服务端 doc 还原成与编辑页同构的 Journey，喂给只读地图。 */
function journeyFromDoc(doc: Record<string, unknown>): Journey {
  return buildJourney({
    title: asString(doc.title),
    startDate: asString(doc.startDate),
    places: placesFromDoc(doc),
    startId: asId(doc.startId),
    endId: asId(doc.endId),
    orderedIds: asIds(doc.orderedIds),
    splitIds: asIds(doc.splitIds),
  })
}

/** 复制文本；非安全上下文（http）下 navigator.clipboard 不可用，退回 textarea。 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 继续走兜底方案 */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

/** 复制按钮：成功 / 失败在按钮上原地反馈，2 秒后复原。 */
function CopyButton({ text, label }: { text: string; label: string }) {
  const t = adminT
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle')

  const copy = async () => {
    const ok = await copyText(text)
    setState(ok ? 'ok' : 'fail')
    window.setTimeout(() => setState('idle'), 2000)
  }

  return (
    <button
      type="button"
      className="btn-ghost admin-copy"
      disabled={!text}
      onClick={() => void copy()}
    >
      {state === 'ok' ? t('admin.copied') : state === 'fail' ? t('admin.copyFailed') : label}
    </button>
  )
}

function AdminScreen({ children }: { children: ReactNode }) {
  return (
    <div className="home admin-home">
      <div className="admin-login-screen">{children}</div>
    </div>
  )
}

function AdminLogin({ onDone }: { onDone: () => void }) {
  const t = adminT
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [disabled, setDisabled] = useState(false)

  useEffect(() => {
    void probeAdmin().then((s) => {
      if (s === 'disabled') setDisabled(true)
      if (s === 'admin') onDone()
    })
  }, [onDone])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    const result = await adminLogin(token.trim())
    setBusy(false)
    if (result === 'ok') {
      onDone()
      return
    }
    if (result === 'disabled') {
      setDisabled(true)
      return
    }
    if (result === 'offline') {
      setError(t('common.backendUnavailable'))
      return
    }
    if (result === 'rate_limited') {
      setError(t('err.rate_limited'))
      return
    }
    setError(t('admin.wrongPassphrase'))
  }

  if (disabled) {
    return (
      <AdminScreen>
        <div className="admin-card">
          <h1>{t('admin.title')}</h1>
          <p className="admin-muted">{t('admin.disabled')}</p>
        </div>
      </AdminScreen>
    )
  }

  return (
    <AdminScreen>
      <div className="admin-card">
        <div className="admin-card-brand">
          <BrandMark />
          <span>lushu {t('admin.brand')}</span>
        </div>
        <h1>{t('admin.login')}</h1>
        <p className="admin-muted">{t('admin.enterPrompt')}</p>
        <form className="admin-form" onSubmit={(e) => void submit(e)}>
          <label>
            <span>{t('admin.passphrase')}</span>
            <input
              type="password"
              autoComplete="current-password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              required
            />
          </label>
          {error ? <p className="admin-error">{error}</p> : null}
          <button type="submit" className="btn-primary" disabled={busy || !token.trim()}>
            {busy ? t('admin.verifying') : t('admin.enter')}
          </button>
        </form>
      </div>
    </AdminScreen>
  )
}

function StatCards({ stats }: { stats: AdminStats }) {
  const t = adminT
  return (
    <div className="admin-stats">
      <div className="admin-stat">
        <b>{stats.users}</b>
        <span>{t('admin.statUsers')}</span>
      </div>
      <div className="admin-stat">
        <b>{stats.books}</b>
        <span>{t('admin.statBooks')}</span>
      </div>
      <div className="admin-stat">
        <b>{stats.publicBooks}</b>
        <span>{t('admin.statPublic')}</span>
      </div>
      <div className="admin-stat">
        <b>{stats.privateBooks}</b>
        <span>{t('admin.statPrivate')}</span>
      </div>
    </div>
  )
}

function Pager({
  total,
  offset,
  pageSize,
  onChange,
}: {
  total: number
  offset: number
  pageSize: number
  onChange: (next: number) => void
}) {
  const t = adminT
  const page = Math.floor(offset / pageSize) + 1
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="admin-pager">
      <button type="button" disabled={offset <= 0} onClick={() => onChange(Math.max(0, offset - pageSize))}>
        {t('admin.prevPage')}
      </button>
      <span>{t('admin.pageInfo', { page, pages, total })}</span>
      <button
        type="button"
        disabled={offset + pageSize >= total}
        onClick={() => onChange(offset + pageSize)}
      >
        {t('admin.nextPage')}
      </button>
    </div>
  )
}

function UsersPanel({
  onSelect,
}: {
  onSelect: (id: string) => void
}) {
  const t = adminT
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const data = await fetchAdminUsers({ limit: PAGE_SIZE, offset, q: query })
      setUsers(data.users)
      setTotal(data.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [offset, query])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="admin-panel">
      <form
        className="admin-toolbar"
        onSubmit={(e) => {
          e.preventDefault()
          setOffset(0)
          setQuery(q.trim())
        }}
      >
        <input
          type="search"
          placeholder={t('admin.searchEmailPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" className="btn-ghost">
          {t('admin.search')}
        </button>
      </form>
      {error ? <p className="admin-error">{error}</p> : null}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('admin.colId')}</th>
              <th>{t('admin.colEmail')}</th>
              <th>{t('admin.colName')}</th>
              <th>{t('admin.colHashId')}</th>
              <th>{t('admin.colBooks')}</th>
              <th>{t('admin.colStatus')}</th>
              <th>{t('admin.colCreated')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="admin-row-click" onClick={() => onSelect(u.id)}>
                <td className="mono" data-label={t('admin.colId')}>
                  {u.id}
                </td>
                <td data-label={t('admin.colEmail')}>{u.email}</td>
                <td data-label={t('admin.colName')}>{u.displayName}</td>
                <td className="mono" data-label={t('admin.colHashId')}>
                  {u.hashId || '—'}
                </td>
                <td data-label={t('admin.colBooks')}>{u.bookCount}</td>
                <td data-label={t('admin.colStatus')}>
                  {u.activated ? t('admin.activated') : t('admin.pending')}
                </td>
                <td data-label={t('admin.colCreated')}>{fmtTime(u.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager total={total} offset={offset} pageSize={PAGE_SIZE} onChange={setOffset} />
    </div>
  )
}

function BooksPanel({
  onSelect,
}: {
  onSelect: (id: string) => void
}) {
  const t = adminT
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [visibility, setVisibility] = useState<'all' | 'public' | 'private'>('all')
  const [offset, setOffset] = useState(0)
  const [books, setBooks] = useState<AdminBookSummary[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const data = await fetchAdminBooks({ limit: PAGE_SIZE, offset, q: query, visibility })
      setBooks(data.books)
      setTotal(data.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [offset, query, visibility])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="admin-panel">
      <form
        className="admin-toolbar"
        onSubmit={(e) => {
          e.preventDefault()
          setOffset(0)
          setQuery(q.trim())
        }}
      >
        <input
          type="search"
          placeholder={t('admin.searchBookPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
          <option value="all">{t('admin.allVisibility')}</option>
          <option value="public">{t('admin.onlyPublic')}</option>
          <option value="private">{t('admin.onlyPrivate')}</option>
        </select>
        <button type="submit" className="btn-ghost">
          {t('admin.search')}
        </button>
      </form>
      {error ? <p className="admin-error">{error}</p> : null}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('admin.colId')}</th>
              <th>{t('admin.colTitle')}</th>
              <th>{t('admin.colVisibility')}</th>
              <th>{t('admin.colPlaces')}</th>
              <th>{t('admin.colOwner')}</th>
              <th>{t('admin.colUpdated')}</th>
            </tr>
          </thead>
          <tbody>
            {books.map((b) => (
              <tr key={b.id} className="admin-row-click" onClick={() => onSelect(b.id)}>
                <td className="mono" data-label={t('admin.colId')}>
                  {b.id}
                </td>
                <td data-label={t('admin.colTitle')}>{b.title || t('admin.untitled')}</td>
                <td data-label={t('admin.colVisibility')}>{visLabel(b.visibility)}</td>
                <td data-label={t('admin.colPlaces')}>{b.places}</td>
                <td data-label={t('admin.colOwner')}>
                  {b.ownerEmail ?? b.ownerHashId ?? t('common.anonymous')}
                </td>
                <td data-label={t('admin.colUpdated')}>{fmtTime(b.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager total={total} offset={offset} pageSize={PAGE_SIZE} onChange={setOffset} />
    </div>
  )
}

function UserDetail({
  userId,
  onBack,
}: {
  userId: string
  onBack: () => void
}) {
  const t = adminT
  const [user, setUser] = useState<AdminUser | null>(null)
  const [books, setBooks] = useState<
    Array<{
      id: string
      title: string
      startDate: string
      places: number
      visibility: 'public' | 'private'
      updatedAt: number
    }>
  >([])
  const [error, setError] = useState('')

  useEffect(() => {
    setUser(null)
    setBooks([])
    setError('')
    void fetchAdminUser(userId)
      .then((data) => {
        setUser(data.user)
        setBooks(data.books)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [userId])

  return (
    <div className="admin-detail">
      <div className="admin-detail-head">
        <button type="button" className="btn-ghost admin-back" onClick={onBack}>
          {t('admin.backUsers')}
        </button>
      </div>
      {error ? <p className="admin-error">{error}</p> : null}
      {!user && !error ? <p className="admin-muted">{t('common.loading')}</p> : null}
      {user ? (
        <>
          <h2>{user.displayName}</h2>
          <dl className="admin-kv">
            <div>
              <dt>{t('admin.colEmail')}</dt>
              <dd>{user.email}</dd>
            </div>
            <div>
              <dt>{t('admin.publicId')}</dt>
              <dd className="mono">{user.hashId || '—'}</dd>
            </div>
            <div>
              <dt>{t('admin.internalOwner')}</dt>
              <dd className="mono">{user.id}</dd>
            </div>
            <div>
              <dt>{t('admin.status')}</dt>
              <dd>{user.activated ? t('admin.activated') : t('admin.pending')}</dd>
            </div>
            <div>
              <dt>{t('admin.colCreated')}</dt>
              <dd>{fmtTime(user.createdAt)}</dd>
            </div>
          </dl>
          <h3>{t('admin.booksCount', { n: books.length })}</h3>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t('admin.colId')}</th>
                  <th>{t('admin.colTitle')}</th>
                  <th>{t('admin.colVisibility')}</th>
                  <th>{t('admin.colPlaces')}</th>
                  <th>{t('admin.colUpdated')}</th>
                  <th>{t('admin.colLink')}</th>
                </tr>
              </thead>
              <tbody>
                {books.map((b) => (
                  <tr key={b.id}>
                    <td className="mono" data-label={t('admin.colId')}>
                      {b.id}
                    </td>
                    <td data-label={t('admin.colTitle')}>{b.title || t('admin.untitled')}</td>
                    <td data-label={t('admin.colVisibility')}>{visLabel(b.visibility)}</td>
                    <td data-label={t('admin.colPlaces')}>{b.places}</td>
                    <td data-label={t('admin.colUpdated')}>{fmtTime(b.updatedAt)}</td>
                    <td data-label={t('admin.colLink')}>
                      <a
                        href={bookPath(b.id, user.hashId || undefined)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t('admin.open')}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  )
}

function BookDetail({
  bookId,
  onBack,
}: {
  bookId: string
  onBack: () => void
}) {
  const t = adminT
  const [book, setBook] = useState<AdminBookDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void fetchAdminBook(bookId)
      .then(setBook)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [bookId])

  const title = typeof book?.doc.title === 'string' ? book.doc.title : ''
  const places = Array.isArray(book?.doc.places) ? book.doc.places.length : 0
  const visibility = book?.doc.visibility === 'private' ? 'private' : 'public'
  const journey = useMemo(() => (book ? journeyFromDoc(book.doc) : null), [book])
  const json = useMemo(() => (book ? JSON.stringify(book.doc, null, 2) : ''), [book])

  return (
    <div className="admin-detail">
      <div className="admin-detail-head">
        <button type="button" className="btn-ghost admin-back" onClick={onBack}>
          {t('admin.backBooks')}
        </button>
      </div>
      {error ? <p className="admin-error">{error}</p> : null}
      {!book ? <p className="admin-muted">{t('common.loading')}</p> : null}
      {book ? (
        <>
          <h2>{title || t('admin.untitled')}</h2>
          <dl className="admin-kv">
            <div>
              <dt>{t('admin.bookId')}</dt>
              <dd className="mono">{book.id}</dd>
            </div>
            <div>
              <dt>{t('admin.colVisibility')}</dt>
              <dd>{visLabel(visibility)}</dd>
            </div>
            <div>
              <dt>{t('admin.placesCount')}</dt>
              <dd>{places}</dd>
            </div>
            <div>
              <dt>{t('admin.colOwner')}</dt>
              <dd>{book.ownerEmail ?? book.ownerHashId ?? t('common.anonymous')}</dd>
            </div>
            <div>
              <dt>{t('admin.createdUpdated')}</dt>
              <dd>
                {fmtTime(book.createdAt)} / {fmtTime(book.updatedAt)}
              </dd>
            </div>
          </dl>
          {journey && journey.places.length > 0 ? (
            <>
              <h3>{t('admin.routeMap')}</h3>
              <div className="admin-map">
                <RouteMap journey={journey} />
              </div>
            </>
          ) : null}
          <div className="admin-section-head">
            <h3>{t('admin.rawData')}</h3>
            <CopyButton text={json} label={t('admin.copyJson')} />
          </div>
          <pre className="admin-json">{json}</pre>
        </>
      ) : null}
    </div>
  )
}

function AdminSidebar({
  tab,
  onTab,
  onLogout,
}: {
  tab: Tab
  onTab: (tab: Tab) => void
  onLogout: () => void
}) {
  const t = adminT
  const items: Tab[] = ['overview', 'users', 'books']
  return (
    <aside className="admin-sidebar">
      <div className="admin-sidebar-brand">
        <BrandMark />
        <div>
          <b>lushu</b>
          <span>{t('admin.title')}</span>
        </div>
      </div>
      <nav className="admin-sidebar-nav">
        {items.map((key) => (
          <button
            key={key}
            type="button"
            className={tab === key ? 'on' : undefined}
            onClick={() => onTab(key)}
          >
            {t(TAB_KEY[key])}
          </button>
        ))}
      </nav>
      <div className="admin-sidebar-foot">
        <button type="button" className="admin-sidebar-link" onClick={() => navigateList()}>
          {t('admin.backToSite')}
        </button>
        <button type="button" className="admin-sidebar-link danger" onClick={onLogout}>
          {t('admin.signOut')}
        </button>
      </div>
    </aside>
  )
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const t = adminT
  // 当前页完全由地址栏决定：tab + 可选详情 ID，刷新 / 分享 / 前进后退都能复现。
  const [route, setRoute] = useState<AdminRoute>(() => readAdminRoute())
  const tab = route.tab
  const detailId = route.id
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [error, setError] = useState('')

  const refreshStats = useCallback(() => {
    setError('')
    return fetchAdminStats()
      .then(setStats)
      .catch((err) => setError(err instanceof Error ? err.message : t('common.backendUnavailable')))
  }, [t])

  useEffect(() => {
    void refreshStats()
  }, [refreshStats])

  // 前进 / 后退（含直接改地址栏）时，当前页跟着地址走。
  useEffect(() => {
    const onPop = () => setRoute(readAdminRoute())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const signOut = () => {
    void adminLogout().finally(onLogout)
  }

  /** 切到下一个管理页（tab 或详情），并把地址栏同步成可分享的路径。 */
  const go = (next: AdminRoute) => {
    setRoute(next)
    const path = adminPath(next.tab, next.id)
    if (window.location.pathname !== path) window.history.pushState(null, '', path)
  }

  const goTab = (next: Tab) => {
    go({ tab: next, id: null })
  }

  let title = t(TAB_KEY[tab])
  if (tab === 'users' && detailId) title = t('admin.userDetail')
  if (tab === 'books' && detailId) title = t('admin.bookDetail')

  let body: ReactNode = null
  if (tab === 'users' && detailId) {
    body = <UserDetail userId={detailId} onBack={() => go({ tab: 'users', id: null })} />
  } else if (tab === 'books' && detailId) {
    body = <BookDetail bookId={detailId} onBack={() => go({ tab: 'books', id: null })} />
  } else if (tab === 'overview') {
    body = stats ? <StatCards stats={stats} /> : <p className="admin-muted">{t('common.loading')}</p>
  } else if (tab === 'users') {
    body = <UsersPanel onSelect={(id) => go({ tab: 'users', id })} />
  } else {
    body = <BooksPanel onSelect={(id) => go({ tab: 'books', id })} />
  }

  return (
    <div className="home admin-home">
      <div className="admin-layout">
        <AdminSidebar tab={tab} onTab={goTab} onLogout={signOut} />
        <main className="admin-main">
          <header className="admin-main-head">
            <h1>{title}</h1>
          </header>
          <div className="admin-main-body">
            {error && tab === 'overview' && !detailId ? (
              <p className="admin-error">{error}</p>
            ) : null}
            {body}
          </div>
        </main>
      </div>
    </div>
  )
}

/** `/admin`：管理后台（需 ADMIN_SECRET 口令）。 */
export function AdminPage() {
  const t = adminT
  const [probe, setProbe] = useState<AdminProbe>('loading')

  const refresh = useCallback(() => {
    void probeAdmin().then(setProbe)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (probe === 'loading') {
    return (
      <AdminScreen>
        <div className="admin-card">
          <p className="admin-muted">{t('admin.checking')}</p>
        </div>
      </AdminScreen>
    )
  }

  if (probe === 'offline') {
    return (
      <AdminScreen>
        <div className="admin-card">
          <h1>{t('admin.title')}</h1>
          <p className="admin-muted">{t('common.backendUnavailable')}</p>
        </div>
      </AdminScreen>
    )
  }

  if (probe === 'admin') {
    return <AdminDashboard onLogout={() => setProbe('guest')} />
  }

  return <AdminLogin onDone={refresh} />
}
