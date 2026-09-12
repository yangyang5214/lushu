import type { CSSProperties } from 'react'
import { useI18n, type MsgKey } from '../lib/i18n'

const CYCLE = '14s'
const DAY1 = '#ff4d4f'
const DAY2 = '#1677ff'
const PIN = '#3d7eff'

/** 与编辑页一致的示意：散点加入 → 自动串线 → 钉过夜点 → 行程尺分天 */
const PINS: readonly {
  x: number
  y: number
  dx: number
  dy: number
  nameKey: MsgKey
  badge: string
  badgeKey?: MsgKey
  split?: boolean
}[] = [
  { x: 58, y: 118, dx: 34, dy: -68, nameKey: 'diagram.hangzhou', badge: '', badgeKey: 'sidebar.startBadge' },
  { x: 148, y: 88, dx: 78, dy: -48, nameKey: 'diagram.qiandaohu', badge: '2' },
  { x: 258, y: 72, dx: 118, dy: -12, nameKey: 'diagram.huangshan', badge: '3', split: true },
  { x: 372, y: 96, dx: -208, dy: 42, nameKey: 'diagram.hongcun', badge: '4' },
  { x: 478, y: 128, dx: -36, dy: -82, nameKey: 'diagram.jingdezhen', badge: '', badgeKey: 'sidebar.endBadge' },
]

const ROUTE1 =
  'M58 118 C 96 98, 118 92, 148 88 C 198 78, 228 74, 258 72'
const ROUTE2 =
  'M258 72 C 302 78, 338 86, 372 96 C 418 108, 452 118, 478 128'

const RAIL_X = [56, 152, 248, 344, 440] as const
const RAIL = {
  top: 176,
  height: 98,
  titleY: 190,
  trackY: 214,
  dividerY: 244,
  daysCy: 258,
  daysTextY: 261,
} as const

export function HeroDiagram() {
  const { t } = useI18n()
  return (
    <div className="hero-diagram" aria-hidden style={{ '--hero-cycle': CYCLE } as CSSProperties}>
      <div className="hero-diagram-head">
        <span className="hero-diagram-step hero-diagram-step--add">{t('diagram.add')}</span>
        <span className="hero-diagram-arrow">→</span>
        <span className="hero-diagram-step hero-diagram-step--route">{t('diagram.route')}</span>
        <span className="hero-diagram-arrow">→</span>
        <span className="hero-diagram-step hero-diagram-step--split">{t('diagram.split')}</span>
      </div>
      <svg className="hero-diagram-svg" viewBox="0 0 520 284" fill="none">
        <defs>
          <linearGradient id="hero-map-fill" x1="8" y1="8" x2="512" y2="170" gradientUnits="userSpaceOnUse">
            <stop stopColor="#f3f0ff" />
            <stop offset="1" stopColor="#e6edf8" />
          </linearGradient>
          <pattern id="hero-map-grid" width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.8" fill="rgba(124, 92, 255, 0.1)" />
          </pattern>
        </defs>

        {/* 迷你地图 */}
        <rect className="hero-map" x="8" y="8" width="504" height="162" rx="10" fill="url(#hero-map-fill)" />
        <rect x="8" y="8" width="504" height="162" rx="10" fill="url(#hero-map-grid)" />

        <g className="hero-search">
          <rect x="20" y="16" width="84" height="18" rx="3" fill="#fff" filter="drop-shadow(0 1px 3px rgba(0,0,0,0.1))" />
          <circle cx="28" cy="25" r="3.2" stroke="#7a6f62" strokeWidth="1.2" opacity="0.55" />
          <path d="M30.2 27.2 32.8 29.8" stroke="#7a6f62" strokeWidth="1.2" strokeLinecap="round" opacity="0.55" />
          <text x="36" y="28" fill="#8a93a0" fontSize="8" fontFamily="Manrope, Noto Sans SC, sans-serif">
            {t('diagram.search')}
          </text>
        </g>

        <path
          className="hero-route hero-route--1"
          d={ROUTE1}
          pathLength={1}
          stroke={DAY1}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          className="hero-route hero-route--2"
          d={ROUTE2}
          pathLength={1}
          stroke={DAY2}
          strokeWidth="3"
          strokeLinecap="round"
        />

        {PINS.map((pin, i) => (
          <g key={pin.nameKey} transform={`translate(${pin.x} ${pin.y})`}>
            <g
              className="hero-pin"
              style={
                {
                  '--hero-delay': `${i * 0.35}s`,
                  '--dx': `${pin.dx}px`,
                  '--dy': `${pin.dy}px`,
                } as CSSProperties
              }
            >
              <circle className="hero-pin-halo" r="14" fill={PIN} />
              <circle className="hero-pin-dot" r="11" fill={PIN} />
              <text
                className="hero-pin-badge"
                textAnchor="middle"
                dominantBaseline="central"
                fill="#fff"
                fontSize="10"
                fontWeight="600"
                fontFamily="Manrope, Noto Sans SC, sans-serif"
              >
                {pin.badgeKey ? t(pin.badgeKey) : pin.badge}
              </text>
              <text
                className="hero-pin-name"
                y="22"
                textAnchor="middle"
                fill="#1b1712"
                fontSize="9.5"
                fontWeight="500"
                fontFamily="Manrope, Noto Sans SC, sans-serif"
              >
                {t(pin.nameKey)}
              </text>
              {pin.split ? (
                <g className="hero-split-flash">
                  <circle r="11" fill="#ef4444" />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#fff"
                    fontSize="10"
                    fontWeight="600"
                    fontFamily="Manrope, Noto Sans SC, sans-serif"
                  >
                    {t('diagram.night')}
                  </text>
                </g>
              ) : null}
            </g>
          </g>
        ))}

        {/* 迷你行程尺 */}
        <g className="hero-rail">
          <rect
            x="8"
            y={RAIL.top}
            width="504"
            height={RAIL.height}
            rx="8"
            fill="#fff"
            stroke="#eef0f3"
          />
          <text
            x="22"
            y={RAIL.titleY}
            fill="#1b1712"
            fontSize="10"
            fontWeight="600"
            fontFamily="Manrope, Noto Sans SC, sans-serif"
          >
            {t('diagram.ruler')}
          </text>

          {RAIL_X.slice(0, -1).map((x, i) => (
            <rect
              key={`seg-${i}`}
              className={`hero-rail-seg hero-rail-seg--${i < 2 ? 1 : 2}`}
              x={x + 12}
              y={RAIL.trackY - 1.5}
              width={RAIL_X[i + 1] - x - 24}
              height="3"
              rx="1.5"
              fill={i < 2 ? DAY1 : DAY2}
            />
          ))}

          {RAIL_X.map((x, i) => {
            const pin = PINS[i]
            const isSplit = Boolean(pin?.split)
            return (
              <g key={`bead-${i}`} transform={`translate(${x} ${RAIL.trackY})`}>
                <circle className={`hero-bead-dot${isSplit ? ' hero-bead-dot--split' : ''}`} r="9" fill={PIN} />
                {isSplit ? (
                  <>
                    <text
                      className="hero-bead-num"
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#fff"
                      fontSize="8.5"
                      fontWeight="600"
                      fontFamily="Manrope, Noto Sans SC, sans-serif"
                    >
                      3
                    </text>
                    <text
                      className="hero-bead-night"
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#fff"
                      fontSize="8.5"
                      fontWeight="600"
                      fontFamily="Manrope, Noto Sans SC, sans-serif"
                    >
                      {t('diagram.night')}
                    </text>
                  </>
                ) : (
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="#fff"
                    fontSize="8.5"
                    fontWeight="600"
                    fontFamily="Manrope, Noto Sans SC, sans-serif"
                  >
                    {pin.badgeKey ? t(pin.badgeKey) : pin.badge}
                  </text>
                )}
                <text
                  y="20"
                  textAnchor="middle"
                  fill="#1b1712"
                  fontSize="8"
                  fontFamily="Manrope, Noto Sans SC, sans-serif"
                >
                  {t(pin.nameKey)}
                </text>
              </g>
            )
          })}

          <line x1="20" y1={RAIL.dividerY} x2="500" y2={RAIL.dividerY} stroke="#eef0f3" />

          <g className="hero-rail-days">
            <circle cx="22" cy={RAIL.daysCy} r="4" fill={DAY1} />
            <text
              x="32"
              y={RAIL.daysTextY}
              fill="#8a93a0"
              fontSize="9"
              fontFamily="Manrope, Noto Sans SC, sans-serif"
            >
              {t('diagram.day1')}
            </text>
            <circle cx="152" cy={RAIL.daysCy} r="4" fill={DAY2} />
            <text
              x="162"
              y={RAIL.daysTextY}
              fill="#8a93a0"
              fontSize="9"
              fontFamily="Manrope, Noto Sans SC, sans-serif"
            >
              {t('diagram.day2')}
            </text>
          </g>
        </g>
      </svg>
    </div>
  )
}
