import type { Journey, Place } from '../types'
import { isSamePlace, splitIntoDays } from './geo'
import { journeyDriveKey } from '../../shared/geo'

export { journeyDriveKey }

export function buildJourney(input: {
  title: string
  startDate: string
  places: Place[]
  startId: string | null
  endId: string | null
  orderedIds: string[]
  splitIds: string[]
  driveKm?: number
  driveMin?: number
  driveKey?: string
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
  const key = journeyDriveKey(ordered, isLoop, splitIds)
  const stored =
    ready &&
    input.driveKey === key &&
    typeof input.driveKm === 'number' &&
    Number.isFinite(input.driveKm) &&
    input.driveKm > 0
  const totalKm = stored ? input.driveKm! : 0
  const totalMin =
    stored && typeof input.driveMin === 'number' && Number.isFinite(input.driveMin)
      ? input.driveMin
      : 0

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
    driveReady: stored,
  }
}
