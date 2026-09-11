/// <reference types="@cloudflare/workers-types" />
//
// 管理后台鉴权：部署时用 wrangler pages secret put ADMIN_SECRET 设置口令。
// 未配置 ADMIN_SECRET 时，所有 /api/admin/* 返回 404（不暴露端点存在）。
//
// 会话是无状态的 HMAC 签名 cookie（不占用 D1），默认 8 小时有效。

import { parseCookies, randomHex, safeEqual } from './auth'

export const ADMIN_COOKIE = 'lushu_admin_session'
const ADMIN_TTL_MS = 8 * 86_400_000 / 3 // 8 小时

export type AdminEnv = {
  ADMIN_SECRET?: string
}

const encoder = new TextEncoder()

function bytesToHex(arr: Uint8Array): string {
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmacSha256(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return bytesToHex(new Uint8Array(sig))
}

function cookieAttrs(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `Path=/; HttpOnly; SameSite=Lax${secure}`
}

/** 管理后台是否已配置（未配置则所有 admin 路由应返回 404）。 */
export function adminConfigured(env: AdminEnv): boolean {
  const secret = env.ADMIN_SECRET?.trim() ?? ''
  // 与账号口令下限一致；部署时仍建议用更长的随机串。
  return secret.length >= 6
}

function adminToken(request: Request): string {
  const token = parseCookies(request.headers.get('cookie'))[ADMIN_COOKIE] ?? ''
  return /^[0-9a-f]{32}\.\d+\.[0-9a-f]{64}$/.test(token) ? token : ''
}

/** 校验当前请求是否持有有效的管理员会话。 */
export async function isAdmin(request: Request, env: AdminEnv): Promise<boolean> {
  const secret = env.ADMIN_SECRET?.trim() ?? ''
  if (!secret) return false
  const token = adminToken(request)
  if (!token) return false
  const [nonce, expRaw, sig] = token.split('.')
  const exp = Number(expRaw)
  if (!nonce || !Number.isFinite(exp) || !sig || exp <= Date.now()) return false
  const payload = `${nonce}.${exp}`
  const expected = await hmacSha256(secret, payload)
  return safeEqual(expected, sig)
}

/** 用 ADMIN_SECRET 登录，成功则返回 Set-Cookie 头值。 */
export async function adminLogin(
  request: Request,
  env: AdminEnv,
  token: string,
): Promise<{ ok: true; cookie: string } | { ok: false }> {
  const secret = env.ADMIN_SECRET?.trim() ?? ''
  if (!secret) return { ok: false }
  const input = String(token ?? '').trim()
  if (!input || !safeEqual(input, secret)) return { ok: false }
  const nonce = randomHex(16)
  const expiresAt = Date.now() + ADMIN_TTL_MS
  const payload = `${nonce}.${expiresAt}`
  const sig = await hmacSha256(secret, payload)
  const session = `${payload}.${sig}`
  const maxAge = Math.max(0, Math.round(ADMIN_TTL_MS / 1000))
  return {
    ok: true,
    cookie: `${ADMIN_COOKIE}=${session}; ${cookieAttrs(request)}; Max-Age=${maxAge}`,
  }
}

export function adminLogoutCookie(request: Request): string {
  return `${ADMIN_COOKIE}=; ${cookieAttrs(request)}; Max-Age=0`
}
