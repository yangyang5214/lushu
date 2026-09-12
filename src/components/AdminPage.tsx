import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  adminLogin,
  adminLogout,
  deleteAdminBook,
  deleteAdminUser,
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
import { getLang, t, useI18n, type MsgKey } from '../lib/i18n'
import { bookPath, navigateList } from '../lib/router'
import type { Journey, Place } from '../types'
import { BrandMark } from './BrandMark'
import { LangSwitch } from './LangSwitch'
import { RouteMap } from './RouteMap'

type Tab = 'overview' | 'users' | 'books'

const PAGE_SIZE = 30

const TAB_KEY: Record<Tab, MsgKey> = {
  overview: 'admin.overview',
  users: 'admin.users',
  books: 'admin.books',
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(getLang() === 'en' ? 'en-US' : 'zh-CN', { hour12: false })
}

function visLabel(v: 'public' | 'private'): string {
  return v === 'private' ? t('admin.visPrivate') : t('admin.visPublic')
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

function AdminScreen({ children }: { children: ReactNode }) {
  return (
    <div className="home admin-home">
      <div className="admin-login-screen">{children}</div>
    </div>
  )
}

function AdminLogin({ onDone }: { onDone: () => void }) {
  const { t } = useI18n()
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
          <LangSwitch className="admin-lang" />
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
        <LangSwitch className="admin-lang" />
      </div>
    </AdminScreen>
  )
}

function StatCards({ stats }: { stats: AdminStats }) {
  const { t } = useI18n()
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
  const { t } = useI18n()
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

/** 二次确认的删除按钮（列表行内 / 详情页共用）。 */
function DangerConfirm({
  busy,
  onConfirm,
  label,
  hint,
}: {
  busy: boolean
  onConfirm: () => void
  label?: string
  hint?: string
}) {
  const { t } = useI18n()
  const [asking, setAsking] = useState(false)
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

  if (!asking) {
    return (
      <button
        type="button"
        className="admin-danger"
        onClick={(e) => {
          stop(e)
          setAsking(true)
        }}
      >
        {label ?? t('common.delete')}
      </button>
    )
  }
  return (
    <span className="admin-danger-group" onClick={stop}>
      {hint ? <span className="admin-danger-hint">{hint}</span> : null}
      <button type="button" className="admin-danger on" disabled={busy} onClick={onConfirm}>
        {busy ? t('admin.deleting') : t('admin.confirmDelete')}
      </button>
      <button type="button" className="admin-cancel" disabled={busy} onClick={() => setAsking(false)}>
        {t('common.cancel')}
      </button>
    </span>
  )
}

function UsersPanel({
  onSelect,
  onChanged,
}: {
  onSelect: (user: AdminUser) => void
  onChanged: () => void
}) {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

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

  const remove = async (id: string) => {
    setError('')
    setBusyId(id)
    try {
      await deleteAdminUser(id)
      setBusyId('')
      onChanged()
      // 删掉的是本页最后一条时回退一页，避免停在空页。
      if (users.length === 1 && offset >= PAGE_SIZE) setOffset(Math.max(0, offset - PAGE_SIZE))
      else await load()
    } catch (err) {
      setBusyId('')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

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
              <th>{t('admin.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="admin-row-click" onClick={() => onSelect(u)}>
                <td className="mono">{u.id}</td>
                <td>{u.email}</td>
                <td>{u.displayName}</td>
                <td className="mono">{u.hashId || '—'}</td>
                <td>{u.bookCount}</td>
                <td>{u.activated ? t('admin.activated') : t('admin.pending')}</td>
                <td>{fmtTime(u.createdAt)}</td>
                <td>
                  <DangerConfirm
                    busy={busyId === u.id}
                    hint={u.bookCount > 0 ? t('admin.withBooks', { n: u.bookCount }) : undefined}
                    onConfirm={() => void remove(u.id)}
                  />
                </td>
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
  onChanged,
}: {
  onSelect: (book: AdminBookSummary) => void
  onChanged: () => void
}) {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [visibility, setVisibility] = useState<'all' | 'public' | 'private'>('all')
  const [offset, setOffset] = useState(0)
  const [books, setBooks] = useState<AdminBookSummary[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

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

  const remove = async (id: string) => {
    setError('')
    setBusyId(id)
    try {
      await deleteAdminBook(id)
      setBusyId('')
      onChanged()
      // 删掉的是本页最后一条时回退一页，避免停在空页。
      if (books.length === 1 && offset >= PAGE_SIZE) setOffset(Math.max(0, offset - PAGE_SIZE))
      else await load()
    } catch (err) {
      setBusyId('')
      setError(err instanceof Error ? err.message : String(err))
    }
  }

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
              <th>{t('admin.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {books.map((b) => (
              <tr key={b.id} className="admin-row-click" onClick={() => onSelect(b)}>
                <td className="mono">{b.id}</td>
                <td>{b.title || t('admin.untitled')}</td>
                <td>{visLabel(b.visibility)}</td>
                <td>{b.places}</td>
                <td>{b.ownerEmail ?? b.ownerHashId ?? t('common.anonymous')}</td>
                <td>{fmtTime(b.updatedAt)}</td>
                <td>
                  <DangerConfirm busy={busyId === b.id} onConfirm={() => void remove(b.id)} />
                </td>
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
  user,
  onBack,
  onDeleted,
}: {
  user: AdminUser
  onBack: () => void
  onDeleted: () => void
}) {
  const { t } = useI18n()
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
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void fetchAdminUser(user.id)
      .then((data) => setBooks(data.books))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [user.id])

  const remove = async () => {
    setError('')
    setBusy(true)
    try {
      await deleteAdminUser(user.id)
      onDeleted()
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="admin-detail">
      <div className="admin-detail-head">
        <button type="button" className="btn-ghost admin-back" onClick={onBack}>
          {t('admin.backUsers')}
        </button>
        <DangerConfirm
          busy={busy}
          hint={books.length > 0 ? t('admin.withBooks', { n: books.length }) : undefined}
          onConfirm={() => void remove()}
        />
      </div>
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
      {error ? <p className="admin-error">{error}</p> : null}
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
                <td className="mono">{b.id}</td>
                <td>{b.title || t('admin.untitled')}</td>
                <td>{visLabel(b.visibility)}</td>
                <td>{b.places}</td>
                <td>{fmtTime(b.updatedAt)}</td>
                <td>
                  <a href={bookPath(b.id, user.hashId || undefined)} target="_blank" rel="noreferrer">
                    {t('admin.open')}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BookDetail({
  bookId,
  onBack,
  onDeleted,
}: {
  bookId: string
  onBack: () => void
  onDeleted: () => void
}) {
  const { t } = useI18n()
  const [book, setBook] = useState<AdminBookDetail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void fetchAdminBook(bookId)
      .then(setBook)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [bookId])

  const title = typeof book?.doc.title === 'string' ? book.doc.title : ''
  const places = Array.isArray(book?.doc.places) ? book.doc.places.length : 0
  const visibility = book?.doc.visibility === 'private' ? 'private' : 'public'
  const journey = useMemo(() => (book ? journeyFromDoc(book.doc) : null), [book])

  const remove = async () => {
    setError('')
    setBusy(true)
    try {
      await deleteAdminBook(bookId)
      onDeleted()
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="admin-detail">
      <div className="admin-detail-head">
        <button type="button" className="btn-ghost admin-back" onClick={onBack}>
          {t('admin.backBooks')}
        </button>
        <DangerConfirm busy={busy} onConfirm={() => void remove()} />
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
          <h3>{t('admin.rawData')}</h3>
          <pre className="admin-json">{JSON.stringify(book.doc, null, 2)}</pre>
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
  const { t } = useI18n()
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
        <LangSwitch className="admin-lang" />
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
  const { t } = useI18n()
  const [tab, setTab] = useState<Tab>('overview')
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [error, setError] = useState('')
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [selectedBook, setSelectedBook] = useState<AdminBookSummary | null>(null)

  const refreshStats = useCallback(() => {
    setError('')
    return fetchAdminStats()
      .then(setStats)
      .catch((err) => setError(err instanceof Error ? err.message : t('common.backendUnavailable')))
  }, [t])

  useEffect(() => {
    void refreshStats()
  }, [refreshStats])

  const signOut = () => {
    void adminLogout().finally(onLogout)
  }

  const goTab = (next: Tab) => {
    setTab(next)
    setSelectedUser(null)
    setSelectedBook(null)
  }

  let title = t(TAB_KEY[tab])
  if (selectedUser) title = t('admin.userDetail')
  if (selectedBook) title = t('admin.bookDetail')

  let body: ReactNode = null
  if (selectedUser) {
    body = (
      <UserDetail
        user={selectedUser}
        onBack={() => setSelectedUser(null)}
        onDeleted={() => {
          setSelectedUser(null)
          void refreshStats()
        }}
      />
    )
  } else if (selectedBook) {
    body = (
      <BookDetail
        bookId={selectedBook.id}
        onBack={() => setSelectedBook(null)}
        onDeleted={() => {
          setSelectedBook(null)
          void refreshStats()
        }}
      />
    )
  } else if (tab === 'overview') {
    body = stats ? <StatCards stats={stats} /> : <p className="admin-muted">{t('common.loading')}</p>
  } else if (tab === 'users') {
    body = <UsersPanel onSelect={setSelectedUser} onChanged={() => void refreshStats()} />
  } else {
    body = <BooksPanel onSelect={setSelectedBook} onChanged={() => void refreshStats()} />
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
            {error && tab === 'overview' && !selectedUser && !selectedBook ? (
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
  const { t } = useI18n()
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
          <LangSwitch className="admin-lang" />
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
          <LangSwitch className="admin-lang" />
        </div>
      </AdminScreen>
    )
  }

  if (probe === 'admin') {
    return <AdminDashboard onLogout={() => setProbe('guest')} />
  }

  return <AdminLogin onDone={refresh} />
}
