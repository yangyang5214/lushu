import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import {
  authErrorText,
  register,
  login,
  refreshAuth,
  resendActivation,
  retryAuth,
  signOut,
  takePending,
  useAuth,
  type AuthError,
} from '../lib/auth'
import { navigateList, readRoute } from '../lib/router'
import { flushPending } from '../lib/sync'
import { mountTurnstile, turnstileConfigured } from '../lib/turnstile'
import { SiteNav } from './Chrome'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function fmtDate(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

function IconMail() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="m4 7.5 8 5.5 8-5.5" />
    </svg>
  )
}

function IconLock() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </svg>
  )
}

// ── 登录 / 注册表单 ──────────────────────────────────────────────────────────

type Mode = 'login' | 'register'

function TurnstileField({
  resetKey,
  onToken,
  onClear,
}: {
  resetKey: number
  onToken: (token: string) => void
  onClear: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host || !turnstileConfigured()) return
    let cleanup: (() => void) | undefined
    void mountTurnstile(host, {
      onToken,
      onExpire: onClear,
      onError: onClear,
    }).then((fn) => {
      cleanup = fn
    })
    return () => cleanup?.()
  }, [resetKey, onToken, onClear])

  if (!turnstileConfigured()) return null
  return <div className="auth-turnstile" ref={hostRef} />
}

function AuthPanel() {
  const status = useAuth((s) => s.status)
  const backendError = useAuth((s) => s.error)
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileKey, setTurnstileKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [resending, setResending] = useState(false)
  const [registerPending, setRegisterPending] = useState(false)
  const [activationNotice, setActivationNotice] = useState<string | null>(null)
  const [error, setError] = useState<AuthError | null>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const needTurnstile = turnstileConfigured()

  const clearTurnstile = useCallback(() => setTurnstileToken(null), [])
  const onTurnstileToken = useCallback((token: string) => setTurnstileToken(token), [])
  const resetTurnstile = useCallback(() => {
    setTurnstileToken(null)
    setTurnstileKey((k) => k + 1)
  }, [])

  useEffect(() => {
    emailRef.current?.focus()
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const activate = params.get('activate')
    if (activate === 'expired') {
      setActivationNotice('激活链接已过期，请重新注册或重发激活邮件。')
      window.history.replaceState(null, '', window.location.pathname)
    } else if (activate === 'invalid') {
      setActivationNotice('激活链接无效，请重新注册或重发激活邮件。')
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  const switchMode = (next: Mode) => {
    if (busy || next === mode) return
    setMode(next)
    setError(null)
    setPassword('')
    setRegisterPending(false)
    setActivationNotice(null)
    resetTurnstile()
  }

  const finish = () => {
    const pending = takePending()
    if (pending) {
      pending()
      return
    }
    if (readRoute().name !== 'mine') navigateList()
  }

  const resend = async () => {
    if (resending || busy) return
    const mail = email.trim().toLowerCase()
    if (!EMAIL_RE.test(mail)) {
      setError('invalid_email')
      emailRef.current?.focus()
      return
    }
    if (needTurnstile && !turnstileToken) {
      setError('turnstile_required')
      return
    }
    setResending(true)
    setError(null)
    const res = await resendActivation(mail, turnstileToken ?? undefined)
    setResending(false)
    if (!res.ok) {
      setError(res.error)
      if (res.error === 'turnstile_failed' || res.error === 'turnstile_required') {
        resetTurnstile()
      }
      return
    }
    setActivationNotice('激活邮件已重新发送，请查收。')
    resetTurnstile()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    const mail = email.trim().toLowerCase()
    if (!EMAIL_RE.test(mail)) {
      setError('invalid_email')
      emailRef.current?.focus()
      return
    }
    if (password.length < 6) {
      setError('weak_password')
      return
    }
    if (mode === 'register') {
      if (needTurnstile && !turnstileToken) {
        setError('turnstile_required')
        return
      }
    }
    setBusy(true)
    setError(null)
    setActivationNotice(null)
    if (mode === 'login') {
      const res = await login(mail, password)
      setBusy(false)
      if (!res.ok) {
        setError(res.error)
        return
      }
      finish()
      return
    }
    const res = await register(mail, password, turnstileToken ?? undefined)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      if (res.error === 'turnstile_failed' || res.error === 'turnstile_required') {
        resetTurnstile()
      }
      return
    }
    setRegisterPending(true)
    resetTurnstile()
  }

  const disabled = status !== 'ready' || busy
  const showResend =
    error === 'email_not_activated' || registerPending || activationNotice?.includes('过期')

  if (status === 'error') {
    return (
      <div className="auth-panel">
        <div className="auth-intro">
          <h1>连不上服务</h1>
          <p>{authErrorText(backendError ?? 'backend_unavailable')}</p>
        </div>
        <button type="button" className="btn-primary auth-submit" onClick={retryAuth}>
          重试
        </button>
      </div>
    )
  }

  if (registerPending) {
    return (
      <div className="auth-panel">
        <div className="auth-intro">
          <h1>查收激活邮件</h1>
          <p>
            我们已向 <strong>{email.trim().toLowerCase()}</strong> 发送了一封激活邮件，
            请点击邮件中的链接完成注册。链接 24 小时内有效。
          </p>
        </div>
        <TurnstileField
          resetKey={turnstileKey}
          onToken={onTurnstileToken}
          onClear={clearTurnstile}
        />
        <button
          type="button"
          className="btn-ghost auth-submit"
          disabled={disabled || resending}
          onClick={() => void resend()}
        >
          {resending ? '发送中…' : '没收到？重新发送'}
        </button>
        <p className="auth-switch">
          已经有账号了？
          <button type="button" onClick={() => switchMode('login')}>
            去登录
          </button>
        </p>
      </div>
    )
  }

  return (
    <div className="auth-panel">
      <div className="auth-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'login'}
          className={mode === 'login' ? 'auth-tab on' : 'auth-tab'}
          onClick={() => switchMode('login')}
        >
          登录
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'register'}
          className={mode === 'register' ? 'auth-tab on' : 'auth-tab'}
          onClick={() => switchMode('register')}
        >
          注册
        </button>
      </div>

      <div className="auth-intro">
        <h1>{mode === 'login' ? '欢迎回来' : '创建账号'}</h1>
        {mode === 'register' ? (
          <p>注册后我们会向你的邮箱发送激活链接，点击即可开通账号。</p>
        ) : null}
      </div>

      {activationNotice ? <p className="auth-notice">{activationNotice}</p> : null}

      <form className="auth-form" onSubmit={submit} noValidate>
        <label className="auth-field">
          <span>邮箱</span>
          <div className="auth-input">
            <IconMail />
            <input
              ref={emailRef}
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              maxLength={254}
            />
          </div>
        </label>

        <label className="auth-field">
          <span>密码</span>
          <div className="auth-input">
            <IconLock />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder="至少 6 位"
              maxLength={128}
            />
          </div>
        </label>

        {mode === 'register' ? (
          <TurnstileField
            resetKey={turnstileKey}
            onToken={onTurnstileToken}
            onClear={clearTurnstile}
          />
        ) : null}

        {error ? <p className="auth-error">{authErrorText(error)}</p> : null}

        {showResend && mode === 'login' ? (
          <button
            type="button"
            className="btn-ghost auth-resend"
            disabled={disabled || resending}
            onClick={() => void resend()}
          >
            {resending ? '发送中…' : '重发激活邮件'}
          </button>
        ) : null}

        <button type="submit" className="btn-primary auth-submit" disabled={disabled}>
          {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册'}
        </button>
      </form>

      <p className="auth-switch">
        {mode === 'login' ? (
          <>
            还没有账号？
            <button type="button" onClick={() => switchMode('register')}>
              立即注册
            </button>
          </>
        ) : (
          <>
            已经有账号了？
            <button type="button" onClick={() => switchMode('login')}>
              去登录
            </button>
          </>
        )}
      </p>
    </div>
  )
}

// ── 已登录：账号信息 ────────────────────────────────────────────────────────

function ProfilePanel({ onSignOut }: { onSignOut: () => void }) {
  const user = useAuth((s) => s.user)
  if (!user) return null

  return (
    <div className="auth-panel">
      <header className="account-head">
        <span className="account-avatar-lg">{user.displayName.slice(0, 1).toUpperCase()}</span>
        <div className="account-head-text">
          <h1>{user.displayName}</h1>
          <p className="account-mail">{user.email}</p>
        </div>
      </header>

      <dl className="account-rows">
        <div>
          <dt>登录邮箱</dt>
          <dd>{user.email}</dd>
        </div>
        <div>
          <dt>用户 ID</dt>
          <dd>{user.hashId || '—'}</dd>
        </div>
        <div>
          <dt>注册时间</dt>
          <dd>{fmtDate(user.createdAt) || '—'}</dd>
        </div>
      </dl>

      <div className="account-danger">
        <button type="button" className="btn-ghost" onClick={onSignOut}>
          退出登录
        </button>
      </div>
    </div>
  )
}

// ── /account 页面 ────────────────────────────────────────────────────────────

const POST_ACTIVATE_KEY = 'lushu-post-activate'

export function AccountPage() {
  const status = useAuth((s) => s.status)
  const user = useAuth((s) => s.user)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('activated') === '1') {
      try {
        sessionStorage.setItem(POST_ACTIVATE_KEY, '1')
      } catch {
        /* 隐私模式 */
      }
      refreshAuth()
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    try {
      if (sessionStorage.getItem(POST_ACTIVATE_KEY) !== '1') return
      sessionStorage.removeItem(POST_ACTIVATE_KEY)
    } catch {
      return
    }
    const pending = takePending()
    if (pending) {
      pending()
      return
    }
    if (readRoute().name !== 'mine') navigateList()
  }, [user])

  const doSignOut = async () => {
    await flushPending()
    await signOut()
  }

  return (
    <div className="home account-home">
      <SiteNav />

      <main className="account-main">
        <div className="shell account-shell">
          {status === 'loading' ? (
            <div className="account-card">
              <p className="account-loading">正在确认登录状态…</p>
            </div>
          ) : user ? (
            <div className="account-card">
              <ProfilePanel onSignOut={() => void doSignOut()} />
            </div>
          ) : (
            <div className="account-card">
              <AuthPanel />
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
