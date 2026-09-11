import { useMemo } from 'react'
import { dayInk } from '../lib/geo'
import type { Journey } from '../types'

const W = 100
const H = 62
const PAD = 12

type XY = [number, number]
type Geo = { id: string; lng: number; lat: number }

function project(points: Geo[]): Map<string, XY> {
  const lngs = points.map((p) => p.lng)
  const lats = points.map((p) => p.lat)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const spanLng = Math.max(maxLng - minLng, 1e-4)
  const spanLat = Math.max(maxLat - minLat, 1e-4)
  const scale = Math.min((W - 2 * PAD) / spanLng, (H - 2 * PAD) / spanLat)
  const cx = (minLng + maxLng) / 2
  const cy = (minLat + maxLat) / 2
  const map = new Map<string, XY>()
  points.forEach((p) => {
    map.set(p.id, [W / 2 + (p.lng - cx) * scale, H / 2 - (p.lat - cy) * scale])
  })
  return map
}

function toPath(xys: XY[]): string {
  if (xys.length === 0) return ''
  if (xys.length === 1) {
    const [x, y] = xys[0]
    return `M ${x} ${y} l 0.01 0`
  }
  return xys.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')
}

function dayIndexOf(id: string, journey: Journey): number {
  return journey.days.findIndex((d, di) =>
    d.places.some((p, pi) => p.id === id && !(di > 0 && pi === 0)),
  )
}

/**
 * 公开路书卡片用：服务端只给有序坐标 + 每天起点下标，没有完整的 Journey。
 * 渲染方式与 RoutePreview 保持一致（底色路径 + 按天分段着色 + 首尾大点），
 * 这样同一本路书在「我的路书」和「公开路书」里长得一样。
 */
export function PointsPreview({
  points,
  dayBreaks,
  days = 0,
}: {
  points: [number, number][]
  dayBreaks?: number[]
  days?: number
}) {
  const view = useMemo(() => {
    if (points.length === 0) return null
    const geo: Geo[] = points.map(([lng, lat], i) => ({ id: String(i), lng, lat }))
    const map = project(geo)
    const xy = (i: number): XY => map.get(String(i)) ?? [W / 2, H / 2]
    const last = geo.length - 1

    const cuts = (dayBreaks ?? []).filter((b) => b >= 0 && b <= last)
    if (cuts.length === 0 || cuts[0] !== 0) cuts.unshift(0)

    const base = toPath(points.map((_, i) => xy(i)))
    const dayIndex = (i: number): number => {
      let d = 0
      cuts.forEach((cut, k) => {
        if (i >= cut) d = k
      })
      // 每天的分割点同时是上一天的终点，颜色与 RoutePreview 一致算作上一天。
      return i !== 0 && cuts.includes(i) ? Math.max(d - 1, 0) : d
    }
    const ink = (i: number): string => (days > 0 ? dayInk(dayIndex(i)) : '#8e2414')

    const segments =
      days > 0
        ? cuts.map((from, k) => {
            const to = k + 1 < cuts.length ? cuts[k + 1] : last
            const xs: XY[] = []
            for (let i = from; i <= to; i += 1) xs.push(xy(i))
            return { key: `seg-${k}`, color: dayInk(k), d: toPath(xs) }
          })
        : [{ key: 'seg-0', color: '#8e2414', d: base }]

    const dots = geo.map((p, i) => {
      const [x, y] = xy(i)
      const edge = i === 0 || i === last
      return { key: p.id, x, y, r: edge ? 2.7 : 1.5, edge, color: ink(i) }
    })

    return { base, segments, dots }
  }, [points, dayBreaks, days])

  if (!view) {
    return (
      <div className="cover-empty" aria-hidden>
        <span>还没有地点</span>
      </div>
    )
  }

  return (
    <svg
      className="route-preview"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <path d={view.base} fill="none" stroke="#16161e" strokeOpacity="0.1" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      {view.segments.map((seg) => (
        <path
          key={seg.key}
          d={seg.d}
          fill="none"
          stroke={seg.color}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {view.dots
        .filter((d) => !d.edge)
        .map((d) => (
          <circle key={d.key} cx={d.x} cy={d.y} r={d.r} fill={d.color} stroke="#ffffff" strokeWidth="0.8" />
        ))}
      {view.dots
        .filter((d) => d.edge)
        .map((d) => (
          <circle key={d.key} cx={d.x} cy={d.y} r={d.r} fill={d.color} stroke="#ffffff" strokeWidth="1.1" />
        ))}
    </svg>
  )
}

export function RoutePreview({ journey }: { journey: Journey }) {
  const view = useMemo(() => {
    const all = journey.ready ? journey.ordered : journey.places
    if (all.length === 0) return null
    const map = project(all)
    const seqs =
      journey.ready && journey.days.length
        ? journey.days.map((d, i) => ({ color: dayInk(i), places: d.places }))
        : [{ color: '#8e2414', places: all }]

    const segments = seqs
      .map((seq) => ({
        color: seq.color,
        d: toPath(seq.places.map((p) => map.get(p.id)).filter((v): v is XY => Boolean(v))),
      }))
      .filter((s) => s.d)

    const base = toPath(all.map((p) => map.get(p.id)).filter((v): v is XY => Boolean(v)))
    const firstId = all[0].id
    const lastId = all[all.length - 1].id

    const dots = all.map((p, i) => {
      const [x, y] = map.get(p.id) ?? [W / 2, H / 2]
      const di = dayIndexOf(p.id, journey)
      const ink = journey.ready && journey.days.length ? dayInk(di >= 0 ? di : 0) : '#8e2414'
      const edge = i === 0 || i === all.length - 1
      return {
        key: `${p.id}-${i}`,
        x,
        y,
        r: edge ? 2.7 : 1.5,
        color: ink,
        edge,
        isStart: p.id === firstId && i === 0,
        isEnd: i === all.length - 1 && lastId !== firstId,
      }
    })

    return { segments, base, dots }
  }, [journey])

  if (!view) {
    return (
      <div className="cover-empty" aria-hidden>
        <span>还没有地点</span>
      </div>
    )
  }

  return (
    <svg
      className="route-preview"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <path d={view.base} fill="none" stroke="#16161e" strokeOpacity="0.1" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      {view.segments.map((seg, i) => (
        <path
          key={i}
          d={seg.d}
          fill="none"
          stroke={seg.color}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {view.dots
        .filter((d) => !d.edge)
        .map((d) => (
          <circle key={d.key} cx={d.x} cy={d.y} r={d.r} fill={d.color} stroke="#ffffff" strokeWidth="0.8" />
        ))}
      {view.dots
        .filter((d) => d.edge)
        .map((d) => (
          <circle key={d.key} cx={d.x} cy={d.y} r={d.r} fill={d.color} stroke="#ffffff" strokeWidth="1.1" />
        ))}
    </svg>
  )
}
