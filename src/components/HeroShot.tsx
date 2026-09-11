import { useMemo } from 'react'
import { buildJourney } from '../lib/journey'
import { dayInk } from '../lib/geo'
import { SAMPLE_DATE, SAMPLE_PLACES, SAMPLE_TITLE } from '../lib/sample'

const W = 1000
const H = 380
const PAD = 64

/** 示例书里的分割针：第 1/2/3 天结束在温岭、平潭、龙岩。 */
const SAMPLE_SPLITS = ['s4', 's8', 's11']

type XY = { x: number; y: number }

/** 首页首屏那张「应用截图」：把示例环线按天画出来。 */
export function HeroShot() {
  const view = useMemo(() => {
    const journey = buildJourney({
      title: SAMPLE_TITLE,
      startDate: SAMPLE_DATE,
      places: SAMPLE_PLACES,
      startId: SAMPLE_PLACES[0].id,
      endId: SAMPLE_PLACES[0].id,
      orderedIds: SAMPLE_PLACES.map((p) => p.id),
      splitIds: SAMPLE_SPLITS,
    })

    const lngs = SAMPLE_PLACES.map((p) => p.lng)
    const lats = SAMPLE_PLACES.map((p) => p.lat)
    const minLng = Math.min(...lngs)
    const maxLng = Math.max(...lngs)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const scale = Math.min(
      (W - 2 * PAD) / Math.max(maxLng - minLng, 1e-4),
      (H - 2 * PAD) / Math.max(maxLat - minLat, 1e-4),
    )
    const cx = (minLng + maxLng) / 2
    const cy = (minLat + maxLat) / 2
    const at = (lng: number, lat: number): XY => ({
      x: W / 2 + (lng - cx) * scale,
      y: H / 2 - (lat - cy) * scale,
    })

    const line = (points: { lng: number; lat: number }[], close: boolean) => {
      const list = close ? [...points, points[0]] : points
      return list
        .map((p, i) => {
          const { x, y } = at(p.lng, p.lat)
          return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
        })
        .join(' ')
    }

    const base = line(journey.ordered, journey.isLoop)
    const days = journey.days.map((day, i) => ({
      index: i,
      color: dayInk(i),
      d: line(day.places, false),
      km: Math.round(day.distanceKm),
    }))
    const start = at(SAMPLE_PLACES[0].lng, SAMPLE_PLACES[0].lat)
    const dots = journey.ordered.map((p) => ({ id: p.id, ...at(p.lng, p.lat) }))

    return { journey, base, days, dots, start }
  }, [])

  const { journey } = view

  return (
    <div className="hero-shot">
      <div className="hero-shot-bar">
        <strong>{SAMPLE_TITLE}</strong>
        <span>环线 · 上海出发</span>
        <span className="spacer" />
        <span>
          {journey.places.length} 站 · {journey.days.length} 天 ·{' '}
          {Math.round(journey.totalKm).toLocaleString()} 公里
        </span>
      </div>

      <div className="hero-shot-map">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="示例环线按天分段">
          <path className="shot-base" d={view.base} fill="none" />
          {view.days.map((day) => (
            <path
              key={day.index}
              d={day.d}
              fill="none"
              stroke={day.color}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {view.dots.map((dot) => (
            <circle key={dot.id} className="shot-dot" cx={dot.x} cy={dot.y} r="3.6" />
          ))}
          <circle className="shot-start" cx={view.start.x} cy={view.start.y} r="6.5" />
          <text
            className="shot-label"
            x={view.start.x}
            y={view.start.y - 16}
            textAnchor="middle"
          >
            川沙地铁站
          </text>
        </svg>
      </div>

      <div className="hero-shot-days">
        {view.days.map((day) => (
          <span key={day.index} className="day-chip">
            <i style={{ background: day.color }} />
            第{day.index + 1}天 · {day.km} 公里
          </span>
        ))}
      </div>
    </div>
  )
}
