/// <reference types="@cloudflare/workers-types" />
//
// 注册邮箱激活：生成链接 token、限流、一次性校验。

import { sha256Hex } from './auth'

export type EmailActivationEnv = {
  DB: D1Database
}

export const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1000
export const SEND_COOLDOWN_MS = 60 * 1000
export const MAX_SENDS_PER_HOUR = 5

type ActivationRow = {
  email: string
  token_hash: string
  created_at: number
  expires_at: number
}

export type SendGate = 'ok' | 'cooldown' | 'rate_limit'
export type ActivateFail = 'missing' | 'expired'
export type ActivateVerifyResult = { result: 'ok'; email: string } | { result: ActivateFail }

/** 64 位 hex（32 字节随机），用于激活链接。 */
export function generateActivationToken(): string {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function normalizeActivationToken(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
}

export function validateActivationTokenFormat(token: string): boolean {
  return /^[0-9a-f]{64}$/.test(token)
}

async function tokenHash(token: string): Promise<string> {
  return sha256Hex(token)
}

/** 是否允许向该邮箱发激活信（冷却 + 每小时上限）。 */
export async function canSendActivation(
  env: EmailActivationEnv,
  email: string,
): Promise<SendGate> {
  const row = await env.DB.prepare(
    'SELECT created_at FROM email_activations WHERE email = ? ORDER BY created_at DESC LIMIT 1',
  )
    .bind(email)
    .first<{ created_at: number }>()

  const now = Date.now()
  if (row && now - row.created_at < SEND_COOLDOWN_MS) return 'cooldown'

  const since = now - 3_600_000
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM email_send_log WHERE email = ? AND sent_at > ?',
  )
    .bind(email, since)
    .first<{ n: number }>()
  if ((recent?.n ?? 0) >= MAX_SENDS_PER_HOUR) return 'rate_limit'

  return 'ok'
}

/** 写入新激活 token（覆盖同邮箱旧 token），并记一条发信日志。 */
export async function storeActivationToken(
  env: EmailActivationEnv,
  email: string,
  token: string,
): Promise<void> {
  const now = Date.now()
  const hash = await tokenHash(token)
  await env.DB.batch([
    env.DB.prepare('DELETE FROM email_activations WHERE email = ?').bind(email),
    env.DB.prepare(
      `INSERT INTO email_activations (email, token_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?)`,
    ).bind(email, hash, now, now + ACTIVATION_TTL_MS),
    env.DB.prepare('INSERT INTO email_send_log (email, sent_at) VALUES (?, ?)').bind(email, now),
  ])
}

/** 校验并消费激活 token；成功则删行并返回邮箱。 */
export async function verifyAndConsumeActivation(
  env: EmailActivationEnv,
  token: string,
): Promise<ActivateVerifyResult> {
  const hash = await tokenHash(token)
  const row = await env.DB.prepare(
    'SELECT email, token_hash, created_at, expires_at FROM email_activations WHERE token_hash = ?',
  )
    .bind(hash)
    .first<ActivationRow>()

  if (!row) return { result: 'missing' }

  const now = Date.now()
  if (row.expires_at <= now) {
    await env.DB.prepare('DELETE FROM email_activations WHERE token_hash = ?').bind(hash).run()
    return { result: 'expired' }
  }

  await env.DB.prepare('DELETE FROM email_activations WHERE token_hash = ?').bind(hash).run()
  return { result: 'ok', email: row.email }
}
