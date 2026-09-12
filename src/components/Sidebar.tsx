import { useState } from 'react'
import { driveMinutes, haversineKm, validSplitIndexes } from '../lib/geo'
import { t, useI18n } from '../lib/i18n'
import { navigateBookOrigin } from '../lib/router'
import type { Place } from '../types'
import { useJourney, useLushu, useSelectedId } from '../store'

function cityOf(place: Place | undefined): string {
  if (!place) return ''
  const parts = place.address.split(/[·,，]/).map((s) => s.trim()).filter(Boolean)
  if (parts[0] && ['上海', '北京', '天津', '重庆'].includes(parts[0])) return parts[0]
  return parts[parts.length - 1] || place.name
}

function legLabel(from: Place, to: Place): string {
  const km = haversineKm(from, to)
  const min = driveMinutes(km)
  const kmText =
    km < 1
      ? t('unit.meters', { n: Math.round(km * 1000) })
      : t('unit.km', { n: Math.round(km) })
  if (min < 60) return `${kmText}  ${t('eta.minutes', { n: min })}`
  const h = Math.floor(min / 60)
  const m = min % 60
  const eta = m ? t('eta.hoursMinutes', { h, m }) : t('eta.hours', { n: h })
  return `${kmText}  ${eta}`
}

function CarIcon() {
  return (
    <svg className="leg-car" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M5.5 16a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm13 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11h1a1 1 0 0 1 1 1v3h-1.1a2.5 2.5 0 0 0-4.8 0H8.9a2.5 2.5 0 0 0-4.8 0H3v-3a1 1 0 0 1 1-1h1Z"
      />
    </svg>
  )
}

export function Sidebar() {
  const { t } = useI18n()
  const journey = useJourney()
  const selectedId = useSelectedId()
  const startId = useLushu((s) => s.startId)
  const endId = useLushu((s) => s.endId)
  const setStart = useLushu((s) => s.setStart)
  const setEnd = useLushu((s) => s.setEnd)
  const setTitle = useLushu((s) => s.setTitle)
  const removePlace = useLushu((s) => s.removePlace)
  const addSplit = useLushu((s) => s.addSplit)
  const removeSplit = useLushu((s) => s.removeSplit)
  const selectPlace = useLushu((s) => s.selectPlace)
  const closeBook = useLushu((s) => s.closeBook)
  const back = () => {
    closeBook()
    // 从哪一页点进来的就回哪一页（首页 / 我的路书 / 公开路书）。
    navigateBookOrigin()
  }
  const [folded, setFolded] = useState<Record<number, boolean>>({})

  const valid = new Set(validSplitIndexes(journey.ordered, journey.isLoop).map((i) => journey.ordered[i]?.id))
  const splitSet = new Set(journey.splitIds)

  const toggleFold = (index: number) => {
    setFolded((prev) => ({ ...prev, [index]: !prev[index] }))
  }

  return (
    <aside className="sheet">
      <div className="sheet-title">
        <button
          type="button"
          className="sheet-back"
          onClick={back}
          title={t('sidebar.back')}
          aria-label={t('sidebar.back')}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M19 12H5" />
            <path d="M11.5 18.5 5 12l6.5-6.5" />
          </svg>
        </button>
        <input
          className="title-input"
          value={journey.title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('sidebar.titlePlaceholder')}
          aria-label={t('sidebar.routeName')}
        />
      </div>

      <div className="place-scroll">
        {journey.ready
          ? journey.days.map((day) => {
              const visible = day.places.filter((_, i) => !(day.index > 0 && i === 0))
              const leadFrom = day.index > 0 ? day.places[0] : null
              const cityPlace = visible[0] ?? day.places[0]
              return (
                <section key={day.index} className="day-block">
                  <button type="button" className="day-head" onClick={() => toggleFold(day.index)}>
                    <strong>{t('sidebar.day', { n: day.index + 1 })}</strong>
                    <span>{cityOf(cityPlace)}</span>
                    <i className={folded[day.index] ? 'chev folded' : 'chev'} />
                  </button>
                  {folded[day.index] ? null : (
                    <ol className="timeline">
                      {leadFrom && visible[0] ? (
                        <li className="leg">
                          <CarIcon />
                          <em>{legLabel(leadFrom, visible[0])}</em>
                        </li>
                      ) : null}
                      {visible.map((place, i) => {
                        const isReturn =
                          journey.isLoop &&
                          place.id === journey.start?.id &&
                          day.index === journey.days.length - 1 &&
                          i === visible.length - 1
                        const next = visible[i + 1]
                        const no = isReturn
                          ? journey.ordered.length + 1
                          : journey.ordered.findIndex((p) => p.id === place.id) + 1
                        const overnight = splitSet.has(place.id) && !isReturn
                        const canSplit = valid.has(place.id) && !isReturn
                        return (
                          <li key={`${day.index}-${place.id}-${i}`}>
                            <div className={selectedId === place.id ? 'stop on' : 'stop'}>
                              <button
                                type="button"
                                className="stop-main"
                                onClick={() => selectPlace(place.id)}
                              >
                                <b>{no}</b>
                                <strong>
                                  {place.name}
                                  {place.id === startId && !isReturn ? (
                                    <mark>{t('sidebar.startBadge')}</mark>
                                  ) : null}
                                  {place.id === endId && !journey.isLoop ? (
                                    <mark>{t('sidebar.endBadge')}</mark>
                                  ) : null}
                                  {overnight ? (
                                    <mark className="night">{t('sidebar.nightBadge')}</mark>
                                  ) : null}
                                </strong>
                              </button>
                              <div className="stop-ops">
                                {canSplit ? (
                                  overnight ? (
                                    <button type="button" onClick={() => removeSplit(place.id)}>
                                      {t('sidebar.cancelOvernight')}
                                    </button>
                                  ) : (
                                    <button type="button" onClick={() => addSplit(place.id)}>
                                      {t('sidebar.overnight')}
                                    </button>
                                  )
                                ) : null}
                                <button type="button" onClick={() => removePlace(place.id)}>
                                  {t('common.delete')}
                                </button>
                              </div>
                            </div>
                            {next ? (
                              <div className="leg">
                                <CarIcon />
                                <em>{legLabel(place, next)}</em>
                              </div>
                            ) : null}
                          </li>
                        )
                      })}
                    </ol>
                  )}
                </section>
              )
            })
          : (
            <ol className="timeline">
              {journey.places.map((place, i) => (
                <li key={place.id}>
                  <div className={selectedId === place.id ? 'stop on' : 'stop'}>
                    <button type="button" className="stop-main" onClick={() => selectPlace(place.id)}>
                      <b>{i + 1}</b>
                      <strong>
                        {place.name}
                        {place.id === startId ? <mark>{t('sidebar.startBadge')}</mark> : null}
                        {place.id === endId ? <mark>{t('sidebar.endBadge')}</mark> : null}
                      </strong>
                    </button>
                    <div className="stop-ops always">
                      <button
                        type="button"
                        className={place.id === startId ? 'on' : ''}
                        onClick={() => setStart(place.id)}
                      >
                        {t('sidebar.setStart')}
                      </button>
                      <button
                        type="button"
                        className={place.id === endId ? 'on' : ''}
                        onClick={() => setEnd(place.id)}
                      >
                        {t('sidebar.setEnd')}
                      </button>
                      <button type="button" onClick={() => removePlace(place.id)}>
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            )}
      </div>

      {journey.ready ? null : (
        <div className="sheet-foot">
          <p className="hint">
            {journey.places.length === 0
              ? t('sidebar.hintEmpty')
              : t('sidebar.hintReady')}
          </p>
        </div>
      )}
    </aside>
  )
}
