import { useEffect, useMemo, useState } from 'react'
import { saveVisibility } from '../lib/api'
import { requireLogin, useAuth } from '../lib/auth'
import { fmtDay } from '../lib/format'
import { t, useI18n } from '../lib/i18n'
import { buildJourney } from '../lib/journey'
import { getMeta, hasToken } from '../lib/keys'
import { navigateBook } from '../lib/router'
import { pullMissingCloudBooks, pushBook, refreshCloud, refreshPublic, removeBook, useCloud } from '../lib/sync'
import { useLushu } from '../store'
import type { Book, Journey, Visibility } from '../types'
import { SiteNav } from './Chrome'
import { ConfirmDialog } from './ConfirmDialog'
import { RoutePreview } from './RoutePreview'

function routeLabel(journey: Journey): string {
  if (!journey.ready) return t('card.noEnds')
  const from = journey.start?.name ?? ''
  if (journey.isLoop) return t('card.loopFrom', { from })
  const to = journey.end?.name ?? ''
  return t('card.fromTo', { from, to })
}

/** `/list`：我的路书，独立页面。 */
export function MinePage() {
  const { t } = useI18n()
  const books = useLushu((s) => s.books)
  const order = useLushu((s) => s.order)
  const activeId = useLushu((s) => s.activeId)
  const createBook = useLushu((s) => s.createBook)
  const duplicateBook = useLushu((s) => s.duplicateBook)
  const setVisibility = useLushu((s) => s.setVisibility)
  const cloud = useCloud((s) => s.books)
  const cloudLoaded = useCloud((s) => s.loaded)
  const cloudById = useMemo(() => new Map(cloud.map((c) => [c.id, c])), [cloud])
  // 本人的公开短 ID：自己的路书链接用 `/d/{userId}/{bookId}`。
  const myId = useAuth((s) => s.user?.hashId)

  // 待删除的路书：不为空时弹出二次确认浮层。
  const [deleteTarget, setDeleteTarget] = useState<Book | null>(null)

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

  // 这次删除会不会连云端一起清掉，决定确认框里要不要提「分享出去的链接会失效」。
  // 判断口径与 removeBook 里的一致。
  const purgesCloud = (id: string) => {
    const meta = getMeta(id)
    return cloudById.has(id) || meta.pushed !== undefined || (Boolean(meta.token) && !meta.remote)
  }

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

  const makePrivate = (book: Book) => applyVisibility(book, 'private')

  const makePublic = (book: Book) => applyVisibility(book, 'public')

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
          driveKm: book.driveKm,
          driveMin: book.driveMin,
          driveKey: book.driveKey,
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
            {t('mine.newBook')}
          </button>
        }
      />

      <main>
        <section className="shelf page-first">
          <div className="shell">
            <header className="shelf-head">
              <h2>{t('mine.heading')}</h2>
            </header>

            {shown.length === 0 ? (
              syncing ? (
                <p className="empty-note">{t('mine.syncing')}</p>
              ) : (
                <div className="empty-state">
                  <h3>{t('mine.empty')}</h3>
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
                    : t('card.updatedAt', { date: fmtDay(book.updatedAt) })
                  return (
                    <li key={book.id} className={book.id === activeId ? 'card on' : 'card'}>
                      <button
                        type="button"
                        className="card-open"
                        onClick={() => navigateBook(book.id, myId)}
                      >
                        <div className="card-cover">
                          <RoutePreview journey={journey} />
                          <span className="card-days">
                            {dayCount > 0 ? t('card.days', { n: dayCount }) : t('card.draft')}
                          </span>
                          {journey.isLoop && journey.ready ? (
                            <span className="card-loop">{t('card.loop')}</span>
                          ) : null}
                          {isPrivate ? <span className="card-vis">{t('card.private')}</span> : null}
                        </div>
                        <div className="card-body">
                          <h3>{book.title || t('common.untitled')}</h3>
                          <p className="card-route">{routeLabel(journey)}</p>
                          <div className="card-meta">
                            <span>
                              <b>{journey.places.length}</b> {t('card.placesUnit')}
                            </span>
                            {journey.ready && journey.totalKm > 0 ? (
                              <span>
                                <b>{Math.round(journey.totalKm).toLocaleString()}</b>{' '}
                                {t('card.kmUnit')}
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
                          {t('card.copy')}
                        </button>
                        {canToggle ? (
                          <button
                            type="button"
                            onClick={() => (isPrivate ? makePublic(book) : makePrivate(book))}
                          >
                            {isPrivate ? t('mine.makePublic') : t('mine.makePrivate')}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="danger"
                          aria-label={t('mine.deleteAria', {
                            title: book.title || t('common.untitled'),
                          })}
                          onClick={() => setDeleteTarget(book)}
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>
      </main>

      {deleteTarget ? (
        <ConfirmDialog
          title={t('mine.deleteTitle')}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          tone="danger"
          onConfirm={() => {
            const id = deleteTarget.id
            // 本地立即消失，云端删除在后台继续；删不掉的话下次刷新书架会再出现。
            void removeBook(id)
            setDeleteTarget(null)
          }}
          onCancel={() => setDeleteTarget(null)}
          body={
            <>
              <p className="confirm-ask">
                {t('mine.deleteAsk', {
                  title: deleteTarget.title || t('common.untitled'),
                })}
              </p>
              <p>
                {purgesCloud(deleteTarget.id) ? t('mine.deleteWarnCloud') : t('mine.deleteWarnLocal')}
              </p>
            </>
          }
        />
      ) : null}
    </div>
  )
}
