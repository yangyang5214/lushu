import { wgs84ToGcj02, type LngLat } from './geo'
import { buildJourney } from './journey'
import type { Book } from '../types'

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

function keyOf(points: LngLat[]): string {
  return points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';')
}

const mem = new Map<string, Promise<[number, number][] | null>>()
const BROWSER_CACHE = 'lushu-route-v1'
const BROWSER_TTL_SEC = 60 * 60 * 24 * 7

function cacheUrl(key: string): string {
  return `https://lushu.internal/api/route/v2?coords=${encodeURIComponent(key)}`
}

async function fromBrowserCache(key: string): Promise<[number, number][] | null | undefined> {
  if (typeof caches === 'undefined') return undefined
  try {
    const cache = await caches.open(BROWSER_CACHE)
    const hit = await cache.match(cacheUrl(key))
    if (!hit) return undefined
    return pickLine(await hit.json())
  } catch {
    return undefined
  }
}

async function toBrowserCache(key: string, line: [number, number][]): Promise<void> {
  if (typeof caches === 'undefined') return
  try {
    const cache = await caches.open(BROWSER_CACHE)
    await cache.put(
      cacheUrl(key),
      new Response(JSON.stringify({ line }), {
        headers: {
          'content-type': 'application/json',
          'cache-control': `max-age=${BROWSER_TTL_SEC}`,
        },
      }),
    )
  } catch {
    /* 隐私模式 / 配额满：内存缓存仍在 */
  }
}

type Job = {
  key: string
  resolve: (line: [number, number][] | null) => void
}

let queued: Job[] = []
let flushScheduled = false

function scheduleFlush(): void {
  if (flushScheduled) return
  flushScheduled = true
  queueMicrotask(() => {
    flushScheduled = false
    void flushJobs()
  })
}

async function fetchOsrm(coords: string): Promise<[number, number][] | null> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/${coords}` +
    '?overview=full&geometries=geojson&continue_straight=false'
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return fromOsrm((await res.json()) as OsrmResponse)
  } catch {
    return null
  }
}

async function fetchOneGet(coords: string): Promise<[number, number][] | null> {
  try {
    const res = await fetch(`/api/route?coords=${encodeURIComponent(coords)}`)
    if (res.ok) {
      const line = pickLine(await res.json())
      if (line) return line
    }
  } catch {
    /* 落到 OSRM */
  }
  return fetchOsrm(coords)
}

async function fetchSegments(keys: string[]): Promise<Array<[number, number][] | null>> {
  try {
    const res = await fetch('/api/route', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ segments: keys }),
    })
    if (res.ok) {
      const data = (await res.json()) as { routes?: unknown[] }
      if (Array.isArray(data.routes) && data.routes.length === keys.length) {
        return Promise.all(data.routes.map((item, i) => pickLine(item) ?? fetchOsrm(keys[i])))
      }
    }
  } catch {
    /* Worker 未起 / 旧部署没有 POST：逐段 GET，再直连 OSRM */
  }
  return Promise.all(keys.map((key) => fetchOneGet(key)))
}

async function flushJobs(): Promise<void> {
  const jobs = queued
  queued = []
  if (jobs.length === 0) return

  const cached = await Promise.all(jobs.map((job) => fromBrowserCache(job.key)))
  const pending: Job[] = []
  jobs.forEach((job, i) => {
    const hit = cached[i]
    if (hit !== undefined) job.resolve(hit)
    else pending.push(job)
  })
  if (pending.length === 0) return

  const lines = await fetchSegments(pending.map((job) => job.key))
  pending.forEach((job, i) => {
    const line = lines[i] ?? null
    if (line) void toBrowserCache(job.key, line)
    job.resolve(line)
  })
}

/**
 * 路线几何。同一坐标内存去重；同一事件循环里的多天请求会合成一次 POST。
 * 优先 Worker（高德，失败回落 OSRM），再退浏览器直连 OSRM。
 */
export function fetchRoadLine(points: LngLat[]): Promise<[number, number][] | null> {
  if (points.length < 2) return Promise.resolve(null)
  const key = keyOf(points)
  const existing = mem.get(key)
  if (existing) return existing
  const pending = new Promise<[number, number][] | null>((resolve) => {
    queued.push({ key, resolve })
    scheduleFlush()
  }).then((line) => {
    if (!line) mem.delete(key)
    return line
  })
  mem.set(key, pending)
  return pending
}

/** 打开路书后立刻预热各天路网，和地图初始化并行，不用等 Leaflet 挂上。 */
export function prefetchBookRoads(book: Book): void {
  const journey = buildJourney(book)
  if (!journey.ready) return
  for (const day of journey.days) void fetchRoadLine(day.places)
}
