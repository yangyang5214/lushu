import { requireLogin, useAuth } from '../lib/auth'
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
                  新建路书
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
