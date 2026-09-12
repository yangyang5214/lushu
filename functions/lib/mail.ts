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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 邮件正文：按钮式激活链接（客户端不支持按钮时仍有文字链接兜底）。 */
function activationEmailHtml(activateUrl: string): string {
  const href = escapeHtml(activateUrl)
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f3f5;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;color:#1f2329;">
    <div style="background:#ffffff;border-radius:12px;padding:32px 28px;">
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.4;">激活你的路书账号</h1>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:#646a73;">
        欢迎注册路书！点击下面的按钮完成邮箱验证，即可开始使用。
      </p>
      <a href="${href}" style="display:inline-block;padding:12px 28px;background:#1f6feb;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">激活账号</a>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#8f959e;">
        按钮无法点击？请复制以下链接到浏览器打开：<br>
        <a href="${href}" style="color:#1f6feb;word-break:break-all;">${href}</a>
      </p>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#8f959e;">
        链接 24 小时内有效，请勿泄露给他人。如非本人操作，请忽略此邮件。
      </p>
    </div>
  </div>
</body>
</html>`
}

/**
 * 「这个邮箱已经注册过」的提醒。注册接口对外一律回 pending，不给调用方
 * 提供邮箱是否已注册的信息；真正该知道的只有邮箱主人，所以用邮件告知。
 */
export async function sendAccountExistsEmail(env: MailEnv, to: string): Promise<SendResult> {
  const key = env.RESEND_API_KEY?.trim()
  if (!key) {
    console.log(`[lushu] account exists notice for ${to}`)
    return 'unconfigured'
  }

  const from = env.EMAIL_FROM?.trim() || DEFAULT_FROM
  const subject = '你的路书账号已存在'
  const text =
    `这个邮箱已经注册过路书账号了。\n\n` +
    `如果刚才是你本人操作：直接到登录页用原密码登录即可，不需要重新注册。\n` +
    `非本人操作可忽略本邮件。\n`
  const html = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f2f3f5;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;color:#1f2329;">
    <div style="background:#ffffff;border-radius:12px;padding:32px 28px;">
      <h1 style="margin:0 0 12px;font-size:20px;line-height:1.4;">你的路书账号已存在</h1>
      <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#646a73;">
        这个邮箱已经注册过路书账号，无需重复注册，直接到登录页用原密码登录即可。
      </p>
      <p style="margin:0;font-size:13px;line-height:1.7;color:#8f959e;">
        如非本人操作，请忽略本邮件。
      </p>
    </div>
  </div>
</body>
</html>`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) {
      console.error('[lushu] resend notice failed', res.status, await res.text())
      return 'failed'
    }
    return 'sent'
  } catch (err) {
    console.error('[lushu] resend notice error', err)
    return 'failed'
  }
}

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
  const html = activationEmailHtml(activateUrl)

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
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
