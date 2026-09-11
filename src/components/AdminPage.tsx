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
import { BACKEND_UNAVAILABLE } from '../lib/api'
import { bookPath, navigateList } from '../lib/router'
import { BrandMark } from './BrandMark'

type Tab = 'overview' | 'users' | 'books'

const PAGE_SIZE = 30

const TAB_LABEL: Record<Tab, string> = {
  overview: '概览',
  users: '用户',
  books: '路书',
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('zh-CN', { hour12: false })
}

function visLabel(v: 'public' | 'private'): string {
  return v === 'private' ? '私密' : '公开'
}

function AdminScreen({ children }: { children: ReactNode }) {
  return (
    <div className="home admin-home">
      <div className="admin-login-screen">{children}</div>
    </div>
  )
}

function AdminLogin({ onDone }: { onDone: () => void }) {
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
      setError(BACKEND_UNAVAILABLE)
      return
    }
    setError('口令不正确')
  }

  if (disabled) {
    return (
      <AdminScreen>
        <div className="admin-card">
          <h1>管理后台</h1>
          <p className="admin-muted">
            管理功能未启用：请在 wrangler.toml 的 [vars] 或 .dev.vars 中设置 ADMIN_SECRET（至少 6
            字符），然后重启 Worker。
          </p>
        </div>
      </AdminScreen>
    )
  }

  return (
    <AdminScreen>
      <div className="admin-card">
        <div className="admin-card-brand">
          <BrandMark />
          <span>lushu 管理</span>
        </div>
        <h1>登录</h1>
        <p className="admin-muted">请输入管理员口令以继续。</p>
        <form className="admin-form" onSubmit={(e) => void submit(e)}>
          <label>
            <span>管理员口令</span>
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
            {busy ? '验证中…' : '进入'}
          </button>
        </form>
      </div>
    </AdminScreen>
  )
}

function StatCards({ stats }: { stats: AdminStats }) {
  return (
    <div className="admin-stats">
      <div className="admin-stat">
        <b>{stats.users}</b>
        <span>注册用户</span>
      </div>
      <div className="admin-stat">
        <b>{stats.books}</b>
        <span>路书总数</span>
      </div>
      <div className="admin-stat">
        <b>{stats.publicBooks}</b>
        <span>公开路书</span>
      </div>
      <div className="admin-stat">
        <b>{stats.privateBooks}</b>
        <span>私密路书</span>
      </div>
      <div className="admin-stat">
        <b>{stats.activeSessions}</b>
        <span>活跃会话</span>
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
  const page = Math.floor(offset / pageSize) + 1
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="admin-pager">
      <button type="button" disabled={offset <= 0} onClick={() => onChange(Math.max(0, offset - pageSize))}>
        上一页
      </button>
      <span>
        第 {page} / {pages} 页（共 {total} 条）
      </span>
      <button
        type="button"
        disabled={offset + pageSize >= total}
        onClick={() => onChange(offset + pageSize)}
      >
        下一页
      </button>
    </div>
  )
}

/** 二次确认的删除按钮（列表行内 / 详情页共用）。 */
function DangerConfirm({
  busy,
  onConfirm,
  label = '删除',
  hint,
}: {
  busy: boolean
  onConfirm: () => void
  label?: string
  hint?: string
}) {
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
        {label}
      </button>
    )
  }
  return (
    <span className="admin-danger-group" onClick={stop}>
      {hint ? <span className="admin-danger-hint">{hint}</span> : null}
      <button type="button" className="admin-danger on" disabled={busy} onClick={onConfirm}>
        {busy ? '删除中…' : '确认删除'}
      </button>
      <button type="button" className="admin-cancel" disabled={busy} onClick={() => setAsking(false)}>
        取消
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
          placeholder="搜索邮箱或昵称"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="submit" className="btn-ghost">
          搜索
        </button>
      </form>
      {error ? <p className="admin-error">{error}</p> : null}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>邮箱</th>
              <th>昵称</th>
              <th>公开 ID</th>
              <th>路书</th>
              <th>状态</th>
              <th>注册时间</th>
              <th>操作</th>
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
                <td>{u.activated ? '已激活' : '待激活'}</td>
                <td>{fmtTime(u.createdAt)}</td>
                <td>
                  <DangerConfirm
                    busy={busyId === u.id}
                    hint={u.bookCount > 0 ? `连同 ${u.bookCount} 本路书` : undefined}
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
          placeholder="搜索路书标题"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
          <option value="all">全部可见性</option>
          <option value="public">仅公开</option>
          <option value="private">仅私密</option>
        </select>
        <button type="submit" className="btn-ghost">
          搜索
        </button>
      </form>
      {error ? <p className="admin-error">{error}</p> : null}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>标题</th>
              <th>可见性</th>
              <th>地点</th>
              <th>书主</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {books.map((b) => (
              <tr key={b.id} className="admin-row-click" onClick={() => onSelect(b)}>
                <td className="mono">{b.id}</td>
                <td>{b.title || '（未命名）'}</td>
                <td>{visLabel(b.visibility)}</td>
                <td>{b.places}</td>
                <td>{b.ownerEmail ?? b.ownerHashId ?? '匿名'}</td>
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
          ← 返回用户列表
        </button>
        <DangerConfirm
          busy={busy}
          hint={books.length > 0 ? `连同 ${books.length} 本路书` : undefined}
          onConfirm={() => void remove()}
        />
      </div>
      <h2>{user.displayName}</h2>
      <dl className="admin-kv">
        <div>
          <dt>邮箱</dt>
          <dd>{user.email}</dd>
        </div>
        <div>
          <dt>用户 ID</dt>
          <dd className="mono">{user.hashId || '—'}</dd>
        </div>
        <div>
          <dt>内部 owner_key</dt>
          <dd className="mono">{user.id}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>{user.activated ? '已激活' : '待激活'}</dd>
        </div>
        <div>
          <dt>注册时间</dt>
          <dd>{fmtTime(user.createdAt)}</dd>
        </div>
      </dl>
      {error ? <p className="admin-error">{error}</p> : null}
      <h3>路书（{books.length}）</h3>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>标题</th>
              <th>可见性</th>
              <th>地点</th>
              <th>更新时间</th>
              <th>链接</th>
            </tr>
          </thead>
          <tbody>
            {books.map((b) => (
              <tr key={b.id}>
                <td className="mono">{b.id}</td>
                <td>{b.title || '（未命名）'}</td>
                <td>{visLabel(b.visibility)}</td>
                <td>{b.places}</td>
                <td>{fmtTime(b.updatedAt)}</td>
                <td>
                  <a href={bookPath(b.id, user.hashId || undefined)} target="_blank" rel="noreferrer">
                    打开
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
          ← 返回路书列表
        </button>
        <DangerConfirm busy={busy} onConfirm={() => void remove()} />
      </div>
      {error ? <p className="admin-error">{error}</p> : null}
      {!book ? <p className="admin-muted">加载中…</p> : null}
      {book ? (
        <>
          <h2>{title || '（未命名）'}</h2>
          <dl className="admin-kv">
            <div>
              <dt>路书 ID</dt>
              <dd className="mono">{book.id}</dd>
            </div>
            <div>
              <dt>可见性</dt>
              <dd>{visLabel(visibility)}</dd>
            </div>
            <div>
              <dt>地点数</dt>
              <dd>{places}</dd>
            </div>
            <div>
              <dt>书主</dt>
              <dd>{book.ownerEmail ?? book.ownerHashId ?? '匿名'}</dd>
            </div>
            <div>
              <dt>创建 / 更新</dt>
              <dd>
                {fmtTime(book.createdAt)} / {fmtTime(book.updatedAt)}
              </dd>
            </div>
          </dl>
          <h3>完整数据</h3>
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
  const items: Tab[] = ['overview', 'users', 'books']
  return (
    <aside className="admin-sidebar">
      <div className="admin-sidebar-brand">
        <BrandMark />
        <div>
          <b>lushu</b>
          <span>管理后台</span>
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
            {TAB_LABEL[key]}
          </button>
        ))}
      </nav>
      <div className="admin-sidebar-foot">
        <button type="button" className="admin-sidebar-link" onClick={() => navigateList()}>
          返回站点
        </button>
        <button type="button" className="admin-sidebar-link danger" onClick={onLogout}>
          退出登录
        </button>
      </div>
    </aside>
  )
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('overview')
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [error, setError] = useState('')
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [selectedBook, setSelectedBook] = useState<AdminBookSummary | null>(null)

  const refreshStats = useCallback(() => {
    setError('')
    return fetchAdminStats()
      .then(setStats)
      .catch((err) => setError(err instanceof Error ? err.message : BACKEND_UNAVAILABLE))
  }, [])

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

  let title = TAB_LABEL[tab]
  if (selectedUser) title = '用户详情'
  if (selectedBook) title = '路书详情'

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
    body = stats ? <StatCards stats={stats} /> : <p className="admin-muted">加载中…</p>
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
          <p className="admin-muted">正在确认权限…</p>
        </div>
      </AdminScreen>
    )
  }

  if (probe === 'offline') {
    return (
      <AdminScreen>
        <div className="admin-card">
          <h1>管理后台</h1>
          <p className="admin-muted">{BACKEND_UNAVAILABLE}</p>
        </div>
      </AdminScreen>
    )
  }

  if (probe === 'admin') {
    return <AdminDashboard onLogout={() => setProbe('guest')} />
  }

  return <AdminLogin onDone={refresh} />
}
