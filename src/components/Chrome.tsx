import type { MouseEvent, ReactNode } from 'react'
import { useI18n } from '../lib/i18n'
import { navigateList, navigateMine, navigatePublic } from '../lib/router'
import { AccountChip } from './AccountChip'
import { BrandMark } from './BrandMark'
import { LangSwitch } from './LangSwitch'

export type NavKey = 'mine' | 'public'

function jump(fn: () => void) {
  return (e: MouseEvent) => {
    e.preventDefault()
    fn()
  }
}

/** 全站页头：品牌、三个导航项（当前页高亮）、账户入口。 */
export function SiteNav({
  active,
  extra,
}: {
  active?: NavKey
  extra?: ReactNode
}) {
  const { t } = useI18n()
  return (
    <header className="nav">
      <div className="shell nav-in">
        <a className="brand" href="/" onClick={jump(navigateList)}>
          <BrandMark />
          <b>lushu</b>
        </a>
        <nav className="nav-links">
          <a href="/list" className={active === 'mine' ? 'on' : undefined} onClick={jump(navigateMine)}>
            {t('nav.mine')}
          </a>
          <a
            href="/public"
            className={active === 'public' ? 'on' : undefined}
            onClick={jump(navigatePublic)}
          >
            {t('nav.public')}
          </a>
        </nav>
        <div className="nav-actions">
          <LangSwitch />
          <AccountChip />
          {extra}
        </div>
      </div>
    </header>
  )
}
