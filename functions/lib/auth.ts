/// <reference types="@cloudflare/workers-types" />
//
// 路书 · 账号与登录
//
// 模型（尽量少动老数据）：
//   · users.id 就是 books.owner_key（32-hex = 16 字节随机串）。
//   · 登录名就是邮箱（users.username 列存归一化后的邮箱）；登录与注册分开，
//     登录不再自动注册。注册/登录时带上本机旧 owner_key，可把此前匿名创建
//     的书过户到账号。
//   · 会话是 httpOnly cookie，库里的 sessions 只存 token 的 SHA-256 摘要，
//     即使 D1 被读走也换不到登录态。
//   · 口令用 PBKDF2-SHA256 迭代 10 万次，明文永不落库。
//
// 免费档开销：读一次会话 = 1 行读（带主键索引）；登录/注册 = 1 行写。

export type AuthUser = {
  id: string
  email: string
  displayName: string
  createdAt: number
}

export type UserRow = {
  id: string
  username: string
  display_name: string
  pass_hash: string | null
  created_at: number
}

/** 账号 / 书架密钥的统一形态：16 字节随机串的十六进制。 */
export const ID_RE = /^[0-9a-f]{32}$/
/** 登录名只支持邮箱。形态校验从宽（真正的可达性靠发信验证，这里不做）。 */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export const MAX_EMAIL = 254
export const MAX_DISPLAY_NAME = 32
export const MIN_PASSWORD = 6
export const MAX_PASSWORD = 128
export const SESSION_COOKIE = 'lushu_session'

const PBKDF2_ITERATIONS = 100_000
const DEFAULT_SESSION_TTL_DAYS = 30
const SALT_HEX_LEN = 32
const HASH_HEX_LEN = 64

const encoder = new TextEncoder()

// ── 随机数 / 十六进制 ───────────────────────────────────────────────────────

export function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return bytesToHex(arr)
}

export function newUserId(): string {
  return randomHex(16)
}

function bytesToHex(arr: Uint8Array): string {
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** 恒定时间比较：口令摘要、会话摘要都用它，避免计时侧信道。 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function safeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
  return diff === 0
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input))
  return bytesToHex(new Uint8Array(digest))
}

// ── 口令 ────────────────────────────────────────────────────────────────────

async function pbkdf2(password: string, saltHex: string, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations, hash: 'SHA-256' },
    key,
    256,
  )
  return new Uint8Array(bits)
}

/** → "pbkdf2$sha256$100000$<saltHex>$<hashHex>" */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomHex(16)
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${salt}$${bytesToHex(hash)}`
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') return false
  const iterations = Number(parts[2])
  const salt = parts[3]
  const expected = parts[4]
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > 1_000_000) return false
  if (salt.length !== SALT_HEX_LEN || expected.length !== HASH_HEX_LEN) return false
  if (!/^[0-9a-f]+$/.test(salt) || !/^[0-9a-f]+$/.test(expected)) return false
  const actual = await pbkdf2(password, salt, iterations)
  return safeEqualBytes(actual, hexToBytes(expected))
}

// ── 入参校验 ────────────────────────────────────────────────────────────────

export function normalizeEmail(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
}

export function validateEmail(email: string): string | null {
  if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) return 'invalid_email'
  return null
}

/** 昵称：可选，缺省时取邮箱 @ 前的一段。 */
export function normalizeDisplayName(raw: unknown, email: string): string {
  const name = String(raw ?? '').trim()
  const fallback = email.split('@')[0] || email
  return (name || fallback).slice(0, MAX_DISPLAY_NAME)
}

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD) return 'weak_password'
  if (password.length > MAX_PASSWORD) return 'weak_password'
  return null
}

// ── users ───────────────────────────────────────────────────────────────────

export function toUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.username,
    displayName: row.display_name,
    createdAt: row.created_at,
  }
}

const USER_COLS = 'id, username, display_name, pass_hash, created_at'

export function findUserById(env: AuthEnv, id: string): Promise<UserRow | null> {
  return env.DB.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`)
    .bind(id)
    .first<UserRow>()
}

export function findUserByEmail(env: AuthEnv, email: string): Promise<UserRow | null> {
  return env.DB.prepare(`SELECT ${USER_COLS} FROM users WHERE username = ?`)
    .bind(email)
    .first<UserRow>()
}

export async function createUser(
  env: AuthEnv,
  input: { id?: string; email: string; displayName: string; password: string },
): Promise<AuthUser> {
  const id = input.id ?? newUserId()
  const now = Date.now()
  const passHash = await hashPassword(input.password)
  await env.DB.prepare(
    'INSERT INTO users (id, username, display_name, pass_hash, created_at) VALUES (?,?,?,?,?)',
  )
    .bind(id, input.email, input.displayName, passHash, now)
    .run()
  return { id, email: input.email, displayName: input.displayName, createdAt: now }
}

/**
 * 把旧的书架密钥整体过户到账号名下。
 * from 是调用方本机持有的密钥，本身就是 128-bit 凭证，所以知道它 ≈ 有权处置。
 */
export async function adoptBooks(env: AuthEnv, from: unknown, to: string): Promise<number> {
  const key = String(from ?? '')
    .trim()
    .toLowerCase()
  if (!ID_RE.test(key) || key === to) return 0
  const res = await env.DB.prepare('UPDATE books SET owner_key = ? WHERE owner_key = ?')
    .bind(to, key)
    .run()
  return res.meta.changes ?? 0
}

// ── 会话 ────────────────────────────────────────────────────────────────────

export type AuthEnv = {
  DB: D1Database
  /** 可选，默认 30 天。 */
  SESSION_TTL_DAYS?: string
}

function ttlDays(env: AuthEnv): number {
  const n = Number(env.SESSION_TTL_DAYS)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SESSION_TTL_DAYS
  return Math.min(n, 365)
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    if (k) out[k] = part.slice(i + 1).trim()
  }
  return out
}

/** 只有 https 才加 Secure，否则本地 http 调试时 cookie 会被浏览器丢掉。 */
function cookieAttrs(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `Path=/; HttpOnly; SameSite=Lax${secure}`
}

export function sessionCookie(request: Request, token: string, expiresAt: number): string {
  const maxAge = Math.max(0, Math.round((expiresAt - Date.now()) / 1000))
  return `${SESSION_COOKIE}=${token}; ${cookieAttrs(request)}; Max-Age=${maxAge}`
}

export function clearedCookie(request: Request): string {
  return `${SESSION_COOKIE}=; ${cookieAttrs(request)}; Max-Age=0`
}

export async function createSession(
  env: AuthEnv,
  userId: string,
): Promise<{ token: string; expiresAt: number }> {
  // 32 字节随机 token；库里只存摘要。
  const token = randomHex(32)
  const tokenHash = await sha256Hex(token)
  const now = Date.now()
  const expiresAt = now + ttlDays(env) * 86_400_000
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)',
  )
    .bind(tokenHash, userId, now, expiresAt)
    .run()
  // 顺手清掉这个用户的过期会话（有索引，代价很小）。
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?')
    .bind(userId, now)
    .run()
  return { token, expiresAt }
}

function sessionToken(request: Request): string {
  const token = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE] ?? ''
  return /^[0-9a-f]{64}$/.test(token) ? token : ''
}

/** 读当前登录用户；没登录 / 会话过期返回 null。 */
export async function readUser(request: Request, env: AuthEnv): Promise<AuthUser | null> {
  const token = sessionToken(request)
  if (!token) return null
  const tokenHash = await sha256Hex(token)
  const row = await env.DB.prepare(
    `SELECT u.id AS id, u.username AS username, u.display_name AS display_name,
            u.pass_hash AS pass_hash, u.created_at AS created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(tokenHash, Date.now())
    .first<UserRow>()
  return row ? toUser(row) : null
}

export async function destroySession(request: Request, env: AuthEnv): Promise<void> {
  const token = sessionToken(request)
  if (!token) return
  const tokenHash = await sha256Hex(token)
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
}
