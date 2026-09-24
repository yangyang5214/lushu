// 云游动画本体（Remotion composition）：地图为底，车按路线顺序走完全程。
//
// 这一层是「帧 → 画面」的纯函数：给定 scene（几何 + 文案）和当前帧，
// 画出底图、已走 / 未走的线、沿途停靠点和 HUD。进度、镜头、动画全部由帧算出来，
// 所以在 <Player> 里拖动进度条能精确回放到任意一帧。
//
// 视觉：暖阳底 + 阳光金高光，靠字距、细线和留白托信息；底图不过度去色，
// 白天晒着的暖调压角只用来托住字，不把画面压灰。
// 动效集中在四处 —— 片头的逐行落字、路线上的流动虚线、到站点的一圈扩散、
// 以及跟着车走的「下一站」气泡。

import { useState, type CSSProperties } from 'react'
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import { DRIVE_CAMERA_MAX, type DrivePoint, type DriveScene, type DriveStop } from '../lib/drive'
import { dayInk } from '../lib/geo'
// 用 ?inline 钉成 data URL：导出成 mp4 时这一层 SVG 会被整个序列化成一个 blob
// 再当图片画到 canvas 上，而「当图片用的 SVG」不加载外部资源（车会消失）。
// 内联后 dev 和构建产物是同一张图，导出和预览长得一样。
import carIcon from '../assets/amap-car.png?inline'

const SANS = "'Noto Sans SC', 'PingFang SC', system-ui, sans-serif"
const SERIF = "'Fraunces', 'Noto Serif SC', 'Songti SC', serif"
/** 阳光金：字标、里程、车灯共用的一点暖金，像晒在地图上的日光。 */
const SAND = '#f0b869'
const INK = '#1d1509'
const CREAM = '#fdf4e4'

/** 小标签：细、疏、半透明，是这套 UI 里唯一的「次级信息」样式。 */
const label: CSSProperties = {
  fontFamily: SANS,
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: 2.5,
  color: 'rgba(253,244,228,0.62)',
  textShadow: '0 1px 8px rgba(24,16,6,0.5)',
}

/** 找 target 落在哪一段：返回满足 cum[i] <= target 的最大下标。 */
function locate(cum: number[], target: number): number {
  let lo = 0
  let hi = cum.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (cum[mid] <= target) lo = mid
    else hi = mid - 1
  }
  return lo
}

type Car = { x: number; y: number; angle: number; index: number }

/** 按累计里程取车的位置与朝向（朝向多看几个点，短路段不会抖）。 */
function sampleCar(scene: DriveScene, target: number): Car {
  const { points, cum } = scene
  const i = locate(cum, target)
  const j = Math.min(i + 1, points.length - 1)
  const span = cum[j] - cum[i]
  const t = span > 0 ? (target - cum[i]) / span : 0
  const x = points[i][0] + (points[j][0] - points[i][0]) * t
  const y = points[i][1] + (points[j][1] - points[i][1]) * t
  const back = points[Math.max(0, i - 4)]
  const ahead = points[Math.min(points.length - 1, i + 4)]
  let dx = ahead[0] - back[0]
  let dy = ahead[1] - back[1]
  if (dx === 0 && dy === 0) {
    dx = points[j][0] - points[i][0]
    dy = points[j][1] - points[i][1]
  }
  const angle = dx === 0 && dy === 0 ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI
  return { x, y, angle, index: i }
}

function pathD(points: DrivePoint[]): string {
  if (points.length === 0) return ''
  let d = ''
  points.forEach(([x, y], i) => {
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
  })
  return d
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))

/** 缓出：所有「落下来」的元素共用同一条曲线，整套动效手感一致。 */
function easeOut(frame: number, start: number, dur = 18): number {
  return interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  })
}

/** 落字：淡入 + 上浮，p = 0 时还没落位。 */
function rise(p: number, dist = 16): CSSProperties {
  return { opacity: p, transform: `translateY(${((1 - p) * dist).toFixed(2)}px)` }
}

/**
 * 到站点。未到的只留一枚小圆点（不抢路线），车压过去的那一刻：
 * 圆点收成白底圆牌、外面炸开一圈同色光环。
 *
 * 站名同一刻只挂一个（报到的那一站），不然同城几处一起亮起来，字就叠成一团；
 * 下一站的名字只在离得远时才提前挂出来（带剩余里程）。
 * 几站落在同一个像素上时，勋章在构建期已经摊开（见 drive.ts 的 layoutStops），
 * 这里按摊开的偏移画勋章、画一条引线回到真位置。
 */
function StopMarker({
  stop,
  frame,
  fps,
  driveStart,
  atFrame,
  reached,
  next,
  mode,
  remaining,
}: {
  stop: DriveStop
  frame: number
  fps: number
  driveStart: number
  atFrame: number
  reached: boolean
  next: boolean
  /** 站名：当前报到 / 提前预告（离得远才有）/ 不挂。 */
  mode: 'current' | 'teaser' | 'off'
  /** 到下一站的剩余里程：挂在那下一站上，到站后换成备注。 */
  remaining?: string
}) {
  const color = dayInk(stop.day)
  const since = frame - atFrame
  const pop = spring({
    frame: since,
    fps,
    durationInFrames: 14,
    config: { damping: 12, stiffness: 170, mass: 0.5 },
  })
  // 圆点 → 圆牌的交接、以及那一圈扩散，都跟 pop 同一条时间线。
  const burst = clamp01(since / 22)
  const ringScale = 0.7 + burst * 2.6
  const ringOpacity = reached ? (1 - burst) * 0.75 : 0
  const dotOpacity = reached ? Math.max(0, 1 - pop * 1.6) : next ? 0.9 : 0.5
  const pinScale = reached ? 0.62 + 0.38 * pop : 0.55

  // 站名的时间轴按行车段算（announce 是相对行车段起点的帧）：提前 26 帧淡入
  // （既是提前预告下一站，也是到站那一下的报到），交棒给下一站时淡出。
  // 两个阶段用同一条曲线，预告转报到时不会闪一下。
  const driveT = frame - driveStart
  const nameEnd = Math.max(stop.announceEnd, stop.announce + 16)
  const nameOpacity =
    mode === 'off'
      ? 0
      : Math.min(easeOut(driveT, stop.announce - 26, 14), 1 - easeOut(driveT, nameEnd - 7, 12))

  const bx = stop.dx
  const by = stop.dy
  const len = Math.hypot(bx, by)
  /** 偏得太少就当没摊开：三两像素的引线只是一根毛刺，站名也照样挂正上方。 */
  const spread = len > 6
  // 引线：勋章已亮、或站名正挂在摊开的位置上时，牵一条线回真位置。
  const leaderOpacity = spread ? Math.max(reached ? 0.45 : 0, nameOpacity * 0.5) : 0

  const labelSize = /[\u3000-\u9fff]/.test(stop.label) ? 10.5 : 12
  // 报到的是「这一站 + 备注」，还没到就是「这一站 + 还剩多少公里」。
  const detail = [!reached && remaining ? remaining : '', stop.note].filter(Boolean).join(' · ')

  // 站名挂在勋章外侧：摊开的按径向挂出去（彼此不会撞），没摊开的还是挂正上方。
  let lx = bx
  let ly = by - 22 - 6 * nameOpacity
  let anchor: 'middle' | 'start' | 'end' = 'middle'
  let baseline: 'auto' | 'middle' | 'hanging' = 'auto'
  if (spread) {
    const ux = bx / len
    const uy = by / len
    const out = 18 + 6 * nameOpacity
    if (Math.abs(ux) > 0.5) {
      anchor = ux > 0 ? 'start' : 'end'
      lx = bx + ux * out
      ly = by + uy * out
      baseline = 'middle'
    } else {
      lx = bx
      ly = by + uy * out
      baseline = uy > 0 ? 'hanging' : 'auto'
    }
  } else if (stop.y + by < 52) {
    // 顶到画面上沿的那几站，站名改挂到勋章下面。
    ly = by + 28 + 6 * nameOpacity
    baseline = 'hanging'
  }

  return (
    <g transform={`translate(${stop.x.toFixed(1)} ${stop.y.toFixed(1)})`}>
      {leaderOpacity > 0.01 ? (
        <line
          x1={0}
          y1={0}
          x2={bx}
          y2={by}
          stroke={color}
          strokeOpacity={leaderOpacity}
          strokeWidth={1.3}
        />
      ) : null}
      {ringOpacity > 0.01 ? (
        <circle
          r={11}
          fill="none"
          stroke={color}
          strokeWidth={2.4}
          opacity={ringOpacity}
          transform={`scale(${ringScale.toFixed(3)})`}
        />
      ) : null}
      <circle r={5.5} fill={color} opacity={dotOpacity} />
      <g transform={`translate(${bx.toFixed(1)} ${by.toFixed(1)})`}>
        <g transform={`scale(${pinScale.toFixed(3)})`} opacity={reached ? 1 : 0}>
          <circle r={12.5} fill="#ffffff" />
          <circle r={12.5} fill="none" stroke={color} strokeWidth={2.6} />
          <text
            y={0.5}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={color}
            fontFamily={SANS}
            fontSize={labelSize}
            fontWeight={700}
          >
            {stop.label}
          </text>
        </g>
        {nameOpacity > 0.01 ? (
          /* 贴图的字：描边作底，和地图上的地名同一套读法，压在任何底图上都不糊 */
          <text
            x={lx}
            y={ly}
            textAnchor={anchor}
            dominantBaseline={baseline}
            opacity={nameOpacity}
            fill={CREAM}
            stroke="rgba(30,21,9,0.5)"
            strokeWidth={3.4}
            strokeLinejoin="round"
            paintOrder="stroke"
            fontFamily={SANS}
            fontSize={12.5}
          >
            <tspan fontWeight={600}>{stop.name}</tspan>
            {detail ? (
              <tspan dx={6} fontWeight={500} fill="rgba(255,250,240,0.8)">
                {detail}
              </tspan>
            ) : null}
          </text>
        ) : null}
      </g>
    </g>
  )
}

/**
 * 车：高德默认的俯视小车图标（52×26，车头朝 +x，和 rotate 的算法同一套约定）。
 * 位图存在 src/assets/amap-car.png（源：https://webapi.amap.com/images/car.png），
 * 只有图标本身是位图，车灯、光晕、尾迹仍用 SVG 画，好跟着主题色走。
 */
const CAR_W = 40
const CAR_H = 20

/** 车：俯视小汽车，车头朝 +x，靠 rotate 对齐行进方向；车灯、光晕、尾迹都跟着走。 */
function CarShape({ x, y, angle, frame, fps }: Car & { frame: number; fps: number }) {
  const pulse = (Math.sin((frame / fps) * Math.PI * 2.2) + 1) / 2
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
      <circle r={26 + pulse * 12} fill="url(#drive-glow)" opacity={0.45 + pulse * 0.2} />
      <g transform={`rotate(${angle.toFixed(1)})`}>
        <path d="M14,-5.5 L44,-20 L44,20 L14,5.5 Z" fill="url(#drive-beam)" opacity={0.45} />
        <rect
          x={-CAR_W / 2 - 11 - pulse * 5}
          y={-2.4}
          width={13}
          height={4.8}
          rx={2.4}
          fill="url(#drive-trail)"
        />
        <image
          href={carIcon}
          x={-CAR_W / 2}
          y={-CAR_H / 2}
          width={CAR_W}
          height={CAR_H}
          preserveAspectRatio="xMidYMid meet"
        />
      </g>
    </g>
  )
}

/** 底图取不到时的纯色底：晒热的暖阳渐变 + 轻网格，动画照放。 */
function FallbackBase() {
  const grid = 'rgba(178,138,84,0.14)'
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        backgroundImage:
          `repeating-linear-gradient(0deg, ${grid} 0 1px, transparent 1px 80px),` +
          `repeating-linear-gradient(90deg, ${grid} 0 1px, transparent 1px 80px),` +
          'radial-gradient(120% 110% at 50% -10%, #f7e7c6 0%, #eedbb2 55%, #ddc79b 100%)',
      }}
    />
  )
}

export function DriveComposition({ scene }: { scene: DriveScene }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const [mapFailed, setMapFailed] = useState(false)

  const { points, pointDay, stops, labels, width, height, totalMeters } = scene
  const driveStart = scene.introFrames
  const driveEnd = driveStart + scene.driveFrames
  const outroStart = driveEnd + 12

  const progress = interpolate(frame, [driveStart, driveEnd], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const car = sampleCar(scene, progress * totalMeters)
  const currentDay = pointDay[car.index] ?? 0
  const ink = dayInk(currentDay)

  // 镜头：出发前全览 → 跟着车推近 → 到站再退回全览。
  const scale = interpolate(
    frame,
    [
      driveStart,
      driveStart + scene.driveFrames * 0.16,
      driveEnd - scene.driveFrames * 0.14,
      driveEnd,
    ],
    [1, DRIVE_CAMERA_MAX, DRIVE_CAMERA_MAX, 1],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.inOut(Easing.quad),
    },
  )
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  const tx = clamp(width / 2 - scale * car.x, width - scale * width, 0)
  const ty = clamp(height / 2 - scale * car.y, height - scale * height, 0)

  // 按天分段：已走的线亮、未走的线虚；分界点就是镜头里那辆车。
  const ranges: Array<{ day: number; from: number; to: number }> = []
  pointDay.forEach((day, i) => {
    const last = ranges[ranges.length - 1]
    if (last && last.day === day) last.to = i
    else ranges.push({ day, from: i, to: i })
  })
  const slices = ranges.map((range) => {
    const traveled: DrivePoint[] = []
    const ahead: DrivePoint[] = []
    if (car.index >= range.to) {
      traveled.push(...points.slice(range.from, range.to + 1))
    } else if (car.index < range.from) {
      ahead.push(...points.slice(range.from, range.to + 1))
    } else {
      traveled.push(...points.slice(range.from, car.index + 1), [car.x, car.y])
      ahead.push([car.x, car.y], ...points.slice(car.index + 1, range.to + 1))
    }
    return { day: range.day, key: `${range.day}-${range.from}`, traveled, ahead }
  })

  // 下一站：气泡上的剩余里程靠它算出来。
  const nextIndex = stops.findIndex((stop) => stop.at > progress + 1e-4)
  const nextStop = nextIndex >= 0 ? stops[nextIndex] : null
  const toNextKm = nextStop ? Math.max(0, Math.round((nextStop.at - progress) * scene.distanceKm)) : 0

  // 站名同一刻只挂一个：挂的是最后报到的那一站。下一站离得够远（不在同一堆里）
  // 才提前预告，不然同城几处的站名会盖在一起。
  const driveT = frame - driveStart
  let announcedIndex = -1
  stops.forEach((stop, i) => {
    if (driveT >= stop.announce) announcedIndex = i
  })
  let teaserIndex = -1
  // 还没开始走（片头）就不预告：这时画面上只有书名，地图不必再多一行字。
  if (announcedIndex >= 0 && nextIndex >= 0 && nextIndex !== announcedIndex) {
    const from = stops[announcedIndex]
    const to = stops[nextIndex]
    // 挨在同一堆里的两站（同城几处）不预告，不然两个站名会盖在一起。
    const gap = Math.hypot(from.x + from.dx - (to.x + to.dx), from.y + from.dy - (to.y + to.dy))
    if (gap >= 90) teaserIndex = nextIndex
  }

  const traveledKm = Math.round(progress * scene.distanceKm)
  const dayTitle = labels.dayTitles[currentDay] ?? ''

  // 换天：找出每一次「进入新的一天」的帧，最近一次发生时顶上飘一条日头。
  const dayEntered: number[] = []
  let lastDay = -1
  stops.forEach((stop) => {
    if (stop.day !== lastDay) {
      dayEntered.push(stop.at)
      lastDay = stop.day
    }
  })
  const dayFrames = dayEntered.map((at) => driveStart + at * scene.driveFrames)
  const dayBannerAt = [...dayFrames].reverse().find((f) => frame >= f) ?? -1e9
  const dayBannerRise = easeOut(frame, dayBannerAt, 20)
  const dayBannerFade = interpolate(frame, [dayBannerAt + 46, dayBannerAt + 72], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const dayBannerOpacity = frame >= driveStart ? dayBannerRise * dayBannerFade : 0

  // 片头 / 片尾的遮罩与落字节奏（帧）。
  const introIn = easeOut(frame, 0, 16)
  const introOut = interpolate(frame, [driveStart - 18, driveStart + 2], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const introOpacity = Math.min(introIn, introOut)
  const outroIn = easeOut(frame, outroStart, 22)
  const hudOpacity = clamp01(easeOut(frame, driveStart - 6, 14)) * (1 - outroIn * 0.9)

  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width,
          height,
          transform: `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`,
          transformOrigin: '0 0',
        }}
      >
        {mapFailed ? (
          <FallbackBase />
        ) : (
          <img
            src={scene.mapUrl}
            alt=""
            draggable={false}
            onError={() => setMapFailed(true)}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width,
              height,
              objectFit: 'cover',
              // 只提饱和度和对比度，不提亮：提亮会把浅色底图洗成一片白（看着像蒙了层灰）
              filter: 'saturate(1.18) contrast(1.07)',
            }}
          />
        )}
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ position: 'absolute', left: 0, top: 0, width, height }}
        >
          <defs>
            <radialGradient id="drive-glow">
              <stop offset="0%" stopColor={SAND} stopOpacity="0.5" />
              <stop offset="55%" stopColor={SAND} stopOpacity="0.14" />
              <stop offset="100%" stopColor={SAND} stopOpacity="0" />
            </radialGradient>
            <radialGradient id="drive-spot">
              <stop offset="0%" stopColor="#ffdc9e" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#ffdc9e" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="drive-beam" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ffe8bc" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#ffe8bc" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="drive-trail" x1="1" y1="0" x2="0" y2="0">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.32" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* 车周围的一小片暖光：地图上自然长出来的焦点 */}
          <circle cx={car.x} cy={car.y} r={210} fill="url(#drive-spot)" />

          {/* 还没走的路：流动的虚线，方向就是车要去的方向 */}
          {slices.map((slice) => (
            <path
              key={`ahead-${slice.key}`}
              d={pathD(slice.ahead)}
              fill="none"
              stroke={dayInk(slice.day)}
              strokeOpacity={0.55}
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="2 10"
              strokeDashoffset={-frame * 1.1}
            />
          ))}
          {/* 已走的路：外发光 + 彩色主线 + 白芯 */}
          {slices.map((slice) => (
            <g key={`done-${slice.key}`}>
              <path
                d={pathD(slice.traveled)}
                fill="none"
                stroke={dayInk(slice.day)}
                strokeOpacity={0.2}
                strokeWidth={14}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={pathD(slice.traveled)}
                fill="none"
                stroke={dayInk(slice.day)}
                strokeWidth={5.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={pathD(slice.traveled)}
                fill="none"
                stroke="#ffffff"
                strokeOpacity={0.7}
                strokeWidth={1.3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          ))}

          {stops.map((stop, i) => (
            <StopMarker
              key={`${stop.name}-${i}`}
              stop={stop}
              frame={frame}
              fps={fps}
              driveStart={driveStart}
              atFrame={driveStart + stop.at * scene.driveFrames}
              reached={progress >= stop.at - 1e-4}
              next={i === nextIndex}
              mode={i === announcedIndex ? 'current' : i === teaserIndex ? 'teaser' : 'off'}
              remaining={i === nextIndex ? `${toNextKm} ${labels.unitKm}` : undefined}
            />
          ))}
          <CarShape {...car} frame={frame} fps={fps} />
        </svg>
      </div>

      {/* 压角 + 上下压暗：只为托住 HUD 的字，能多轻就多轻。
          底图本身的上下都一样亮，压重了上半部分就像蒙了层灰。 */}
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          background:
            'radial-gradient(88% 84% at 50% 46%, rgba(29,21,9,0) 62%, rgba(48,33,13,0.08) 100%)',
        }}
      />
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          background:
            'linear-gradient(180deg, rgba(33,23,10,0.16) 0%, rgba(33,23,10,0) 12%, rgba(33,23,10,0) 76%, rgba(33,23,10,0.14) 94%, rgba(33,23,10,0.03) 100%)',
        }}
      />

      {/* 顶部：字标 + 书名 + 当天 */}
      <div
        style={{
          position: 'absolute',
          left: 56,
          right: 56,
          top: 36,
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          opacity: hudOpacity,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              background: SAND,
              boxShadow: `0 0 10px ${SAND}88`,
            }}
          />
          <span
            style={{
              ...label,
              fontSize: 11,
              letterSpacing: 4,
              // 字标用奶白：金色压在亮底图上太糊，金色的分量交给左边那点光点
              color: CREAM,
              textShadow: '0 0 2px rgba(24,16,6,0.85), 0 2px 10px rgba(24,16,6,0.6)',
            }}
          >
            {labels.brand}
          </span>
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            fontFamily: SANS,
            fontSize: 14,
            fontWeight: 500,
            color: 'rgba(253,244,228,0.9)',
            textShadow: '0 0 2px rgba(24,16,6,0.7), 0 2px 10px rgba(24,16,6,0.6)',
          }}
        >
          {scene.title}
        </div>
        {dayTitle ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              // 换天时轻微弹一下，和顶上的日头呼应
              transform: `scale(${(0.94 + 0.06 * easeOut(frame, dayBannerAt, 24)).toFixed(3)})`,
              transformOrigin: '100% 50%',
            }}
          >
            <span
              style={{
                fontFamily: SANS,
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: 0.5,
                color: ink,
                textShadow: '0 0 2px rgba(24,16,6,0.7), 0 2px 10px rgba(24,16,6,0.5)',
              }}
            >
              {dayTitle}
            </span>
          </div>
        ) : null}
      </div>

      {/* 换天：顶上一闪而过的日头 */}
      {dayBannerOpacity > 0.01 && dayTitle ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 18,
            opacity: dayBannerOpacity,
            transform: `translateY(${((1 - dayBannerRise) * -12).toFixed(2)}px)`,
          }}
        >
          <span
            style={{
              height: 1,
              width: 36 + 52 * dayBannerRise,
              background: `linear-gradient(90deg, transparent, ${ink})`,
            }}
          />
          <span
            style={{
              fontFamily: SERIF,
              fontSize: 22,
              fontWeight: 560,
              letterSpacing: 4,
              color: CREAM,
              textShadow: `0 0 3px rgba(24,16,6,0.75), 0 2px 16px rgba(24,16,6,0.55)`,
            }}
          >
            {dayTitle}
          </span>
          <span
            style={{
              height: 1,
              width: 36 + 52 * dayBannerRise,
              background: `linear-gradient(90deg, ${ink}, transparent)`,
            }}
          />
        </div>
      ) : null}

      {/* 里程读数：右下角的一处固定读数（不跟车跑，也不做进度条），
          和顶部的字标 / 书名 / 当天对角相望。 */}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ position: 'absolute', left: 0, top: 0, width, height, pointerEvents: 'none' }}
      >
        <g textAnchor="end" opacity={hudOpacity}>
          <text
            x={width - 56}
            y={height - 80}
            fill={SAND}
            stroke="rgba(30,21,9,0.5)"
            strokeWidth={3}
            strokeLinejoin="round"
            paintOrder="stroke"
            fontFamily={SANS}
            fontSize={10}
            fontWeight={600}
            letterSpacing={2.5}
          >
            {labels.traveled}
          </text>
          <text
            x={width - 56}
            y={height - 44}
            fill={CREAM}
            stroke="rgba(30,21,9,0.5)"
            strokeWidth={3.6}
            strokeLinejoin="round"
            paintOrder="stroke"
            fontFamily={SANS}
            fontSize={30}
            fontWeight={600}
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            <tspan>{traveledKm}</tspan>
            <tspan dx={6} fontSize={12} fontWeight={500} fill={SAND}>
              {labels.unitKm}
            </tspan>
          </text>
          <rect
            x={width - 176}
            y={height - 30}
            width={120}
            height={1}
            fill="rgba(255,248,234,0.3)"
          />
        </g>
      </svg>

      {/* 片头：书名逐行落位 */}
      {introOpacity > 0.01 ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            opacity: introOpacity,
            background:
              'radial-gradient(70% 60% at 50% 50%, rgba(30,21,9,0.62) 0%, rgba(30,21,9,0.4) 70%, rgba(30,21,9,0.18) 100%)',
            pointerEvents: 'none',
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: 760, padding: '0 40px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 14,
                marginBottom: 28,
                ...rise(easeOut(frame, 4, 20), 10),
              }}
            >
              <span
                style={{
                  height: 1,
                  width: 28 + 36 * easeOut(frame, 6, 26),
                  background: `linear-gradient(90deg, transparent, ${SAND})`,
                }}
              />
              <span style={{ ...label, fontSize: 12, letterSpacing: 5, color: CREAM, textShadow: '0 0 3px rgba(24,16,6,0.8), 0 2px 12px rgba(24,16,6,0.6)' }}>
                {labels.brand}
              </span>
              <span
                style={{
                  height: 1,
                  width: 28 + 36 * easeOut(frame, 6, 26),
                  background: `linear-gradient(90deg, ${SAND}, transparent)`,
                }}
              />
            </div>
            <div
              style={{
                fontFamily: SERIF,
                fontSize: 44,
                fontWeight: 560,
                lineHeight: 1.28,
                color: CREAM,
                textShadow: '0 6px 28px rgba(0,0,0,0.4)',
                ...rise(easeOut(frame, 8, 22), 18),
              }}
            >
              {scene.title}
            </div>
            <div
              style={{
                margin: '24px auto 0',
                height: 1,
                width: 220 * easeOut(frame, 16, 26),
                background:
                  'linear-gradient(90deg, transparent, rgba(253,244,228,0.45), transparent)',
              }}
            />
            <div
              style={{
                marginTop: 22,
                fontFamily: SANS,
                fontSize: 20,
                fontWeight: 500,
                color: SAND,
                ...rise(easeOut(frame, 20, 20), 12),
              }}
            >
              {labels.totalLine}
            </div>
            <div
              style={{
                marginTop: 12,
                fontFamily: SANS,
                fontSize: 13,
                letterSpacing: 1.5,
                color: 'rgba(253,244,228,0.66)',
                ...rise(easeOut(frame, 26, 20), 10),
              }}
            >
              {labels.legendLine}
            </div>
          </div>
        </div>
      ) : null}

      {/* 片尾：全程走完 */}
      {outroIn > 0.01 ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            opacity: outroIn,
            background:
              'radial-gradient(70% 60% at 50% 50%, rgba(30,21,9,0.68) 0%, rgba(30,21,9,0.46) 70%, rgba(30,21,9,0.26) 100%)',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              textAlign: 'center',
              transform: `scale(${(0.96 + 0.04 * outroIn).toFixed(3)})`,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 14,
                marginBottom: 24,
                ...rise(easeOut(frame, outroStart + 6, 20), 10),
              }}
            >
              <span style={{ height: 1, width: 40, background: `linear-gradient(90deg, transparent, ${SAND})` }} />
              <span style={{ ...label, fontSize: 11, letterSpacing: 4, color: CREAM, textShadow: '0 0 3px rgba(24,16,6,0.8), 0 2px 12px rgba(24,16,6,0.6)' }}>
                {labels.brand}
              </span>
              <span style={{ height: 1, width: 40, background: `linear-gradient(90deg, ${SAND}, transparent)` }} />
            </div>
            <div
              style={{
                fontFamily: SERIF,
                fontSize: 38,
                fontWeight: 560,
                letterSpacing: 2,
                color: CREAM,
                textShadow: '0 6px 28px rgba(0,0,0,0.42)',
                ...rise(easeOut(frame, outroStart + 10, 22), 16),
              }}
            >
              {labels.completed}
            </div>
            <div
              style={{
                marginTop: 20,
                fontFamily: SANS,
                fontSize: 18,
                fontWeight: 500,
                color: SAND,
                ...rise(easeOut(frame, outroStart + 22, 20), 12),
              }}
            >
              {labels.totalLine}
            </div>
            <div
              style={{
                marginTop: 12,
                fontFamily: SANS,
                fontSize: 13,
                letterSpacing: 1.5,
                color: 'rgba(253,244,228,0.66)',
                ...rise(easeOut(frame, outroStart + 30, 20), 10),
              }}
            >
              {labels.legendLine}
            </div>
          </div>
        </div>
      ) : null}
    </AbsoluteFill>
  )
}
