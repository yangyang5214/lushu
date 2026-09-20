import { useEffect, useState } from 'react'
import { formatKm, formatLegLabel, validSplitIndexes } from '../lib/geo'
import { useI18n, type MsgKey } from '../lib/i18n'
import { fetchRoad } from '../lib/route'
import { navigateBookOrigin, PUBLIC_PATH } from '../lib/router'
import { DAY_NOTE_MAX, PLACE_NOTE_MAX, type Place } from '../types'
import { useJourney, useLushu, useReadonly, useSelectedId } from '../store'
import { BookActions } from './BookActions'
import { JourneyStats } from './JourneyStats'
import { TripTableSheet } from './TripTableSheet'

function LegLabel({ from, to }: { from: Place; to: Place }) {
  const [drive, setDrive] = useState<{ km: number; min: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    setDrive(null)
    void fetchRoad([from, to]).then((route) => {
      if (cancelled || !route || !(route.distanceKm > 0)) return
      setDrive({ km: route.distanceKm, min: route.durationMin })
    })
    return () => {
      cancelled = true
    }
  }, [from.id, from.lng, from.lat, to.id, to.lng, to.lat])

  if (!drive) return null
  return <em>{formatLegLabel(drive.km, drive.min)}</em>
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

/**
 * 备注编辑框：点「备注」/ 铅笔展开，失焦 / Esc 即收；地点和整天共用一套。
 * 备注本身是行内的一小段字（地点的 .place-note-tag / 天数的 .day-note-text），
 * 这里只管编辑；输入直写 store，走既有的 1.4s 防抖推送。
 */
function NoteEditor({
  value,
  rows = 2,
  max,
  className,
  placeholder,
  onChange,
  onToggle,
}: {
  value: string
  rows?: number
  max: number
  className: string
  placeholder: MsgKey
  onChange: (text: string) => void
  onToggle: () => void
}) {
  const { t } = useI18n()

  return (
    <textarea
      className={className}
      defaultValue={value}
      maxLength={max}
      rows={rows}
      autoFocus
      placeholder={t(placeholder)}
      aria-label={t('sidebar.noteEdit')}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Escape') e.currentTarget.blur()
      }}
    />
  )
}

export function Sidebar() {
  const { t } = useI18n()
  const journey = useJourney()
  const readonly = useReadonly()
  const selectedId = useSelectedId()
  const startId = useLushu((s) => s.startId)
  const endId = useLushu((s) => s.endId)
  const setStart = useLushu((s) => s.setStart)
  const setEnd = useLushu((s) => s.setEnd)
  const setTitle = useLushu((s) => s.setTitle)
  const removePlace = useLushu((s) => s.removePlace)
  const addSplit = useLushu((s) => s.addSplit)
  const removeSplit = useLushu((s) => s.removeSplit)
  const setPlaceNote = useLushu((s) => s.setPlaceNote)
  const setDayNote = useLushu((s) => s.setDayNote)
  const dayNotes = useLushu((s) => s.dayNotes) ?? []
  const selectPlace = useLushu((s) => s.selectPlace)
  const closeBook = useLushu((s) => s.closeBook)
  const back = () => {
    closeBook()
    // 从哪一页点进来的就回哪一页（首页 / 我的路书 / 公开路书）。
    // 别人分享的路书直接粘链接打开时没有来源页，退回「公开路书」而不是要登录的「我的路书」。
    navigateBookOrigin(readonly ? PUBLIC_PATH : undefined)
  }
  const nightIds = new Set(
    validSplitIndexes(journey.ordered, journey.isLoop).map((i) => journey.ordered[i]?.id),
  )
  const splitSet = new Set(journey.splitIds)
  const [folded, setFolded] = useState<Record<number, boolean>>({})
  // 正在编辑备注的那个点 / 那天（同一时刻只开一个，窄侧栏里不叠输入框）。
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [noteDay, setNoteDay] = useState<number | null>(null)
  // 多天行程才值得单开一张表；单天一眼看完。
  const multiDay = journey.ready && journey.days.length > 1
  const [tableOpen, setTableOpen] = useState(false)

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
          readOnly={readonly}
          disabled={readonly}
        />
        {/* 表格不在这里展开，只作为入口：行程表是独立的一整屏阅读面 */}
        {multiDay ? (
          <button
            type="button"
            className="sheet-table"
            onClick={() => setTableOpen(true)}
            title={t('table.open')}
          >
            {t('table.open')}
          </button>
        ) : null}
        {/* 书名下方：去手机查看（微信扫码进小程序）与分享（设为公开） */}
        <BookActions />
      </div>

      {/* 手机浏览（只读）时行程尺收起，总统计挪到行程清单顶部 */}
      <div className="sheet-stats">
        <JourneyStats />
      </div>

      <div className="place-scroll">
        {journey.ready
          ? journey.days.map((day) => {
              const visible = day.places.filter((_, i) => !(day.index > 0 && i === 0))
              const leadFrom = day.index > 0 ? day.places[0] : null
              const dayNote = dayNotes[day.index] ?? ''
              return (
                <section key={day.index} className="day-block">
                  <div className="day-head">
                    {/* 天数头整条都是折叠开关；备注按钮得是它的兄弟节点，按钮不能嵌套按钮 */}
                    <button
                      type="button"
                      className="day-fold"
                      onClick={() => toggleFold(day.index)}
                      aria-expanded={!folded[day.index]}
                    >
                      <strong>{t('sidebar.day', { n: day.index + 1 })}</strong>
                      {dayNote ? (
                        <span className="day-note-text" title={dayNote}>
                          ({dayNote})
                        </span>
                      ) : null}
                      {day.distanceKm > 0 ? (
                        <em className="day-km">{formatKm(day.distanceKm)}</em>
                      ) : null}
                      <i className={folded[day.index] ? 'chev folded' : 'chev'} />
                    </button>
                    {readonly ? null : (
                      <button
                        type="button"
                        className={noteDay === day.index || dayNote ? 'day-ops on' : 'day-ops'}
                        onClick={() => setNoteDay(noteDay === day.index ? null : day.index)}
                        title={t('sidebar.noteEdit')}
                        aria-label={t('sidebar.noteEdit')}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden>
                          <path d="M4 20h4l11-11-4-4L4 16v4Z" />
                          <path d="M14.5 5.5l4 4" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {noteDay === day.index ? (
                    <NoteEditor
                      value={dayNote}
                      rows={1}
                      max={DAY_NOTE_MAX}
                      className="day-note-input"
                      placeholder="sidebar.note"
                      onChange={(text) => setDayNote(day.index, text)}
                      onToggle={() => setNoteDay(null)}
                    />
                  ) : null}
                  {folded[day.index] ? null : (
                    <ol className="timeline">
                      {leadFrom && visible[0] ? (
                        <li className="leg">
                          <CarIcon />
                          <LegLabel from={leadFrom} to={visible[0]} />
                        </li>
                      ) : null}
                      {visible.map((place, i) => {
                        const isReturn =
                          journey.isLoop &&
                          place.id === journey.start?.id &&
                          day.index === journey.days.length - 1 &&
                          i === visible.length - 1
                        const isNight = !isReturn && splitSet.has(place.id)
                        const canNight = !isReturn && (nightIds.has(place.id) || isNight)
                        const next = visible[i + 1]
                        const no = isReturn
                          ? journey.ordered.length + 1
                          : journey.ordered.findIndex((p) => p.id === place.id) + 1
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
                                  {place.note ? (
                                    <span className="place-note-tag">{place.note}</span>
                                  ) : null}
                                  {place.id === startId && !isReturn ? (
                                    <mark>{t('sidebar.startBadge')}</mark>
                                  ) : null}
                                  {isReturn || (place.id === endId && !journey.isLoop) ? (
                                    <mark>{t('sidebar.endBadge')}</mark>
                                  ) : null}
                                  {isNight ? <mark>{t('rail.nightBadge')}</mark> : null}
                                </strong>
                              </button>
                              <div className="stop-ops">
                                {readonly ? null : (
                                  <>
                                    <button
                                      type="button"
                                      className={
                                        noteFor === place.id || place.note ? 'on' : ''
                                      }
                                      onClick={() =>
                                        setNoteFor(noteFor === place.id ? null : place.id)
                                      }
                                    >
                                      {t('sidebar.note')}
                                    </button>
                                    {canNight ? (
                                      <button
                                        type="button"
                                        className={isNight ? 'on' : ''}
                                        onClick={() =>
                                          isNight ? removeSplit(place.id) : addSplit(place.id)
                                        }
                                      >
                                        {isNight ? t('sidebar.cancelNight') : t('sidebar.night')}
                                      </button>
                                    ) : null}
                                    <button type="button" onClick={() => removePlace(place.id)}>
                                      {t('common.delete')}
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                            {noteFor === place.id ? (
                              <NoteEditor
                                value={place.note ?? ''}
                                max={PLACE_NOTE_MAX}
                                className="stop-note-input"
                                placeholder="sidebar.note"
                                onChange={(text) => setPlaceNote(place.id, text)}
                                onToggle={() => setNoteFor(null)}
                              />
                            ) : null}
                            {next ? (
                              <div className="leg">
                                <CarIcon />
                                <LegLabel from={place} to={next} />
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
                        {place.note ? (
                          <span className="place-note-tag">{place.note}</span>
                        ) : null}
                        {place.id === startId ? <mark>{t('sidebar.startBadge')}</mark> : null}
                        {place.id === endId ? <mark>{t('sidebar.endBadge')}</mark> : null}
                      </strong>
                    </button>
                    <div className="stop-ops always">
                      {readonly ? null : (
                        <>
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
                          <button
                            type="button"
                            className={noteFor === place.id || place.note ? 'on' : ''}
                            onClick={() =>
                              setNoteFor(noteFor === place.id ? null : place.id)
                            }
                          >
                            {t('sidebar.note')}
                          </button>
                          <button type="button" onClick={() => removePlace(place.id)}>
                            {t('common.delete')}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {noteFor === place.id ? (
                    <NoteEditor
                      value={place.note ?? ''}
                      max={PLACE_NOTE_MAX}
                      className="stop-note-input"
                      placeholder="sidebar.note"
                      onChange={(text) => setPlaceNote(place.id, text)}
                      onToggle={() => setNoteFor(null)}
                    />
                  ) : null}
                </li>
              ))}
            </ol>
            )}
      </div>

      {journey.ready || readonly ? null : (
        <div className="sheet-foot">
          <p className="hint">
            {journey.places.length === 0
              ? t('sidebar.hintEmpty')
              : t('sidebar.hintReady')}
          </p>
        </div>
      )}

      {/* 行程表是 position:fixed 的浮层，放这里不受侧栏裁切影响 */}
      {tableOpen && multiDay ? <TripTableSheet onClose={() => setTableOpen(false)} /> : null}
    </aside>
  )
}
