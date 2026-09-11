import type { Journey, Place } from '../types'
import { isSamePlace, pathDistanceKm, splitIntoDays } from './geo'

export function buildJourney(input: {
  title: string
  startDate: string
  places: Place[]
  startId: string | null
  endId: string | null
  orderedIds: string[]
  splitIds: string[]
}): Journey {
  const { title, startDate, places, startId, endId, orderedIds, splitIds } = input
  const start = places.find((p) => p.id === startId) ?? null
  const end = places.find((p) => p.id === endId) ?? null
  const isLoop = !!(start && end && (start.id === end.id || isSamePlace(start, end)))
  const ready = !!(start && end)
  const byId = new Map(places.map((p) => [p.id, p]))
  const ordered = (ready ? orderedIds : places.map((p) => p.id))
    .map((id) => byId.get(id))
    .filter((p): p is Place => Boolean(p))

  const days = ready ? splitIntoDays(ordered, splitIds, isLoop) : []
  const route = isLoop && ordered.length > 1 ? [...ordered, ordered[0]] : ordered
  const totalKm = ready ? pathDistanceKm(route) : 0
  const totalMin = days.reduce((sum, d) => sum + d.driveMin, 0)

  return {
    title,
    startDate,
    places,
    start,
    end,
    ordered,
    isLoop,
    ready,
    splitIds,
    days,
    totalKm,
    totalMin,
  }
}
