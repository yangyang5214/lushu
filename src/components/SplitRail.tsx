import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { dayInk, formatKm, haversineKm, loopOrientation, validSplitIndexes } from '../lib/geo'
import { useI18n } from '../lib/i18n'
import { useJourney, useLushu, useReadonly, useSelectedId } from '../store'
import { JourneyStats } from './JourneyStats'

/**
 * 分行时给每段走线预留的宽度：留得够宽，行里的走线才看得出长短，
 * 否则一行塞太多刻度，剩余空间都贴着最小宽，间距就又变成“均匀”了。
 * （走线真正的最小宽在 CSS 的 .rail-seg min-width）
 */
const SEG_RESERVE = 46

/**
 * 一行装不下所有刻度时，把刻度均分成多行：行数尽量少、每行数量只差 1，
 * 行内每段用 flex-grow 拉满，奇数行反向，形成一条来回折返的蛇形尺。
 */
function packRows(mins: number[], width: number): number[][] {
  const n = mins.length
  if (!n || width <= 0) return []
  const total = mins.reduce((sum, w) => sum + w, 0)
  const minRows = Math.max(1, Math.ceil(total / width))
  for (let count = minRows; count <= n; count += 1) {
    const base = Math.floor(n / count)
    const extra = n % count
    const rows: number[][] = []
    let i = 0
    let fits = true
    for (let r = 0; r < count; r += 1) {
      const size = base + (r < extra ? 1 : 0)
      const row: number[] = []
      let used = 0
      for (let k = 0; k < size; k += 1) {
        row.push(i)
        used += mins[i]
        i += 1
      }
      if (used > width) {
        fits = false
        break
      }
      rows.push(row)
    }
    if (fits) return rows
  }
  // 容器窄到每个刻度都放不下（现实中到不了）：退化成一行一个，尽量不裁。
  return mins.map((_, i) => [i])
}

/** 折行的连接线长度：从行尾竖线伸到圆点中心，再多压进圆点一点。 */
function bendStyle(color: string, tail: number, head: number): CSSProperties {
  return {
    color,
    '--tail': `${Math.round(tail / 2) + 12}px`,
    '--head': `${Math.round(head / 2) + 12}px`,
  } as CSSProperties
}

export function SplitRail() {
  const { t } = useI18n()
  const journey = useJourney()
  const readonly = useReadonly()
  const selectedId = useSelectedId()
  const addSplit = useLushu((s) => s.addSplit)
  const removeSplit = useLushu((s) => s.removeSplit)
  const moveSplit = useLushu((s) => s.moveSplit)
  const setLoopDir = useLushu((s) => s.setLoopDir)
  const selectPlace = useLushu((s) => s.selectPlace)
  const railRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<string | null>(null)
  const hoverRef = useRef<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)

  const { ordered, isLoop, ready, days } = journey
  // 起终点重合时才有「顺 / 逆」：按当前实际绕行朝向点亮对应那颗按钮。
  const orientation = isLoop ? loopOrientation(ordered) : null
  const validIds = new Set(validSplitIndexes(ordered, isLoop).map((i) => ordered[i]?.id))
  const splitSet = new Set(journey.splitIds)
  const beads = isLoop && ordered.length > 1 ? [...ordered, ordered[0]] : ordered

  const legKms = beads.map((place, i) =>
    i === beads.length - 1 ? 0 : haversineKm(place, beads[i + 1]),
  )

  // 一行装不下时改多行蛇形：先量出每个刻度的实际宽度，再按容器宽度分行。
  const rowsRef = useRef<number[][]>([])
  const [rows, setRows] = useState<number[][]>([])
  const beadWidthsRef = useRef<number[]>([])
  const [beadWidths, setBeadWidths] = useState<number[]>([])
  const layoutKey = `${beads.map((p) => `${p.id}:${p.name}`).join('|')}|${isLoop ? 'loop' : ''}`

  useLayoutEffect(() => {
    const rail = railRef.current
    if (!rail) return
    let lastWidth = -1
    let dirty = true
    const recalc = () => {
      const width = rail.clientWidth
      if (!dirty && width === lastWidth) return
      lastWidth = width
      dirty = false
      const els = [...rail.querySelectorAll<HTMLElement>('[data-unit]')]
      if (!els.length || width <= 0) return
      const measured = els.map((el) => el.getBoundingClientRect().width)
      const prev = beadWidthsRef.current
      if (prev.length !== measured.length || measured.some((w, i) => Math.abs(w - prev[i]) > 0.5)) {
        beadWidthsRef.current = measured
        setBeadWidths(measured)
      }
      const mins = measured.map((w, i) => w + (i === els.length - 1 ? 0 : SEG_RESERVE))
      const next = packRows(mins, width)
      const same =
        next.length === rowsRef.current.length &&
        next.every((row, i) => row.join() === rowsRef.current[i].join())
      if (same) return
      rowsRef.current = next
      setRows(next)
    }
    recalc()
    const observer = new ResizeObserver(() => {
      dirty = true
      recalc()
    })
    observer.observe(rail)
    return () => observer.disconnect()
  }, [layoutKey])

  useEffect(() => {
    if (!dragId) return
    const allowed = new Set(validSplitIndexes(ordered, isLoop).map((i) => ordered[i]?.id))
    const onMove = (e: PointerEvent) => {
      const rail = railRef.current
      if (!rail) return
      const nodes = [...rail.querySelectorAll<HTMLElement>('[data-bead]')]
      let nearest = ''
      let best = Infinity
      nodes.forEach((node) => {
        const id = node.dataset.bead
        if (!id || !allowed.has(id)) return
        const r = node.getBoundingClientRect()
        // 尺子折成多行后要按二维距离找最近刻度，不然会跳到别的行
        const d = Math.hypot(e.clientX - (r.left + r.width / 2), (e.clientY - (r.top + r.height / 2)) * 2)
        if (d < best) {
          best = d
          nearest = id
        }
      })
      hoverRef.current = nearest || null
      setHoverId(nearest || null)
    }
    const onUp = () => {
      const from = dragRef.current
      const to = hoverRef.current
      if (from && to && from !== to) moveSplit(from, to)
      dragRef.current = null
      hoverRef.current = null
      setDragId(null)
      setHoverId(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragId, moveSplit, ordered, isLoop])

  if (!ready || ordered.length < 2) {
    return (
      <footer className="rail empty">
        <p>{t('rail.empty')}</p>
      </footer>
    )
  }

  let dayCursor = 0
  const beadDay: number[] = []
  beads.forEach((place, i) => {
    beadDay.push(dayCursor)
    if (i < beads.length - 1 && splitSet.has(place.id) && i > 0) dayCursor += 1
  })

  const chips = beads.map((place, i) => {
    const isGhostReturn = isLoop && i === beads.length - 1
    const canSplit = validIds.has(place.id) && !isGhostReturn
    const isSplit = splitSet.has(place.id) && !isGhostReturn && i > 0
    const preview = hoverId === place.id && dragId && dragId !== place.id
    return (
      <button
        key={`${place.id}-${i}`}
        type="button"
        className={[
          'bead',
          selectedId === place.id ? 'on' : '',
          isSplit || preview ? 'cut' : '',
          canSplit ? 'live' : '',
        ].join(' ')}
        data-unit={i}
        data-bead={isGhostReturn ? '' : place.id}
        title={isGhostReturn ? t('rail.returnBadge') : place.name}
        onClick={() => {
          if (isGhostReturn) return
          selectPlace(place.id)
          if (readonly || !canSplit) return
          if (isSplit) removeSplit(place.id)
          else addSplit(place.id)
        }}
        onPointerDown={(e) => {
          if (readonly || !isSplit || isGhostReturn) return
          e.preventDefault()
          dragRef.current = place.id
          hoverRef.current = place.id
          setDragId(place.id)
          setHoverId(place.id)
        }}
      >
        <b>
          {isGhostReturn
            ? t('rail.returnBadge')
            : i === 0
              ? t('rail.startBadge')
              : i === beads.length - 1
                ? t('rail.endBadge')
                : isSplit || preview
                  ? t('rail.nightBadge')
                  : i + 1}
        </b>
        <em>{place.name}</em>
      </button>
    )
  })

  // 刻度是行的直接子元素，走线才能 flex-grow 把整行撑满；行尾改用带拐弯的连接线接下一行。
  const shown = rows.length ? rows : [beads.map((_, i) => i)]

  return (
    <footer className="rail">
      <div className="rail-head">
        <div className="rail-meta">
          <strong>{t('rail.title')}</strong>
          {isLoop ? (
            <div className="dir-switch" role="group" aria-label={t('rail.dir')}>
              <button
                type="button"
                className={orientation === 'cw' ? 'on' : ''}
                title={t('rail.dirCwTitle')}
                disabled={readonly}
                onClick={() => setLoopDir('cw')}
              >
                {t('rail.dirCw')}
              </button>
              <button
                type="button"
                className={orientation === 'ccw' ? 'on' : ''}
                title={t('rail.dirCcwTitle')}
                disabled={readonly}
                onClick={() => setLoopDir('ccw')}
              >
                {t('rail.dirCcw')}
              </button>
            </div>
          ) : null}
        </div>
        {/* 总统计：天数 / 地点 / 总里程 / 驾驶时长 */}
        <JourneyStats />
      </div>
      <div className="rail-track" ref={railRef}>
        {shown.map((row, r) => {
          const tail = row[row.length - 1]
          const head = shown[r + 1]?.[0]
          return (
            <div className={r % 2 === 1 ? 'rail-row rev' : 'rail-row'} key={r}>
              {row.map((i) => (
                <Fragment key={i}>
                  {chips[i]}
                  {i === tail ? null : (
                    <div
                      className="rail-seg"
                      title={formatKm(legKms[i])}
                      style={{ flexGrow: legKms[i], background: dayInk(beadDay[i]) }}
                    />
                  )}
                </Fragment>
              ))}
              {head === undefined ? null : (
                <span
                  className="rail-bend"
                  style={bendStyle(
                    dayInk(beadDay[tail]),
                    beadWidths[tail] ?? 54,
                    beadWidths[head] ?? 54,
                  )}
                />
              )}
            </div>
          )
        })}
      </div>
      <ol className="rail-days">
        {days.map((day) => (
          <li key={day.index}>
            <i style={{ background: dayInk(day.index) }} />
            {t('rail.day', { n: day.index + 1, km: formatKm(day.distanceKm) })}
          </li>
        ))}
      </ol>
    </footer>
  )
}
