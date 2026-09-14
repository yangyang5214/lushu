/**
 * 路线顺序：前端（src/lib/geo.ts）和 Pages Function（functions/api）共用这一份。
 *
 * 球面距离只用来串点和判断环线，不参与页面上的公里数；展示里程一律用驾车规划。
 * 顺序只有这一套代码产：地点从哪来都一样（手输、扩展导入、AI 生成），
 * 存下来的 orderedIds 只是缓存，读的时候按起点/终点重推一遍即可。
 */

export type LngLat = { lng: number; lat: number }

/** 排序只用到 id + 坐标，前端 Place 与线上 PublicPlace 都能直接传进来。 */
export type Routable = LngLat & { id: string }

/** 环线的绕行方向：cw 顺时针 / ccw 逆时针（起终点相同才有意义）。 */
export type LoopDir = 'cw' | 'ccw'

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

/** 驾车里程库存指纹：坐标（5 位小数）+ 切天。对不上就把 driveKm 当没数。 */
export function journeyDriveKey(ordered: LngLat[], isLoop: boolean, splitIds: string[]): string {
  const route = isLoop && ordered.length > 1 ? [...ordered, ordered[0]] : ordered
  return `${route.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';')}|${splitIds.join(',')}`
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
 * 环线朝向：鞋带公式算有向面积。'cw' 顺时针 / 'ccw' 逆时针；点太少或几乎共线
 * （面积≈0）时返回 null——此时方向本身没有意义。用 lng 当 x、lat 当 y（等距圆柱
 * 投影保向），只判断符号，局部范围的环线足够准。
 */
export function loopOrientation(path: LngLat[]): LoopDir | null {
  if (path.length < 3) return null
  let sum = 0
  for (let i = 0; i < path.length; i += 1) {
    const a = path[i]
    const b = path[(i + 1) % path.length]
    sum += (b.lng - a.lng) * (b.lat + a.lat)
  }
  if (Math.abs(sum) < 1e-12) return null
  // Σ(x_{i+1}-x_i)(y_{i+1}+y_i) = -2A：为正即顺时针。
  return sum > 0 ? 'cw' : 'ccw'
}

/** 环线反向：起点钉在第一位，其余倒序（往返成本对称，倒过来仍是最优路径）。 */
export function reverseLoop<T extends Routable>(path: T[]): T[] {
  return path.length > 1 ? [path[0], ...path.slice(1).reverse()] : path
}

/**
 * 唯一的一条顺序来源：从起点贪心铺一条线，再用 2-opt + or-opt 收紧；
 * 起点终点是同一个点（或几乎重合）时按环线算。缺起点或终点就原样返回。
 * 环线可传 loopDir 指定顺 / 逆朝向（用户的选择优先于优化器的任意解）。
 */
export function orderRoute<T extends Routable>(
  places: T[],
  startId: string,
  endId: string,
  opts: { loopDir?: LoopDir } = {},
): T[] {
  const start = places.find((p) => p.id === startId)
  const end = places.find((p) => p.id === endId)
  if (!start || !end) return places
  const loop = isSamePlace(start, end) || start.id === end.id
  const rest = places.filter((p) => {
    if (p.id === start.id) return false
    if (!loop && p.id === end.id) return false
    return true
  })
  if (loop) {
    const path = improve(nearestNeighbor(start, rest), true)
    // 优化器给的是任一条等价的环线；用户选了方向就按它绕，换点/加点时也保持。
    if (opts.loopDir) {
      const current = loopOrientation(path)
      if (current && current !== opts.loopDir) return reverseLoop(path)
    }
    return path
  }
  const middle = nearestNeighbor(start, rest).slice(1)
  return improve([start, ...middle, end], false)
}
