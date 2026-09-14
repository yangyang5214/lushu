import type { MsgKey } from '../lib/i18n'
import { useI18n } from '../lib/i18n'
import { SiteNav } from './Chrome'

/** 微信公众平台下载的小程序码（太阳码），文件在 public/mp-code.jpg。 */
const MP_CODE_SRC = '/mp-code.jpg'

/** 小程序截图：列表 → 详情 → 按天 → 导航。原图约 610×1318。 */
const MP_SHOTS: { src: string; title: MsgKey; text: MsgKey; alt: MsgKey }[] = [
  { src: '/gpx_merge_01.png', title: 'mp.s1.title', text: 'mp.s1.text', alt: 'mp.s1.alt' },
  { src: '/gpx_merge_02.png', title: 'mp.s2.title', text: 'mp.s2.text', alt: 'mp.s2.alt' },
  { src: '/gpx_merge_03.png', title: 'mp.s3.title', text: 'mp.s3.text', alt: 'mp.s3.alt' },
  { src: '/gpx_merge_04.png', title: 'mp.s4.title', text: 'mp.s4.text', alt: 'mp.s4.alt' },
]

function IconScan() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" />
      <path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" />
      <path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" />
      <path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <path d="M7 12h10" />
    </svg>
  )
}

function IconDays() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M5 8.5h14v11H5Z" />
      <path d="M8 5.5v3M16 5.5v3M5 12h14" />
    </svg>
  )
}

function IconPocket() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M7 4.5h10v15H7Z" />
      <path d="M7 8h10M10.5 18.5h3" />
    </svg>
  )
}

/** `/mp`：微信小程序落地页，大码方便扫。 */
export function MiniProgramPage() {
  const { t } = useI18n()
  return (
    <div className="home">
      <SiteNav active="mp" />
      <main>
        <section className="mp-page">
          <div className="shell mp-layout">
            <div className="mp-copy">
              <p className="eyebrow">{t('mp.kicker')}</p>
              <h1>
                {t('mp.title1')}
                <br />
                {t('mp.title2')}
              </h1>
              <p className="lede">{t('mp.lede')}</p>
              <ul className="mp-points">
                <li>
                  <span className="feature-icon">
                    <IconScan />
                  </span>
                  <div>
                    <h3>{t('mp.f1.title')}</h3>
                    <p>{t('mp.f1.text')}</p>
                  </div>
                </li>
                <li>
                  <span className="feature-icon">
                    <IconDays />
                  </span>
                  <div>
                    <h3>{t('mp.f2.title')}</h3>
                    <p>{t('mp.f2.text')}</p>
                  </div>
                </li>
                <li>
                  <span className="feature-icon">
                    <IconPocket />
                  </span>
                  <div>
                    <h3>{t('mp.f3.title')}</h3>
                    <p>{t('mp.f3.text')}</p>
                  </div>
                </li>
              </ul>
            </div>

            <aside className="mp-stage">
              <div className="mp-card">
                <img
                  className="mp-code"
                  src={MP_CODE_SRC}
                  width={258}
                  height={258}
                  alt={t('mp.alt')}
                />
                <b className="mp-name">{t('mp.name')}</b>
                <p className="mp-hint">{t('mp.hint')}</p>
              </div>
            </aside>
          </div>
        </section>

        <section className="mp-shots" aria-labelledby="mp-shots-heading">
          <div className="shell">
            <header className="section-head">
              <h2 id="mp-shots-heading">{t('mp.shotsHeading')}</h2>
              <p>{t('mp.shotsSub')}</p>
            </header>
            <ol className="mp-shot-row">
              {MP_SHOTS.map((shot, i) => (
                <li key={shot.src} className="mp-shot">
                  <figure>
                    <div className="mp-shot-phone">
                      <img
                        src={shot.src}
                        width={610}
                        height={1318}
                        alt={t(shot.alt)}
                        loading={i === 0 ? 'eager' : 'lazy'}
                        decoding="async"
                      />
                    </div>
                    <figcaption>
                      <span className="mp-shot-num">{String(i + 1).padStart(2, '0')}</span>
                      <h3>{t(shot.title)}</h3>
                      <p>{t(shot.text)}</p>
                    </figcaption>
                  </figure>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>
    </div>
  )
}
