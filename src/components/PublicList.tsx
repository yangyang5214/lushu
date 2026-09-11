import { useEffect, useState } from 'react'
import { BACKEND_UNAVAILABLE, type PublicBook } from '../lib/api'
import { requireLogin } from '../lib/auth'
import { fmtDay } from '../lib/format'
import { navigateBook } from '../lib/router'
import { copyPublicBook, refreshPublic, usePublic } from '../lib/sync'
import { SiteNav } from './Chrome'
import { PointsPreview } from './RoutePreview'

function PublicCard({ book }: { book: PublicBook }) {
  const [copying, setCopying] = useState(false)
  // 文案与「我的路书」的 routeLabel 完全一致，同一本路书两边显示同样的起终点。
  const label =
    book.days > 0
      ? book.isLoop
        ? `${book.from} 出发 · 环线`
        : `${book.from} → ${book.to}`
      : '未设起点与终点'
  return (
    <li className="card">
      <button type="button" className="card-open" onClick={() => navigateBook(book.id, book.owner)}>
        <div className="card-cover">
          <PointsPreview points={book.points} dayBreaks={book.dayBreaks} days={book.days} />
          <span className="card-days">{book.days > 0 ? `${book.days} 天` : '草稿'}</span>
          {book.isLoop && book.days > 0 ? <span className="card-loop">环线</span> : null}
        </div>
        <div className="card-body">
          <h3>{book.title || '未命名路书'}</h3>
          <p className="card-route">{label}</p>
          <div className="card-meta">
            <span>
              <b>{book.places}</b> 个地点
            </span>
            {book.days > 0 ? (
              <span>
                <b>{book.km.toLocaleString()}</b> 公里
              </span>
            ) : null}
            <span className="card-date">更新于 {fmtDay(book.updatedAt)}</span>
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
          {copying ? '复制中…' : '复制'}
        </button>
      </div>
    </li>
  )
}

/** `/public`：所有公开路书，独立页面。 */
export function PublicList() {
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
              <h2>公开路书</h2>
              <span className="count">{books.length} 本</span>
            </header>

            {books.length > 0 ? (
              <ul className="card-grid">
                {books.map((b) => (
                  <PublicCard key={b.id} book={b} />
                ))}
              </ul>
            ) : (
              <p className={error ? 'empty-note bad' : 'empty-note'}>
                {error
                  ? `${BACKEND_UNAVAILABLE}。`
                  : loaded
                    ? '还没有公开的路书'
                    : '正在加载…'}
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
