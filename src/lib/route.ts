import { wgs84ToGcj02, type LngLat } from './geo'

/** Worker `/api/route` 的统一返回：坐标已经是 GCJ02，直接贴合高德底图。 */
type NormalizedRoute = { source?: string; line?: [number, number][] }

type OsrmResponse = {
  routes?: Array<{ geometry?: { coordinates?: [number, number][] } }>
}

type AmapResponse = {
  route?: { paths?: Array<{ steps?: Array<{ polyline?: string }> }> }
}

/** 统一返回：线路已经是 GCJ02，原样交给 Leaflet。 */
function fromNormalized(data: NormalizedRoute): [number, number][] | null {
  const line = data?.line
  if (!Array.isArray(line)) return null
  const clean = line.filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
  return clean.length >= 2 ? clean : null
}

/** OSRM 原始响应：WGS84 转 GCJ02。 */
function fromOsrm(data: OsrmResponse): [number, number][] | null {
  const line = data.routes?.[0]?.geometry?.coordinates
  if (!line?.length) return null
  return line.map(([lng, lat]) => wgs84ToGcj02(lng, lat))
}

/** 高德原始响应（本地 Vite 代理直连时会出现）：polyline 本来就是 GCJ02。 */
function fromAmap(data: AmapResponse): [number, number][] | null {
  const steps = data.route?.paths?.[0]?.steps ?? []
  const line: [number, number][] = []
  for (const step of steps) {
    for (const pair of (step.polyline ?? '').split(';')) {
      if (!pair) continue
      const [lng, lat] = pair.split(',').map(Number)
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue
      // 高德相邻 step 会重复首尾点，去掉零长度段
      const last = line[line.length - 1]
      if (last && last[0] === lng && last[1] === lat) continue
      line.push([lng, lat])
    }
  }
  return line.length >= 2 ? line : null
}

function pickLine(data: unknown): [number, number][] | null {
  if (!data || typeof data !== 'object') return null
  const payload = data as NormalizedRoute & OsrmResponse & AmapResponse
  if (Array.isArray(payload.line)) return fromNormalized(payload)
  if (payload.routes) return fromOsrm(payload)
  if (payload.route) return fromAmap(payload)
  return null
}

const ROUTE_GAP_MS = 300

/**
 * 全局串行 + 最小间隔：多天路线同时发会撞高德并发 QPS 限流，
 * 串行只是排队，前面的失败不会影响后面的。
 */
let queue: Promise<unknown> = Promise.resolve()
let lastAt = 0

function queued<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = ROUTE_GAP_MS - (Date.now() - lastAt)
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    try {
      return await task()
    } finally {
      lastAt = Date.now()
    }
  })
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/**
 * 路线几何。优先走 Worker 代理（高德驾车，失败自动回落 OSRM；两者都带缓存），
 * 代理不可用时回落到浏览器直连 OSRM。
 */
export function fetchRoadLine(points: LngLat[]): Promise<[number, number][] | null> {
  if (points.length < 2) return Promise.resolve(null)
  return queued(() => fetchRoadLineNow(points))
}

async function fetchRoadLineNow(points: LngLat[]): Promise<[number, number][] | null> {
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';')

  try {
    const res = await fetch(`/api/route?coords=${encodeURIComponent(coords)}`)
    if (res.ok) {
      const line = pickLine(await res.json())
      if (line) return line
    }
  } catch {
    /* 落到下面的直连 */
  }

  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&continue_straight=false`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return fromOsrm((await res.json()) as OsrmResponse)
  } catch {
    return null
  }
}
