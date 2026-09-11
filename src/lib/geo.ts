import type { DayPlan, Place } from '../types'

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
  if (km < 1) return `${Math.round(km * 1000)} 米`
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} 公里`
}

export function formatDuration(min: number): string {
  if (min < 60) return `${min} 分钟`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} 小时 ${m} 分` : `${h} 小时`
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

function tourKm(path: Place[], loop: boolean): number {
  const closed = loop && path.length > 1 ? [...path, path[0]] : path
  return pathDistanceKm(closed)
}

function twoOpt(path: Place[], loop: boolean): Place[] {
  if (path.length < 4) return path
  let best = path.slice()
  let improved = true
  const last = path.length - 1
  while (improved) {
    improved = false
    const iMin = 0
    const iMax = loop ? last - 1 : last - 2
    for (let i = iMin; i <= iMax; i += 1) {
      const kMax = loop ? last : last - 1
      for (let k = i + 2; k <= kMax; k += 1) {
        if (!loop && k === last) continue
        const cand = reverseSlice(best, i + 1, k)
        if (tourKm(cand, loop) + 1e-6 < tourKm(best, loop)) {
          best = cand
          improved = true
        }
      }
    }
  }
  return best
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
  if (loop) return twoOpt(nearestNeighbor(start, rest), true)
  const middle = nearestNeighbor(start, rest).slice(1)
  return twoOpt([start, ...middle, end], false)
}

export function insertNearest(path: Place[], place: Place, loop: boolean): Place[] {
  if (path.length === 0) return [place]
  if (path.length === 1) return loop ? [path[0], place] : [path[0], place]
  let bestI = 1
  let bestCost = Infinity
  const n = path.length
  const last = loop ? n : n - 1
  for (let i = 0; i < last; i += 1) {
    const a = path[i]
    const b = path[(i + 1) % n]
    const cost = haversineKm(a, place) + haversineKm(place, b) - haversineKm(a, b)
    if (cost < bestCost) {
      bestCost = cost
      bestI = i + 1
    }
  }
  const next = path.slice()
  next.splice(bestI, 0, place)
  return next
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

const PI = Math.PI
const A = 6378245
const EE = 0.00669342162296594323

function outOfChina(lng: number, lat: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(lng: number, lat: number): number {
  let r = -100 + 2 * lng + 3 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng))
  r += ((20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2) / 3
  r += ((20 * Math.sin(lat * PI) + 40 * Math.sin((lat / 3) * PI)) * 2) / 3
  r += ((160 * Math.sin((lat / 12) * PI) + 320 * Math.sin((lat * PI) / 30)) * 2) / 3
  return r
}

function transformLng(lng: number, lat: number): number {
  let r = 300 + lng + 2 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng))
  r += ((20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2) / 3
  r += ((20 * Math.sin(lng * PI) + 40 * Math.sin((lng / 3) * PI)) * 2) / 3
  r += ((150 * Math.sin((lng / 12) * PI) + 300 * Math.sin((lng / 30) * PI)) * 2) / 3
  return r
}

export function wgs84ToGcj02(lng: number, lat: number): [number, number] {
  if (outOfChina(lng, lat)) return [lng, lat]
  let dLat = transformLat(lng - 105, lat - 35)
  let dLng = transformLng(lng - 105, lat - 35)
  const rad = (lat / 180) * PI
  let magic = Math.sin(rad)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI)
  dLng = (dLng * 180) / ((A / sqrtMagic) * Math.cos(rad) * PI)
  return [lng + dLng, lat + dLat]
}

export function toGcj(place: LngLat): [number, number] {
  return wgs84ToGcj02(place.lng, place.lat)
}

export function gcj02ToWgs84(lng: number, lat: number): [number, number] {
  const [glng, glat] = wgs84ToGcj02(lng, lat)
  return [lng * 2 - glng, lat * 2 - glat]
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
