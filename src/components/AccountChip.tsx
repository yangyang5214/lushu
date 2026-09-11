import { BACKEND_UNAVAILABLE } from '../lib/api'
import { useAuth } from '../lib/auth'
import { navigateAccount } from '../lib/router'

/** 页头右侧的账户入口：未登录显示「账户」，登录后显示昵称。 */
export function AccountChip() {
  const status = useAuth((s) => s.status)
  const user = useAuth((s) => s.user)

  if (status === 'loading') return <span className="account-chip muted" aria-hidden>…</span>

  if (status === 'error') {
    return (
      <button
        type="button"
        className="account-chip error"
        onClick={() => navigateAccount()}
        title={BACKEND_UNAVAILABLE}
      >
        服务不可用
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
          title={`账户 · ${user.email}`}
        >
          <span className="account-avatar">{user.displayName.slice(0, 1).toUpperCase()}</span>
          {user.displayName}
        </button>
      ) : (
        <button type="button" className="account-chip" onClick={() => navigateAccount()}>
          账户
        </button>
      )}
    </div>
  )
}
