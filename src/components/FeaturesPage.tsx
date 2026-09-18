import { useEffect, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { useI18n, type MsgKey } from '../lib/i18n'
import { featurePath, navigateFeature, readFeatureSlug } from '../lib/router'
import { SiteNav } from './Chrome'
import {
  ShotAccount,
  ShotAdd,
  ShotEnds,
  ShotLegs,
  ShotNight,
  ShotPoi,
  ShotRail,
  ShotShelf,
  ShotShare,
  ShotTable,
} from './FeatureShots'

type Feature = {
  /** 序号：01、02…，和标题一起当功能点的编号。 */
  num: string
  /** 这一条功能点自己的 URL：`/features/{slug}`。 */
  slug: string
  titleKey: MsgKey
  textKey: MsgKey
  shot: ComponentType
}

/** 功能点行的锚点 id：`feat-01`…，左侧全览跳转和滚动高亮都用它。 */
function featId(num: string): string {
  return `feat-${num}`
}

/** 普通左键才拦下来做无刷新跳转；带修饰键 / 中键照旧开新标签。 */
function plainClick(e: {
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}): boolean {
  return !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
}

/** 小程序是真实截图，单独成一个组件，好和数据里那些 SVG 示意图并列。 */
function ShotMiniProgram() {
  const { t } = useI18n()
  return (
    <div className="shot-phones">
      <img
        src="/gpx_merge_01.png"
        width={610}
        height={1318}
        alt={t('mp.s1.alt')}
        loading="lazy"
        decoding="async"
      />
      <img
        src="/gpx_merge_02.png"
        width={610}
        height={1318}
        alt={t('mp.s2.alt')}
        loading="lazy"
        decoding="async"
      />
    </div>
  )
}

/**
 * 功能一览：一个功能点一行，左边功能点，中间描述，右边截图。
 * 顺序跟着实际用法走：先加点，再决定怎么走、怎么分天，最后是云端、分享、账号和小程序。
 */
const FEATURES: Feature[] = [
  { num: '01', slug: 'add', titleKey: 'feat.add.title', textKey: 'feat.add.text', shot: ShotAdd },
  { num: '02', slug: 'poi', titleKey: 'feat.poi.title', textKey: 'feat.poi.text', shot: ShotPoi },
  { num: '03', slug: 'ends', titleKey: 'feat.ends.title', textKey: 'feat.ends.text', shot: ShotEnds },
  { num: '04', slug: 'night', titleKey: 'feat.night.title', textKey: 'feat.night.text', shot: ShotNight },
  { num: '05', slug: 'rail', titleKey: 'feat.rail.title', textKey: 'feat.rail.text', shot: ShotRail },
  { num: '06', slug: 'legs', titleKey: 'feat.legs.title', textKey: 'feat.legs.text', shot: ShotLegs },
  { num: '07', slug: 'table', titleKey: 'feat.table.title', textKey: 'feat.table.text', shot: ShotTable },
  { num: '08', slug: 'shelf', titleKey: 'feat.shelf.title', textKey: 'feat.shelf.text', shot: ShotShelf },
  { num: '09', slug: 'share', titleKey: 'feat.share.title', textKey: 'feat.share.text', shot: ShotShare },
  { num: '10', slug: 'account', titleKey: 'feat.account.title', textKey: 'feat.account.text', shot: ShotAccount },
  { num: '11', slug: 'mp', titleKey: 'feat.mp.title', textKey: 'feat.mp.text', shot: ShotMiniProgram },
]

function bySlug(slug: string | null): Feature | undefined {
  return slug ? FEATURES.find((feature) => feature.slug === slug) : undefined
}

/** `/features`：功能一览页，一个功能点一行，配一张界面截图（可点开放大）。 */
export function FeaturesPage() {
  const { t } = useI18n()
  const [zoom, setZoom] = useState<Feature | null>(null)
  // 左侧功能点全览当前高亮的那一项（跟着滚动走）。
  const [active, setActive] = useState(FEATURES[0].num)
  // 刚点过的那一项：点完的那一段平滑滚动不再让高亮回跳（比如最后一屏滚不到顶部）。
  const locked = useRef<string | null>(null)

  // 放大后 Esc 关掉；点背景也关。
  useEffect(() => {
    if (!zoom) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoom(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom])

  // 地址里的功能点 slug 就是当前选中的那一条：首次打开 /features/xx 直接落位，
  // 浏览器前进后退也跟着走。
  useEffect(() => {
    const scroller = document.querySelector('.home')
    const sync = (smooth: boolean) => {
      const feature = bySlug(readFeatureSlug())
      if (!feature) {
        // /features：回到全览顶端。
        locked.current = null
        setActive(FEATURES[0].num)
        scroller?.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'instant' })
        return
      }
      locked.current = feature.num
      setActive(feature.num)
      document
        .getElementById(featId(feature.num))
        ?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant', block: 'start' })
    }
    sync(false)
    const onPop = () => sync(true)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // 滚动时更新左侧高亮：取最后一个已经划到导航下方的功能点；
  // 滚到底时直接高亮最后一项。
  useEffect(() => {
    const scroller = document.querySelector('.home')
    if (!scroller) return

    // 当前该高亮哪一条：最后一个已经划到导航下方的功能点；滚到底就是最后一项。
    const currentNum = () => {
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
        return FEATURES[FEATURES.length - 1].num
      }
      const line = 128
      let num = FEATURES[0].num
      for (const feature of FEATURES) {
        const el = document.getElementById(featId(feature.num))
        if (!el || el.getBoundingClientRect().top > line) break
        num = feature.num
      }
      return num
    }

    const onScroll = () => {
      // 点到的那一项优先，直到用户自己再滚一下。
      if (locked.current) return
      const num = currentNum()
      setActive(num)
      // 地址栏跟着换成这一条自己的 URL（replaceState：不新增历史记录）。
      const feature = FEATURES.find((f) => f.num === num)
      if (feature) {
        const path = featurePath(feature.slug)
        if (window.location.pathname !== path) window.history.replaceState(null, '', path)
      }
    }
    // 用户自己滚（滚轮 / 触屏 / 键盘）时解锁，高亮回到跟随滚动。
    const release = () => {
      locked.current = null
    }
    // 初始只定高亮，不改地址栏：/features 有它自己的 URL。
    if (!bySlug(readFeatureSlug())) setActive(currentNum())
    scroller.addEventListener('scroll', onScroll, { passive: true })
    scroller.addEventListener('wheel', release, { passive: true })
    scroller.addEventListener('touchstart', release, { passive: true })
    window.addEventListener('keydown', release)
    window.addEventListener('resize', onScroll)
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      scroller.removeEventListener('wheel', release)
      scroller.removeEventListener('touchstart', release)
      window.removeEventListener('keydown', release)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  const jumpTo = (feature: Feature) => {
    locked.current = feature.num
    setActive(feature.num)
    // 换成这一条自己的 URL；浏览器前进后退也可以回到它。
    navigateFeature(feature.slug)
  }

  const ZoomShot = zoom?.shot

  return (
    <div className={zoom ? 'home home-locked' : 'home'}>
      <SiteNav active="features" />

      <main>
        <section className="features-page">
          <div className="shell features-shell">
            <header className="section-head features-head">
              <h1>{t('features.heading')}</h1>
            </header>

            <div className="features-layout">
              {/* 往下滚时固定在左侧的功能点全览，点一下跳到那一行。 */}
              <aside className="feat-toc">
                <nav aria-label={t('features.colFeature')}>
                  <span className="feat-toc-label">{t('features.colFeature')}</span>
                  <ol>
                    {FEATURES.map((feature) => (
                      <li key={feature.num}>
                        <a
                          href={featurePath(feature.slug)}
                          className={active === feature.num ? 'on' : undefined}
                          aria-current={active === feature.num ? 'true' : undefined}
                          onClick={(e) => {
                            if (!plainClick(e)) return
                            e.preventDefault()
                            jumpTo(feature)
                          }}
                        >
                          <span className="feat-toc-num">{feature.num}</span>
                          <span className="feat-toc-name">{t(feature.titleKey)}</span>
                        </a>
                      </li>
                    ))}
                  </ol>
                </nav>
              </aside>

              <div className="features-body">
                {/* 三个列名做成一条很轻的图例，不在表格里占一整行表头。 */}
                <div className="feat-legend" aria-hidden>
                  <span>{t('features.colFeature')}</span>
                  <span>{t('features.colDesc')}</span>
                  <span>{t('features.colShot')}</span>
                </div>

                <ol className="feat-list" aria-label={t('features.caption')}>
                  {FEATURES.map((feature) => {
                    const { num, slug, titleKey, textKey, shot: Shot } = feature
                    return (
                      <li key={num} id={featId(num)} className="feat-item">
                        <div className="feat-item-head">
                          <span className="feat-num">{num}</span>
                          <h2>
                            <a
                              href={featurePath(slug)}
                              title={t('features.link')}
                              onClick={(e) => {
                                if (!plainClick(e)) return
                                e.preventDefault()
                                jumpTo(feature)
                              }}
                            >
                              {t(titleKey)}
                            </a>
                          </h2>
                        </div>
                        <p className="feat-item-text">{t(textKey)}</p>
                        <div className="feat-item-shot">
                          <button
                            type="button"
                            className="feat-shot-btn"
                            onClick={() => setZoom(feature)}
                            title={t('features.zoom')}
                            aria-label={t('features.zoom')}
                          >
                            <Shot />
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </div>
            </div>
          </div>
        </section>
      </main>

      {zoom && ZoomShot ? (
        <div
          className="shot-zoom"
          role="dialog"
          aria-modal="true"
          aria-label={t(zoom.titleKey)}
          onClick={() => setZoom(null)}
        >
          <div className="shot-zoom-in" onClick={(e) => e.stopPropagation()}>
            <header className="shot-zoom-head">
              <span className="feat-num">{zoom.num}</span>
              <h3>{t(zoom.titleKey)}</h3>
              <button
                type="button"
                className="shot-zoom-close"
                onClick={() => setZoom(null)}
                title={t('common.close')}
                aria-label={t('common.close')}
              >
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M6 6l12 12" />
                  <path d="M18 6 6 18" />
                </svg>
              </button>
            </header>
            <div className="shot-zoom-shot">
              <ZoomShot />
            </div>
            <p className="shot-zoom-text">{t(zoom.textKey)}</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}
