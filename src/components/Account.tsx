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
  updateDisplayName,
  useAuth,
  type AuthError,
} from '../lib/auth'
import {
  limitDisplayNameInput,
  normalizeChosenDisplayName,
  validateDisplayName,
} from '../../shared/display-name'
import { navigateList, readRoute } from '../lib/router'
import { getLang, useI18n } from '../lib/i18n'
import { MAX_PASSWORD, MIN_PASSWORD, hasInvalidPasswordChars, passwordStrength } from '../../shared/password'
import { flushPending } from '../lib/sync'
import { mountTurnstile, turnstileConfigured } from '../lib/turnstile'
import { SiteNav } from './Chrome'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

function fmtDate(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  if (getLang() === 'en') {
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }
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

function IconEye({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3.2" />
      {off ? <path d="m4 4 16 16" /> : null}
    </svg>
  )
}

// ── 登录 / 注册表单 ──────────────────────────────────────────────────────────

type Mode = 'login' | 'register'
type ActivationNotice = 'expired' | 'invalid' | 'resent'

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
  const { t } = useI18n()
  const status = useAuth((s) => s.status)
  const backendError = useAuth((s) => s.error)
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileKey, setTurnstileKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [resending, setResending] = useState(false)
  const [registerPending, setRegisterPending] = useState(false)
  const [activationNotice, setActivationNotice] = useState<ActivationNotice | null>(null)
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
      setActivationNotice('expired')
      window.history.replaceState(null, '', window.location.pathname)
    } else if (activate === 'invalid') {
      setActivationNotice('invalid')
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  const switchMode = (next: Mode) => {
    if (busy || next === mode) return
    setMode(next)
    setError(null)
    setPassword('')
    setShowPassword(false)
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
    setActivationNotice('resent')
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
    // 登录不做口令形态校验（老账号可能更短或含中文），交给服务端验证。
    if (mode === 'register') {
      if (password.length < MIN_PASSWORD) {
        setError('weak_password')
        return
      }
      if (hasInvalidPasswordChars(password)) {
        setError('invalid_password')
        return
      }
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
  const strength = passwordStrength(password)
  const strengthLabel =
    strength === 'strong'
      ? 'auth.pwStrong'
      : strength === 'fair'
        ? 'auth.pwFair'
        : 'auth.pwWeak'
  const badChars = hasInvalidPasswordChars(password)
  const showResend =
    error === 'email_not_activated' ||
    registerPending ||
    activationNotice === 'expired' ||
    activationNotice === 'invalid'

  if (status === 'error') {
    return (
      <div className="auth-panel">
        <div className="auth-intro">
          <h1>{t('auth.serviceDownTitle')}</h1>
          <p>{authErrorText(backendError ?? 'backend_unavailable')}</p>
        </div>
        <button type="button" className="btn-primary auth-submit" onClick={retryAuth}>
          {t('auth.retry')}
        </button>
      </div>
    )
  }

  if (registerPending) {
    return (
      <div className="auth-panel">
        <div className="auth-intro">
          <h1>{t('auth.checkEmailTitle')}</h1>
          <p>
            {t('auth.checkEmailBefore')}
            <strong>{email.trim().toLowerCase()}</strong>
            {t('auth.checkEmailAfter')}
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
          {resending ? t('auth.sending') : t('auth.resendPrompt')}
        </button>
        <p className="auth-switch">
          {t('auth.haveAccount')}
          <button type="button" onClick={() => switchMode('login')}>
            {t('auth.goLogin')}
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
          {t('auth.tabLogin')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'register'}
          className={mode === 'register' ? 'auth-tab on' : 'auth-tab'}
          onClick={() => switchMode('register')}
        >
          {t('auth.tabRegister')}
        </button>
      </div>

      {activationNotice ? (
        <p className="auth-notice">
          {activationNotice === 'expired'
            ? t('auth.activateExpired')
            : activationNotice === 'invalid'
              ? t('auth.activateInvalid')
              : t('auth.resendDone')}
        </p>
      ) : null}

      <form className="auth-form" onSubmit={submit} noValidate>
        <label className="auth-field">
          <span>{t('auth.email')}</span>
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
          <span>{t('auth.password')}</span>
          <div className="auth-input">
            <IconLock />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={t('auth.passwordPlaceholder', { min: MIN_PASSWORD })}
              maxLength={MAX_PASSWORD}
            />
            <button
              type="button"
              className="auth-eye"
              aria-label={t(showPassword ? 'auth.hidePassword' : 'auth.showPassword')}
              aria-pressed={showPassword}
              title={t(showPassword ? 'auth.hidePassword' : 'auth.showPassword')}
              onClick={() => setShowPassword((v) => !v)}
            >
              <IconEye off={showPassword} />
            </button>
          </div>
          {mode === 'register' && password ? (
            <div className="pw-hint" data-level={badChars ? 'invalid' : strength}>
              <span className="pw-bars" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <span className="pw-text">
                {badChars ? t('auth.pwInvalid') : t(strengthLabel)}
              </span>
            </div>
          ) : null}
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
            {resending ? t('auth.sending') : t('auth.resend')}
          </button>
        ) : null}

        <button type="submit" className="btn-primary auth-submit" disabled={disabled}>
          {busy ? t('auth.busy') : mode === 'login' ? t('auth.tabLogin') : t('auth.tabRegister')}
        </button>
      </form>

      <p className="auth-switch">
        {mode === 'login' ? (
          <>
            {t('auth.noAccount')}
            <button type="button" onClick={() => switchMode('register')}>
              {t('auth.registerNow')}
            </button>
          </>
        ) : (
          <>
            {t('auth.haveAccount')}
            <button type="button" onClick={() => switchMode('login')}>
              {t('auth.goLogin')}
            </button>
          </>
        )}
      </p>
    </div>
  )
}

// ── 已登录：账号信息 ────────────────────────────────────────────────────────

function ProfilePanel({ onSignOut }: { onSignOut: () => void }) {
  const { t } = useI18n()
  const user = useAuth((s) => s.user)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(user?.displayName ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<AuthError | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const ignoreBlur = useRef(false)

  useEffect(() => {
    if (user && !editing) setName(user.displayName)
  }, [user?.displayName, editing])

  useEffect(() => {
    if (!editing) return
    const el = nameRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [editing])

  if (!user) return null

  const shown = editing ? normalizeChosenDisplayName(name) || user.displayName : user.displayName
  const initial = [...shown][0]?.toUpperCase() ?? '?'

  const startEdit = () => {
    if (busy) return
    ignoreBlur.current = false
    setName(user.displayName)
    setError(null)
    setEditing(true)
  }

  const cancel = () => {
    ignoreBlur.current = true
    setName(user.displayName)
    setError(null)
    setEditing(false)
  }

  const commit = async () => {
    if (busy) return
    const trimmed = normalizeChosenDisplayName(name)
    if (trimmed === user.displayName) {
      setError(null)
      setEditing(false)
      return
    }
    const localError = validateDisplayName(trimmed)
    if (localError) {
      setError(localError)
      nameRef.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    const res = await updateDisplayName(trimmed)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      nameRef.current?.focus()
      return
    }
    setName(res.user.displayName)
    setEditing(false)
  }

  return (
    <div className="auth-panel">
      <header className="account-head">
        <span className="account-avatar-lg">{initial}</span>
        <div className="account-head-text">
          {editing ? (
            <input
              ref={nameRef}
              className={error ? 'account-nick-input invalid' : 'account-nick-input'}
              type="text"
              name="nickname"
              autoComplete="nickname"
              enterKeyHint="done"
              value={name}
              disabled={busy}
              aria-label={t('account.editNickname')}
              aria-invalid={Boolean(error)}
              onChange={(e) => {
                setName(limitDisplayNameInput(name, e.target.value))
                setError(null)
              }}
              onBlur={() => {
                if (ignoreBlur.current) {
                  ignoreBlur.current = false
                  return
                }
                void commit()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void commit()
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  cancel()
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="account-nick-btn"
              onClick={startEdit}
              title={t('account.editNickname')}
              aria-label={t('account.editNickname')}
            >
              {user.displayName}
            </button>
          )}
          {editing && error ? <p className="auth-error">{authErrorText(error)}</p> : null}
        </div>
      </header>

      <dl className="account-rows">
        <div>
          <dt>{t('account.email')}</dt>
          <dd>{user.email}</dd>
        </div>
        <div>
          <dt>{t('account.userId')}</dt>
          <dd>{user.hashId || '—'}</dd>
        </div>
        <div>
          <dt>{t('account.joined')}</dt>
          <dd>{fmtDate(user.createdAt) || '—'}</dd>
        </div>
      </dl>

      <div className="account-danger">
        <button type="button" className="btn-ghost" onClick={onSignOut}>
          {t('account.signOut')}
        </button>
      </div>
    </div>
  )
}

// ── /account 页面 ────────────────────────────────────────────────────────────

const POST_ACTIVATE_KEY = 'lushu-post-activate'

export function AccountPage() {
  const { t } = useI18n()
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
              <p className="account-loading">{t('account.checking')}</p>
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
