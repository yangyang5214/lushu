import { useMemo } from 'react'
import { dayInk } from '../lib/geo'
import type { Journey, Place } from '../types'

const W = 100
const H = 62
const PAD = 12

type XY = [number, number]

function project(points: Place[]): Map<string, XY> {
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
      <path d={view.base} fill="none" stroke="#1b1712" strokeOpacity="0.1" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
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
          <circle key={d.key} cx={d.x} cy={d.y} r={d.r} fill={d.color} stroke="#f7f0e4" strokeWidth="0.8" />
        ))}
      {view.dots
        .filter((d) => d.edge)
        .map((d) => (
          <circle key={d.key} cx={d.x} cy={d.y} r={d.r} fill={d.color} stroke="#f7f0e4" strokeWidth="1.1" />
        ))}
    </svg>
  )
}
