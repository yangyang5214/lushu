import { useEffect, useState } from 'react'
import type { PublicBook } from '../lib/api'
import { requireLogin } from '../lib/auth'
import { fmtDay } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { navigateBook } from '../lib/router'
import { copyPublicBook, refreshPublic, usePublic } from '../lib/sync'
import { SiteNav } from './Chrome'
import { PointsPreview } from './RoutePreview'

function PublicCard({ book }: { book: PublicBook }) {
  const { t } = useI18n()
  const [copying, setCopying] = useState(false)
  // 文案与「我的路书」的 routeLabel 完全一致，同一本路书两边显示同样的起终点。
  const label =
    book.days > 0
      ? book.isLoop
        ? t('card.loopFrom', { from: book.from })
        : t('card.fromTo', { from: book.from, to: book.to })
      : t('card.noEnds')
  return (
    <li className="card">
      <button type="button" className="card-open" onClick={() => navigateBook(book.id, book.owner)}>
        <div className="card-cover">
          <PointsPreview points={book.points} dayBreaks={book.dayBreaks} days={book.days} />
          <span className="card-days">
            {book.days > 0 ? t('card.days', { n: book.days }) : t('card.draft')}
          </span>
          {book.isLoop && book.days > 0 ? <span className="card-loop">{t('card.loop')}</span> : null}
        </div>
        <div className="card-body">
          <h3>{book.title || t('common.untitled')}</h3>
          <p className="card-route">{label}</p>
          <div className="card-meta">
            <span>
              <b>{book.places}</b> {t('card.placesUnit')}
            </span>
            {book.days > 0 ? (
              <span>
                <b>{book.km.toLocaleString()}</b> {t('card.kmUnit')}
              </span>
            ) : null}
            <span className="card-date">
              {t('card.updatedAt', { date: fmtDay(book.updatedAt) })}
            </span>
          </div>
        </div>
      </button>

      <div className="card-ops">
        <button
          type="button"
          disabled={copying}
          onClick={() =>
            requireLogin(() => {
              setCopying(true)
              void copyPublicBook(book.id).finally(() => setCopying(false))
            })
          }
        >
          {copying ? t('card.copying') : t('card.copy')}
        </button>
      </div>
    </li>
  )
}

/** `/public`：所有公开路书，独立页面。 */
export function PublicList() {
  const { t } = useI18n()
  const books = usePublic((s) => s.books)
  const loaded = usePublic((s) => s.loaded)
  const error = usePublic((s) => s.error)

  // 每次打开这一页都重新拉一次：否则刚在「我的路书」里改过的公里 / 路线要等刷新才更新。
  useEffect(() => {
    void refreshPublic()
  }, [])

  return (
    <div className="home">
      <SiteNav active="public" />

      <main>
        <section className="shelf page-first">
          <div className="shell">
            <header className="shelf-head">
              <h2>{t('public.heading')}</h2>
              <span className="count">{t('public.count', { n: books.length })}</span>
            </header>

            {books.length > 0 ? (
              <ul className="card-grid">
                {books.map((b) => (
                  <PublicCard key={b.id} book={b} />
                ))}
              </ul>
            ) : (
              <p className={error ? 'empty-note bad' : 'empty-note'}>
                {error ? t('common.backendUnavailable') : loaded ? t('public.empty') : t('common.loading')}
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
