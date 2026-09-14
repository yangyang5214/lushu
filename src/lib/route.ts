import type { LngLat } from './geo'
import { buildJourney } from './journey'
import type { Book } from '../types'

/** Worker `/api/route` 的统一返回：坐标已经是 GCJ02，直接贴合高德底图。 */
export type RoadRoute = {
  line: [number, number][]
  distanceKm: number
  durationMin: number
}

type NormalizedRoute = {
  source?: string
  line?: [number, number][]
  distanceKm?: number
  durationMin?: number
}

type AmapResponse = {
  route?: {
    paths?: Array<{
      distance?: string
      duration?: string
      steps?: Array<{ polyline?: string }>
    }>
  }
}

function asLine(points: unknown): [number, number][] | null {
  if (!Array.isArray(points)) return null
  const clean = (points as unknown[]).filter((pt): pt is [number, number] => {
    if (!Array.isArray(pt) || pt.length < 2) return false
    const [lng, lat] = pt
    return Number.isFinite(lng) && Number.isFinite(lat)
  })
  return clean.length >= 2 ? clean : null
}

/** 统一返回：线路已经是 GCJ02，原样交给高德。 */
function fromNormalized(data: NormalizedRoute): RoadRoute | null {
  const line = asLine(data?.line)
  if (!line) return null
  // 旧浏览器缓存只有 line、没有驾车里程：当未命中，重新向 Worker 要。
  if (typeof data.distanceKm !== 'number' || !Number.isFinite(data.distanceKm)) return null
  const durationMin = Number(data.durationMin)
  return {
    line,
    distanceKm: data.distanceKm,
    durationMin: Number.isFinite(durationMin) ? durationMin : 0,
  }
}

/** 高德原始响应（理论上不会出现，Worker 已归一化；保留兼容旧响应）：polyline 本来就是 GCJ02。 */
function fromAmap(data: AmapResponse): RoadRoute | null {
  const path = data.route?.paths?.[0]
  const steps = path?.steps ?? []
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
  if (line.length < 2) return null
  const distanceKm = Number(path?.distance) / 1000
  const durationMin = Math.round(Number(path?.duration) / 60)
  return {
    line,
    distanceKm: Number.isFinite(distanceKm) ? distanceKm : 0,
    durationMin: Number.isFinite(durationMin) ? durationMin : 0,
  }
}

function pickRoute(data: unknown): RoadRoute | null {
  if (!data || typeof data !== 'object') return null
  const payload = data as NormalizedRoute & AmapResponse
  if (Array.isArray(payload.line)) return fromNormalized(payload)
  if (payload.route) return fromAmap(payload)
  return null
}

/** 单点坐标串：5 位小数约 1 m，避免浮点写法差异打不中缓存。 */
function pointKey(p: LngLat): string {
  return `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`
}

/**
 * A→B 与 B→A 走的是同一段路，缓存键必须共用一份：取正串 / 反串里字典序小的那个，
 * 并记下这次请求相对它是正还是反。这样顺 / 逆切换时复用同一条已经规划好的线，
 * 不会因为驾车规划本身有向（单行、多条等价走廊、正反 tie-break 不同）而换个走向。
 */
function canonicalKey(points: LngLat[]): { key: string; reversed: boolean } {
  const forward = points.map(pointKey).join(';')
  const backward = [...points].reverse().map(pointKey).join(';')
  return forward <= backward ? { key: forward, reversed: false } : { key: backward, reversed: true }
}

const mem = new Map<string, Promise<RoadRoute | null>>()
const BROWSER_CACHE = 'lushu-route-v3'
const BROWSER_TTL_SEC = 60 * 60 * 24 * 3

function cacheUrl(key: string): string {
  return `https://lushu.internal/api/route/v3?coords=${encodeURIComponent(key)}`
}

async function fromBrowserCache(key: string): Promise<RoadRoute | null | undefined> {
  if (typeof caches === 'undefined') return undefined
  try {
    const cache = await caches.open(BROWSER_CACHE)
    const hit = await cache.match(cacheUrl(key))
    if (!hit) return undefined
    return pickRoute(await hit.json())
  } catch {
    return undefined
  }
}

async function toBrowserCache(key: string, route: RoadRoute): Promise<void> {
  if (typeof caches === 'undefined') return
  try {
    const cache = await caches.open(BROWSER_CACHE)
    await cache.put(
      cacheUrl(key),
      new Response(JSON.stringify(route), {
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
  resolve: (route: RoadRoute | null) => void
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

async function fetchOneGet(coords: string): Promise<RoadRoute | null> {
  try {
    const res = await fetch(`/api/route?coords=${encodeURIComponent(coords)}`)
    if (res.ok) return pickRoute(await res.json())
  } catch {
    /* Worker 未起：这一段落空，地图上不画这条线 */
  }
  return null
}

async function fetchSegments(keys: string[]): Promise<Array<RoadRoute | null>> {
  try {
    const res = await fetch('/api/route', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ segments: keys }),
    })
    if (res.ok) {
      const data = (await res.json()) as { routes?: unknown[] }
      if (Array.isArray(data.routes) && data.routes.length === keys.length) {
        return data.routes.map((item) => pickRoute(item))
      }
    }
  } catch {
    /* Worker 未起 / 旧部署没有 POST：逐段 GET */
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

  const routes = await fetchSegments(pending.map((job) => job.key))
  pending.forEach((job, i) => {
    const route = routes[i] ?? null
    if (route) void toBrowserCache(job.key, route)
    job.resolve(route)
  })
}

function reverseRoute(route: RoadRoute): RoadRoute {
  return { ...route, line: [...route.line].reverse() }
}

/**
 * 驾车规划（几何 + 高德给出的里程 / 时长）。同一坐标内存去重；
 * A→B 与 B→A 共用一份（反向请求把线倒过来）；
 * 同一事件循环里的多天请求会合成一次 POST。
 * 驾车导航只走高德：一律请求 Worker `/api/route`，失败就没有线，不再回落其他地图服务。
 */
export function fetchRoad(points: LngLat[]): Promise<RoadRoute | null> {
  if (points.length < 2) return Promise.resolve(null)
  const { key, reversed } = canonicalKey(points)
  let shared = mem.get(key)
  if (!shared) {
    shared = new Promise<RoadRoute | null>((resolve) => {
      queued.push({ key, resolve })
      scheduleFlush()
    }).then((route) => {
      if (!route) mem.delete(key)
      return route
    })
    mem.set(key, shared)
  }
  if (!reversed) return shared
  // 缓存里存的是键的朝向；这次要的是它的反向，倒序即可。里程 / 时长对称。
  return shared.then((route) => (route ? reverseRoute(route) : null))
}

/** 只要折线：地图画路用。里程走 fetchRoad，避免再拆一次请求。 */
export function fetchRoadLine(points: LngLat[]): Promise<[number, number][] | null> {
  return fetchRoad(points).then((route) => route?.line ?? null)
}

/** 打开路书后立刻预热各天路网，和地图初始化并行，不用等地图挂上。 */
export function prefetchBookRoads(book: Book): void {
  const journey = buildJourney(book)
  if (!journey.ready) return
  for (const day of journey.days) void fetchRoad(day.places)
}
