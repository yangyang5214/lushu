// 小红书：打开首页 → 搜索框输入关键词 → 点「问点点」→ 读回答。
//
// 小红书网页接口带签名，第三方直接调不了，所以在真实页面里操作 DOM。
// 分两阶段，因为点「问点点」会让页面跳转（跳转后注入的脚本上下文会消失）：
//   阶段 A（首页 / 搜索结果页）：写入关键词，找到并真正点击「问点点」。
//   阶段 B（点点页/会话页）：轮询读取回答，稳定后返回。
//
// 注意：注入到页面的函数会被 chrome.scripting 序列化后单独执行，
// 所以它们不能引用本文件里任何外部变量，只能靠参数。
// 必须注入 MAIN world：首页搜索框是受控组件，isolated world 赋值会被立刻清掉。

import { getConfig, splitList } from './storage.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function waitForTab(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('小红书页面加载超时'))
    }, timeoutMs)
    function onUpdated(id, info) {
      if (id === tabId && info.status === 'complete') {
        cleanup()
        resolve()
      }
    }
    function cleanup() {
      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(onUpdated)
    }
    chrome.tabs.onUpdated.addListener(onUpdated)
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab?.status === 'complete') {
          cleanup()
          resolve()
        }
      })
      .catch(() => {})
  })
}

async function closeTab(tabId) {
  try {
    await chrome.tabs.remove(tabId)
  } catch {
    /* 标签页可能已经被用户关掉 */
  }
}

function originOf(homeUrl) {
  try {
    return new URL(homeUrl || 'https://www.xiaohongshu.com/explore').origin
  } catch {
    return 'https://www.xiaohongshu.com'
  }
}

function searchResultUrl(homeUrl, keyword) {
  return `${originOf(homeUrl)}/search_result?keyword=${encodeURIComponent(keyword)}&source=web_explore_feed`
}

function chatUrl(homeUrl) {
  return `${originOf(homeUrl)}/ai_chat`
}

function hrefLooksUseful(href, keyword) {
  if (!href) return false
  try {
    const u = new URL(href)
    const blob = decodeURIComponent(u.href)
    if (keyword && blob.includes(keyword)) return true
    if (/search_result/.test(u.pathname) && u.search.includes('keyword=')) return true
    if (/ai_chat|dian/.test(u.pathname) && /[?&](q|query|keyword|text)=/.test(u.search)) return true
  } catch {
    /* ignore */
  }
  return false
}

/* ------------------------------------------------------------------ *
 * 注入脚本（必须自包含，跑在 MAIN world）
 * ------------------------------------------------------------------ */

// 阶段 A：写入关键词，找到并真正点击「问点点」。
// mode:
//   type-and-click  首页：必须先把关键词写进搜索框，再点下拉里新出现的「问点点」
//   click-only      搜索结果页：关键词已在 URL 里，点开下拉再点「问点点」
// eslint-disable-next-line no-unused-vars
function injectedHomeAsk(payload) {
  const { keyword, cfg, mode } = payload
  const clickOnly = mode === 'click-only'
  const state = {
    done: false,
    error: null,
    step: '启动中…',
    href: '',
    clicked: false,
    typed: false,
    typedValue: '',
    needSearchUrl: false,
  }
  window.__LUSHU_XHS__ = state

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const textOf = (el) => (el ? String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : '')
  const currentValue = (el) => {
    if (!el) return ''
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return String(el.value || '')
    return textOf(el)
  }
  const valueMatches = (el, text) => currentValue(el).includes(text)

  const visible = (el) => {
    if (!el) return false
    if (el.getAttribute('aria-hidden') === 'true') return false
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
    const rect = el.getBoundingClientRect()
    if (rect.width < 8 || rect.height < 8) return false
    if (rect.bottom < 0 || rect.top > innerHeight + 40) return false
    return true
  }

  const allVisible = (list) => {
    const out = []
    for (const sel of list) {
      try {
        for (const el of document.querySelectorAll(sel)) {
          if (visible(el)) out.push(el)
        }
      } catch {
        /* 选择器写错就跳过 */
      }
    }
    return out
  }

  const pickSearchInput = () => {
    const candidates = allVisible(cfg.inputSelectors)
    let best = null
    let bestScore = Infinity
    for (const el of candidates) {
      const rect = el.getBoundingClientRect()
      const ph = String(el.getAttribute('placeholder') || '')
      let score = rect.top
      if (/搜索/.test(ph)) score -= 120
      if (rect.top > 180) score += 80
      if (rect.width < 120) score += 60
      if (el.disabled || el.readOnly) score += 200
      if (score < bestScore) {
        bestScore = score
        best = el
      }
    }
    return best
  }

  const realClick = (el) => {
    if (!el) return
    el.scrollIntoView({ block: 'center', inline: 'nearest' })
    const rect = el.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const common = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      button: 0,
      buttons: 1,
    }
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerId: 1, pointerType: 'mouse' }))
    } catch {
      /* ignore */
    }
    el.dispatchEvent(new MouseEvent('mousedown', common))
    try {
      el.dispatchEvent(new PointerEvent('pointerup', { ...common, pointerId: 1, pointerType: 'mouse' }))
    } catch {
      /* ignore */
    }
    el.dispatchEvent(new MouseEvent('mouseup', common))
    el.dispatchEvent(new MouseEvent('click', common))
    try {
      el.click()
    } catch {
      /* ignore */
    }
  }

  const setReactValue = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    const last = el.value
    const tracker = el._valueTracker
    if (setter) setter.call(el, value)
    else el.value = value
    if (tracker) tracker.setValue(last)
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
  }

  async function typeInto(input, text) {
    input.scrollIntoView({ block: 'center', inline: 'nearest' })
    realClick(input)
    input.focus()
    await sleep(120)

    try {
      input.select?.()
    } catch {
      /* ignore */
    }
    try {
      document.execCommand('selectAll', false, null)
    } catch {
      /* ignore */
    }

    let inserted = false
    try {
      inserted = document.execCommand('insertText', false, text)
    } catch {
      inserted = false
    }
    if (inserted && valueMatches(input, text)) return true

    if (input.isContentEditable || (input.tagName !== 'INPUT' && input.tagName !== 'TEXTAREA')) {
      input.textContent = text
      input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: text, inputType: 'insertText' }))
      if (valueMatches(input, text)) return true
    }

    if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
      setReactValue(input, '')
      await sleep(40)
      let acc = ''
      for (const ch of text) {
        acc += ch
        setReactValue(input, acc)
        input.dispatchEvent(
          new InputEvent('beforeinput', { bubbles: true, composed: true, data: ch, inputType: 'insertText' }),
        )
        input.dispatchEvent(
          new InputEvent('input', { bubbles: true, composed: true, data: ch, inputType: 'insertText' }),
        )
        await sleep(18)
      }
    }

    await sleep(80)
    return valueMatches(input, text)
  }

  /** 只认「问点点」，忽略导航栏常驻的「点点」。exclude 用来丢掉输入前就在的节点。 */
  function findEntry(exclude) {
    for (const sel of cfg.dianEntrySelectors) {
      let el = null
      try {
        el = document.querySelector(sel)
      } catch {
        continue
      }
      if (el && visible(el) && !exclude.has(el)) return el
    }
    const nodes = document.querySelectorAll('a,button,[role="button"],div,span,li,p')
    let best = null
    let bestScore = Infinity
    for (const el of nodes) {
      if (exclude.has(el)) continue
      const text = textOf(el)
      if (!text || text.length > 40) continue
      if (!text.includes('问点点')) continue
      if (!visible(el)) continue
      const rect = el.getBoundingClientRect()
      let score = text.length
      if (el.tagName === 'A' || el.tagName === 'BUTTON') score -= 40
      if (el.getAttribute('role') === 'button') score -= 25
      score += Math.max(0, rect.top) / 20
      if (rect.top > 480) score += 80
      if (score < bestScore) {
        bestScore = score
        best = el
      }
    }
    return best
  }

  function snapshotDianNodes() {
    const set = new Set()
    for (const el of document.querySelectorAll('a,button,[role="button"],div,span,li,p')) {
      const text = textOf(el)
      if (text && /点点/.test(text) && text.length <= 40 && visible(el)) set.add(el)
    }
    return set
  }

  async function waitEntry(exclude, ms) {
    const deadline = Date.now() + ms
    let entry = null
    while (Date.now() < deadline && !entry) {
      entry = findEntry(exclude)
      if (!entry) await sleep(350)
    }
    return entry
  }

  async function task() {
    state.step = clickOnly ? '打开搜索结果，找「问点点」…' : '打开首页，等待搜索框…'
    let input = null
    for (let i = 0; i < 60 && !input; i += 1) {
      input = pickSearchInput()
      if (!input) await sleep(400)
    }
    if (!input) throw new Error('没找到首页搜索框（可在设置里改「搜索框」选择器）')

    const before = snapshotDianNodes()

    if (clickOnly) {
      if (!valueMatches(input, keyword)) {
        state.step = '搜索框补写关键词…'
        const ok = await typeInto(input, keyword)
        state.typed = ok
        state.typedValue = currentValue(input)
        if (!ok) throw new Error('搜索框没有写入关键词')
      } else {
        state.typed = true
        state.typedValue = currentValue(input)
        realClick(input)
        input.focus()
        await sleep(200)
      }
    } else {
      state.step = '输入关键词…'
      const ok = await typeInto(input, keyword)
      state.typed = ok
      state.typedValue = currentValue(input)
      if (!ok) {
        state.needSearchUrl = true
        state.step = '搜索框没有写入关键词'
        return
      }
    }

    state.step = '等待「问点点」入口…'
    let entry = await waitEntry(before, cfg.dianWaitMs)

    if (!entry) {
      state.step = '按回车后再找「问点点」…'
      input.focus()
      for (const type of ['keydown', 'keypress', 'keyup']) {
        input.dispatchEvent(
          new KeyboardEvent(type, {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            composed: true,
          }),
        )
      }
      entry = await waitEntry(before, Math.max(6000, cfg.dianWaitMs))
    }

    if (!entry) {
      if (clickOnly) throw new Error('没找到「问点点」入口（可在设置里改「问点点入口」选择器）')
      state.needSearchUrl = true
      state.step = '下拉里没有「问点点」'
      return
    }

    const clickable = entry.closest('a,button,[role="button"]') || entry
    const rawHref = clickable.tagName === 'A' ? String(clickable.getAttribute('href') || '') : ''
    if (rawHref && rawHref !== '#' && !rawHref.startsWith('javascript:')) {
      try {
        state.href = new URL(rawHref, location.href).href
      } catch {
        state.href = rawHref
      }
    }

    // 必须真点：只改 location 会丢掉搜索框里刚写上的关键词。
    state.step = '点击「问点点」…'
    state.done = true
    realClick(clickable)
    state.clicked = true
    await sleep(400)
  }

  task()
    .then(() => {
      state.done = true
    })
    .catch((err) => {
      state.error = String((err && err.message) || err)
      state.done = true
    })
  return true
}

// 阶段 B：读取点点回答；长时间没回答且有输入框时，补发一次问题。
// eslint-disable-next-line no-unused-vars
function injectedReadAnswer(payload) {
  const { keyword, cfg } = payload
  const state = { done: false, error: null, step: '等待点点回答…', text: '', count: 0 }
  window.__LUSHU_XHS__ = state

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const visible = (el) => {
    if (!el) return false
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    const rect = el.getBoundingClientRect()
    return rect.width > 8 && rect.height > 8
  }
  const textOf = (el) => (el ? String(el.innerText || el.textContent || '').trim() : '')
  const pick = (list) => {
    for (const sel of list) {
      let el = null
      try {
        el = document.querySelector(sel)
      } catch {
        continue
      }
      if (visible(el)) return el
    }
    return null
  }
  const queryAll = (list) => {
    const out = []
    for (const sel of list) {
      try {
        out.push(...document.querySelectorAll(sel))
      } catch {
        /* 选择器写错就跳过 */
      }
    }
    return out
  }
  const typeInto = (input, text) => {
    input.focus()
    try {
      input.select?.()
      document.execCommand('selectAll', false, null)
      if (document.execCommand('insertText', false, text)) return
    } catch {
      /* ignore */
    }
    if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
      const proto =
        input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      const last = input.value
      const tracker = input._valueTracker
      if (setter) setter.call(input, text)
      else input.value = text
      if (tracker) tracker.setValue(last)
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    } else {
      input.textContent = text
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }))
    }
  }
  function readNow() {
    const extra = ['article', '[class*="markdown"]', '[class*="rich-text"]', '[class*="chat"]']
    const seen = new Set()
    const nodes = []
    for (const el of [...queryAll(cfg.answerSelectors), ...queryAll(extra)]) {
      if (!el || !visible(el) || seen.has(el)) continue
      seen.add(el)
      nodes.push(el)
    }
    nodes.sort((a, b) => {
      const pos = a.compareDocumentPosition(b)
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1
      return 0
    })
    const roots = nodes.filter((el) => !nodes.some((other) => other !== el && other.contains(el)))
    const joined = roots
      .map((el) => textOf(el))
      .filter(Boolean)
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    const mainText = textOf(document.querySelector('main'))
    return mainText.length > joined.length ? mainText : joined
  }

  async function task() {
    const startedAt = Date.now()
    const minReady = 200
    let submitted = false
    let last = ''
    let stable = 0
    const deadline = Date.now() + cfg.xhsTimeoutMs

    while (Date.now() < deadline) {
      await sleep(1200)
      const text = readNow()
      if (text && text === last) {
        stable += 1
        // 点点是流式输出：短提示（「ai总结xx篇笔记」）会先稳定，必须等正文够长再停。
        if (stable >= 4 && text.length >= minReady) break
      } else {
        stable = 0
        last = text
      }
      state.text = text
      state.count = text.length
      if (text.length >= minReady) state.step = `点点正在生成…（${text.length} 字）`

      // 点点页可能没带上问题：等一会儿还是空的，就自己把问题打进去。
      if ((!text || text.length < 40) && !submitted && Date.now() - startedAt > 9000) {
        const input = pick(cfg.inputSelectors) || pick(['textarea', '[contenteditable="true"]', 'input[type="text"]'])
        if (input) {
          submitted = true
          state.step = '在点点会话里补发问题…'
          typeInto(input, keyword)
          await sleep(500)
          const button = pick(cfg.sendSelectors)
          if (button) button.click()
          else
            input.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true,
                composed: true,
              }),
            )
          state.step = '等待点点回答…'
        }
      }
    }

    state.text = last || state.text
    state.count = state.text.length
    if (!state.text || state.text.length < 80) {
      throw new Error('点点没有返回完整攻略（可能还在生成，或需要先登录小红书）')
    }
  }

  task()
    .then(() => {
      state.step = '完成'
      state.done = true
    })
    .catch((err) => {
      state.error = String((err && err.message) || err)
      state.done = true
    })
  return true
}

// 读取注入脚本写下的进度 / 结果。
// eslint-disable-next-line no-unused-vars
function injectedRead() {
  const s = window.__LUSHU_XHS__
  if (!s) return null
  return {
    done: s.done,
    error: s.error,
    text: s.text,
    count: s.count,
    step: s.step,
    href: s.href,
    clicked: s.clicked,
    typed: s.typed,
    typedValue: s.typedValue,
    needSearchUrl: s.needSearchUrl,
  }
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

function pickCfg(cfg) {
  return {
    xhsTimeoutMs: Number(cfg.xhsTimeoutMs) || 90000,
    dianWaitMs: Number(cfg.dianWaitMs) || 8000,
    inputSelectors: splitList(cfg.inputSelectors),
    dianEntrySelectors: splitList(cfg.dianEntrySelectors),
    sendSelectors: splitList(cfg.sendSelectors),
    answerSelectors: splitList(cfg.answerSelectors),
  }
}

const MAIN = { world: 'MAIN' }

/** 注入启动脚本，然后轮询进度直到 done / 超时。 */
async function runInjected(tabId, startFunc, args, { onProgress, timeout, label }) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: MAIN.world,
    func: startFunc,
    args: [args],
  })
  const started = Date.now()
  let lastStep = ''
  let last = null
  while (Date.now() - started < timeout) {
    await sleep(400)
    let frame
    try {
      ;[frame] = await chrome.scripting.executeScript({
        target: { tabId },
        world: MAIN.world,
        func: injectedRead,
      })
    } catch {
      break
    }
    const state = frame?.result
    if (!state) continue
    last = state
    if (state.step && state.step !== lastStep) {
      lastStep = state.step
      try {
        onProgress?.(`${label}：${state.step}`)
      } catch {
        /* ignore */
      }
    }
    if (state.done) return state
  }
  return last
}

async function afterClickNavigate(tabId, createdIds, href, keyword) {
  await sleep(1600)
  let targetTabId = tabId
  const newTabId = createdIds.find((id) => id !== tabId)
  if (newTabId) return newTabId

  let urlAfter = ''
  try {
    urlAfter = (await chrome.tabs.get(tabId)).url || ''
  } catch {
    urlAfter = ''
  }
  const stillHome = /\/explore\/?$/.test(new URL(urlAfter || 'https://www.xiaohongshu.com/explore').pathname)
  if (stillHome && hrefLooksUseful(href, keyword)) {
    await chrome.tabs.update(tabId, { url: href })
  }
  return targetTabId
}

/**
 * 唯一的小红书入口：首页输入 → 问点点 → 读回答。
 * @param {string} keyword
 * @param {(line:string)=>void} [onProgress]
 * @returns {Promise<{text:string, count:number}>}
 */
export async function askDianDian(keyword, onProgress) {
  const cfg = await getConfig()
  const report = (line) => {
    try {
      onProgress?.(line)
    } catch {
      /* 进度回调出错不影响抓取 */
    }
  }
  const inner = pickCfg(cfg)
  const opened = []
  const createdIds = []
  const onCreated = (tab) => {
    if (tab?.id && /xiaohongshu\.com/.test(tab.url || tab.pendingUrl || '')) {
      createdIds.push(tab.id)
    }
  }

  let homeTabId = null
  try {
    report('打开小红书首页…')
    const tab = await chrome.tabs.create({
      url: cfg.xhsHomeUrl,
      active: cfg.xhsOpenActive !== false,
    })
    homeTabId = tab.id
    opened.push(tab.id)
    await waitForTab(tab.id, 40000)
    await sleep(2000)

    chrome.tabs.onCreated.addListener(onCreated)
    let phaseA = await runInjected(
      tab.id,
      injectedHomeAsk,
      { keyword, cfg: inner, mode: 'type-and-click' },
      {
        onProgress: report,
        timeout: inner.dianWaitMs * 2 + 30000,
        label: '小红书',
      },
    )
    if (phaseA?.error) throw new Error(phaseA.error)

    if (!phaseA?.clicked && phaseA?.needSearchUrl) {
      report('搜索框写不进去，改为打开搜索结果再点「问点点」…')
      await chrome.tabs.update(tab.id, { url: searchResultUrl(cfg.xhsHomeUrl, keyword) })
      await waitForTab(tab.id, 40000).catch(() => {})
      await sleep(2200)
      phaseA = await runInjected(
        tab.id,
        injectedHomeAsk,
        { keyword, cfg: inner, mode: 'click-only' },
        {
          onProgress: report,
          timeout: inner.dianWaitMs * 2 + 20000,
          label: '小红书',
        },
      )
    }
    chrome.tabs.onCreated.removeListener(onCreated)

    if (!phaseA) throw new Error('小红书首页操作超时')
    if (phaseA.error && /搜索框/.test(phaseA.error)) throw new Error(phaseA.error)

    let targetTabId = tab.id
    if (phaseA.clicked || hrefLooksUseful(phaseA.href, keyword)) {
      if (phaseA.clicked) report('已点击「问点点」')
      targetTabId = await afterClickNavigate(tab.id, createdIds, phaseA.href, keyword)
      if (targetTabId !== tab.id) opened.push(targetTabId)
    } else {
      if (phaseA.error) report(phaseA.error)
      report('没点到「问点点」，改为打开点点对话页并直接提问…')
      await chrome.tabs.update(tab.id, { url: chatUrl(cfg.xhsHomeUrl) })
    }

    await waitForTab(targetTabId, 40000).catch(() => {})
    await sleep(2500)

    report('读取点点回答…')
    const phaseB = await runInjected(
      targetTabId,
      injectedReadAnswer,
      { keyword, cfg: inner },
      { onProgress: report, timeout: inner.xhsTimeoutMs + 15000, label: '小红书' },
    )
    if (!phaseB) throw new Error('读取点点回答超时')
    if (phaseB.error) throw new Error(phaseB.error)
    if (!phaseB.text || phaseB.text.trim().length < 80) {
      throw new Error('点点没有返回完整攻略（可能还在生成，或需要先登录小红书）')
    }
    return { text: phaseB.text, count: phaseB.count }
  } finally {
    if (!cfg.xhsKeepTab) {
      for (const id of new Set(opened)) await closeTab(id)
    } else if (homeTabId) {
      report('已保留小红书标签页（调试）')
    }
  }
}
