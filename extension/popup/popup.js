import { getConfig, setConfig } from '../lib/storage.js'

const el = (id) => document.getElementById(id)

const LUSHU_ORIGIN = 'https://lushu.fittools.cc'
const BOOK_URL_RE = /^https?:\/\/[^/]+\/d\//

function send(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message })
      else resolve(res ?? { ok: false, error: '无响应' })
    })
  })
}

async function refresh() {
  const cfg = await getConfig()
  el('key').value = cfg.deepseekKey || ''
  el('status').textContent = cfg.deepseekKey ? 'DeepSeek Key 已配置' : '还没配置 DeepSeek Key'
  el('status').className = `status ${cfg.deepseekKey ? 'ok' : 'err'}`

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const onLushu = tab?.url && BOOK_URL_RE.test(tab.url)
  if (!onLushu) {
    el('status').textContent = '当前不在路书详情页（/d/…）'
    el('status').className = 'status'
  }
}

el('saveKey').addEventListener('click', async () => {
  await setConfig({ deepseekKey: el('key').value.trim() })
  await refresh()
})

el('settings').addEventListener('click', () => void send({ type: 'openOptions' }))

el('openPanel').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !tab.url || !BOOK_URL_RE.test(tab.url)) {
    await chrome.tabs.create({ url: `${LUSHU_ORIGIN}/` })
    return
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'lushu.openPanel' })
    window.close()
  } catch {
    // 内容脚本还没注入（刚装的扩展）：刷新页面即可
    await chrome.tabs.reload(tab.id)
    window.close()
  }
})

el('openLushu').addEventListener('click', () => {
  void chrome.tabs.create({ url: `${LUSHU_ORIGIN}/` })
})

void refresh()
