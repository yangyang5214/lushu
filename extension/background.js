// Service worker：只负责跨站的两件事 —— 抓小红书、调用 DeepSeek。
// 写路书（同源、需要登录 cookie）交给内容脚本，避免跨站 cookie 问题。
//
// 消息协议（内容脚本 / 设置页 → 这里）：
//   { type: 'ping' }
//   { type: 'ai.test' }
//   { type: 'ai.extract', keyword, text }      → { ok, data:{title,summary,places} }
//   { type: 'xhs.ask', keyword }                 → { ok, text, count }
//   { type: 'config.get' } / { type: 'config.set', patch }
//   { type: 'openOptions' }
//
// 抓小红书时会向来源标签页推送 { type: 'lushu.progress', line } 作为进度。

import { chat } from './lib/deepseek.js'
import { buildExtractMessages, parseExtract } from './lib/extract.js'
import { getConfig, setConfig } from './lib/storage.js'
import { askDianDian } from './lib/xhs.js'

async function handle(msg, sender) {
  switch (msg?.type) {
    case 'ping':
      return { ok: true, version: chrome.runtime.getManifest().version }

    case 'ai.test': {
      const text = await chat([{ role: 'user', content: '只回复两个字母：ok' }], {
        temperature: 0,
      })
      return { ok: true, text: text.trim() }
    }

    case 'ai.extract': {
      const cfg = await getConfig()
      const content = await chat(buildExtractMessages(msg.keyword, msg.text), { json: true })
      const data = parseExtract(content, msg.keyword, Number(cfg.maxPlaces) || 30)
      return { ok: true, data }
    }

    case 'xhs.ask': {
      const tabId = sender?.tab?.id
      const progress = (line) => {
        if (typeof tabId !== 'number') return
        chrome.tabs.sendMessage(tabId, { type: 'lushu.progress', line }).catch(() => {})
      }
      const res = await askDianDian(msg.keyword, progress)
      return { ok: true, ...res }
    }

    case 'config.get':
      return { ok: true, config: await getConfig() }

    case 'config.set':
      await setConfig(msg.patch ?? {})
      return { ok: true }

    case 'openOptions':
      await chrome.runtime.openOptionsPage()
      return { ok: true }

    default:
      return { ok: false, error: `未知消息：${msg?.type}` }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender)
    .then((res) => sendResponse(res))
    .catch((err) =>
      sendResponse({ ok: false, error: String((err && err.message) || err) }),
    )
  // 异步返回，保持消息通道打开
  return true
})
