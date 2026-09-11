import { requireLogin, useAuth } from '../lib/auth'
import { navigateBook, navigatePublic } from '../lib/router'
import { useLushu } from '../store'
import { SiteNav } from './Chrome'

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

const FLOW_STEPS = [
  {
    step: '01',
    key: '地点',
    icon: <IconSearch />,
    title: '随意加点',
    text: '城市、寺庙、老街、营地，想到什么就加什么。不用管顺序，也不用先想第几天。',
  },
  {
    step: '02',
    key: '路线',
    icon: <IconPin />,
    title: '自动串线',
    text: '所有地点按路程自动排成合理顺序。需要的话还能钉起终点，起终点相同就是环线。',
  },
  {
    step: '03',
    key: '天数',
    icon: <IconCut />,
    title: '过夜分天',
    text: '在任意地点设过夜分割针，行程自动分成第几天。拖动分割针还能调整每天走多远。',
  },
] as const

const EXTRA_FEATURES = [
  {
    key: '地图',
    icon: <IconMap />,
    title: '地图按天画路',
    text: '地图按天着色，画出当天要走的路，点与点之间标出大概路程和时间。',
  },
  {
    key: '书架',
    icon: <IconShelf />,
    title: '我的路书',
    text: '写过的路书都在书架上，可复制、可改名，也可设为仅自己可见。',
  },
  {
    key: '公开',
    icon: <IconShare />,
    title: '公开路书',
    text: '公开后出现在「公开路书」里，别人用链接也能看完整路线和每天行程。',
  },
] as const

function HeroDiagram() {
  return (
    <div className="hero-diagram" aria-hidden>
      <div className="hero-diagram-head">
        <span>随意添加</span>
        <span className="hero-diagram-arrow">→</span>
        <span>自动串联</span>
        <span className="hero-diagram-arrow">→</span>
        <span>过夜分天</span>
      </div>
      <svg className="hero-diagram-svg" viewBox="0 0 360 220" fill="none">
        <g opacity="0.45">
          <circle cx="58" cy="44" r="7" fill="#7c5cff" />
          <circle cx="118" cy="28" r="7" fill="#7c5cff" />
          <circle cx="198" cy="52" r="7" fill="#7c5cff" />
          <circle cx="268" cy="34" r="7" fill="#7c5cff" />
          <circle cx="312" cy="68" r="7" fill="#7c5cff" />
        </g>
        <path
          d="M58 44 C 88 72, 108 58, 118 78 C 138 108, 168 92, 198 88 C 228 84, 248 72, 268 92 C 288 112, 302 108, 312 128"
          stroke="#7c5cff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="58" cy="44" r="9" stroke="#7c5cff" strokeWidth="2" fill="#fff" />
        <circle cx="118" cy="78" r="9" stroke="#7c5cff" strokeWidth="2" fill="#fff" />
        <circle cx="198" cy="88" r="9" stroke="#7c5cff" strokeWidth="2" fill="#fff" />
        <circle cx="268" cy="92" r="9" stroke="#7c5cff" strokeWidth="2" fill="#fff" />
        <circle cx="312" cy="128" r="9" stroke="#7c5cff" strokeWidth="2" fill="#fff" />
        <line x1="198" y1="128" x2="198" y2="156" stroke="#b8a8ff" strokeWidth="1.5" strokeDasharray="4 3" />
        <rect x="24" y="162" width="150" height="36" rx="8" fill="rgba(124,92,255,0.12)" stroke="rgba(124,92,255,0.35)" />
        <rect x="186" y="162" width="150" height="36" rx="8" fill="rgba(124,92,255,0.06)" stroke="rgba(124,92,255,0.2)" />
        <text x="99" y="185" textAnchor="middle" fill="#6b46f5" fontSize="12" fontWeight="600" fontFamily="Manrope, Noto Sans SC, sans-serif">
          第 1 天
        </text>
        <text x="261" y="185" textAnchor="middle" fill="#8a7bb8" fontSize="12" fontWeight="600" fontFamily="Manrope, Noto Sans SC, sans-serif">
          第 2 天
        </text>
        <circle cx="198" cy="162" r="5" fill="#7c5cff" />
        <text x="198" y="206" textAnchor="middle" fill="#6c6c7c" fontSize="10" fontFamily="Manrope, Noto Sans SC, sans-serif">
          过夜点
        </text>
      </svg>
    </div>
  )
}

/** `/`：首页，首屏 + 核心功能；书单都在独立的 `/list`、`/public` 页。 */
export function RouteList() {
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
              <p className="eyebrow">自驾游路书</p>
              <h1>
                想去的都加进来，
                <br />
                顺序和天数自动排好
              </h1>
              <p className="lede">
                不用纠结先去哪、第几天走哪段。地点搜进来就好，路书按路程串联所有点；在过夜处钉分割针，行程自动分成一天天。
              </p>
              <div className="hero-cta">
                <button type="button" className="btn-primary" onClick={startNew}>
                  新建一本路书
                </button>
                <button type="button" className="btn-ghost" onClick={navigatePublic}>
                  看看公开路书
                </button>
              </div>
            </div>
            <HeroDiagram />
          </div>
        </section>

        <section className="flow">
          <div className="shell">
            <header className="section-head">
              <h2>三步搞定行程</h2>
              <p>先加点，再串线，最后分天——顺序不用你操心。</p>
            </header>
            <ol className="flow-steps">
              {FLOW_STEPS.map((f, i) => (
                <li key={f.key} className="flow-step">
                  <div className="flow-step-card">
                    <div className="flow-step-top">
                      <span className="flow-step-num">{f.step}</span>
                      <span className="feature-icon">{f.icon}</span>
                    </div>
                    <span className="flow-step-key">{f.key}</span>
                    <h3>{f.title}</h3>
                    <p>{f.text}</p>
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
              <h2>还有这些</h2>
              <p>地图、书架与分享，写完之后随时查看和发布。</p>
            </header>
            <div className="feature-grid feature-grid--aux">
              {EXTRA_FEATURES.map((f) => (
                <div key={f.key} className="feature feature--aux">
                  <span className="feature-icon">{f.icon}</span>
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
