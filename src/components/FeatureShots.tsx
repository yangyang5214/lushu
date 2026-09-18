// 主页功能介绍的配图：用 SVG 手绘编辑页里几个关键动作的示意图。
//
// 为什么不是截图：配图要跟着文案一起改、两种语言都要对，还要在任何分辨率下都清楚。
// 这里按编辑页真实的版式画（左清单 / 右地图、底部的行程尺、行末的「起点」「终点」「过夜」），
// 颜色沿用编辑页主题，地点沿用同一本示例路书，几张图看起来是一路的。
import type { ReactNode } from 'react'
import { formatDuration, formatKm, formatLegLabel } from '../lib/geo'
import { useI18n } from '../lib/i18n'

const W = 520
const H = 300
/** 清单与地图的分界：左边行程清单，右边地图。 */
const SHEET_R = 248
const FONT = "Manrope, 'Noto Sans SC', sans-serif"
const INK = '#1b1712'
const MUTED = '#6c6c7c'
const LINE = '#e5e5ea'
const SOFT = '#f4f4f7'
const PIN = '#3d7eff'
const ACCENT = '#7c5cff'
const SEAL = '#c23b22'
const NIGHT = '#ef4444'
/** 与 lib/geo 的 DAY_INKS 一致：第 1 天红、第 2 天蓝、第 3 天黄。 */
const DAY1 = '#ff4d4f'
const DAY2 = '#1677ff'
const DAY3 = '#faad14'

type Point = [number, number]

/** 大致量一下文字宽度：汉字按一个字宽，其余按 0.58 个字宽。 */
function textW(label: string, size: number): number {
  let w = 0
  for (const ch of label) {
    w += /[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? size : size * 0.58
  }
  return w
}

/** 折线转圆滑曲线（Catmull-Rom），示意地图上的路线走向。 */
function curve(points: Point[]): string {
  if (points.length < 2) return ''
  const at = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))]
  let d = `M${points[0][0]} ${points[0][1]}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0]} ${p2[1]}`
  }
  return d
}

/** 五个地点在两种版式里的位置：一边是「清单 + 地图」，一边是「地图 + 行程尺」。 */
const PTS = {
  side: [
    [282, 124],
    [322, 80],
    [416, 97],
    [378, 190],
    [286, 200],
  ] as Point[],
  stack: [
    [272, 53],
    [322, 26],
    [416, 37],
    [378, 94],
    [278, 100],
  ] as Point[],
}

function Label({
  x,
  y,
  size = 11,
  weight = 500,
  fill = INK,
  anchor = 'start',
  halo = false,
  children,
}: {
  x: number
  y: number
  size?: number
  weight?: number
  fill?: string
  anchor?: 'start' | 'middle' | 'end'
  halo?: boolean
  children: ReactNode
}) {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      fontWeight={weight}
      fill={fill}
      textAnchor={anchor}
      fontFamily={FONT}
      paintOrder={halo ? 'stroke' : undefined}
      stroke={halo ? '#fff' : undefined}
      strokeWidth={halo ? 3.5 : undefined}
      strokeLinejoin={halo ? 'round' : undefined}
    >
      {children}
    </text>
  )
}

/** 应用窗口：圆角白底 + 网格底图；`side` 版式左边多一块行程清单。 */
function Frame({
  id,
  label,
  layout,
  children,
}: {
  id: string
  label: string
  layout: 'side' | 'stack' | 'plain'
  children: ReactNode
}) {
  const mapX = layout === 'side' ? SHEET_R : 8
  const mapW = 512 - mapX
  return (
    <svg className="shot-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <defs>
        <linearGradient id={`${id}-sky`} x1={mapX} y1="8" x2="512" y2="292" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f5f3ff" />
          <stop offset="1" stopColor="#e9eff9" />
        </linearGradient>
        <pattern id={`${id}-grid`} width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.9" fill="rgba(124, 92, 255, 0.13)" />
        </pattern>
        <clipPath id={`${id}-clip`}>
          <rect x="8" y="8" width="504" height="284" rx="14" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-clip)`}>
        <rect x="8" y="8" width="504" height="284" fill="#fff" />
        {layout === 'plain' ? null : (
          <>
            <rect x={mapX} y="8" width={mapW} height="284" fill={`url(#${id}-sky)`} />
            <rect x={mapX} y="8" width={mapW} height="284" fill={`url(#${id}-grid)`} />
          </>
        )}
        {layout === 'side' ? <line x1={SHEET_R} y1="8" x2={SHEET_R} y2="292" stroke={LINE} /> : null}
        {children}
      </g>
      <rect x="8.5" y="8.5" width="503" height="283" rx="14" fill="none" stroke={LINE} />
    </svg>
  )
}

function SheetHead({ title }: { title: string }) {
  return (
    <g>
      <circle cx="26" cy="28" r="9.5" fill={SOFT} />
      <path
        d="M29 28h-6m3.5-3.5L23 28l3.5 3.5"
        stroke={MUTED}
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Label x={44} y={32} size={12} weight={650}>
        {title}
      </Label>
    </g>
  )
}

function Badge({
  x,
  y,
  label,
  tone = 'pin',
}: {
  x: number
  y: number
  label: string
  tone?: 'pin' | 'seal' | 'night' | 'accent'
}) {
  const fill = tone === 'seal' ? SEAL : tone === 'night' ? NIGHT : tone === 'accent' ? ACCENT : PIN
  return (
    <g>
      <rect x={x - 8} y={y - 8} width="16" height="16" rx="4.5" fill={fill} />
      <Label x={x} y={y + 3.4} size={9.5} weight={600} fill="#fff" anchor="middle">
        {label}
      </Label>
    </g>
  )
}

function Pill({
  x,
  y,
  label,
  on = false,
  pulse = false,
}: {
  x: number
  y: number
  label: string
  on?: boolean
  pulse?: boolean
}) {
  const w = textW(label, 9.5) + 16
  return (
    <g>
      {pulse ? (
        <rect
          x={x - 3.5}
          y={y - 11.5}
          width={w + 7}
          height="23"
          rx="7"
          fill="none"
          stroke={ACCENT}
          strokeWidth="1.5"
          opacity="0.5"
        />
      ) : null}
      <rect x={x} y={y - 8} width={w} height="16" rx="5" fill={on ? ACCENT : SOFT} />
      <Label x={x + w / 2} y={y + 3.3} size={9.5} weight={600} fill={on ? '#fff' : MUTED} anchor="middle">
        {label}
      </Label>
    </g>
  )
}

type MarkSpec = { label: string; tone?: 'seal' | 'night' | 'accent' }
type OpSpec = { label: string; on?: boolean; pulse?: boolean }

type StopSpec = {
  y: number
  no: string
  name: string
  tone?: string
  /** 名字后面挂的备注小标签（和侧栏清单、行程表里的是同一种）。 */
  note?: string
  marks?: MarkSpec[]
  ops?: OpSpec[]
  /** 新加进来的那一行：虚线框标出来。 */
  fresh?: boolean
}

/** 行程清单里的一行：序号 + 地点名 + 备注标签 + 起/终/夜徽标 + 行末的操作按钮。 */
function StopRow({ row }: { row: StopSpec }) {
  const nameW = textW(row.name, 11.5)
  const noteW = row.note ? textW(row.note, 9.5) + 13 : 0
  const markX = 50 + nameW + 13 + (noteW ? noteW + 5 : 0)
  const pills = (row.ops ?? []).map((op) => ({ ...op, w: textW(op.label, 9.5) + 16 }))
  // 行末按钮右对齐：从右往左算出每个按钮的左边界。
  const total = pills.reduce((sum, p) => sum + p.w + 5, 0)
  const pillX: number[] = []
  let x = 236 - total + 5
  for (const pill of pills) {
    pillX.push(x)
    x += pill.w + 5
  }
  return (
    <g>
      {row.fresh ? (
        <rect
          x="16"
          y={row.y - 15}
          width="220"
          height="30"
          rx="8"
          fill="none"
          stroke={ACCENT}
          strokeWidth="1.4"
          strokeDasharray="5 4"
        />
      ) : null}
      <circle cx="34" cy={row.y} r="9.5" fill={row.tone ?? PIN} />
      <Label x={34} y={row.y + 3.6} size={10} weight={600} fill="#fff" anchor="middle">
        {row.no}
      </Label>
      <Label x={50} y={row.y + 3.8} size={11.5} weight={600}>
        {row.name}
      </Label>
      {row.note ? (
        <g>
          <rect x={50 + nameW + 6} y={row.y - 7.5} width={noteW} height="15" rx="5" fill="#f1f4f8" />
          <Label x={50 + nameW + 12} y={row.y + 3.4} size={9.5} weight={400} fill={MUTED}>
            {row.note}
          </Label>
        </g>
      ) : null}
      {(row.marks ?? []).map((mark, i) => (
        <Badge key={mark.label} x={markX + i * 19} y={row.y} label={mark.label} tone={mark.tone} />
      ))}
      {pills.map((pill, i) => (
        <Pill key={pill.label} x={pillX[i]} y={row.y} label={pill.label} on={pill.on} pulse={pill.pulse} />
      ))}
    </g>
  )
}

/** 天数头：第 1 天 + 当天起点所在城市 + 当天公里数。 */
function DayHead({
  y,
  ink,
  title,
  city,
  km,
}: {
  y: number
  ink: string
  title: string
  city: string
  km: string
}) {
  return (
    <g>
      <rect x="16" y={y - 11} width="220" height="22" rx="7" fill={SOFT} />
      <circle cx="28" cy={y} r="3.6" fill={ink} />
      <Label x={38} y={y + 3.8} size={11.5} weight={650}>
        {title}
      </Label>
      <Label x={96} y={y + 3.8} size={10} fill={MUTED}>
        {city}
      </Label>
      <Label x={212} y={y + 3.8} size={10} fill={MUTED} anchor="end">
        {km}
      </Label>
      <path d={`M219 ${y - 2.5} L222.5 ${y + 1} L226 ${y - 2.5}`} stroke={MUTED} strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </g>
  )
}

function CarIcon({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(0.42)`}>
      <path
        fill={MUTED}
        d="M5.5 16a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm13 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11h1a1 1 0 0 1 1 1v3h-1.1a2.5 2.5 0 0 0-4.8 0H8.9a2.5 2.5 0 0 0-4.8 0H3v-3a1 1 0 0 1 1-1h1Z"
      />
    </g>
  )
}

function Cursor({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path
        d="M0 0 0 16 4.4 11.7 7.3 18 10.1 16.6 7.2 10.4 12.8 10z"
        fill="#fff"
        stroke={INK}
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </g>
  )
}

type PinSpec = { at: Point; label: string; name: string; tone: string; halo?: string }

/** 地图上的一颗点：白圈 + 底色 + 序号（起 / 终 用文字徽标），下面写地点名。 */
function MapPin({ spec }: { spec: PinSpec }) {
  const [x, y] = spec.at
  return (
    <g>
      {spec.halo ? <circle cx={x} cy={y} r="19" fill={spec.halo} opacity="0.2" /> : null}
      <circle cx={x} cy={y} r="12" fill="#fff" />
      <circle cx={x} cy={y} r="10" fill={spec.tone} />
      <Label x={x} y={y + 3.8} size={10.5} weight={600} fill="#fff" anchor="middle">
        {spec.label}
      </Label>
      <Label x={x} y={y + 25} size={10.5} weight={600} fill={INK} anchor="middle" halo>
        {spec.name}
      </Label>
    </g>
  )
}

/** 按天着色的路线；`split` 是换色的地点下标（前面是第 1 天，后面是第 2 天）。 */
function Route({ points, split, width = 4 }: { points: Point[]; split: number; width?: number }) {
  const head = curve(points.slice(0, split + 1))
  const tail = curve(points.slice(split))
  return (
    <g fill="none" strokeLinecap="round">
      <path d={head} stroke="#fff" strokeWidth={width + 4} opacity="0.85" />
      {tail ? <path d={tail} stroke="#fff" strokeWidth={width + 4} opacity="0.85" /> : null}
      <path d={head} stroke={DAY1} strokeWidth={width} />
      {tail ? <path d={tail} stroke={DAY2} strokeWidth={width} /> : null}
    </g>
  )
}

/** 01 · 加地点：搜到 → 点一下 → 落进行程清单。 */
export function ShotAdd() {
  const { t } = useI18n()
  const query = t('shot.p5')
  const rows: StopSpec[] = [
    { y: 76, no: '1', name: t('shot.p1') },
    { y: 110, no: '2', name: t('shot.p2') },
    { y: 144, no: '3', name: t('shot.p3') },
    { y: 178, no: '4', name: query, tone: ACCENT, fresh: true },
  ]
  const pins: PinSpec[] = [
    { at: [280, 176], label: '1', name: t('shot.p1'), tone: INK },
    { at: [322, 146], label: '2', name: t('shot.p2'), tone: INK },
    { at: [438, 166], label: '3', name: t('shot.p3'), tone: INK },
    { at: [356, 238], label: '4', name: query, tone: ACCENT, halo: ACCENT },
  ]
  const caretX = 276 + textW(query, 10.5) + 8
  return (
    <Frame id="shot-add" layout="side" label={t('feat.add.alt')}>
      <SheetHead title={t('shot.book')} />
      {rows.map((row) => (
        <StopRow key={row.no} row={row} />
      ))}

      {pins.map((spec) => (
        <MapPin key={spec.label} spec={spec} />
      ))}

      {/* 地图左上角的搜索框 + 结果列表 */}
      <rect x="256" y="16" width="156" height="24" rx="6" fill="#fff" />
      <rect x="256.5" y="16.5" width="155" height="23" rx="6" fill="none" stroke={LINE} />
      <circle cx="269" cy="27" r="4" stroke={MUTED} strokeWidth="1.2" fill="none" />
      <path d="M272 30l3.4 3.4" stroke={MUTED} strokeWidth="1.2" strokeLinecap="round" />
      <Label x={281} y={30.6} size={10.5} weight={600}>
        {query}
      </Label>
      <rect x={caretX} y="21" width="1.2" height="14" fill={ACCENT} />

      <rect x="256" y="44" width="212" height="76" rx="8" fill="#fff" />
      <rect x="256.5" y="44.5" width="211" height="75" rx="8" fill="none" stroke={LINE} />
      <rect x="257" y="45" width="210" height="37" fill={SOFT} />
      <Label x={270} y={65} size={11.5} weight={650}>
        {query}
      </Label>
      <Label x={270} y={79} size={9.5} fill={MUTED}>
        {t('shot.p5addr')}
      </Label>
      <line x1="256" y1="83" x2="468" y2="83" stroke={LINE} />
      <Label x={270} y={104} size={10.5} fill={MUTED}>
        {t('shot.p5b')}
      </Label>
      <Cursor x={378} y={62} />

      {/* 从结果飞到清单第 4 行 */}
      <path
        d="M302 98 C 278 130 254 152 232 172"
        stroke={ACCENT}
        strokeWidth="1.6"
        strokeDasharray="5 4"
        fill="none"
      />
      <circle cx="302" cy="98" r="3.4" fill={ACCENT} />
      <circle cx="232" cy="172" r="3.4" fill={ACCENT} />
    </Frame>
  )
}

/** 02 · 起点 / 终点：在行末点一下，其余地点自动串成一条顺路的线。 */
export function ShotEnds() {
  const { t } = useI18n()
  const rows: StopSpec[] = [
    {
      y: 74,
      no: '1',
      name: t('shot.p1'),
      marks: [{ label: t('sidebar.startBadge'), tone: 'seal' }],
      ops: [{ label: t('sidebar.setStart'), on: true }, { label: t('sidebar.setEnd') }],
    },
    { y: 106, no: '2', name: t('shot.p2'), ops: [{ label: t('sidebar.setStart') }, { label: t('sidebar.setEnd') }] },
    { y: 138, no: '3', name: t('shot.p3'), ops: [{ label: t('sidebar.setStart') }, { label: t('sidebar.setEnd') }] },
    { y: 170, no: '4', name: t('shot.p4'), ops: [{ label: t('sidebar.setStart') }, { label: t('sidebar.setEnd') }] },
    {
      y: 202,
      no: '5',
      name: t('shot.p5'),
      marks: [{ label: t('sidebar.endBadge'), tone: 'seal' }],
      ops: [{ label: t('sidebar.setStart') }, { label: t('sidebar.setEnd'), on: true, pulse: true }],
    },
  ]
  const points = PTS.side
  const pins: PinSpec[] = [
    { at: points[0], label: t('sidebar.startBadge'), name: t('shot.p1'), tone: DAY1 },
    { at: points[1], label: '2', name: t('shot.p2'), tone: DAY1 },
    { at: points[2], label: '3', name: t('shot.p3'), tone: DAY1 },
    { at: points[3], label: '4', name: t('shot.p4'), tone: DAY1 },
    { at: points[4], label: t('sidebar.endBadge'), name: t('shot.p5'), tone: DAY1 },
  ]
  const last = points[4]
  const first = points[0]
  return (
    <Frame id="shot-ends" layout="side" label={t('feat.ends.alt')}>
      <SheetHead title={t('shot.book')} />

      {/* 串好的路线（还没分天，所以只有第 1 天的颜色） */}
      <path d={curve(points)} stroke="#fff" strokeWidth="8" fill="none" strokeLinecap="round" opacity="0.85" />
      <path d={curve(points)} stroke={DAY1} strokeWidth="4" fill="none" strokeLinecap="round" />
      <path
        d={`M${last[0] - 4} ${last[1] - 6} C ${last[0] - 80} ${last[1] + 4}, ${first[0] + 60} ${first[1] + 34}, ${first[0] + 4} ${first[1] + 12}`}
        stroke={ACCENT}
        strokeWidth="1.6"
        strokeDasharray="5 4"
        fill="none"
      />

      {pins.map((spec) => (
        <MapPin key={spec.name} spec={spec} />
      ))}
      <Label x={306} y={236} size={10.5} weight={650} fill={ACCENT} halo>
        {t('shot.loop')}
      </Label>

      {rows.map((row) => (
        <StopRow key={row.no} row={row} />
      ))}
      <Cursor x={196} y={196} />
    </Frame>
  )
}

/** 03 · 过夜分天：行末点「过夜」，行程立刻分成第 1 天、第 2 天。 */
export function ShotNight() {
  const { t } = useI18n()
  const night = t('rail.nightBadge')
  const day1: StopSpec[] = [
    { y: 104, no: '1', name: t('shot.p1'), marks: [{ label: t('sidebar.startBadge'), tone: 'seal' }] },
    { y: 134, no: '2', name: t('shot.p2') },
    {
      y: 164,
      no: '3',
      name: t('shot.p3'),
      marks: [{ label: night, tone: 'night' }],
      ops: [{ label: t('sidebar.night'), on: true, pulse: true }],
    },
  ]
  const day2: StopSpec[] = [
    { y: 234, no: '4', name: t('shot.p4') },
    { y: 264, no: '5', name: t('shot.p5'), marks: [{ label: t('sidebar.endBadge'), tone: 'seal' }] },
  ]
  const points = PTS.side
  const pins: PinSpec[] = [
    { at: points[0], label: t('sidebar.startBadge'), name: t('shot.p1'), tone: DAY1 },
    { at: points[1], label: '2', name: t('shot.p2'), tone: DAY1 },
    { at: points[2], label: '3', name: t('shot.p3'), tone: DAY1 },
    { at: points[3], label: '4', name: t('shot.p4'), tone: DAY2 },
    { at: points[4], label: t('sidebar.endBadge'), name: t('shot.p5'), tone: DAY2 },
  ]
  const pin = points[2]
  return (
    <Frame id="shot-night" layout="side" label={t('feat.night.alt')}>
      <SheetHead title={t('shot.book')} />

      <Route points={points} split={2} />
      {/* 过夜的那颗点：加一圈虚线 + 一个「夜」标签 */}
      <circle cx={pin[0]} cy={pin[1]} r="17" fill="none" stroke={NIGHT} strokeWidth="1.6" strokeDasharray="4 3" />
      <line x1={pin[0] + 12} y1={pin[1] - 12} x2={pin[0] + 16} y2={pin[1] - 22} stroke={NIGHT} strokeWidth="1.2" />
      <rect x={pin[0] + 4} y={pin[1] - 40} width="24" height="18" rx="5" fill={NIGHT} />
      <Label x={pin[0] + 16} y={pin[1] - 27.4} size={10} weight={600} fill="#fff" anchor="middle">
        {night}
      </Label>

      {pins.map((spec) => (
        <MapPin key={spec.name} spec={spec} />
      ))}

      <DayHead y={74} ink={DAY1} title={t('sidebar.day', { n: 1 })} city={t('shot.p1')} km={formatKm(96)} />
      <line x1="34" y1="113" x2="34" y2="155" stroke={LINE} />
      {day1.map((row) => (
        <StopRow key={row.no} row={row} />
      ))}
      <DayHead y={204} ink={DAY2} title={t('sidebar.day', { n: 2 })} city={t('shot.p4')} km={formatKm(78)} />
      <line x1="34" y1="243" x2="34" y2="255" stroke={LINE} />
      {day2.map((row) => (
        <StopRow key={row.no} row={row} />
      ))}
      <Cursor x={186} y={158} />
    </Frame>
  )
}

/** 地点备注：行末点「备注」，在名字下方写一句停车、门票、联系人之类的话。 */
export function ShotNote() {
  const { t } = useI18n()
  const note = t('shot.note')
  const rows: StopSpec[] = [
    { y: 76, no: '1', name: t('shot.p1'), marks: [{ label: t('sidebar.startBadge'), tone: 'seal' }] },
    {
      y: 110,
      no: '2',
      name: t('shot.p2'),
      note,
      ops: [{ label: t('sidebar.note'), on: true, pulse: true }],
    },
    { y: 186, no: '3', name: t('shot.p3') },
    { y: 218, no: '4', name: t('shot.p4') },
    { y: 250, no: '5', name: t('shot.p5'), marks: [{ label: t('sidebar.endBadge'), tone: 'seal' }] },
  ]
  const points = PTS.side
  const pins: PinSpec[] = [
    { at: points[0], label: t('sidebar.startBadge'), name: t('shot.p1'), tone: DAY1 },
    { at: points[1], label: '2', name: t('shot.p2'), tone: DAY1 },
    { at: points[2], label: '3', name: t('shot.p3'), tone: DAY1 },
    { at: points[3], label: '4', name: t('shot.p4'), tone: DAY2 },
    { at: points[4], label: t('sidebar.endBadge'), name: t('shot.p5'), tone: DAY2 },
  ]
  // 展开的输入框：和侧栏一样，缩进在名字下方，聚焦时带一圈蓝色光晕。
  const boxX = 32
  const boxY = 126
  const boxW = 204
  return (
    <Frame id="shot-note" layout="side" label={t('feat.note.alt')}>
      <SheetHead title={t('shot.book')} />

      <Route points={points} split={2} />
      {pins.map((spec) => (
        <MapPin key={spec.name} spec={spec} />
      ))}

      {rows.map((row) => (
        <StopRow key={row.no} row={row} />
      ))}

      <rect
        x={boxX - 2}
        y={boxY - 2}
        width={boxW + 4}
        height="48"
        rx="9"
        fill="none"
        stroke={PIN}
        strokeWidth="4"
        opacity="0.16"
      />
      <rect x={boxX} y={boxY} width={boxW} height="44" rx="7" fill="#fff" stroke={PIN} />
      <Label x={boxX + 8} y={boxY + 18} size={10.5}>
        {note}
      </Label>
      <rect x={boxX + 10 + textW(note, 10.5)} y={boxY + 9} width="1.2" height="14" fill={ACCENT} />
      <Cursor x={198} y={104} />
    </Frame>
  )
}

/** 04 · 行程尺：整条路线按里程铺开，珠子能点、能拖。 */
export function ShotRail() {
  const { t } = useI18n()
  const points = PTS.stack
  const names = [t('shot.p1'), t('shot.p2'), t('shot.p3'), t('shot.p4'), t('shot.p5')]
  const beadX = [56, 158, 260, 362, 464]
  const beadLabels = [
    t('rail.startBadge'),
    '2',
    t('rail.nightBadge'),
    '4',
    t('rail.endBadge'),
  ]
  const pins: PinSpec[] = [
    { at: points[0], label: t('sidebar.startBadge'), name: names[0], tone: DAY1 },
    { at: points[1], label: '2', name: names[1], tone: DAY1 },
    { at: points[2], label: '3', name: names[2], tone: DAY1 },
    { at: points[3], label: '4', name: names[3], tone: DAY2 },
    { at: points[4], label: t('sidebar.endBadge'), name: names[4], tone: DAY2 },
  ]
  const raidY = 212
  return (
    <Frame id="shot-rail" layout="stack" label={t('feat.rail.alt')}>
      <Route points={points} split={2} />
      {pins.map((spec) => (
        <MapPin key={spec.name} spec={spec} />
      ))}

      {/* 行程尺：尺子从地图下方整条铺开 */}
      <rect x="8" y="150" width="504" height="142" fill="#fff" />
      <line x1="8" y1="150" x2="512" y2="150" stroke={LINE} />
      <Label x={24} y={172} size={11.5} weight={650}>
        {t('rail.title')}
      </Label>

      {beadX.slice(0, -1).map((x, i) => (
        <rect
          key={`seg-${i}`}
          x={x + 12}
          y={raidY - 1.5}
          width={beadX[i + 1] - x - 24}
          height="3"
          rx="1.5"
          fill={i < 2 ? DAY1 : DAY2}
        />
      ))}

      {beadX.map((x, i) => (
        <g key={`bead-${i}`}>
          <circle cx={x} cy={raidY} r="11" fill={i === 2 ? NIGHT : PIN} />
          <circle cx={x} cy={raidY} r="11" fill="none" stroke="#fff" strokeWidth="2.5" />
          <Label x={x} y={raidY + 3.8} size={10} weight={600} fill="#fff" anchor="middle">
            {beadLabels[i]}
          </Label>
          <Label x={x} y={raidY + 26} size={9.5} fill={MUTED} anchor="middle">
            {names[i]}
          </Label>
        </g>
      ))}

      {/* 拖拽：按住「夜」拖到别的点 */}
      <path d={`M260 ${raidY - 12} C 290 ${raidY - 30}, 332 ${raidY - 30}, 362 ${raidY - 12}`} stroke={ACCENT} strokeWidth="1.6" strokeDasharray="5 4" fill="none" />
      <circle cx="362" cy={raidY} r="18" fill="none" stroke={NIGHT} strokeWidth="1.6" strokeDasharray="4 3" />
      <Cursor x={254} y={raidY - 10} />

      <circle cx="26" cy="270" r="4" fill={DAY1} />
      <Label x={38} y={273.4} size={9.5} fill={MUTED}>
        {t('rail.day', { n: 1, km: formatKm(96) })}
      </Label>
      <circle cx="190" cy="270" r="4" fill={DAY2} />
      <Label x={202} y={273.4} size={9.5} fill={MUTED}>
        {t('rail.day', { n: 2, km: formatKm(78) })}
      </Label>
    </Frame>
  )
}

/** 05 · 里程与时长：点与点之间标着大概开多久，四个总数实时重算。 */
export function ShotLegs() {
  const { t } = useI18n()
  const stops: StopSpec[] = [
    { y: 72, no: '1', name: t('shot.p1'), marks: [{ label: t('sidebar.startBadge'), tone: 'seal' }] },
    { y: 128, no: '2', name: t('shot.p2') },
    { y: 184, no: '3', name: t('shot.p3'), marks: [{ label: t('rail.nightBadge'), tone: 'night' }] },
    { y: 240, no: '4', name: t('shot.p5'), marks: [{ label: t('sidebar.endBadge'), tone: 'seal' }] },
  ]
  const legs = [
    { y: 100, text: formatLegLabel(62, 70) },
    { y: 156, text: formatLegLabel(48, 55) },
    { y: 212, text: formatLegLabel(76, 80) },
  ]
  const pins: PinSpec[] = [
    { at: [278, 86], label: t('sidebar.startBadge'), name: t('shot.p1'), tone: DAY1 },
    { at: [318, 62], label: '2', name: t('shot.p2'), tone: DAY1 },
    { at: [408, 78], label: '3', name: t('shot.p3'), tone: DAY1 },
    { at: [364, 152], label: '4', name: t('shot.p4'), tone: DAY2 },
    { at: [282, 164], label: t('sidebar.endBadge'), name: t('shot.p5'), tone: DAY2 },
  ]
  const stats: { label: string; value: string }[] = [
    { label: t('rail.statDays'), value: '2' },
    { label: t('rail.statPlaces'), value: '4' },
    { label: t('rail.statKm'), value: formatKm(186) },
    { label: t('rail.statTime'), value: formatDuration(205) },
  ]
  return (
    <Frame id="shot-legs" layout="side" label={t('feat.legs.alt')}>
      <SheetHead title={t('shot.book')} />

      <Route points={[[266, 86], [318, 62], [408, 78], [364, 152], [272, 164]]} split={2} />
      {pins.map((spec) => (
        <MapPin key={spec.name} spec={spec} />
      ))}

      {/* 总数：天数 / 地点 / 总里程 / 驾驶时长 */}
      <rect x="296" y="198" width="200" height="84" rx="10" fill="#fff" />
      <rect x="296.5" y="198.5" width="199" height="83" rx="10" fill="none" stroke={LINE} />
      {stats.map((stat, i) => {
        const x = i % 2 === 0 ? 312 : 400
        const y = i < 2 ? 222 : 262
        return (
          <g key={stat.label}>
            <Label x={x} y={y} size={9} fill={MUTED}>
              {stat.label}
            </Label>
            <Label x={x} y={y + 17} size={12} weight={650}>
              {stat.value}
            </Label>
          </g>
        )
      })}
      {/* 清单：行与行之间是「开车多久」，左侧一条竖线把当天串起来 */}
      <line x1="34" y1="81" x2="34" y2="230" stroke={LINE} />
      {legs.map((leg) => (
        <g key={leg.text}>
          <CarIcon x={34} y={leg.y - 5} />
          <Label x={52} y={leg.y + 3.4} size={10} fill={MUTED}>
            {leg.text}
          </Label>
        </g>
      ))}
      {stops.map((row) => (
        <StopRow key={row.no} row={row} />
      ))}
    </Frame>
  )
}

/** 06 · 点地图看地点：在地图上点一处，右侧弹出离那一点最近的高德地点。 */
export function ShotPoi() {
  const { t } = useI18n()
  const points: Point[] = [
    [46, 216],
    [118, 178],
    [186, 208],
    [252, 162],
  ]
  const pins: PinSpec[] = [
    { at: points[0], label: t('sidebar.startBadge'), name: t('shot.p1'), tone: DAY1 },
    { at: points[1], label: '2', name: t('shot.p2'), tone: DAY1 },
    { at: points[2], label: '3', name: t('shot.p3'), tone: DAY2 },
    { at: points[3], label: t('sidebar.endBadge'), name: t('shot.p4'), tone: DAY2 },
  ]
  const tap: Point = [206, 244]
  const cx = 288
  const cy = 18
  const cw = 216
  const ch = 258
  const px = cx + 10
  const pw = cw - 20
  const addW = textW(t('poi.add'), 9.5) + 16
  return (
    <Frame id="shot-poi" layout="stack" label={t('feat.poi.alt')}>
      <defs>
        <linearGradient id="shot-poi-photo" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#d5e3ff" />
          <stop offset="1" stopColor="#eef3ff" />
        </linearGradient>
        <clipPath id="shot-poi-photo-clip">
          <rect x={px} y={cy + 10} width={pw} height="84" rx="8" />
        </clipPath>
      </defs>

      <Route points={points} split={2} width={3.5} />
      {pins.map((spec) => (
        <MapPin key={spec.name} spec={spec} />
      ))}

      {/* 手指点下去的那一处 */}
      <circle cx={tap[0]} cy={tap[1]} r="13" fill="none" stroke={ACCENT} strokeWidth="1.6" />
      <circle cx={tap[0]} cy={tap[1]} r="4.2" fill={ACCENT} />
      <path
        d={`M${tap[0] + 13} ${tap[1] - 4} C ${tap[0] + 70} ${tap[1] - 46}, ${cx - 46} ${cy + 40}, ${cx - 2} ${cy + 62}`}
        stroke={ACCENT}
        strokeWidth="1.4"
        strokeDasharray="5 4"
        fill="none"
        opacity="0.75"
      />

      {/* 右侧地点卡片 */}
      <rect x={cx} y={cy} width={cw} height={ch} rx="14" fill="#fff" />
      <rect
        x={cx + 0.5}
        y={cy + 0.5}
        width={cw - 1}
        height={ch - 1}
        rx="14"
        fill="none"
        stroke={LINE}
      />
      <rect x={px} y={cy + 10} width={pw} height="84" rx="8" fill="url(#shot-poi-photo)" />
      <g clipPath="url(#shot-poi-photo-clip)">
        <path
          d={`M${px} ${cy + 94} L${px + 44} ${cy + 58} L${px + 78} ${cy + 84} L${px + 108} ${cy + 62} L${px + 160} ${cy + 94} Z`}
          fill="#a9c4ef"
        />
        <path
          d={`M${px - 4} ${cy + 94} L${px + 40} ${cy + 70} L${px + 84} ${cy + 92} L${px + 130} ${cy + 72} L${px + 200} ${cy + 94} Z`}
          fill="#8fb0e2"
          opacity="0.85"
        />
      </g>

      <Label x={px} y={cy + 116} size={13} weight={650}>
        {t('shot.p5')}
      </Label>
      <path
        d={`M${px + 6} ${cy + 125.5} l1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6Z`}
        fill="#f5a623"
      />
      <Label x={px + 17} y={cy + 135} size={10} fill={MUTED}>
        {`4.6 · ${t('poi.ratingNote')}`}
      </Label>
      <Label x={px} y={cy + 152} size={9.5} fill={MUTED}>
        {t('shot.p5addr')}
      </Label>
      <Label x={px} y={cy + 170} size={9.5} fill={MUTED}>
        {`${t('poi.distance')} · ${t('unit.meters', { n: 120 })}`}
      </Label>

      <line x1={px} y1={cy + 184} x2={px + pw} y2={cy + 184} stroke={LINE} />
      <Label x={px} y={cy + 200} size={9.5} weight={650}>
        {t('poi.nearby')}
      </Label>
      <circle cx={px + 4} cy={cy + 214} r="3" fill={PIN} />
      <Label x={px + 13} y={cy + 217} size={9.5} fill={MUTED}>
        {t('shot.p5b')}
      </Label>

      <Pill x={px} y={cy + 242} label={t('poi.add')} on />
      <Pill x={px + addW + 6} y={cy + 242} label={t('poi.skip')} />
    </Frame>
  )
}

/** 07 · 云端书架：改动先落本地、防抖后写库；换设备登录同一账号接着改。 */
export function ShotShelf() {
  const { t } = useI18n()
  const cards = [
    {
      x: 24,
      title: t('shot.book'),
      days: 5,
      places: 12,
      chips: [t('card.loop'), t('shot.public')],
      pts: [
        [52, 178],
        [104, 138],
        [152, 172],
        [202, 132],
        [226, 158],
      ] as Point[],
    },
    {
      x: 268,
      title: t('shot.book2'),
      days: 3,
      places: 8,
      chips: [t('card.private')],
      pts: [
        [296, 178],
        [348, 138],
        [396, 172],
        [444, 132],
        [470, 158],
      ] as Point[],
    },
  ]
  const cardY = 100
  const cardW = 228
  const cardH = 170
  const newW = textW(t('mine.newBook'), 9.5) + 16
  return (
    <Frame id="shot-shelf" layout="plain" label={t('feat.shelf.alt')}>
      <defs>
        {cards.map((card, i) => (
          <clipPath key={card.title} id={`shot-shelf-thumb-${i}`}>
            <rect x={card.x + 12} y={cardY + 12} width={cardW - 24} height="84" rx="8" />
          </clipPath>
        ))}
      </defs>

      {/* 页头 */}
      <rect x="8" y="8" width="504" height="40" fill="#fbfbfd" />
      <line x1="8" y1="48" x2="512" y2="48" stroke={LINE} />
      <circle cx="30" cy="28" r="8" fill={ACCENT} opacity="0.16" />
      <Label x={44} y={32} size={12} weight={700} fill={ACCENT}>
        lushu
      </Label>
      <Label x={285} y={32} size={10.5} fill={MUTED}>
        {t('nav.mine')}
      </Label>
      <Label x={366} y={32} size={10.5} fill={MUTED}>
        {t('nav.public')}
      </Label>
      <circle cx="482" cy="28" r="9" fill={SOFT} />
      <Label x={482} y={31.6} size={9} weight={600} fill={MUTED} anchor="middle">
        L
      </Label>

      <Label x={24} y={80} size={17} weight={700}>
        {t('mine.heading')}
      </Label>
      <Pill x={504 - 16 - newW} y={74} label={t('mine.newBook')} on />

      {cards.map((card, i) => {
        let chipX = card.x + 12
        const chips = card.chips.map((label) => {
          const node = (
            <Pill key={label} x={chipX} y={cardY + 152} label={label} on={label === t('shot.public')} />
          )
          chipX += textW(label, 9.5) + 16 + 6
          return node
        })
        return (
          <g key={card.title}>
            <rect x={card.x} y={cardY} width={cardW} height={cardH} rx="14" fill="#fff" />
            <rect
              x={card.x + 0.5}
              y={cardY + 0.5}
              width={cardW - 1}
              height={cardH - 1}
              rx="14"
              fill="none"
              stroke={LINE}
            />
            <rect x={card.x + 12} y={cardY + 12} width={cardW - 24} height="84" rx="8" fill="#f5f6fb" />
            <g clipPath={`url(#shot-shelf-thumb-${i})`}>
              <Route points={card.pts} split={2} width={3} />
            </g>
            {card.pts.map(([x, y], j) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r="3.2" fill={j <= 2 ? DAY1 : DAY2} stroke="#fff" strokeWidth="1.4" />
            ))}
            <Label x={card.x + 12} y={cardY + 110} size={12.5} weight={650}>
              {card.title}
            </Label>
            <Label x={card.x + 12} y={cardY + 130} size={9.5} fill={MUTED}>
              {`${t('card.days', { n: card.days })} · ${card.places} ${t('card.placesUnit')}`}
            </Label>
            {chips}
          </g>
        )
      })}
    </Frame>
  )
}

/** 08 · 分享与可见性：公开后链接人人可读，私密书对外打不开。 */
export function ShotShare() {
  const { t } = useI18n()
  const dx = 112
  const dy = 42
  const dw = 296
  const dh = 216
  const copyW = textW(t('book.shareCopy'), 9.5) + 16
  return (
    <Frame id="shot-share" layout="plain" label={t('feat.share.alt')}>
      {/* 背后的路书页（示意） */}
      <rect x="8" y="8" width="504" height="36" fill="#fbfbfd" />
      <line x1="8" y1="44" x2="512" y2="44" stroke={LINE} />
      <rect x="24" y="66" width="150" height="200" rx="12" fill="#fafafb" stroke={LINE} />
      <rect x="190" y="66" width="150" height="200" rx="12" fill="#fafafb" stroke={LINE} />
      <rect x="356" y="66" width="132" height="200" rx="12" fill="#fafafb" stroke={LINE} />
      <rect x="8" y="8" width="504" height="284" fill="rgba(16, 16, 24, 0.07)" />

      {/* 分享对话框 */}
      <rect x={dx + 3} y={dy + 7} width={dw} height={dh} rx="16" fill="rgba(16, 16, 24, 0.10)" />
      <rect x={dx} y={dy} width={dw} height={dh} rx="16" fill="#fff" />
      <rect
        x={dx + 0.5}
        y={dy + 0.5}
        width={dw - 1}
        height={dh - 1}
        rx="16"
        fill="none"
        stroke={LINE}
      />

      <Label x={dx + 24} y={dy + 36} size={13.5} weight={650}>
        {t('book.shareTitle')}
      </Label>
      <Label x={dx + 24} y={dy + 58} size={9.5} fill={MUTED}>
        {t('feat.share.note')}
      </Label>
      <Label x={dx + 24} y={dy + 84} size={9} weight={650} fill={MUTED}>
        {t('book.shareLink')}
      </Label>
      <rect x={dx + 24} y={dy + 92} width={172} height={28} rx="7" fill={SOFT} />
      <Label x={dx + 34} y={dy + 110} size={9.5} fill={MUTED}>
        lushu.fittools.cc/d/8f3a…
      </Label>
      <Pill x={dx + 202} y={dy + 106} label={t('book.shareCopy')} on />

      <line x1={dx + 24} y1={dy + 138} x2={dx + dw - 24} y2={dy + 138} stroke={LINE} />
      <Label x={dx + 24} y={dy + 166} size={10.5} weight={600}>
        {t('features.visibility')}
      </Label>
      <Label x={dx + dw - 24 - copyW - 8} y={dy + 166} size={10} fill={ACCENT} anchor="end">
        {t('shot.public')}
      </Label>
      <rect x={dx + dw - 24 - 40} y={dy + 156} width="40" height="20" rx="10" fill={ACCENT} />
      <circle cx={dx + dw - 24 - 10} cy={dy + 166} r="7.5" fill="#fff" />
    </Frame>
  )
}

/** 09 · 账号：邮箱 + 口令注册，邮件激活，登录态存在会话 cookie 里。 */
export function ShotAccount() {
  const { t } = useI18n()
  const x0 = 32
  const y0 = 40
  const w = 220
  const h = 220
  const rx0 = 268
  const tabW = textW(t('auth.tabLogin'), 13)
  return (
    <Frame id="shot-account" layout="plain" label={t('feat.account.alt')}>
      {/* 登录 / 注册 */}
      <rect x={x0} y={y0} width={w} height={h} rx="16" fill="#fff" />
      <rect x={x0 + 0.5} y={y0 + 0.5} width={w - 1} height={h - 1} rx="16" fill="none" stroke={LINE} />
      <Label x={x0 + 24} y={y0 + 38} size={13} weight={650}>
        {t('auth.tabLogin')}
      </Label>
      <Label x={x0 + 34 + tabW} y={y0 + 38} size={13} fill={MUTED}>
        {t('auth.tabRegister')}
      </Label>
      <rect x={x0 + 24} y={y0 + 46} width={tabW} height="2.4" rx="1.2" fill={ACCENT} />

      <rect x={x0 + 24} y={y0 + 68} width={w - 48} height="30" rx="8" fill={SOFT} />
      <Label x={x0 + 36} y={y0 + 87} size={10} fill={MUTED}>
        {t('auth.email')}
      </Label>
      <rect x={x0 + 24} y={y0 + 108} width={w - 48} height="30" rx="8" fill={SOFT} />
      <Label x={x0 + 36} y={y0 + 127} size={10} fill={MUTED}>
        {t('auth.password')}
      </Label>

      <rect x={x0 + 24} y={y0 + 154} width={w - 48} height="32" rx="9" fill={ACCENT} />
      <Label x={x0 + w / 2} y={y0 + 175} size={11.5} weight={650} fill="#fff" anchor="middle">
        {t('auth.tabLogin')}
      </Label>

      {/* 账户信息 */}
      <rect x={rx0} y={y0} width={w} height={h} rx="16" fill="#fff" />
      <rect x={rx0 + 0.5} y={y0 + 0.5} width={w - 1} height={h - 1} rx="16" fill="none" stroke={LINE} />
      <circle cx={rx0 + 46} cy={y0 + 46} r="16" fill={ACCENT} opacity="0.16" />
      <Label x={rx0 + 46} y={y0 + 50.6} size={13} weight={700} fill={ACCENT} anchor="middle">
        L
      </Label>
      <Label x={rx0 + 72} y={y0 + 42} size={11} weight={650}>
        you@example.com
      </Label>
      <Label x={rx0 + 72} y={y0 + 58} size={9} fill={MUTED}>
        {t('account.email')}
      </Label>

      <line x1={rx0 + 24} y1={y0 + 82} x2={rx0 + w - 24} y2={y0 + 82} stroke={LINE} />
      <Label x={rx0 + 24} y={y0 + 104} size={8.5} fill={MUTED}>
        {t('account.userId')}
      </Label>
      <Label x={rx0 + 24} y={y0 + 120} size={11} weight={600}>
        1a2b3c4d5e
      </Label>
      <Label x={rx0 + 24} y={y0 + 146} size={8.5} fill={MUTED}>
        {t('account.joined')}
      </Label>
      <Label x={rx0 + 24} y={y0 + 162} size={11} weight={600}>
        2026-09-17
      </Label>
      <Label x={rx0 + 24} y={y0 + 192} size={10.5} fill={ACCENT}>
        {t('account.signOut')}
      </Label>
    </Frame>
  )
}

/** 07 · 行程表：整屏铺开，一天一行；点某一天，地图高亮那一段。 */
export function ShotTable() {
  const { t } = useI18n()
  const cols = { day: 28, route: 116, km: 358, time: 426 }
  const rows = [
    { day: 1, stops: `${t('shot.p1')} → ${t('shot.p2')}`, km: 62, min: 70, ink: DAY1 },
    { day: 2, stops: `${t('shot.p3')} → ${t('shot.p4')}`, km: 76, min: 80, ink: DAY2 },
    { day: 3, stops: t('shot.p5'), km: 48, min: 55, ink: DAY3 },
  ]
  const stats = [
    { label: t('rail.statDays'), value: '3' },
    { label: t('rail.statPlaces'), value: '5' },
    { label: t('rail.statKm'), value: formatKm(186) },
    { label: t('rail.statTime'), value: formatDuration(205) },
  ]
  const top = 104
  const rowH = 56
  return (
    <Frame id="shot-table" layout="plain" label={t('feat.table.alt')}>
      {/* 浮层头部：标题 + 四个总数 + 关闭 */}
      <Label x={28} y={38} size={15} weight={700}>
        {t('table.title')}
      </Label>
      <Label x={28} y={56} size={9.5} fill={MUTED}>
        {t('shot.book')}
      </Label>
      {stats.map((stat, i) => (
        <g key={stat.label}>
          <Label x={228 + i * 58} y={34} size={7.5} fill={MUTED}>
            {stat.label}
          </Label>
          <Label x={228 + i * 58} y={50} size={9.5} weight={650}>
            {stat.value}
          </Label>
        </g>
      ))}
      <circle cx="488" cy="40" r="12" fill={SOFT} />
      <path d="M483 35l10 10M493 35l-10 10" stroke={MUTED} strokeWidth="1.4" strokeLinecap="round" />
      <line x1="8" y1="72" x2="512" y2="72" stroke={LINE} />

      {/* 表头 */}
      <rect x="8" y="72" width="504" height="32" fill="#fafafb" />
      <Label x={cols.day} y={92} size={9.5} weight={650} fill={MUTED}>
        {t('table.day')}
      </Label>
      <Label x={cols.route} y={92} size={9.5} weight={650} fill={MUTED}>
        {t('table.route')}
      </Label>
      <Label x={cols.km} y={92} size={9.5} weight={650} fill={MUTED}>
        {t('table.km')}
      </Label>
      <Label x={cols.time} y={92} size={9.5} weight={650} fill={MUTED}>
        {t('table.time')}
      </Label>
      <line x1="8" y1="104" x2="512" y2="104" stroke={LINE} />

      {/* 一天一行；第 1 天是点开高亮的那一天 */}
      {rows.map((row, i) => {
        const y = top + i * rowH
        const center = y + rowH / 2
        return (
          <g key={row.day}>
            {i === 0 ? <rect x="8" y={y} width="504" height={rowH} fill={ACCENT} opacity="0.07" /> : null}
            {i === 0 ? <rect x="8" y={y} width="3" height={rowH} fill={ACCENT} /> : null}
            <circle cx={cols.day + 4} cy={center} r="3.6" fill={row.ink} />
            <Label x={cols.day + 16} y={center + 3.6} size={11} weight={650}>
              {t('sidebar.day', { n: row.day })}
            </Label>
            <Label x={cols.route} y={center + 3.8} size={10.5}>
              {row.stops}
            </Label>
            <Label x={cols.km} y={center + 3.6} size={10.5} fill={MUTED}>
              {formatKm(row.km)}
            </Label>
            <Label x={cols.time} y={center + 3.6} size={10.5} fill={MUTED}>
              {formatDuration(row.min)}
            </Label>
            {i > 0 ? <line x1="8" y1={y} x2="512" y2={y} stroke={LINE} /> : null}
          </g>
        )
      })}
      <line x1="8" y1={top + rows.length * rowH} x2="512" y2={top + rows.length * rowH} stroke={LINE} />
    </Frame>
  )
}
