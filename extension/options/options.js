import { DEFAULTS, getConfig, setConfig } from '../lib/storage.js'

const FIELD_IDS = [
  'deepseekKey',
  'deepseekBase',
  'deepseekModel',
  'sourceMode',
  'xhsHomeUrl',
  'xhsTimeoutMs',
  'dianWaitMs',
  'inputSelectors',
  'dianEntrySelectors',
  'sendSelectors',
  'answerSelectors',
  'visibility',
  'maxPlaces',
]

const CHECK_IDS = ['xhsOpenActive', 'xhsKeepTab']

const el = (id) => document.getElementById(id)

function setResult(node, text, ok) {
  node.textContent = text
  node.className = `result ${ok === true ? 'ok' : ok === false ? 'err' : ''}`
}

function fill(config) {
  for (const id of FIELD_IDS) {
    const node = el(id)
    if (!node) continue
    node.value = config[id] ?? DEFAULTS[id] ?? ''
  }
  for (const id of CHECK_IDS) {
    const node = el(id)
    if (node) node.checked = Boolean(config[id])
  }
}

function collect() {
  const patch = {}
  for (const id of FIELD_IDS) {
    const node = el(id)
    if (!node) continue
    const def = DEFAULTS[id]
    patch[id] = typeof def === 'number' ? Number(node.value) : node.value.trim()
  }
  for (const id of CHECK_IDS) {
    const node = el(id)
    if (node) patch[id] = Boolean(node.checked)
  }
  return patch
}

async function save() {
  await setConfig(collect())
  setResult(el('saveResult'), '已保存', true)
  setTimeout(() => setResult(el('saveResult'), '', null), 2000)
}

async function testAi() {
  const node = el('aiResult')
  setResult(node, '测试中…', null)
  // 先落盘，确保 background 读到的是当前输入
  await setConfig(collect())
  const res = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'ai.test' }, (r) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message })
      else resolve(r ?? { ok: false, error: '无响应' })
    })
  })
  if (res.ok) setResult(node, `连接正常（返回：${res.text || 'ok'}）`, true)
  else setResult(node, `失败：${res.error}`, false)
}

async function reset() {
  await setConfig(DEFAULTS)
  fill(DEFAULTS)
  setResult(el('saveResult'), '已恢复默认', true)
}

el('save').addEventListener('click', () => void save())
el('reset').addEventListener('click', () => void reset())
el('testAi').addEventListener('click', () => void testAi())

void getConfig().then(fill)
