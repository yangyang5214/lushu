// DeepSeek 调用：所有需要 AI 处理的步骤都走这里。
// Key 由用户自己在设置页填，只存在本机 chrome.storage.local，不会随路书上传。

import { getConfig } from './storage.js'

const TIMEOUT_MS = 120000

function normalizeBase(base) {
  const trimmed = String(base ?? '').trim().replace(/\/+$/, '')
  return trimmed || 'https://api.deepseek.com'
}

/**
 * 发一轮对话，返回助手回复的纯文本。
 * @param {{role:string, content:string}[]} messages
 * @param {{json?:boolean, temperature?:number}} [opts]
 */
export async function chat(messages, opts = {}) {
  const cfg = await getConfig()
  const key = String(cfg.deepseekKey ?? '').trim()
  if (!key) throw new Error('未配置 DeepSeek API Key：点扩展图标 → 设置')

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let res
  try {
    res = await fetch(`${normalizeBase(cfg.deepseekBase)}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: String(cfg.deepseekModel ?? '').trim() || 'deepseek-chat',
        messages,
        temperature: opts.temperature ?? 0.2,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: ctrl.signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('DeepSeek 请求超时')
    throw new Error(`DeepSeek 网络错误：${err?.message ?? err}`)
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    if (res.status === 401) throw new Error('DeepSeek Key 无效（401），请检查设置')
    if (res.status === 402) throw new Error('DeepSeek 余额不足（402）')
    if (res.status === 429) throw new Error('DeepSeek 触发限流（429），稍后再试')
    throw new Error(`DeepSeek 失败 ${res.status}：${detail.slice(0, 300)}`)
  }

  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('DeepSeek 返回格式异常')
  return content
}

/** 设置页的连通性测试。 */
export async function ping() {
  const text = await chat([{ role: 'user', content: '只回复两个字母：ok' }], { temperature: 0 })
  return text.trim()
}
