/// <reference types="@cloudflare/workers-types" />
//
// 认证面的轻量限流：固定窗口计数，落在 D1 的 rate_limits 表。
//
// 用途：登录 / 注册 / 管理登录等无鉴权入口的频率控制，抵挡口令爆破与批量注册。
// 只记录计数与过期时间，不保存原始 IP 或任何凭证。

export type RateLimitEnv = { DB: D1Database }

/** 客户端 IP：Cloudflare 会写 cf-connecting-ip；取不到时退化为固定桶（全局计数）。 */
export function clientIp(request: Request): string {
  const ip = request.headers.get('cf-connecting-ip')?.trim()
  if (ip) return ip
  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}

/**
 * 记一次并判断是否超过限额。key 建议形如 `login:ip:1.2.3.4`。
 * windowMs 为固定窗口长度。返回 true 表示已超限（调用方应拒绝）。
 */
export async function rateLimited(
  env: RateLimitEnv,
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const now = Date.now()
  const windowIndex = Math.floor(now / windowMs)
  const bucket = `${key}:${windowIndex}`
  let n = 1
  try {
    const row = await env.DB.prepare(
      `INSERT INTO rate_limits (bucket, expires_at, n) VALUES (?, ?, 1)
         ON CONFLICT(bucket) DO UPDATE SET n = n + 1 RETURNING n`,
    )
      .bind(bucket, now + windowMs * 2)
      .first<{ n: number }>()
    n = row?.n ?? 1
  } catch (err) {
    // 表还没建（升级后未跑 schema.sql）时不能让登录 / 注册直接 500：
    // 记一条错误后放行，建表后限流自动生效。
    console.error('[lushu] rate limit unavailable', err)
    return false
  }

  // 顺手清一点过期桶：2% 概率触发，避免每次请求都多一条删除。
  if (Math.random() < 0.02) {
    try {
      await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now).run()
    } catch {
      /* 清理失败不影响限流判断 */
    }
  }

  return n > limit
}
