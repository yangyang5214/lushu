/// <reference types="@cloudflare/workers-types" />
//
// 发信：Resend HTTP API（Cloudflare Worker 友好，无需 SMTP）。

export type MailEnv = {
  RESEND_API_KEY?: string
  /** 例如 "路书 <noreply@yourdomain.com>" */
  EMAIL_FROM?: string
}

const DEFAULT_FROM = '路书 <onboarding@resend.dev>'

export type SendResult = 'sent' | 'unconfigured' | 'failed'

export async function sendActivationEmail(
  env: MailEnv,
  to: string,
  activateUrl: string,
): Promise<SendResult> {
  const key = env.RESEND_API_KEY?.trim()
  if (!key) {
    // 本地调试：没配密钥时在 Worker 日志里打出激活链接，方便 pages:dev 联调。
    console.log(`[lushu] activation link for ${to}: ${activateUrl}`)
    return 'unconfigured'
  }

  const from = env.EMAIL_FROM?.trim() || DEFAULT_FROM
  const subject = '激活你的路书账号'
  const text =
    `欢迎注册路书！请点击以下链接激活账号：\n\n` +
    `${activateUrl}\n\n` +
    `链接 24 小时内有效，请勿泄露给他人。\n` +
    `如非本人操作，请忽略此邮件。`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) {
      console.error('[lushu] resend failed', res.status, await res.text())
      return 'failed'
    }
    return 'sent'
  } catch (err) {
    console.error('[lushu] resend error', err)
    return 'failed'
  }
}
