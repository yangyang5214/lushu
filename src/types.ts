export type Place = {
  id: string
  name: string
  address: string
  lng: number
  lat: number
}

export type Book = {
  id: string
  title: string
  startDate: string
  places: Place[]
  startId: string | null
  endId: string | null
  orderedIds: string[]
  splitIds: string[]
  createdAt: number
  updatedAt: number
}

export type SearchHit = {
  name: string
  address: string
  lng: number
  lat: number
}

export type DayPlan = {
  index: number
  places: Place[]
  distanceKm: number
  driveMin: number
}

export type Journey = {
  title: string
  startDate: string
  places: Place[]
  start: Place | null
  end: Place | null
  ordered: Place[]
  isLoop: boolean
  ready: boolean
  splitIds: string[]
  days: DayPlan[]
  totalKm: number
  totalMin: number
}
