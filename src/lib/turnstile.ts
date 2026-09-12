// 可选的人机校验。只有当构建时配置了 VITE_TURNSTILE_SITE_KEY 才启用。
//
// site key 是公开的（本来就会出现在前端 bundle 里），secret 只在 Worker 侧
// 通过 TURNSTILE_SECRET 提供。仓库开源不影响这套机制的安全性。

type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string
      callback: (token: string) => void
      'expired-callback'?: () => void
      'error-callback'?: () => void
      'timeout-callback'?: () => void
      theme?: 'light' | 'dark' | 'auto'
      size?: 'normal' | 'flexible' | 'compact'
      action?: string
    },
  ) => string
  remove: (id: string) => void
}

const SITE_KEY = String(import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '').trim()

export function turnstileConfigured(): boolean {
  return Boolean(SITE_KEY)
}

let loader: Promise<void> | null = null

function loadScript(): Promise<void> {
  if (loader) return loader
  loader = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('turnstile script failed'))
    document.head.appendChild(script)
  })
  return loader
}

type TurnstileMountOpts = {
  onToken: (token: string) => void
  onExpire?: () => void
  onError?: () => void
}

/** 在指定容器内嵌入 Turnstile 小组件；返回卸载函数。未配置 site key 时返回空操作。 */
export async function mountTurnstile(
  container: HTMLElement,
  opts: TurnstileMountOpts,
): Promise<() => void> {
  if (!SITE_KEY) return () => {}
  try {
    await loadScript()
  } catch {
    return () => {}
  }

  const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile
  if (!api) return () => {}

  let widgetId: string | null = null
  try {
    widgetId = api.render(container, {
      sitekey: SITE_KEY,
      theme: 'light',
      size: 'flexible',
      action: 'lushu',
      callback: opts.onToken,
      'expired-callback': () => opts.onExpire?.(),
      'error-callback': () => opts.onError?.(),
    })
  } catch {
    /* ignore */
  }

  return () => {
    try {
      if (widgetId) api.remove(widgetId)
    } catch {
      /* ignore */
    }
  }
}

/**
 * 弹出一个 Turnstile 校验并返回 token。失败 / 未配置返回 null。
 * token 一次性，每次新建路书都要重新取。
 */
export async function requestTurnstileToken(): Promise<string | null> {
  if (!SITE_KEY) return null
  try {
    await loadScript()
  } catch {
    return null
  }

  const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile
  if (!api) return null

  const host = document.createElement('div')
  host.className = 'turnstile-host'
  document.body.appendChild(host)

  return new Promise<string | null>((resolve) => {
    let widgetId: string | null = null
    let settled = false
    const done = (token: string | null) => {
      if (settled) return
      settled = true
      try {
        if (widgetId) api.remove(widgetId)
      } catch {
        /* ignore */
      }
      host.remove()
      resolve(token)
    }
    try {
      widgetId = api.render(host, {
        sitekey: SITE_KEY,
        theme: 'light',
        size: 'flexible',
        action: 'lushu',
        callback: (token) => done(token),
        'error-callback': () => done(null),
        'timeout-callback': () => done(null),
      })
    } catch {
      done(null)
    }
  })
}
