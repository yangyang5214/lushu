import { useEffect, useMemo, useState } from 'react'
import { saveVisibility } from '../lib/api'
import { requireLogin, useAuth } from '../lib/auth'
import { fmtDay } from '../lib/format'
import { buildJourney } from '../lib/journey'
import { getMeta, hasToken } from '../lib/keys'
import { navigateBook } from '../lib/router'
import { pullMissingCloudBooks, pushBook, refreshCloud, refreshPublic, removeBook, useCloud } from '../lib/sync'
import { useLushu } from '../store'
import type { Book, Journey, Visibility } from '../types'
import { SiteNav } from './Chrome'
import { RoutePreview } from './RoutePreview'

function routeLabel(journey: Journey): string {
  if (!journey.ready) return '未设起点与终点'
  const from = journey.start?.name ?? ''
  if (journey.isLoop) return `${from} 出发 · 环线`
  const to = journey.end?.name ?? ''
  return `${from} → ${to}`
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
  const cloudLoaded = useCloud((s) => s.loaded)
  const cloudById = useMemo(() => new Map(cloud.map((c) => [c.id, c])), [cloud])
  // 本人的公开短 ID：自己的路书链接用 `/{userId}/{bookId}`。
  const myId = useAuth((s) => s.user?.hashId)

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [publicConfirmId, setPublicConfirmId] = useState<string | null>(null)

  // 每次打开「我的路书」都刷新账号书架，并把云端有、本机缺的路书拉下来。
  useEffect(() => {
    void refreshCloud()
  }, [])

  useEffect(() => {
    if (!cloudLoaded || cloud.length === 0) return
    void pullMissingCloudBooks()
  }, [cloud, cloudLoaded])

  // 新建（含复制）都要先登录；未登录会跳到账户页，登录后接着把动作做完。
  const startNew = () => requireLogin(() => navigateBook(createBook(), useAuth.getState().user?.hashId))

  // 改权限也要登录：写操作靠账号归属或编辑口令授权。
  // 账号书架里的书（含换设备后刚拉下来的）即使没有本机编辑口令也能改可见性。
  const canToggleVisibility = (id: string) => hasToken(id) || cloudById.has(id)

  const applyVisibility = (book: Book, next: Visibility) =>
    requireLogin(() => {
      setVisibility(book.id, next)
      const meta = getMeta(book.id)
      const onServer = cloudById.has(book.id) || meta.pushed !== undefined
      const done = () => {
        void refreshCloud()
        void refreshPublic()
      }
      if (onServer) {
        void saveVisibility(book.id, next).then((ok) => {
          if (ok) done()
        })
        return
      }
      void pushBook(book.id).then(done)
    })

  const makePrivate = (book: Book) => {
    setPublicConfirmId(null)
    applyVisibility(book, 'private')
  }

  const makePublic = (book: Book) => {
    setPublicConfirmId(null)
    applyVisibility(book, 'public')
  }

  const shown = useMemo(() => {
    const cloudAt = new Map(cloud.map((c) => [c.id, c.updatedAt]))
    return order
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
      }))
      .sort((a, b) => {
        const ta = Math.max(a.book.updatedAt, cloudAt.get(a.book.id) ?? 0)
        const tb = Math.max(b.book.updatedAt, cloudAt.get(b.book.id) ?? 0)
        return tb - ta
      })
  }, [books, order, cloud])

  const syncing =
    cloudLoaded && cloud.some((c) => !books[c.id])

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

            {shown.length === 0 ? (
              syncing ? (
                <p className="empty-note">正在同步路书…</p>
              ) : (
                <div className="empty-state">
                  <h3>还没有自己的路书</h3>
                  <p>把想去的点一路搜进来，定好起点终点，再在过夜的地方钉上分割针。</p>
                  <div className="empty-ops">
                    <button type="button" className="btn-primary" onClick={startNew}>
                      新建路书
                    </button>
                  </div>
                </div>
              )
            ) : (
              <ul className="card-grid">
                {shown.map(({ book, journey }) => {
                  const dayCount = journey.days.length
                  const isPrivate = book.visibility === 'private'
                  const canToggle = canToggleVisibility(book.id)
                  const footDate = book.startDate
                    ? fmtDay(book.startDate)
                    : `更新于 ${fmtDay(book.updatedAt)}`
                  return (
                    <li
                      key={book.id}
                      className={
                        book.id === activeId
                          ? deleteConfirmId === book.id || publicConfirmId === book.id
                            ? 'card on confirming'
                            : 'card on'
                          : deleteConfirmId === book.id || publicConfirmId === book.id
                            ? 'card confirming'
                            : 'card'
                      }
                    >
                      <button
                        type="button"
                        className="card-open"
                        onClick={() => navigateBook(book.id, myId)}
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
                            <span className="card-date">{footDate}</span>
                          </div>
                        </div>
                      </button>

                      <div className="card-ops">
                        <button
                          type="button"
                          onClick={() => requireLogin(() => duplicateBook(book.id))}
                        >
                          复制
                        </button>
                        {canToggle ? (
                          publicConfirmId === book.id ? (
                            <>
                              <button
                                type="button"
                                className="on"
                                onClick={() => makePublic(book)}
                              >
                                确认公开
                              </button>
                              <button type="button" onClick={() => setPublicConfirmId(null)}>
                                取消
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                isPrivate ? setPublicConfirmId(book.id) : makePrivate(book)
                              }
                            >
                              {isPrivate ? '设为公开' : '设为私密'}
                            </button>
                          )
                        ) : null}
                        {deleteConfirmId === book.id ? (
                          <>
                            <button
                              type="button"
                              className="danger on"
                              onClick={() => {
                                void removeBook(book.id)
                                setDeleteConfirmId(null)
                              }}
                            >
                              确认删除
                            </button>
                            <button type="button" onClick={() => setDeleteConfirmId(null)}>
                              取消
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="danger"
                            onClick={() => {
                              setPublicConfirmId(null)
                              setDeleteConfirmId(book.id)
                            }}
                          >
                            删除
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
