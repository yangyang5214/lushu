/**
 * 距离与路线顺序：前端（src/lib/geo.ts）和 Pages Function（functions/api）共用这一份。
 *
 * 顺序只有这一套代码产：地点从哪来都一样（手输、扩展导入、AI 生成），
 * 存下来的 orderedIds 只是缓存，读的时候按起点/终点重推一遍即可。
 */

export type LngLat = { lng: number; lat: number }

/** 排序只用到 id + 坐标，前端 Place 与线上 PublicPlace 都能直接传进来。 */
export type Routable = LngLat & { id: string }

const EARTH_KM = 6371

/** 环线判定阈值（米）：起终点差这么近就当重合。前后端必须一致，否则环线会一边算一边不算。 */
export const LOOP_METERS = 280

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

export function haversineKm(a: LngLat, b: LngLat): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)))
}

export function pathDistanceKm(path: LngLat[]): number {
  let sum = 0
  for (let i = 0; i < path.length - 1; i += 1) {
    sum += haversineKm(path[i], path[i + 1])
  }
  return sum
}

export function isSamePlace(a: LngLat, b: LngLat, meters = LOOP_METERS): boolean {
  return haversineKm(a, b) * 1000 <= meters
}

function nearestNeighbor<T extends Routable>(start: T, rest: T[]): T[] {
  const remaining = [...rest]
  const path: T[] = [start]
  while (remaining.length > 0) {
    const cur = path[path.length - 1]
    let best = 0
    let bestD = Infinity
    remaining.forEach((place, i) => {
      const d = haversineKm(cur, place)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    path.push(remaining.splice(best, 1)[0])
  }
  return path
}

function reverseSlice<T>(path: T[], from: number, to: number): T[] {
  const next = path.slice()
  let i = from
  let j = to
  while (i < j) {
    const tmp = next[i]
    next[i] = next[j]
    next[j] = tmp
    i += 1
    j -= 1
  }
  return next
}

/** 环线在末尾补一条回到起点的边；非环线的首尾都钉死。 */
function edgeKm(path: LngLat[], loop: boolean, i: number): number {
  const j = i + 1
  if (j < path.length) return haversineKm(path[i], path[j])
  return loop ? haversineKm(path[i], path[0]) : 0
}

/**
 * 2-opt：反转一段。只比较被换掉的两条边和补上的两条边，单步 O(1)、
 * 整趟 O(n²)。每试一个候选就重算整条路（O(n³)）在手机上一本书就能卡住。
 */
function twoOptPass<T extends Routable>(path: T[], loop: boolean): { path: T[]; improved: boolean } {
  const n = path.length
  if (n < 4) return { path, improved: false }
  const iMax = loop ? n - 2 : n - 3
  const kMax = loop ? n - 1 : n - 2
  let next = path
  let improved = false
  for (let i = 0; i <= iMax; i += 1) {
    for (let k = i + 2; k <= kMax; k += 1) {
      const a = next[i]
      const b = next[i + 1]
      const c = next[k]
      const d = next[(k + 1) % n]
      const delta =
        haversineKm(a, c) + haversineKm(b, d) - edgeKm(next, loop, i) - edgeKm(next, loop, k)
      if (delta < -1e-6) {
        next = reverseSlice(next, i + 1, k)
        improved = true
      }
    }
  }
  return { path: next, improved }
}

/**
 * or-opt：把连续 1~3 个点整段搬到另一条边上。2-opt 只会反转，解不开
 * 「一整段该往前挪」这种弯（比如福州该夹在雁荡山与平潭岛之间）。
 */
function orOptPass<T extends Routable>(path: T[], loop: boolean): { path: T[]; improved: boolean } {
  const n = path.length
  if (n < 4) return { path, improved: false }
  const lastStart = loop ? n - 1 : n - 2 // 非环线时最后一个点钉死，不能搬
  const cMax = loop ? n - 1 : n - 2
  let next = path
  let improved = false
  for (let len = 1; len <= 3; len += 1) {
    for (let a = 1; a + len - 1 <= lastStart; a += 1) {
      const b = a + len - 1
      const prev = a - 1
      const after = (b + 1) % n
      for (let c = 0; c <= cMax; c += 1) {
        if (c === prev || (c >= a && c <= b)) continue
        const nc = (c + 1) % n
        const delta =
          haversineKm(next[prev], next[after]) +
          haversineKm(next[c], next[a]) +
          haversineKm(next[b], next[nc]) -
          edgeKm(next, loop, prev) -
          edgeKm(next, loop, b) -
          edgeKm(next, loop, c)
        if (delta >= -1e-6) continue
        const seg = next.slice(a, b + 1)
        const rest = [...next.slice(0, a), ...next.slice(b + 1)]
        const at = c < a ? c + 1 : c + 1 - len
        next = [...rest.slice(0, at), ...seg, ...rest.slice(at)]
        improved = true
        break // 这一段已经搬走，本轮 a 指向的内容变了，换下一组
      }
    }
  }
  return { path: next, improved }
}

/** 2-opt 与 or-opt 交替跑到两者都不再改善。 */
function improve<T extends Routable>(path: T[], loop: boolean): T[] {
  let next = path
  for (let round = 0; round < 50; round += 1) {
    const two = twoOptPass(next, loop)
    const or = orOptPass(two.path, loop)
    next = or.path
    if (!two.improved && !or.improved) break
  }
  return next
}

/**
 * 唯一的一条顺序来源：从起点贪心铺一条线，再用 2-opt + or-opt 收紧；
 * 起点终点是同一个点（或几乎重合）时按环线算。缺起点或终点就原样返回。
 */
export function orderRoute<T extends Routable>(places: T[], startId: string, endId: string): T[] {
  const start = places.find((p) => p.id === startId)
  const end = places.find((p) => p.id === endId)
  if (!start || !end) return places
  const loop = isSamePlace(start, end) || start.id === end.id
  const rest = places.filter((p) => {
    if (p.id === start.id) return false
    if (!loop && p.id === end.id) return false
    return true
  })
  if (loop) return improve(nearestNeighbor(start, rest), true)
  const middle = nearestNeighbor(start, rest).slice(1)
  return improve([start, ...middle, end], false)
}
