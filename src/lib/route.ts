import { wgs84ToGcj02, type LngLat } from './geo'

type OsrmResponse = {
  routes?: Array<{ geometry?: { coordinates?: [number, number][] } }>
}

function parse(data: OsrmResponse): [number, number][] | null {
  const line = data.routes?.[0]?.geometry?.coordinates
  if (!line?.length) return null
  return line.map(([lng, lat]) => wgs84ToGcj02(lng, lat))
}

/**
 * 路线几何。优先走 Worker 代理（缓存 + 统一 UA，避免 OSRM demo 服务器限流），
 * 代理不可用时回落到浏览器直连。
 */
export async function fetchRoadLine(points: LngLat[]): Promise<[number, number][] | null> {
  if (points.length < 2) return null
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';')

  try {
    const res = await fetch(`/api/route?coords=${encodeURIComponent(coords)}`)
    if (res.ok) {
      const line = parse((await res.json()) as OsrmResponse)
      if (line) return line
    }
  } catch {
    /* 落到下面的直连 */
  }

  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&continue_straight=false`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return parse((await res.json()) as OsrmResponse)
  } catch {
    return null
  }
}
