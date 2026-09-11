// 账号：登录 / 注册 + 会话。
//
// 设计（和 functions/lib/auth.ts 一一对应）：
//   · 没有游客账号。登录名就是邮箱；注册和登录是两个明确的动作，登录不会
//     顺手注册。口令至少 6 位。
//   · 注册后须点击邮件里的激活链接才能登录。
//   · 登录 / 注册时带上本机旧的 owner_key，服务端把此前匿名创建的书过户到账号。
//   · 「我的路书」= 未登录时的本机匿名书架（x-owner-key）；登录后按账号归属。
//
// 这里只负责账号态；路书同步仍由 sync.ts 负责。

import { create } from 'zustand'
import { BACKEND_UNAVAILABLE } from './api'
import { ownerKey } from './keys'
import { markBookOrigin, navigateAccount } from './router'

export type AuthUser = {
  id: string
  /** 邮箱派生的公开短 ID（10 位 hex），展示 / 引用用，不是凭证。 */
  hashId: string
  email: string
  displayName: string
  createdAt: number
}

/** loading = 还在探测；error = 后端不可达 / 缺配置，需要显式报错并重试。 */
export type AuthStatus = 'loading' | 'ready' | 'error'

type AuthStore = {
  status: AuthStatus
  user: AuthUser | null
  pending: (() => void) | null
  error: AuthError | null
}

export const useAuth = create<AuthStore>(() => ({
  status: 'loading',
  user: null,
  pending: null,
  error: null,
}))

/**
 * 需要登录才能做的事：已登录就直接执行；未登录则记下动作并跳到 /account，
 * 登录 / 注册成功后由账户页把它接着做完（比如「新建路书」）。
 */
export function requireLogin(run: () => void): void {
  if (loggedIn()) {
    run()
    return
  }
  useAuth.setState({ pending: run })
  // 登录成功后 pending 会打开路书，返回时要回用户点按钮的那一页，而不是登录页。
  markBookOrigin()
  navigateAccount()
}

export function takePending(): (() => void) | null {
  const pending = useAuth.getState().pending
  if (pending) useAuth.setState({ pending: null })
  return pending
}

/** 当前是否已登录（用 getState，方便在事件里同步判断）。 */
export function loggedIn(): boolean {
  return Boolean(useAuth.getState().user)
}

export type AuthError =
  | 'invalid_credentials'
  | 'invalid_email'
  | 'email_taken'
  | 'email_not_activated'
  | 'weak_password'
  | 'activation_cooldown'
  | 'activation_rate_limit'
  | 'email_failed'
  | 'turnstile_required'
  | 'turnstile_failed'
  | 'network'
  | 'backend_unavailable'

const ERROR_TEXT: Record<AuthError, string> = {
  invalid_credentials: '邮箱或密码不对',
  invalid_email: '请输入有效的邮箱地址',
  email_taken: '这个邮箱已经注册过了，直接登录即可',
  email_not_activated: '账号尚未激活，请查收邮件并点击激活链接',
  weak_password: '密码至少 6 位',
  activation_cooldown: '发送太频繁，请稍后再试',
  activation_rate_limit: '该邮箱今日发信次数已达上限，请稍后再试',
  email_failed: '激活邮件发送失败，请稍后再试',
  turnstile_required: '请先完成人机验证',
  turnstile_failed: '人机验证失败，请重试',
  network: '网络不可用，账号暂时用不了',
  backend_unavailable: BACKEND_UNAVAILABLE,
}

export function authErrorText(error: AuthError): string {
  return ERROR_TEXT[error] ?? '出了点问题，请重试'
}

const TIMEOUT_MS = 12_000

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    return await fetch(path, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

function isJson(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').includes('application/json')
}

const KNOWN_ERRORS: AuthError[] = [
  'invalid_credentials',
  'invalid_email',
  'email_taken',
  'email_not_activated',
  'weak_password',
  'activation_cooldown',
  'activation_rate_limit',
  'email_failed',
  'turnstile_required',
  'turnstile_failed',
]

function asError(code: unknown): AuthError {
  return KNOWN_ERRORS.includes(code as AuthError) ? (code as AuthError) : 'network'
}

type AuthOk = { ok: true; user: AuthUser }
type AuthFail = { ok: false; error: AuthError }
export type AuthResult = AuthOk | AuthFail

type RegisterOk = { ok: true; pending: true }
type RegisterFail = { ok: false; error: AuthError }
export type RegisterResult = RegisterOk | RegisterFail

type ResendOk = { ok: true }
type ResendFail = { ok: false; error: AuthError }
export type ResendResult = ResendOk | ResendFail

async function post(
  path: string,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<AuthResult> {
  let res: Response
  try {
    res = await request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, error: 'network' }
  }
  if (!isJson(res)) return { ok: false, error: 'network' }
  const data = (await res.json()) as { user?: AuthUser; error?: unknown }
  if (res.ok && data.user) return { ok: true, user: data.user }
  return { ok: false, error: asError(data.error) }
}

type MeResult = AuthUser | null | 'error'

async function getMe(): Promise<MeResult> {
  let res: Response
  try {
    res = await request('/api/auth/me')
  } catch {
    return 'error'
  }
  if (!isJson(res) || !res.ok) return 'error'
  const data = (await res.json()) as { user?: AuthUser | null }
  return data.user ?? null
}

/** 探测登录态。幂等：React StrictMode 下 effect 会跑两次，这里只真正执行一次。 */
let initStarted = false
export async function initAuth(): Promise<void> {
  if (initStarted) return
  initStarted = true
  await probeAuth()
}

async function probeAuth(): Promise<void> {
  const me = await getMe()
  if (me === 'error') {
    useAuth.setState({ status: 'error', user: null, error: 'backend_unavailable' })
  } else {
    useAuth.setState({ status: 'ready', user: me, error: null })
  }
}

/** 后端不可达时手动重试探测。 */
export function retryAuth(): void {
  if (useAuth.getState().status === 'loading') return
  useAuth.setState({ status: 'loading', user: null, error: null })
  void probeAuth()
}

/** 重新探测登录态（例如邮件激活跳转回来后刷新会话）。 */
export function refreshAuth(): void {
  useAuth.setState({ status: 'loading', error: null })
  void probeAuth()
}

/** 登录；邮箱未注册或密码不对都会失败，不会自动注册。 */
export async function login(email: string, password: string): Promise<AuthResult> {
  const res = await post('/api/auth/login', { email, password, ownerKey: ownerKey() })
  if (res.ok) useAuth.setState({ status: 'ready', user: res.user })
  return res
}

/** 注册；成功后发送激活邮件，须点击链接后才能登录。 */
export async function register(
  email: string,
  password: string,
  turnstile?: string,
): Promise<RegisterResult> {
  const headers = turnstile ? { 'x-turnstile-token': turnstile } : undefined
  let res: Response
  try {
    res = await request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ email, password, ownerKey: ownerKey() }),
    })
  } catch {
    return { ok: false, error: 'network' }
  }
  if (!isJson(res)) return { ok: false, error: 'network' }
  if (res.ok) return { ok: true, pending: true }
  const data = (await res.json()) as { error?: unknown }
  return { ok: false, error: asError(data.error) }
}

/** 重发激活邮件（账号存在且尚未激活）。 */
export async function resendActivation(
  email: string,
  turnstile?: string,
): Promise<ResendResult> {
  const headers = turnstile ? { 'x-turnstile-token': turnstile } : undefined
  let res: Response
  try {
    res = await request('/api/auth/resend-activation', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ email }),
    })
  } catch {
    return { ok: false, error: 'network' }
  }
  if (!isJson(res)) return { ok: false, error: 'network' }
  if (res.ok) return { ok: true }
  const data = (await res.json()) as { error?: unknown }
  return { ok: false, error: asError(data.error) }
}

/**
 * 退出登录。
 *
 * 退出账号：账号只是路书归属的一把钥匙，退出时把设备上的缓存（路书、令牌、书架
 * 密钥）一并清掉，避免同一台设备换账号后，把上一账号的口令与路书留在
 * 浏览器里。路书仍在这个账号里，重新登录就能同步回来。调用前请先
 * flushPending() 把未推送的改动发出去。
 */
export async function signOut(): Promise<void> {
  try {
    await request('/api/auth/logout', { method: 'POST' })
  } catch {
    /* 请求失败也照样清设备缓存，退出不能被网络卡住 */
  }
  try {
    localStorage.removeItem('lushu-v1')
    localStorage.removeItem('lushu-meta-v1')
    localStorage.removeItem('lushu-owner-v1')
  } catch {
    /* 隐私模式 / 存储不可用：忽略 */
  }
  useAuth.setState({ status: 'loading', user: null, pending: null })
  window.location.assign('/')
}
