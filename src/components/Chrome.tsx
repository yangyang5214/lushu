import type { MouseEvent, ReactNode } from 'react'
import { useI18n } from '../lib/i18n'
import { navigateFeatures, navigateList, navigateMine, navigateMp, navigatePublic } from '../lib/router'
import { AccountChip } from './AccountChip'
import { BrandMark } from './BrandMark'
import { LangSwitch } from './LangSwitch'

export type NavKey = 'features' | 'mine' | 'public' | 'mp'

/** 项目开源地址：页头右上角的 GitHub 图标入口。 */
export const GITHUB_URL = 'https://github.com/yangyang5214/lushu'

/** 功能反馈：直接打开 GitHub 的新建 issue 页面，不用再让用户自己找。 */
export const FEEDBACK_URL = 'https://github.com/yangyang5214/lushu/issues/new'

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2C6.48 2 2 6.58 2 12.26c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.4 9.4 0 0 1 2.5-.34c.85 0 1.71.12 2.5.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.57 5.05.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.26C22 6.58 17.52 2 12 2Z" />
    </svg>
  )
}

function GithubLink() {
  const { t } = useI18n()
  return (
    <a
      className="nav-github"
      href={GITHUB_URL}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={t('nav.github')}
      title={t('nav.github')}
    >
      <GithubIcon />
    </a>
  )
}

/** 全站页脚：版权信息 + 功能反馈入口（直接开 GitHub 新建 issue）。 */
export function SiteFooter() {
  const { t } = useI18n()
  return (
    <footer className="foot">
      <div className="shell foot-in">
        <span className="foot-copy">© {new Date().getFullYear()} lushu</span>
        <a className="foot-feedback" href={FEEDBACK_URL} target="_blank" rel="noreferrer noopener">
          {t('nav.feedback')}
        </a>
      </div>
    </footer>
  )
}

function jump(fn: () => void) {
  return (e: MouseEvent) => {
    e.preventDefault()
    fn()
  }
}

/** 全站页头：品牌、四个导航项（当前页高亮）、账户入口。 */
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
          <a
            href="/features"
            className={active === 'features' ? 'on' : undefined}
            onClick={jump(navigateFeatures)}
          >
            {t('nav.features')}
          </a>
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
          <a href="/mp" className={active === 'mp' ? 'on' : undefined} onClick={jump(navigateMp)}>
            {t('nav.mp')}
          </a>
        </nav>
        <div className="nav-actions">
          <GithubLink />
          <LangSwitch />
          <AccountChip />
          {extra}
        </div>
      </div>
    </header>
  )
}
