import { useEffect, useRef } from 'react'
import { useI18n } from '../lib/i18n'
import { useJourney } from '../store'
import { JourneyStats } from './JourneyStats'
import { TripTable } from './TripTable'

/**
 * 行程表浮层：/d 页里独立于「行程清单」的一块阅读面。
 * 清单在侧栏（窄，适合编辑单点），表格铺满整屏（宽，途经一列能完整铺开）。
 */
export function TripTableSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const journey = useJourney()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="trip-overlay" role="presentation" onClick={onClose}>
      <section
        className="trip-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('table.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="trip-sheet-head">
          <div className="trip-sheet-title">
            <h2>{t('table.title')}</h2>
            <p>{journey.title || t('common.untitled')}</p>
          </div>
          <JourneyStats />
          <button
            ref={closeRef}
            type="button"
            className="trip-close"
            onClick={onClose}
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M6 6l12 12" />
              <path d="M18 6 6 18" />
            </svg>
          </button>
        </header>
        <div className="trip-sheet-body">
          <TripTable onPick={onClose} />
        </div>
      </section>
    </div>
  )
}
