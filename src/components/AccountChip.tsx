import { useAuth } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { navigateAccount } from '../lib/router'

/** 页头右侧的账户入口：未登录显示「账户」，登录后显示昵称。 */
export function AccountChip() {
  const { t } = useI18n()
  const status = useAuth((s) => s.status)
  const user = useAuth((s) => s.user)

  if (status === 'loading') return <span className="account-chip muted" aria-hidden>…</span>

  if (status === 'error') {
    return (
      <button
        type="button"
        className="account-chip error"
        onClick={() => navigateAccount()}
        title={t('common.backendUnavailable')}
      >
        {t('nav.serviceDown')}
      </button>
    )
  }

  return (
    <div className="account">
      {user ? (
        <button
          type="button"
          className="account-chip who"
          onClick={() => navigateAccount()}
          title={t('nav.accountTitle', { email: user.email })}
        >
          <span className="account-avatar">{user.displayName.slice(0, 1).toUpperCase()}</span>
          {user.displayName}
        </button>
      ) : (
        <button type="button" className="account-chip" onClick={() => navigateAccount()}>
          {t('nav.account')}
        </button>
      )}
    </div>
  )
}
