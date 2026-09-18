import { useEffect, useState } from 'react'
import { fetchPublicStats } from '../lib/api'
import { requireLogin, useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { navigateBook, navigatePublic } from '../lib/router'
import { useLushu } from '../store'
import { SiteNav } from './Chrome'
import { HeroDiagram } from './HeroDiagram'

/** `/`：首页，首屏 + 新建入口；功能逐条说明在 `/features`，书单在 `/list`、`/public`。 */
export function RouteList() {
  const { lang, t } = useI18n()
  const createBook = useLushu((s) => s.createBook)
  // 已激活账号数：首屏按钮下面那一行小字。取不到就不显示，不占位也不报错。
  const [users, setUsers] = useState(0)

  useEffect(() => {
    let cancelled = false
    void fetchPublicStats().then((stats) => {
      if (!cancelled && stats) setUsers(stats.users)
    })
    return () => {
      cancelled = true
    }
  }, [])

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
              {users > 0 ? (
                <p className="hero-note">
                  {t('home.userCount', {
                    n: users.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US'),
                  })}
                </p>
              ) : null}
            </div>
            <HeroDiagram />
          </div>
        </section>
      </main>
    </div>
  )
}
