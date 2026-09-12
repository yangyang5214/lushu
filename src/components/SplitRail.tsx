import { useEffect, useRef, useState } from 'react'
import { dayInk, formatKm, haversineKm, validSplitIndexes } from '../lib/geo'
import { useI18n } from '../lib/i18n'
import { useJourney, useLushu, useReadonly, useSelectedId } from '../store'

export function SplitRail() {
  const { t } = useI18n()
  const journey = useJourney()
  const readonly = useReadonly()
  const selectedId = useSelectedId()
  const addSplit = useLushu((s) => s.addSplit)
  const removeSplit = useLushu((s) => s.removeSplit)
  const moveSplit = useLushu((s) => s.moveSplit)
  const selectPlace = useLushu((s) => s.selectPlace)
  const railRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<string | null>(null)
  const hoverRef = useRef<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)

  const { ordered, isLoop, ready, days } = journey
  const validIds = new Set(validSplitIndexes(ordered, isLoop).map((i) => ordered[i]?.id))
  const splitSet = new Set(journey.splitIds)
  const beads = isLoop && ordered.length > 1 ? [...ordered, ordered[0]] : ordered

  const widths = beads.map((place, i) => {
    if (i === beads.length - 1) return 0
    return Math.max(haversineKm(place, beads[i + 1]), 12)
  })

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
        const d = Math.abs(e.clientX - (r.left + r.width / 2))
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

  return (
    <footer className="rail">
      <div className="rail-meta">
        <strong>{t('rail.title')}</strong>
      </div>
      <div className="rail-track" ref={railRef}>
        {beads.map((place, i) => {
          const isGhostReturn = isLoop && i === beads.length - 1
          const canSplit = validIds.has(place.id) && !isGhostReturn
          const isSplit = splitSet.has(place.id) && !isGhostReturn && i > 0
          const preview = hoverId === place.id && dragId && dragId !== place.id
          return (
            <div key={`${place.id}-${i}`} className="rail-unit">
              <button
                type="button"
                data-bead={isGhostReturn ? '' : place.id}
                className={[
                  'bead',
                  selectedId === place.id ? 'on' : '',
                  isSplit || preview ? 'cut' : '',
                  canSplit ? 'live' : '',
                ].join(' ')}
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
                      : isSplit || preview
                        ? t('rail.nightBadge')
                        : i + 1}
                </b>
                <em>{place.name}</em>
              </button>
              {i < beads.length - 1 ? (
                <div
                  className="rail-seg"
                  style={{
                    flexGrow: widths[i],
                    background: dayInk(beadDay[i]),
                  }}
                />
              ) : null}
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
