import type { ReactNode } from 'react'
import { requireLogin, useAuth } from '../lib/auth'
import { useI18n, type MsgKey } from '../lib/i18n'
import { navigateBook, navigatePublic } from '../lib/router'
import { useLushu } from '../store'
import { SiteNav } from './Chrome'
import { HeroDiagram } from './HeroDiagram'

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M15.8 15.8 21 21" />
    </svg>
  )
}

function IconPin() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 21.5s7-6.4 7-11.5a7 7 0 1 0-14 0c0 5.1 7 11.5 7 11.5Z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  )
}

function IconCut() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="6" cy="6.5" r="2.6" />
      <circle cx="6" cy="17.5" r="2.6" />
      <path d="M8.3 7.8 20 17.2M8.3 16.2 20 6.8" />
    </svg>
  )
}

function IconMap() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M9 4.5 3.5 6.5v13l5.5-2 6 2 5.5-2v-13L15.5 6.5 9 4.5Z" />
      <path d="M9 4.5v13M15.5 6.5v13" />
    </svg>
  )
}

function IconShelf() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M5 5.5h14v13H5Z" />
      <path d="M5 10h14M5 14.5h14M9 5.5v13" />
    </svg>
  )
}

function IconShare() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="6.5" cy="12" r="2.4" />
      <circle cx="17" cy="6.5" r="2.4" />
      <circle cx="17" cy="17.5" r="2.4" />
      <path d="M8.7 10.8 14.8 7.6M8.7 13.2 14.8 16.4" />
    </svg>
  )
}

type FlowStep = {
  step: string
  labelKey: MsgKey
  titleKey: MsgKey
  textKey: MsgKey
  icon: ReactNode
}

const FLOW_STEPS: FlowStep[] = [
  {
    step: '01',
    labelKey: 'flow.1.key',
    titleKey: 'flow.1.title',
    textKey: 'flow.1.text',
    icon: <IconSearch />,
  },
  {
    step: '02',
    labelKey: 'flow.2.key',
    titleKey: 'flow.2.title',
    textKey: 'flow.2.text',
    icon: <IconPin />,
  },
  {
    step: '03',
    labelKey: 'flow.3.key',
    titleKey: 'flow.3.title',
    textKey: 'flow.3.text',
    icon: <IconCut />,
  },
]

type Feature = {
  labelKey: MsgKey
  titleKey: MsgKey
  textKey: MsgKey
  icon: ReactNode
}

const EXTRA_FEATURES: Feature[] = [
  {
    labelKey: 'feature.1.key',
    titleKey: 'feature.1.title',
    textKey: 'feature.1.text',
    icon: <IconMap />,
  },
  {
    labelKey: 'feature.2.key',
    titleKey: 'feature.2.title',
    textKey: 'feature.2.text',
    icon: <IconShelf />,
  },
  {
    labelKey: 'feature.3.key',
    titleKey: 'feature.3.title',
    textKey: 'feature.3.text',
    icon: <IconShare />,
  },
]

/** `/`：首页，首屏 + 核心功能；书单都在独立的 `/list`、`/public` 页。 */
export function RouteList() {
  const { t } = useI18n()
  const createBook = useLushu((s) => s.createBook)

  // 新建路书要先登录；未登录会跳到账户页，登录后接着把动作做完。
  const startNew = () =>
    requireLogin(() => navigateBook(createBook(), useAuth.getState().user?.hashId))

  return (
    <div className="home">
      <SiteNav />

      <main>
        <section className="hero">
          <div className="shell hero-grid">
            <div className="hero-copy">
              <h1>
                {t('home.heroTitle1')}
                <br />
                {t('home.heroTitle2')}
              </h1>
              <p className="lede">{t('home.lede')}</p>
              <div className="hero-cta">
                <button type="button" className="btn-primary" onClick={startNew}>
                  {t('home.newBook')}
                </button>
                <button type="button" className="btn-ghost" onClick={navigatePublic}>
                  {t('home.seePublic')}
                </button>
              </div>
            </div>
            <HeroDiagram />
          </div>
        </section>

        <section className="flow">
          <div className="shell">
            <header className="section-head">
              <h2>{t('home.flowHeading')}</h2>
              <p>{t('home.flowSub')}</p>
            </header>
            <ol className="flow-steps">
              {FLOW_STEPS.map((f, i) => (
                <li key={f.labelKey} className="flow-step">
                  <div className="flow-step-card">
                    <div className="flow-step-top">
                      <span className="flow-step-num">{f.step}</span>
                      <span className="feature-icon">{f.icon}</span>
                    </div>
                    <span className="flow-step-key">{t(f.labelKey)}</span>
                    <h3>{t(f.titleKey)}</h3>
                    <p>{t(f.textKey)}</p>
                  </div>
                  {i < FLOW_STEPS.length - 1 ? <span className="flow-connector" aria-hidden /> : null}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="features">
          <div className="shell">
            <header className="section-head">
              <h2>{t('home.featuresHeading')}</h2>
              <p>{t('home.featuresSub')}</p>
            </header>
            <div className="feature-grid feature-grid--aux">
              {EXTRA_FEATURES.map((f) => (
                <div key={f.labelKey} className="feature feature--aux">
                  <span className="feature-icon">{f.icon}</span>
                  <h3>{t(f.titleKey)}</h3>
                  <p>{t(f.textKey)}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
