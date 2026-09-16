import { useEffect, useRef, useState, type ReactNode } from 'react'
import { gcj02ToWgs84, formatKm } from '../lib/geo'
import { useI18n } from '../lib/i18n'
import { fetchPoi, type PoiCard, type PoiQuery } from '../lib/poi'
import { useLushu, useReadonly } from '../store'

/** 经纬度差小于这个数（约 1 米）就当是同一个点：搜索加进来的点与高德 POI 的
 *  坐标可能在小数点后第 5、6 位上有一点差，不能按全等比。 */
const SAME_PLACE_DEG = 1e-5

type Status = 'loading' | 'ready' | 'error'

/** 评分星：一排灰星打底，上面按分数宽度裁一排亮星（半颗也画得出来）。 */
function Stars({ score }: { score: number }) {
  const width = `${(Math.max(0, Math.min(5, score)) / 5) * 100}%`
  return (
    <span className="poi-stars" aria-hidden>
      <span className="poi-stars-base">★★★★★</span>
      <span className="poi-stars-fill" style={{ width }}>
        ★★★★★
      </span>
    </span>
  )
}

/** 一条「标签 → 值」；值太长（比如一周营业时间）就换行。 */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="poi-fact">
      <span className="poi-fact-k">{label}</span>
      <span className="poi-fact-v">{children}</span>
    </div>
  )
}

/**
 * 点击地图任意一点后，右侧弹出的高德地点卡片：评分、照片（多为用户评价图）、
 * 电话、营业时间、地址，以及底部「加入路线 / 不加入」的选择。
 *
 * 数据是 /api/poi 现查的（服务端缓存 1 天），点得越远半径越大；先显示最近的那个，
 * 下面再列出附近其它地点，点一下就能换。「加入路线」把点按 GCJ02 → WGS84 转好再入库，
 * 只读分享（别人的路书）里不出现这个选择。
 */
export function PoiPanel({ query, onClose }: { query: PoiQuery; onClose: () => void }) {
  const { t } = useI18n()
  // 只取当前路书的地点：卡片只需要知道「这一点在不在路线里」。
  const places = useLushu((s) => s.places)
  const readonly = useReadonly()
  const addPlace = useLushu((s) => s.addPlace)
  const selectPlace = useLushu((s) => s.selectPlace)
  const [status, setStatus] = useState<Status>('loading')
  const [pois, setPois] = useState<PoiCard[]>([])
  const [active, setActive] = useState(0)
  /** 本次点击里已经加进路线的 POI（按高德 id 记）。 */
  const [added, setAdded] = useState<Record<string, true>>({})
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setStatus('loading')
    setPois([])
    setActive(0)
    setAdded({})
    fetchPoi(query, ctrl.signal)
      .then((rows) => {
        if (ctrl.signal.aborted) return
        setPois(rows)
        setStatus('ready')
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setStatus('error')
      })
    return () => ctrl.abort()
  }, [query])

  // Esc 关掉卡片（地图本身不吃键盘事件，不会和别的交互打架）。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // 换一个附近地点时回到卡片顶部，别停在上一张的滚动位置。
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
  }, [active])

  const poi = pois[active]
  const score = poi ? Number.parseFloat(poi.rating) : Number.NaN
  const hasScore = Number.isFinite(score) && score > 0
  const cost = poi ? Number.parseFloat(poi.cost) : Number.NaN
  const hasCost = Number.isFinite(cost) && cost > 0
  const hours = poi ? poi.opentimeToday || poi.opentimeWeek : ''
  const thumbs = poi && poi.photos.length > 1 ? poi.photos.slice(1) : []

  /** 这个 POI 是不是已经在路线里：本次刚加的，或坐标已经对得上的。 */
  const inRoute = (item: PoiCard): boolean => {
    if (added[item.id]) return true
    const [lng, lat] = gcj02ToWgs84(item.lng, item.lat)
    return places.some(
      (place) =>
        Math.abs(place.lng - lng) < SAME_PLACE_DEG && Math.abs(place.lat - lat) < SAME_PLACE_DEG,
    )
  }

  /** 加入路线：高德坐标是 GCJ02，路书里一律存 WGS84；同名同坐标的点会被 store 去重。 */
  const addToRoute = (item: PoiCard) => {
    const [lng, lat] = gcj02ToWgs84(item.lng, item.lat)
    const id = addPlace({ name: item.name, address: item.address, lng, lat })
    setAdded((prev) => ({ ...prev, [item.id]: true }))
    selectPlace(id)
  }

  return (
    <aside className="poi-panel" role="dialog" aria-label={t('poi.title')}>
      <header className="poi-head">
        <span className="poi-head-title">{t('poi.title')}</span>
        <button
          type="button"
          className="poi-close"
          onClick={onClose}
          title={t('common.close')}
          aria-label={t('common.close')}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div className="poi-body" ref={bodyRef}>
        {status === 'loading' ? <p className="poi-state">{t('poi.loading')}</p> : null}
        {status === 'error' ? <p className="poi-state">{t('poi.error')}</p> : null}
        {status === 'ready' && !poi ? <p className="poi-state">{t('poi.empty')}</p> : null}

        {status === 'ready' && poi ? (
          <>
            {poi.photos.length ? (
              <div className="poi-hero">
                <img src={poi.photos[0]} alt="" />
                <span className="poi-hero-count">{t('poi.photos', { n: poi.photos.length })}</span>
              </div>
            ) : null}

            <h3 className="poi-name">{poi.name}</h3>

            <div className="poi-score">
              {hasScore ? (
                <>
                  <b className="poi-score-num">{poi.rating}</b>
                  <Stars score={score} />
                  <span className="poi-score-note">{t('poi.ratingNote')}</span>
                </>
              ) : null}
              {hasCost ? <span className="poi-chip">{t('poi.cost', { n: Math.round(cost) })}</span> : null}
              {poi.category ? <span className="poi-chip">{poi.category}</span> : null}
            </div>

            {poi.tags.length ? <p className="poi-tags">{poi.tags.join(' · ')}</p> : null}

            <div className="poi-facts">
              {hours ? (
                <Fact label={t('poi.hours')}>
                  <span title={poi.opentimeWeek || undefined}>{hours}</span>
                </Fact>
              ) : null}
              {poi.tel ? (
                <Fact label={t('poi.tel')}>
                  <a href={`tel:${poi.tel.split(';')[0]}`}>{poi.tel.split(';').join(' / ')}</a>
                </Fact>
              ) : null}
              {poi.address ? <Fact label={t('poi.address')}>{poi.address}</Fact> : null}
              <Fact label={t('poi.distance')}>{formatKm(poi.distance / 1000)}</Fact>
            </div>

            <section className="poi-sec">
              <div className="poi-sec-head">
                <h4>{t('poi.reviews')}</h4>
                <a
                  className="poi-link"
                  href={poi.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {t('poi.openReviews')} ›
                </a>
              </div>
              {thumbs.length ? (
                <div className="poi-photos">
                  {thumbs.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer noopener">
                      <img src={url} alt="" loading="lazy" />
                    </a>
                  ))}
                </div>
              ) : null}
              <p className="poi-note">{t('poi.reviewNote')}</p>
            </section>

            {pois.length > 1 ? (
              <section className="poi-sec">
                <div className="poi-sec-head">
                  <h4>{t('poi.nearby')}</h4>
                </div>
                <ul className="poi-nearby">
                  {pois.map((item, i) =>
                    i === active ? null : (
                      <li key={item.id}>
                        <button type="button" onClick={() => setActive(i)}>
                          <span className="poi-nearby-name">{item.name}</span>
                          <span className="poi-nearby-meta">
                            {formatKm(item.distance / 1000)}
                            {item.rating ? ` · ${item.rating}` : ''}
                          </span>
                        </button>
                      </li>
                    ),
                  )}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
      </div>

      {/* 选择：这一点要不要进路线。只读分享（别人的路书）里没有这个动作。 */}
      {!readonly && status === 'ready' && poi ? (
        <div className="poi-actions">
          {inRoute(poi) ? (
            <>
              <span className="poi-added">{t('poi.added')}</span>
              <button type="button" className="poi-skip" onClick={onClose}>
                {t('common.close')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="poi-add" onClick={() => addToRoute(poi)}>
                {t('poi.add')}
              </button>
              <button type="button" className="poi-skip" onClick={onClose}>
                {t('poi.skip')}
              </button>
            </>
          )}
        </div>
      ) : null}
    </aside>
  )
}
