import { wgs84ToGcj02, type LngLat } from './geo'

export async function fetchRoadLine(points: LngLat[]): Promise<[number, number][] | null> {
  if (points.length < 2) return null
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';')
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&continue_straight=false`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = (await res.json()) as {
      routes?: Array<{ geometry?: { coordinates?: [number, number][] } }>
    }
    const line = data.routes?.[0]?.geometry?.coordinates
    if (!line?.length) return null
    return line.map(([lng, lat]) => wgs84ToGcj02(lng, lat))
  } catch {
    return null
  }
}
