import type { ComponentType } from 'react'
import { requireLogin, useAuth } from '../lib/auth'
import { useI18n, type MsgKey } from '../lib/i18n'
import { navigateBook, navigatePublic } from '../lib/router'
import { useLushu } from '../store'
import { SiteNav } from './Chrome'
import { ShotAdd, ShotEnds, ShotLegs, ShotNight, ShotRail } from './FeatureShots'
import { HeroDiagram } from './HeroDiagram'

type Guide = {
  /** 序号：01、02…，和配图一起当小标题用。 */
  num: string
  titleKey: MsgKey
  textKey: MsgKey
  whereKey: MsgKey
  shot: ComponentType
}

/**
 * 功能介绍：从「加地点」到「地图按天着色」，一个动作配一张编辑页示意图。
 * 顺序跟着实际用法走：先加点，再定起终点，然后过夜分天，最后看尺子和地图。
 */
const GUIDE: Guide[] = [
  { num: '01', titleKey: 'feat.add.title', textKey: 'feat.add.text', whereKey: 'feat.add.where', shot: ShotAdd },
  { num: '02', titleKey: 'feat.ends.title', textKey: 'feat.ends.text', whereKey: 'feat.ends.where', shot: ShotEnds },
  { num: '03', titleKey: 'feat.night.title', textKey: 'feat.night.text', whereKey: 'feat.night.where', shot: ShotNight },
  { num: '04', titleKey: 'feat.rail.title', textKey: 'feat.rail.text', whereKey: 'feat.rail.where', shot: ShotRail },
  { num: '05', titleKey: 'feat.legs.title', textKey: 'feat.legs.text', whereKey: 'feat.legs.where', shot: ShotLegs },
]

/** `/`：首页，首屏 + 逐个动作的功能介绍；书单都在独立的 `/list`、`/public` 页。 */
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

        {/* 每个动作单独展开，一个动作一张编辑页示意图。 */}
        <section className="guide">
          <div className="shell">
            <header className="section-head">
              <h2>{t('home.guideHeading')}</h2>
              <p>{t('home.guideSub')}</p>
            </header>
            <ol className="feat-rows">
              {GUIDE.map(({ num, titleKey, textKey, whereKey, shot: Shot }) => (
                <li key={num} className="feat-row">
                  <div className="feat-shot">
                    <Shot />
                  </div>
                  <div className="feat-copy">
                    <span className="feat-num">{num}</span>
                    <h3>{t(titleKey)}</h3>
                    <p>{t(textKey)}</p>
                    <p className="feat-where">
                      <b>{t('home.guideWhere')}</b>
                      <span>{t(whereKey)}</span>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

      </main>
    </div>
  )
}
