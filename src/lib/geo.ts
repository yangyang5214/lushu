import type { DayPlan, Place } from '../types'
import { gcj02ToWgs84, wgs84ToGcj02 } from '../../shared/coords'
import { pathDistanceKm, type LngLat } from '../../shared/geo'
import { t } from './i18n'

export { gcj02ToWgs84, wgs84ToGcj02 }
// 距离与路线顺序都在 shared/geo.ts：Pages Function 算公开列表预览用的是同一份，
// 地点从哪来（手输 / 扩展导入 / AI 生成）都归到同一个结果。
export { haversineKm, isSamePlace, pathDistanceKm, orderRoute, LOOP_METERS } from '../../shared/geo'
export type { LngLat } from '../../shared/geo'

const AVG_KMH = 68

export function driveMinutes(km: number): number {
  return Math.round((km / AVG_KMH) * 60)
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
