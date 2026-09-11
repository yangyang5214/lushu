import { requireLogin, useAuth } from '../lib/auth'
import { navigateBook } from '../lib/router'
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

const FEATURES = [
  {
    step: '第一步',
    icon: <IconSearch />,
    title: '搜地点，可一直加',
    text: '城市、寺庙、老街、营地，搜到什么就放什么。顺序不用先想好，加进来之后再排。',
  },
  {
    step: '第二步',
    icon: <IconPin />,
    title: '定起点和终点',
    text: '在任意两点上钉起终点，中间的点按路程自动串起来；钉在同一处，就是一条环线。',
  },
  {
    step: '第三步',
    icon: <IconCut />,
    title: '在过夜处剪一刀',
    text: '在要过夜的点上剪一刀，方便把行程按天分开。',
  },
]

/** `/`：首页，首屏 + 怎么用；书单都在独立的 `/list`、`/public` 页。 */
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
          <div className="shell hero-in">
            <h1>搜地点，串路线，在过夜处切成每天</h1>
            <p className="lede">
              不用先想好第几天去哪：把城市、景点、营地一个个搜进来，
              钉起终点后自动串成一条线；在要住下来的地方钉分割针，行程就按天分开。
            </p>
            <div className="hero-cta">
              <button type="button" className="btn-primary" onClick={startNew}>
                新建一本路书
              </button>
            </div>
          </div>
        </section>

        <section className="features">
          <div className="shell feature-grid">
            {FEATURES.map((f) => (
              <div key={f.title} className="feature">
                <span className="feature-icon">{f.icon}</span>
                <span className="feature-step">{f.step}</span>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
