import { useMemo, useState } from 'react'
import { saveVisibility, type BookSummary } from '../lib/api'
import { requireLogin } from '../lib/auth'
import { fmtDay } from '../lib/format'
import { buildJourney } from '../lib/journey'
import { hasToken } from '../lib/keys'
import { navigateBook } from '../lib/router'
import { pushBook, refreshCloud, refreshPublic, removeBook, useCloud } from '../lib/sync'
import { useLushu } from '../store'
import type { Book, Journey, Visibility } from '../types'
import { SiteFoot, SiteNav } from './Chrome'
import { RoutePreview } from './RoutePreview'

function routeLabel(journey: Journey): string {
  if (!journey.ready) return '未设起点与终点'
  const from = journey.start?.name ?? ''
  if (journey.isLoop) return `${from} 出发 · 环线`
  const to = journey.end?.name ?? ''
  return `${from} → ${to}`
}

/** 书名去重用的键：忽略大小写与首尾空白；空名不参与去重（各自保留）。 */
function titleKey(title: string): string | null {
  const key = title.trim().toLowerCase()
  return key || null
}

/** 按书名去重，保留先出现的那一本（调用方先按 updatedAt 倒序排好）。 */
function dedupeByTitle<T>(items: T[], titleOf: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = titleKey(titleOf(item))
    if (!key) return true
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** `/list`：我的路书，独立页面。 */
export function MinePage() {
  const books = useLushu((s) => s.books)
  const order = useLushu((s) => s.order)
  const activeId = useLushu((s) => s.activeId)
  const createBook = useLushu((s) => s.createBook)
  const duplicateBook = useLushu((s) => s.duplicateBook)
  const setVisibility = useLushu((s) => s.setVisibility)
  const cloud = useCloud((s) => s.books)

  const [confirmId, setConfirmId] = useState<string | null>(null)

  // 新建（含复制）都要先登录；未登录会跳到账户页，登录后接着把动作做完。
  const startNew = () => requireLogin(() => navigateBook(createBook()))

  // 改权限也要登录：这是写操作，且推送靠账号归属授权。
  // 没有编辑口令的书（比如别人分享过来、只落在本机的那本）不提供切换。
  const flipVisibility = (book: { visibility: Visibility }): Visibility =>
    book.visibility === 'private' ? 'public' : 'private'

  const toggleVisibility = (book: Book) =>
    requireLogin(() => {
      setVisibility(book.id, flipVisibility(book))
      void pushBook(book.id).then(() => refreshPublic())
    })

  // 换设备后从云端列出来的那几本：本机没有整本 doc，直接让服务端改这一列。
  const toggleCloudVisibility = (book: BookSummary) =>
    requireLogin(() => {
      void saveVisibility(book.id, flipVisibility(book)).then((ok) => {
        if (!ok) return
        void refreshCloud()
        void refreshPublic()
      })
    })

  const rows = useMemo(
    () =>
      order
        .map((id) => books[id])
        .filter((b): b is Book => Boolean(b))
        .map((book) => ({
          book,
          journey: buildJourney({
            title: book.title,
            startDate: book.startDate,
            places: book.places,
            startId: book.startId,
            endId: book.endId,
            orderedIds: book.orderedIds,
            splitIds: book.splitIds,
          }),
        })),
    [books, order],
  )

  // 同名路书只留最近更新的一本，避免复制 / 跨设备同步堆出一串重名的。
  const shown = useMemo(
    () =>
      dedupeByTitle(
        [...rows].sort((a, b) => b.book.updatedAt - a.book.updatedAt),
        (row) => row.book.title,
      ),
    [rows],
  )

  // 账号里有、这台设备上还没有的路书（比如换了设备 / 换了浏览器）；
  // 书名已经有了的也不再单列，同样按书名去重。
  const cloudOnly = useMemo(() => {
    const localTitles = new Set(
      rows.map((row) => titleKey(row.book.title)).filter((k): k is string => Boolean(k)),
    )
    const next = cloud.filter((c) => {
      if (books[c.id]) return false
      const key = titleKey(c.title)
      return !key || !localTitles.has(key)
    })
    return dedupeByTitle(next, (c) => c.title)
  }, [cloud, books, rows])

  return (
    <div className="home">
      <SiteNav
        active="mine"
        extra={
          <button type="button" className="btn-primary btn-sm" onClick={startNew}>
            新建路书
          </button>
        }
      />

      <main>
        <section className="shelf page-first">
          <div className="shell">
            <header className="shelf-head">
              <h2>我的路书</h2>
            </header>

            {rows.length === 0 ? (
              <div className="empty-state">
                <h3>还没有自己的路书</h3>
                <p>把想去的点一路搜进来，定好起点终点，再在过夜的地方钉上分割针。</p>
                <div className="empty-ops">
                  <button type="button" className="btn-primary" onClick={startNew}>
                    新建一本路书
                  </button>
                </div>
              </div>
            ) : (
              <ul className="card-grid">
                {shown.map(({ book, journey }) => {
                  const dayCount = journey.days.length
                  const isPrivate = book.visibility === 'private'
                  const editable = hasToken(book.id)
                  return (
                    <li key={book.id} className={book.id === activeId ? 'card on' : 'card'}>
                      <button
                        type="button"
                        className="card-open"
                        onClick={() => navigateBook(book.id)}
                      >
                        <div className="card-cover">
                          <RoutePreview journey={journey} />
                          <span className="card-days">
                            {dayCount > 0 ? `${dayCount} 天` : '草稿'}
                          </span>
                          {journey.isLoop && journey.ready ? (
                            <span className="card-loop">环线</span>
                          ) : null}
                          {isPrivate ? <span className="card-vis">仅自己可见</span> : null}
                        </div>
                        <div className="card-body">
                          <h3>{book.title || '未命名路书'}</h3>
                          <p className="card-route">{routeLabel(journey)}</p>
                          <div className="card-meta">
                            <span>
                              <b>{journey.places.length}</b> 个地点
                            </span>
                            {journey.ready ? (
                              <span>
                                <b>{Math.round(journey.totalKm).toLocaleString()}</b> 公里
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </button>

                      <div className="card-foot">
                        <span className="card-date">{fmtDay(book.startDate)}</span>
                        <div className="card-ops">
                          <button
                            type="button"
                            onClick={() => requireLogin(() => duplicateBook(book.id))}
                          >
                            复制
                          </button>
                          {editable ? (
                            <button type="button" onClick={() => toggleVisibility(book)}>
                              {isPrivate ? '设为公开' : '设为私密'}
                            </button>
                          ) : null}
                          {confirmId === book.id ? (
                            <button
                              type="button"
                              className="danger on"
                              onClick={() => {
                                void removeBook(book.id)
                                setConfirmId(null)
                              }}
                              onBlur={() => setConfirmId(null)}
                            >
                              确认删除
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="danger"
                              onClick={() => setConfirmId(book.id)}
                            >
                              删除
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>

        {cloudOnly.length > 0 ? (
          <section className="shelf">
            <div className="shell">
              <ul className="card-grid">
                {cloudOnly.map((c) => (
                  <li key={c.id} className="card">
                    <button
                      type="button"
                      className="card-open"
                      onClick={() => navigateBook(c.id)}
                    >
                      <div className="card-body">
                        <h3>{c.title || '未命名路书'}</h3>
                        <p className="card-route">{c.places} 个地点</p>
                        <div className="card-meta">
                          {c.visibility === 'private' ? <span>仅自己可见</span> : null}
                          <span className="card-date">更新于 {fmtDay(c.updatedAt)}</span>
                        </div>
                      </div>
                    </button>

                    <div className="card-foot">
                      <div className="card-ops">
                        <button type="button" onClick={() => toggleCloudVisibility(c)}>
                          {c.visibility === 'private' ? '设为公开' : '设为私密'}
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}
      </main>

      <SiteFoot active="mine" />
    </div>
  )
}
