import { useMemo, useState } from 'react'
import { buildJourney } from '../lib/journey'
import { navigateBook } from '../lib/router'
import type { Book, Journey, Place } from '../types'
import { useLushu } from '../store'
import { RoutePreview } from './RoutePreview'

function cityOf(place: Place | undefined): string {
  if (!place) return ''
  const parts = place.address.split(/[·,，]/).map((s) => s.trim()).filter(Boolean)
  if (parts[0] && ['上海', '北京', '天津', '重庆'].includes(parts[0])) return parts[0]
  return parts[parts.length - 1] || place.name
}

function citiesOf(journey: Journey): string[] {
  const out: string[] = []
  journey.places.forEach((p) => {
    const city = cityOf(p)
    if (city && !out.includes(city)) out.push(city)
  })
  return out
}

function fmtDateRange(startDate: string, days: number): string {
  if (!startDate) return '未定日期'
  const start = new Date(`${startDate}T00:00:00`)
  if (Number.isNaN(start.getTime())) return startDate
  const label = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`
  if (days <= 1) return label(start)
  const end = new Date(start)
  end.setDate(end.getDate() + days - 1)
  return `${label(start)} – ${label(end)}`
}

function routeLabel(journey: Journey): string {
  if (!journey.ready) return '未设起点与终点'
  const from = journey.start?.name ?? ''
  if (journey.isLoop) return `${from} 出发 · 环线`
  const to = journey.end?.name ?? ''
  return `${from} → ${to}`
}

export function RouteList() {
  const books = useLushu((s) => s.books)
  const order = useLushu((s) => s.order)
  const activeId = useLushu((s) => s.activeId)
  const createBook = useLushu((s) => s.createBook)
  const duplicateBook = useLushu((s) => s.duplicateBook)
  const deleteBook = useLushu((s) => s.deleteBook)
  const loadSample = useLushu((s) => s.loadSample)

  const [confirmId, setConfirmId] = useState<string | null>(null)

  const startNew = () => navigateBook(createBook())
  const startSample = () => navigateBook(loadSample())

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

  const shown = useMemo(
    () => [...rows].sort((a, b) => b.book.updatedAt - a.book.updatedAt),
    [rows],
  )

  return (
    <div className="library">
      <header className="lib-top">
        <div className="lib-brand">
          <span className="lib-seal" aria-hidden>
            路书
          </span>
          <div>
            <h1>我的路书</h1>
            <p>先铺整条路，再剪成日子</p>
          </div>
        </div>
      </header>

      <main className="lib-body">
        {rows.length === 0 ? (
          <section className="lib-empty">
            <div className="lib-empty-art" aria-hidden>
              <span className="dot" />
              <span className="line" />
              <span className="dot" />
              <span className="line" />
              <span className="dot" />
            </div>
            <h2>还没有路书</h2>
            <p>
              把想去的点一路搜进来，定好起点终点，再在过夜的地方钉上分割针。
              <br />
              整趟旅程会自己铺成一条线。
            </p>
            <div className="lib-empty-ops">
              <button type="button" className="btn-primary" onClick={startNew}>
                ＋ 新建一本路书
              </button>
              <button type="button" className="btn-ghost" onClick={startSample}>
                载入示例环线
              </button>
            </div>
          </section>
        ) : (
          <ul className="card-grid">
            <li>
              <button type="button" className="card-new" onClick={startNew}>
                <span className="card-new-plus" aria-hidden>
                  ＋
                </span>
                <span>新建路书</span>
              </button>
            </li>

            {shown.map(({ book, journey }) => {
              const cities = citiesOf(journey)
              const dayCount = journey.days.length
              return (
                <li key={book.id} className={book.id === activeId ? 'book-card on' : 'book-card'}>
                  <button type="button" className="card-open" onClick={() => navigateBook(book.id)}>
                    <div className="card-cover">
                      <RoutePreview journey={journey} />
                      <span className="card-days">
                        {dayCount > 0 ? `${dayCount} 天` : '草稿'}
                      </span>
                      {journey.isLoop && journey.ready ? (
                        <span className="card-loop">环线</span>
                      ) : null}
                    </div>
                    <div className="card-body">
                      <h3>{book.title || '未命名路书'}</h3>
                      <p className="card-route">{routeLabel(journey)}</p>
                      <div className="card-meta">
                        <span>
                          <b>{journey.places.length}</b>个地点
                        </span>
                        {journey.ready ? (
                          <span>
                            <b>{Math.round(journey.totalKm).toLocaleString()}</b>公里
                          </span>
                        ) : null}
                      </div>
                      {cities.length ? (
                        <div className="card-cities">
                          {cities.slice(0, 3).map((c) => (
                            <span key={c}>{c}</span>
                          ))}
                          {cities.length > 3 ? <span>+{cities.length - 3}</span> : null}
                        </div>
                      ) : null}
                    </div>
                  </button>

                  <div className="card-foot">
                    <span className="date">{fmtDateRange(book.startDate, dayCount)}</span>
                    <div className="ops">
                      <button type="button" onClick={() => navigateBook(book.id)}>
                        打开
                      </button>
                      <button type="button" onClick={() => duplicateBook(book.id)}>
                        复制
                      </button>
                      {confirmId === book.id ? (
                        <button
                          type="button"
                          className="danger on"
                          onClick={() => {
                            deleteBook(book.id)
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
      </main>
    </div>
  )
}
