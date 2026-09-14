import { formatDuration, formatKm } from '../lib/geo'
import { useI18n } from '../lib/i18n'
import { useJourney } from '../store'

/**
 * `/d` 路书页的「总统计」：天数 / 地点 / 总里程 / 驾驶时长。
 * 桌面（含行程尺）和手机编辑态放在行程尺里；手机浏览别人的分享（只读、
 * 行程尺收起）时放到行程清单顶部，保证浏览时也能一眼看到全程概览。
 */
export function JourneyStats({ showLabel = true }: { showLabel?: boolean }) {
  const { t } = useI18n()
  const journey = useJourney()
  if (!journey.ready) return null

  return (
    <div className="rail-stats" role="group" aria-label={t('rail.statsLabel')}>
      {showLabel ? <span className="rail-stats-label">{t('rail.statsLabel')}</span> : null}
      <span className="rail-stat">
        <em>{t('rail.statDays')}</em>
        <b>{journey.days.length}</b>
      </span>
      <span className="rail-stat">
        <em>{t('rail.statPlaces')}</em>
        <b>{journey.ordered.length}</b>
      </span>
      {journey.driveReady ? (
        <>
          <span className="rail-stat">
            <em>{t('rail.statKm')}</em>
            <b>{formatKm(journey.totalKm)}</b>
          </span>
          <span className="rail-stat">
            <em>{t('rail.statTime')}</em>
            <b>{formatDuration(journey.totalMin)}</b>
          </span>
        </>
      ) : null}
    </div>
  )
}
