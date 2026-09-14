import type { DayPlan, Place } from '../types'
import { gcj02ToWgs84, wgs84ToGcj02 } from '../../shared/coords'
import { pathDistanceKm, type LngLat } from '../../shared/geo'
import { t } from './i18n'

export { gcj02ToWgs84, wgs84ToGcj02 }
// 排点顺序在 shared/geo.ts（球面距离只用于串线 / 切天启发式）。
// 页面上的公里数一律用高德驾车规划，不在这里用直线距离。
export {
  isSamePlace,
  loopOrientation,
  orderRoute,
  LOOP_METERS,
} from '../../shared/geo'
export type { LngLat, LoopDir } from '../../shared/geo'

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

/** 行程清单里两点之间的「xx公里  约x小时」：整数公里，和天数头上的 formatKm 略有不同。 */
export function formatLegLabel(km: number, min: number): string {
  const kmText =
    km < 1
      ? t('unit.meters', { n: Math.round(km * 1000) })
      : t('unit.km', { n: Math.round(km) })
  return `${kmText}  ${formatDuration(min)}`
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

  return ranges.map(([start, end], index) => ({
    index,
    places: route.slice(start, end + 1),
    distanceKm: 0,
    driveMin: 0,
  }))
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
      const loads = next.map((d) => pathDistanceKm(d.places))
      const mean = loads.reduce((a, b) => a + b, 0) / loads.length
      const variance = loads.reduce((a, b) => a + (b - mean) ** 2, 0)
      const score = pathDistanceKm(day.places) - variance
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
