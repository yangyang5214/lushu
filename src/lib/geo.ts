import type { DayPlan, Place } from '../types'
import { gcj02ToWgs84, wgs84ToGcj02 } from '../../shared/coords'
import { t } from './i18n'

export { gcj02ToWgs84, wgs84ToGcj02 }

export type LngLat = { lng: number; lat: number }

const EARTH_KM = 6371
const AVG_KMH = 68
const LOOP_METERS = 280

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

export function haversineKm(a: LngLat, b: LngLat): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)))
}

export function pathDistanceKm(path: LngLat[]): number {
  let sum = 0
  for (let i = 0; i < path.length - 1; i += 1) {
    sum += haversineKm(path[i], path[i + 1])
  }
  return sum
}

export function driveMinutes(km: number): number {
  return Math.round((km / AVG_KMH) * 60)
}

export function isSamePlace(a: LngLat, b: LngLat, meters = LOOP_METERS): boolean {
  return haversineKm(a, b) * 1000 <= meters
}

export function formatKm(km: number): string {
  if (km < 1) return t('unit.meters', { n: Math.round(km * 1000) })
  return t('unit.km', { n: km < 10 ? km.toFixed(1) : Math.round(km) })
}

export function formatDuration(min: number): string {
  if (min < 60) return t('eta.minutes', { n: min })
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? t('eta.hoursMinutes', { h, m }) : t('eta.hours', { n: h })
}

function nearestNeighbor(start: Place, rest: Place[]): Place[] {
  const remaining = [...rest]
  const path: Place[] = [start]
  while (remaining.length > 0) {
    const cur = path[path.length - 1]
    let best = 0
    let bestD = Infinity
    remaining.forEach((place, i) => {
      const d = haversineKm(cur, place)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    path.push(remaining.splice(best, 1)[0])
  }
  return path
}

function reverseSlice(path: Place[], from: number, to: number): Place[] {
  const next = path.slice()
  let i = from
  let j = to
  while (i < j) {
    const tmp = next[i]
    next[i] = next[j]
    next[j] = tmp
    i += 1
    j -= 1
  }
  return next
}

/** 环线在末尾补一条回到起点的边；非环线的首尾都钉死。 */
function edgeKm(path: Place[], loop: boolean, i: number): number {
  const j = i + 1
  if (j < path.length) return haversineKm(path[i], path[j])
  return loop ? haversineKm(path[i], path[0]) : 0
}

/**
 * 2-opt：反转一段。只比较被换掉的两条边和补上的两条边，单步 O(1)、
 * 整趟 O(n²)。旧写法每试一个候选都重算整条路，是 O(n³)。
 */
function twoOptPass(path: Place[], loop: boolean): { path: Place[]; improved: boolean } {
  const n = path.length
  if (n < 4) return { path, improved: false }
  const iMax = loop ? n - 2 : n - 3
  const kMax = loop ? n - 1 : n - 2
  let next = path
  let improved = false
  for (let i = 0; i <= iMax; i += 1) {
    for (let k = i + 2; k <= kMax; k += 1) {
      const a = next[i]
      const b = next[i + 1]
      const c = next[k]
      const d = next[(k + 1) % n]
      const delta =
        haversineKm(a, c) + haversineKm(b, d) - edgeKm(next, loop, i) - edgeKm(next, loop, k)
      if (delta < -1e-6) {
        next = reverseSlice(next, i + 1, k)
        improved = true
      }
    }
  }
  return { path: next, improved }
}

/**
 * or-opt：把连续 1~3 个点整段搬到另一条边上。2-opt 只会反转，解不开
 * 「一整段该往前挪」这种弯（比如福州该夹在雁荡山与平潭岛之间）。
 */
function orOptPass(path: Place[], loop: boolean): { path: Place[]; improved: boolean } {
  const n = path.length
  if (n < 4) return { path, improved: false }
  const lastStart = loop ? n - 1 : n - 2 // 非环线时最后一个点钉死，不能搬
  const cMax = loop ? n - 1 : n - 2
  let next = path
  let improved = false
  for (let len = 1; len <= 3; len += 1) {
    for (let a = 1; a + len - 1 <= lastStart; a += 1) {
      const b = a + len - 1
      const prev = a - 1
      const after = (b + 1) % n
      for (let c = 0; c <= cMax; c += 1) {
        if (c === prev || (c >= a && c <= b)) continue
        const nc = (c + 1) % n
        const delta =
          haversineKm(next[prev], next[after]) +
          haversineKm(next[c], next[a]) +
          haversineKm(next[b], next[nc]) -
          edgeKm(next, loop, prev) -
          edgeKm(next, loop, b) -
          edgeKm(next, loop, c)
        if (delta >= -1e-6) continue
        const seg = next.slice(a, b + 1)
        const rest = [...next.slice(0, a), ...next.slice(b + 1)]
        const at = c < a ? c + 1 : c + 1 - len
        next = [...rest.slice(0, at), ...seg, ...rest.slice(at)]
        improved = true
        break // 这一段已经搬走，本轮 a 指向的内容变了，换下一组
      }
    }
  }
  return { path: next, improved }
}

/** 2-opt 与 or-opt 交替跑到两者都不再改善。 */
function improve(path: Place[], loop: boolean): Place[] {
  let next = path
  for (let round = 0; round < 50; round += 1) {
    const two = twoOptPass(next, loop)
    const or = orOptPass(two.path, loop)
    next = or.path
    if (!two.improved && !or.improved) break
  }
  return next
}

export function orderRoute(places: Place[], startId: string, endId: string): Place[] {
  const start = places.find((p) => p.id === startId)
  const end = places.find((p) => p.id === endId)
  if (!start || !end) return places
  const loop = isSamePlace(start, end) || start.id === end.id
  const rest = places.filter((p) => {
    if (p.id === start.id) return false
    if (!loop && p.id === end.id) return false
    return true
  })
  if (loop) return improve(nearestNeighbor(start, rest), true)
  const middle = nearestNeighbor(start, rest).slice(1)
  return improve([start, ...middle, end], false)
}

export function validSplitIndexes(ordered: Place[], loop: boolean): number[] {
  if (ordered.length < 2) return []
  const max = loop ? ordered.length - 1 : ordered.length - 2
  const out: number[] = []
  for (let i = 1; i <= max; i += 1) out.push(i)
  return out
}

export function splitIntoDays(
  ordered: Place[],
  splitIds: string[],
  loop: boolean,
): DayPlan[] {
  if (ordered.length === 0) return []
  const route = loop ? [...ordered, ordered[0]] : ordered
  const splitSet = new Set(splitIds)
  const cuts: number[] = []
  ordered.forEach((place, i) => {
    if (i === 0) return
    if (splitSet.has(place.id)) cuts.push(i)
  })
  cuts.sort((a, b) => a - b)

  const ranges: Array<[number, number]> = []
  let from = 0
  cuts.forEach((cut) => {
    ranges.push([from, cut])
    from = cut
  })
  ranges.push([from, route.length - 1])

  return ranges.map(([start, end], index) => {
    const places = route.slice(start, end + 1)
    const distanceKm = pathDistanceKm(places)
    return {
      index,
      places,
      distanceKm,
      driveMin: driveMinutes(distanceKm),
    }
  })
}

export function suggestSplitId(ordered: Place[], splitIds: string[], loop: boolean): string | null {
  const days = splitIntoDays(ordered, splitIds, loop)
  const taken = new Set(splitIds)
  const valid = new Set(validSplitIndexes(ordered, loop))
  let bestId: string | null = null
  let bestScore = -Infinity

  days.forEach((day) => {
    if (day.places.length < 3) return
    const inner = day.places.slice(1, day.places.length - 1)
    inner.forEach((place) => {
      const idx = ordered.findIndex((p) => p.id === place.id)
      if (!valid.has(idx) || taken.has(place.id)) return
      const next = splitIntoDays(ordered, [...splitIds, place.id], loop)
      const loads = next.map((d) => d.distanceKm)
      const mean = loads.reduce((a, b) => a + b, 0) / loads.length
      const variance = loads.reduce((a, b) => a + (b - mean) ** 2, 0)
      const score = day.distanceKm - variance
      if (score > bestScore) {
        bestScore = score
        bestId = place.id
      }
    })
  })

  if (bestId) return bestId
  const fallback = validSplitIndexes(ordered, loop)
    .map((i) => ordered[i])
    .find((p) => !taken.has(p.id))
  return fallback?.id ?? null
}

export function toGcj(place: LngLat): [number, number] {
  return wgs84ToGcj02(place.lng, place.lat)
}

export const DAY_INKS = [
  '#ff4d4f',
  '#1677ff',
  '#faad14',
  '#13c2c2',
  '#722ed1',
  '#52c41a',
  '#eb2f96',
  '#fa8c16',
  '#2f54eb',
  '#a0d911',
]

export function dayInk(index: number): string {
  return DAY_INKS[index % DAY_INKS.length]
}
