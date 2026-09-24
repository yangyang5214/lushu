// 云游：把「按天的高德路网线」拼成一条整线，算出每个点的累计里程，
// 再投影到 1024×576 的舞台坐标系（Web 墨卡托 —— 和高德底图同一个投影，
// 静态底图 + 前端画线才能严丝合缝）。
//
// 动画组件只按「进度」取点，不再碰经纬度：镜头框、里程、停靠点都在这算好。

import { wgs84ToGcj02 } from '../../shared/coords'
import { haversineKm } from '../../shared/geo'
import type { Journey, Place } from '../types'
import type { RoadRoute } from './route'

/** 舞台：16:9，和服务端 /api/staticmap 的 1024*576 对齐。 */
export const DRIVE_WIDTH = 1024
export const DRIVE_HEIGHT = 576
export const DRIVE_FPS = 30

/**
 * 镜头里路线四周留白（占舞台的比例），别顶到边。
 * 静态地图只认整数级别，级别差一级路线就差一倍：留白卡到 0.16 时，一条南北向
 * 的路线常常「再进一级就差几个像素」而被压回上一级，于是一整条几千公里的线
 * 只占舞台中间一小块，几十个停靠点全挤在那几个像素里。0.13 的边距仍够顶栏和
 * 站名落脚，却能多收下一级。
 */
const FRAME_PADDING = 0.13
/** 静态地图只认整数级别，且 1..17。 */
const FRAME_ZOOM_MIN = 3
const FRAME_ZOOM_MAX = 16
/** 动画里镜头最多推几倍（底图是 2 倍像素，再推就糊了）。 */
export const DRIVE_CAMERA_MAX = 1.55

/** 隔夜点会同时落进前后两天的线里：1 公里内认作同一个点，接上时不回折。 */
const JOIN_KM = 1
/**
 * 去重叠：屏幕上挨得这么近（舞台像素）的停靠点算「同一处」，勋章要摊开画。
 * 同城几处、环线的出发＝到达，投影下来本来就落在一两个像素上。
 */
const STOP_GROUP_R = 14
/** 摊开后相邻两枚勋章的中心距：勋章直径 25 + 一点缝。 */
const STOP_GAP = 28
/** 引线最长拉这么远（stage 像素）：再长就跟真位置分家了。 */
const STOP_LEADER_MAX = 44
/** 站名报到：人多时一站一句往下排，最短 / 最长停多久（帧）。 */
const ANNOUNCE_FRAMES_MIN = 16
const ANNOUNCE_FRAMES_MAX = 30
/** 片子最长的行车段（秒）：站数再多也不靠拉长片子来排。 */
const DRIVE_SECONDS_MAX = 36
/** 抽稀：相邻保留点不足这个距离就并掉（1024px 舞台上约 2~3px，看不出来）。 */
const MIN_STEP_M = 25
/** 折线点上限：再长的路书也够画，渲染不至于卡。 */
const MAX_POINTS = 3000

export type DrivePoint = [number, number]

export type DriveStopKind = 'start' | 'via' | 'end'

export type DriveStop = {
  /** 舞台坐标。 */
  x: number
  y: number
  name: string
  note: string
  /** 针尖上的字：序号，或「出发 / 到达」。 */
  label: string
  kind: DriveStopKind
  /** 所属天序号（0 起）。 */
  day: number
  /** 到达进度：累计里程 / 总里程，0..1。 */
  at: number
  /** 勋章相对真实位置的偏移（stage 像素）：同一处的几枚摊开画，真位置留着画引线。 */
  dx: number
  dy: number
  /** 站名报到的帧（相对行车段起点）。人多时自动错开，同一刻只报一个站。 */
  announce: number
  /** 这个站名交棒给下一站的帧。 */
  announceEnd: number
}

/** 动画里的文案：由组件按当前语言翻好再传进来，组件本身不碰 i18n。 */
export type DriveLabels = {
  /** 片头片尾和顶栏上的字标（当前是「云游」）。 */
  brand: string
  /** 每天一个「第 N 天」；没定起终点时为空数组。 */
  dayTitles: string[]
  start: string
  end: string
  /** 「全程 320 公里 · 约 5 小时 20 分」整句。 */
  totalLine: string
  /** 「3 天 · 12 个地点」整句。 */
  legendLine: string
  /** 「已行驶」——车上那枚里程牌的前缀。 */
  traveled: string
  unitKm: string
  /** 片尾的「全程走完」。 */
  completed: string
}

export type DriveScene = {
  width: number
  height: number
  /** 书名：片头打在屏幕中间的那行大字。 */
  title: string
  /** 底图地址；空串 = 没有底图，动画用纯色底。 */
  mapUrl: string
  /** 整条路线的舞台坐标（按天拼接，隔夜点只留一个）。 */
  points: DrivePoint[]
  /** 每个点属于哪一天，用来分段着色（与 points 等长）。 */
  pointDay: number[]
  /** 每个点的累计里程（米，与 points 等长）。 */
  cum: number[]
  totalMeters: number
  /** 总驾车里程（公里）与时长（分钟）。 */
  distanceKm: number
  durationMin: number
  stops: DriveStop[]
  labels: DriveLabels
  /** 时间轴（帧）：片头 / 行车 / 片尾。 */
  introFrames: number
  driveFrames: number
  outroFrames: number
}

const round1 = (n: number): number => Math.round(n * 10) / 10

/** 安全网：极度密集时别把勋章推得离真位置太远（引线太长就跟真位置分家了）。 */
function clampLeader(stops: DriveStop[]): void {
  stops.forEach((stop) => {
    const l = Math.hypot(stop.dx, stop.dy)
    if (l > STOP_LEADER_MAX) {
      stop.dx *= STOP_LEADER_MAX / l
      stop.dy *= STOP_LEADER_MAX / l
    }
  })
}

/**
 * 摊完再松弛几轮：还挨着的两枚勋章各让一半，让到不挨为止。
 * 摊开是围着各自的组心摆的，两堆离得近时圆周还是会碰（汕头与潮州就是）；
 * 这一轮只挪勋章、不动真位置，引线自然会变长。
 */
function relaxStops(stops: DriveStop[]): void {
  for (let pass = 0; pass < 12; pass += 1) {
    let moved = false
    for (let i = 0; i < stops.length; i += 1) {
      for (let j = i + 1; j < stops.length; j += 1) {
        const a = stops[i]
        const b = stops[j]
        const ax = a.x + a.dx
        const ay = a.y + a.dy
        const dx = b.x + b.dx - ax
        const dy = b.y + b.dy - ay
        const dist = Math.hypot(dx, dy)
        if (dist >= STOP_GAP || dist < 1e-6) continue
        const push = (STOP_GAP - dist) / 2
        const ux = dx / dist
        const uy = dy / dist
        a.dx -= ux * push
        a.dy -= uy * push
        b.dx += ux * push
        b.dy += uy * push
        moved = true
      }
    }
    clampLeader(stops)
    if (!moved) break
  }
}

/** 摆停靠点的勋章：先按真实位置分组，组内围着组心摊成一圈，避开已经摆好的。 */
function layoutStops(stops: DriveStop[]): void {
  const placed: DrivePoint[] = []
  const taken = new Set<number>()
  stops.forEach((stop, seed) => {
    if (taken.has(seed)) return
    const group = [seed]
    taken.add(seed)
    stops.forEach((other, j) => {
      if (taken.has(j)) return
      if (Math.hypot(other.x - stop.x, other.y - stop.y) <= STOP_GROUP_R) {
        group.push(j)
        taken.add(j)
      }
    })
    if (group.length > 1) {
      const k = group.length
      // 正 k 边形，弦长 = STOP_GAP；k=2 时退化成一条线，也要够开。
      const radius = k === 2 ? STOP_GAP / 2 : (STOP_GAP / 2 - 1) / Math.sin(Math.PI / k)
      const cx = group.reduce((sum, i) => sum + stops[i].x, 0) / k
      const cy = group.reduce((sum, i) => sum + stops[i].y, 0) / k
      const inGroup = new Set(group)
      // 转一圈挑最空的朝向：既躲已经摆好的勋章，也躲别处还没摆的点。
      let bestAngle = 0
      let bestScore = Number.NEGATIVE_INFINITY
      for (let turn = 0; turn < 36; turn += 1) {
        const angle = (turn * 10 * Math.PI) / 180
        let score = Number.POSITIVE_INFINITY
        for (let j = 0; j < k; j += 1) {
          const a = -Math.PI / 2 + angle + (2 * Math.PI * j) / k
          const px = cx + Math.cos(a) * radius
          const py = cy + Math.sin(a) * radius
          placed.forEach(([qx, qy]) => {
            score = Math.min(score, Math.hypot(px - qx, py - qy))
          })
          stops.forEach((other, t) => {
            if (inGroup.has(t)) return
            score = Math.min(score, Math.hypot(px - other.x, py - other.y))
          })
        }
        if (score > bestScore) {
          bestScore = score
          bestAngle = angle
        }
      }
      group.forEach((i, j) => {
        const a = -Math.PI / 2 + bestAngle + (2 * Math.PI * j) / k
        const stop2 = stops[i]
        stop2.dx = round1(cx + Math.cos(a) * radius - stop2.x)
        stop2.dy = round1(cy + Math.sin(a) * radius - stop2.y)
      })
    }
    group.forEach((i) => {
      placed.push([stops[i].x + stops[i].dx, stops[i].y + stops[i].dy])
    })
  })
}

/**
 * 站名报到：同一刻只报一个站。挤在一处的几站本来会在同一帧里一起报到，
 * 名字叠成一团，所以把它们按「剩下的时间 ÷ 剩下的站数」排队往下报 ——
 * 前面宽裕就按自然节奏，快到片尾自动收紧，不会拖出行车段。
 */
function assignAnnounce(stops: DriveStop[], driveFrames: number): void {
  let cursor = 0
  stops.forEach((stop, i) => {
    cursor = Math.max(stop.at * driveFrames, cursor)
    stop.announce = cursor
    const left = stops.length - i
    // 从当下（不是从到站时刻）算剩下的人均时间：前面挤出的债，后面几段长路自己还。
    const step = Math.max(
      ANNOUNCE_FRAMES_MIN,
      Math.min(ANNOUNCE_FRAMES_MAX, (driveFrames - cursor) / left),
    )
    cursor += step
  })
  // 兜底：站多到怎么撑都排不下（几十个点全挤在一条短线上）就整串均匀铺满，
  // 宁可报得比到站早一点，也别把后面几站的名字挤到同一帧上。
  const last = stops[stops.length - 1]
  if (last && stops.length > 1 && last.announce > driveFrames) {
    stops.forEach((stop, i) => {
      stop.announce = (i / (stops.length - 1)) * driveFrames
    })
  }
  stops.forEach((stop) => {
    stop.announce = Math.max(0, Math.round(stop.announce))
  })
  stops.forEach((stop, i) => {
    stop.announceEnd = i + 1 < stops.length ? stops[i + 1].announce : driveFrames + 26
  })
}

/** 云游按天分镜：定了起终点就一天一段；只有一串点（没定起终点）就整条一组。 */
export function driveLegs(journey: Journey): Place[][] {
  if (journey.ready && journey.days.length > 0) return journey.days.map((day) => day.places)
  return journey.places.length >= 2 ? [journey.places] : []
}

/**
 * 高德静态地图的瓦片基准是 512px（不是 JS API 的 256px）：同一坐标下
 * 静态图 zoom=z 的像素分辨率 = 512·2^z。实测过（把 paths 画到静态图上，
 * 与这里的投影比比对角偏移 < 1px），底图和线上才贴得准。
 */
const STATIC_TILE = 512

/** Web 墨卡托：经纬度 → 该级别下整个世界（512·2^zoom 像素）里的像素坐标。 */
function worldXY(lng: number, lat: number, zoom: number): DrivePoint {
  const size = STATIC_TILE * 2 ** zoom
  const safeLat = Math.max(-85, Math.min(85, lat))
  const s = Math.sin((safeLat * Math.PI) / 180)
  const x = ((lng + 180) / 360) * size
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size
  return [x, y]
}

type CameraFrame = { zoom: number; lng: number; lat: number }

/** 镜头：整条路线按留白收进舞台，取整数级别。 */
function frameRoute(path: DrivePoint[]): CameraFrame {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [lng, lat] of path) {
    const [x, y] = worldXY(lng, lat, 0)
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  const usableW = DRIVE_WIDTH * (1 - FRAME_PADDING * 2)
  const usableH = DRIVE_HEIGHT * (1 - FRAME_PADDING * 2)
  const spanX = maxX - minX
  const spanY = maxY - minY
  const fit = Math.min(
    spanX > 0 ? usableW / spanX : Number.POSITIVE_INFINITY,
    spanY > 0 ? usableH / spanY : Number.POSITIVE_INFINITY,
  )
  const zoom = Number.isFinite(fit)
    ? Math.max(FRAME_ZOOM_MIN, Math.min(FRAME_ZOOM_MAX, Math.floor(Math.log2(fit))))
    : FRAME_ZOOM_MAX
  // 中心取墨卡托 bbox 的中点再反算经纬度：纬度不是线性的，直接取平均值会偏。
  const midX = (minX + maxX) / 2
  const midY = (minY + maxY) / 2
  const n = Math.PI - (2 * Math.PI * midY) / STATIC_TILE
  return {
    zoom,
    lng: (midX / STATIC_TILE) * 360 - 180,
    lat: (180 / Math.PI) * Math.atan(Math.sinh(n)),
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** 投影到舞台坐标（底图中心 = 舞台中心，静态地图与高德同一套投影）。 */
function projector(frame: CameraFrame) {
  const [cx, cy] = worldXY(frame.lng, frame.lat, frame.zoom)
  return ([lng, lat]: DrivePoint): DrivePoint => {
    const [x, y] = worldXY(lng, lat, frame.zoom)
    return [round2(x - cx + DRIVE_WIDTH / 2), round2(y - cy + DRIVE_HEIGHT / 2)]
  }
}

/** 抽稀折线：相邻点太近就并掉；换天的那一点永远保留。 */
function thin(path: {
  points: DrivePoint[]
  days: number[]
}): { points: DrivePoint[]; days: number[] } {
  const points: DrivePoint[] = []
  const days: number[] = []
  path.points.forEach((pt, i) => {
    const day = path.days[i]
    const last = points[points.length - 1]
    const lastDay = days[days.length - 1]
    const keep =
      !last ||
      lastDay !== day ||
      i === path.points.length - 1 ||
      haversineKm({ lng: last[0], lat: last[1] }, { lng: pt[0], lat: pt[1] }) * 1000 >= MIN_STEP_M
    if (keep) {
      points.push(pt)
      days.push(day)
    }
  })
  if (points.length <= MAX_POINTS) return { points, days }
  const stride = Math.ceil(points.length / MAX_POINTS)
  const keptPoints: DrivePoint[] = []
  const keptDays: number[] = []
  for (let i = 0; i < points.length; i += stride) {
    keptPoints.push(points[i])
    keptDays.push(days[i])
  }
  const lastIndex = points.length - 1
  if (keptPoints[keptPoints.length - 1] !== points[lastIndex]) {
    keptPoints.push(points[lastIndex])
    keptDays.push(days[lastIndex])
  }
  return { points: keptPoints, days: keptDays }
}

/**
 * 生成一帧动画所需要的全部几何。routes 与 driveLegs(journey) 一一对应，
 * 缺项（路网没回来）就用两点的直线兜底 —— 动画照放，只是线不贴路。
 */
export function buildDriveScene(
  journey: Journey,
  routes: Array<RoadRoute | null>,
  labels: DriveLabels,
): DriveScene | null {
  const legs = driveLegs(journey)
  if (legs.length === 0) return null

  const lines: DrivePoint[][] = legs.map((places, i) => {
    const line = routes[i]?.line
    if (line && line.length >= 2) return line.map(([lng, lat]) => [lng, lat] as DrivePoint)
    return places.map((place) => wgs84ToGcj02(place.lng, place.lat) as DrivePoint)
  })

  // 拼接：隔夜点同时出现在前后两天的线里，从最靠近上一天尽头的那一点接上。
  const rawPoints: DrivePoint[] = []
  const rawDays: number[] = []
  lines.forEach((line, day) => {
    let from = 0
    const last = rawPoints[rawPoints.length - 1]
    if (last) {
      // 接点只可能在第二天的开头，扫前 1/4 就够（避免线上折返时误取远端）。
      const scan = Math.max(1, Math.min(line.length, Math.ceil(line.length / 4), 400))
      let best = -1
      let bestKm = Infinity
      for (let i = 0; i < scan; i += 1) {
        const km = haversineKm({ lng: last[0], lat: last[1] }, { lng: line[i][0], lat: line[i][1] })
        if (km < bestKm) {
          bestKm = km
          best = i
        }
      }
      if (best >= 0 && bestKm <= JOIN_KM) from = best + 1
    }
    for (let i = from; i < line.length; i += 1) {
      const pt = line[i]
      const prev = rawPoints[rawPoints.length - 1]
      if (prev && prev[0] === pt[0] && prev[1] === pt[1]) continue
      rawPoints.push(pt)
      rawDays.push(day)
    }
  })
  const path = thin({ points: rawPoints, days: rawDays })
  if (path.points.length < 2) return null

  // 累计里程（米）：进度、镜头、里程碑都按真实里程走。
  const cum: number[] = [0]
  for (let i = 1; i < path.points.length; i += 1) {
    const km = haversineKm(
      { lng: path.points[i - 1][0], lat: path.points[i - 1][1] },
      { lng: path.points[i][0], lat: path.points[i][1] },
    )
    cum.push(cum[i - 1] + km * 1000)
  }
  const totalMeters = cum[cum.length - 1]
  if (!(totalMeters > 0)) return null

  const frame = frameRoute(path.points)
  const project = projector(frame)
  const projected = path.points.map(project)

  // 停靠点：按顺序在线上找最近的点。只往后找，环线绕回来时不会串到起点。
  const stopPlaces = journey.ready ? journey.ordered : journey.places
  const stops: DriveStop[] = []
  let cursor = 0
  stopPlaces.forEach((place, i) => {
    const [lng, lat] = wgs84ToGcj02(place.lng, place.lat)
    let best = cursor
    let bestKm = Infinity
    for (let j = cursor; j < path.points.length; j += 1) {
      const km = haversineKm({ lng, lat }, { lng: path.points[j][0], lat: path.points[j][1] })
      if (km < bestKm) {
        bestKm = km
        best = j
      }
      if (km < 0.02) break
    }
    cursor = best
    const first = i === 0 && journey.ready
    const last = i === stopPlaces.length - 1 && journey.ready && !journey.isLoop
    stops.push({
      x: projected[best][0],
      y: projected[best][1],
      name: place.name,
      note: place.note ?? '',
      label: first ? labels.start : last ? labels.end : String(i + 1),
      kind: first ? 'start' : last ? 'end' : 'via',
      day: path.days[best] ?? 0,
      at: cum[best] / totalMeters,
      dx: 0,
      dy: 0,
      announce: 0,
      announceEnd: 0,
    })
  })
  // 环线（出发地就是终点）：最后一个停靠点是起点，补一个「到达」收尾。
  if (journey.ready && stops.length > 0 && stops[stops.length - 1].at < 0.98) {
    const lastPoint = projected[projected.length - 1]
    stops.push({
      x: lastPoint[0],
      y: lastPoint[1],
      name: journey.end?.name ?? stopPlaces[0]?.name ?? '',
      note: '',
      label: labels.end,
      kind: 'end',
      day: path.days[path.days.length - 1] ?? 0,
      at: 1,
      dx: 0,
      dy: 0,
      announce: 0,
      announceEnd: 0,
    })
  }

  const allRoutes = routes.every((r) => r && r.distanceKm > 0)
  const distanceKm = allRoutes
    ? routes.reduce((sum, r) => sum + (r?.distanceKm ?? 0), 0)
    : totalMeters / 1000
  const durationMin = allRoutes
    ? routes.reduce((sum, r) => sum + (r?.durationMin ?? 0), 0)
    : Math.round((distanceKm / 70) * 60)

  // 时间轴：太短看不清、太长坐不住；公里数决定行车段长度。
  // 站多的时候还要装得下「一站一句」：不然站名会挤在同几帧里报不完。
  const driveSeconds = Math.min(24, Math.max(7, 5 + distanceKm / 60))
  const driveFrames = Math.min(
    DRIVE_SECONDS_MAX * DRIVE_FPS,
    Math.max(Math.round(driveSeconds * DRIVE_FPS), stops.length * ANNOUNCE_FRAMES_MIN),
  )
  const center = `${frame.lng.toFixed(6)},${frame.lat.toFixed(6)}`
  layoutStops(stops)
  relaxStops(stops)
  assignAnnounce(stops, driveFrames)

  return {
    width: DRIVE_WIDTH,
    height: DRIVE_HEIGHT,
    title: journey.title,
    mapUrl: `/api/staticmap?center=${center}&zoom=${frame.zoom}`,
    points: projected,
    pointDay: path.days,
    cum,
    totalMeters,
    distanceKm,
    durationMin,
    stops,
    labels,
    introFrames: 48,
    driveFrames,
    outroFrames: 78,
  }
}
