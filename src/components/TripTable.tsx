import { Fragment } from 'react'
import { dayInk, formatDuration, formatKm } from '../lib/geo'
import { fmtDayOffset } from '../lib/format'
import { useI18n } from '../lib/i18n'
import type { Place } from '../types'
import { useJourney, useLushu, useSelectedId } from '../store'

/**
 * 一天的途经点：按名字去掉相邻重复（切天处前后的同一个过夜点只留一个）。
 * 城市名太粗，看不出当天实际走了哪几站，所以按点逐个展示。
 */
function uniquePlaces(places: Place[]): Place[] {
  const out: Place[] = []
  for (const place of places) {
    if (place.name && place.name !== out[out.length - 1]?.name) out.push(place)
  }
  return out
}

/**
 * 多天行程的表格：一天一行，列是「天 / 途经 / 里程 / 驾驶时长」。
 * 只在行程表浮层里用，宽度够，途经一列能完整铺开。
 */
export function TripTable({ onPick }: { onPick?: () => void } = {}) {
  const { t } = useI18n()
  const journey = useJourney()
  const selectedId = useSelectedId()
  const selectPlace = useLushu((s) => s.selectPlace)

  if (!journey.ready || journey.days.length === 0) return null

  return (
    <table className="trip-table">
      <thead>
        <tr>
          <th scope="col">{t('table.day')}</th>
          <th scope="col">{t('table.route')}</th>
          <th scope="col">{t('table.km')}</th>
          <th scope="col">{t('table.time')}</th>
        </tr>
      </thead>
      <tbody>
        {journey.days.map((day) => {
          // 第 2 天起，行首那个点是前一天的过夜点（和前一天重复），选当天第一个新点。
          const focus = day.places[day.index > 0 ? 1 : 0] ?? day.places[0]
          const date = fmtDayOffset(journey.startDate, day.index)
          const on = day.places.some((place) => place.id === selectedId)
          return (
            <tr key={day.index} className={on ? 'on' : undefined}>
              <th scope="row">
                <span className="trip-day">
                  <i style={{ background: dayInk(day.index) }} />
                  <span>
                    <b>{t('sidebar.day', { n: day.index + 1 })}</b>
                    {date ? <em>{date}</em> : null}
                  </span>
                </span>
              </th>
              <td className="trip-route">
                <button
                  type="button"
                  title={t('table.select', { n: day.index + 1 })}
                  onClick={() => {
                    if (focus) selectPlace(focus.id)
                    // 地图在浮层后面，选完就收起来，才能看到高亮的那一天。
                    onPick?.()
                  }}
                >
                  {uniquePlaces(day.places).map((place, i) => (
                    <Fragment key={`${place.id}-${i}`}>
                      {i > 0 ? (
                        <i className="trip-arrow" aria-hidden>
                          →
                        </i>
                      ) : null}
                      <span className="trip-stop">
                        <span className="trip-stop-name">{place.name}</span>
                        {place.note ? (
                          <span className="place-note-tag">{place.note}</span>
                        ) : null}
                      </span>
                    </Fragment>
                  ))}
                </button>
              </td>
              <td className="trip-km" data-label={t('table.km')}>
                {day.distanceKm > 0 ? formatKm(day.distanceKm) : t('common.none')}
              </td>
              <td className="trip-time" data-label={t('table.time')}>
                {day.driveMin > 0 ? formatDuration(day.driveMin) : t('common.none')}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
