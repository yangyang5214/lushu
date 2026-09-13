// 路书助手 · 注入到 https://lushu.fittools.cc/d/* 的悬浮面板。
//
// 它只做「同源」的事：查登录态、调 /api/places 定位、PUT /api/books/:id 写入。
// 跨站的抓小红书 / 调 DeepSeek 一律通过 chrome.runtime.sendMessage 交给 background。

;(() => {
  const ROOT_ID = 'lushu-xhs-assistant'
  if (document.getElementById(ROOT_ID)) return

  const META_KEY = 'lushu-meta-v1'
  const OWNER_KEY = 'lushu-owner-v1'
  const LOG_LIMIT = 200

  const state = {
    resolved: [],
    title: '',
    keyword: '',
    sourceMode: 'xhs',
    loop: false,
    days: 0,
    busy: false,
  }

  /* ── 小工具 ─────────────────────────────────────────────────────────── */

  function randomHex(bytes) {
    const arr = new Uint8Array(bytes)
    crypto.getRandomValues(arr)
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
  }

  function hashId() {
    return randomHex(12)
  }

  function readAllMeta() {
    try {
      return JSON.parse(localStorage.getItem(META_KEY) || '{}')
    } catch {
      return {}
    }
  }

  function getMetaToken(id) {
    return readAllMeta()[id]?.token || ''
  }

  function setBookMeta(id, patch) {
    try {
      const all = readAllMeta()
      all[id] = { ...all[id], ...patch }
      localStorage.setItem(META_KEY, JSON.stringify(all))
    } catch {
      /* 隐私模式：忽略，页面还能读，只是本机记不住编辑口令 */
    }
  }

  function ownerKey() {
    try {
      return localStorage.getItem(OWNER_KEY) || ''
    } catch {
      return ''
    }
  }

  /** 给 background 发消息，永远拿到 {ok, ...}，不抛异常。 */
  function send(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message })
          return
        }
        resolve(res ?? { ok: false, error: '扩展后台没有响应（重新加载扩展试试）' })
      })
    })
  }

  async function getJson(path) {
    try {
      const res = await fetch(path, { headers: { accept: 'application/json' } })
      if (!res.ok) return null
      return await res.json()
    } catch {
      return null
    }
  }

  function matchBookIdInPath() {
    const m = location.pathname.match(/\/([0-9a-f]{24})\/?$/)
    return m ? m[1] : ''
  }

  function unique(list) {
    return [...new Set(list.filter(Boolean))]
  }

  /* ── 地图定位 ───────────────────────────────────────────────────────── */

  async function searchMap(query) {
    const q = String(query || '').trim()
    if (!q) return null
    // 首选路书的高德 POI 检索（服务端已把坐标统一成 WGS84）。
    const places = await getJson(`/api/places?q=${encodeURIComponent(q)}`)
    if (Array.isArray(places) && places.length) {
      const hit = places[0]
      if (Number.isFinite(hit.lng) && Number.isFinite(hit.lat)) return hit
    }
    // 没配高德 key 时回落到 /api/geocode（Nominatim）。
    const geo = await getJson(`/api/geocode?q=${encodeURIComponent(q)}`)
    if (Array.isArray(geo) && geo.length) {
      const row = geo[0]
      const parts = String(row.display_name || '')
        .split(',')
        .map((s) => s.trim())
      const lng = Number(row.lon)
      const lat = Number(row.lat)
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        return {
          name: row.name || parts[0] || q,
          address: parts.slice(1, 4).join(' · '),
          lng,
          lat,
        }
      }
    }
    return null
  }

  async function resolvePlace(place) {
    const queries = unique([
      place.city ? `${place.city}${place.name}` : '',
      place.name,
      place.query,
    ])
    for (const q of queries) {
      const hit = await searchMap(q)
      if (hit) return hit
    }
    return null
  }

  /* ── 界面 ───────────────────────────────────────────────────────────── */

  const root = document.createElement('div')
  root.id = ROOT_ID
  root.innerHTML = `
    <button class="lx-fab" id="lx-fab" type="button" title="路书助手">路</button>
    <section class="lx-panel" id="lx-panel" hidden>
      <header class="lx-head">
        <span class="lx-title">lushu 助手</span>
        <button class="lx-icon" id="lx-close" type="button" title="收起">×</button>
      </header>
      <div class="lx-body">
        <div class="lx-status" id="lx-status">检查登录态…</div>

        <label class="lx-label" for="lx-keyword">路书名</label>
        <input class="lx-input" id="lx-keyword" type="text" placeholder="例如：青甘大环线" autocomplete="off" />

        <div class="lx-modes" role="tablist" aria-label="生成方式">
          <button class="lx-mode is-on" id="lx-mode-xhs" type="button" data-mode="xhs">小红书问点点</button>
          <button class="lx-mode" id="lx-mode-ai" type="button" data-mode="deepseek">DeepSeek 生成</button>
        </div>

        <div class="lx-actions">
          <button class="lx-btn lx-primary" id="lx-run" type="button">开始生成</button>
          <button class="lx-btn" id="lx-settings" type="button">设置</button>
        </div>

        <div class="lx-log" id="lx-log" aria-live="polite"></div>

        <ul class="lx-preview" id="lx-preview"></ul>
      </div>
    </section>
  `
  document.body.appendChild(root)

  const els = {
    fab: root.querySelector('#lx-fab'),
    panel: root.querySelector('#lx-panel'),
    close: root.querySelector('#lx-close'),
    status: root.querySelector('#lx-status'),
    keyword: root.querySelector('#lx-keyword'),
    modeXhs: root.querySelector('#lx-mode-xhs'),
    modeAi: root.querySelector('#lx-mode-ai'),
    run: root.querySelector('#lx-run'),
    settings: root.querySelector('#lx-settings'),
    log: root.querySelector('#lx-log'),
    preview: root.querySelector('#lx-preview'),
  }

  function log(line) {
    if (!line) return
    const div = document.createElement('div')
    div.className = 'lx-line'
    div.textContent = line
    els.log.appendChild(div)
    while (els.log.childElementCount > LOG_LIMIT) els.log.removeChild(els.log.firstChild)
    els.log.scrollTop = els.log.scrollHeight
  }

  function warn(line) {
    const div = document.createElement('div')
    div.className = 'lx-line lx-err'
    div.textContent = `⚠ ${line}`
    els.log.appendChild(div)
    els.log.scrollTop = els.log.scrollHeight
  }

  function clearLog() {
    els.log.textContent = ''
  }

  function paintSourceMode(mode) {
    state.sourceMode = mode === 'deepseek' ? 'deepseek' : 'xhs'
    els.modeXhs.classList.toggle('is-on', state.sourceMode === 'xhs')
    els.modeAi.classList.toggle('is-on', state.sourceMode === 'deepseek')
  }

  function setSourceMode(mode) {
    paintSourceMode(mode)
    void send({ type: 'config.set', patch: { sourceMode: state.sourceMode } })
  }

  async function loadSourceMode() {
    const res = await send({ type: 'config.get' })
    paintSourceMode(res?.config?.sourceMode)
  }

  function setBusy(busy) {
    state.busy = busy
    els.run.disabled = busy
    els.modeXhs.disabled = busy
    els.modeAi.disabled = busy
    els.run.textContent = busy ? '处理中…' : '开始生成'
  }

  async function refreshStatus() {
    const me = await getJson('/api/auth/me')
    if (me && me.user) {
      els.status.textContent = `已登录：${me.user.displayName || me.user.email}`
      els.status.className = 'lx-status lx-ok'
    } else if (me === null) {
      els.status.textContent = '无法连接路书服务，请确认已打开线上站点'
      els.status.className = 'lx-status lx-err'
    } else {
      els.status.textContent = '未登录：请先在页面右上角登录路书账号'
      els.status.className = 'lx-status lx-err'
    }
  }

  function clearPreview() {
    els.preview.textContent = ''
    state.resolved = []
  }

  function renderPreview() {
    els.preview.textContent = ''
    state.resolved.forEach((item) => {
      const li = document.createElement('li')
      li.className = 'lx-place' + (item.hit ? '' : ' lx-place-miss')

      const main = document.createElement('div')
      main.className = 'lx-place-main'

      const name = document.createElement('div')
      name.className = 'lx-place-name'
      name.textContent = item.night ? `${item.name} · 夜` : item.name

      const addr = document.createElement('div')
      addr.className = 'lx-place-addr'
      addr.textContent = item.hit
        ? item.hit.address || `${item.hit.lng.toFixed(4)}, ${item.hit.lat.toFixed(4)}`
        : '未定位到'

      main.append(name, addr)
      li.append(main)
      els.preview.appendChild(li)
    })
  }

  /* ── 主流程 ─────────────────────────────────────────────────────────── */

  async function run() {
    if (state.busy) return
    clearLog()
    clearPreview()
    setBusy(true)
    try {
      const keyword = els.keyword.value.trim()
      if (!keyword) throw new Error('请先输入路书名')
      state.keyword = keyword
      state.loop = false
      state.days = 0
      log(`主题：${keyword}`)

      const me = await getJson('/api/auth/me')
      if (!me || !me.user) throw new Error('未登录路书账号：请先在页面右上角登录')
      log(`账号：${me.user.displayName || me.user.email}`)

      let text = ''
      if (state.sourceMode === 'deepseek') {
        log('DeepSeek 正在根据路书名生成路线…')
      } else {
        const askKeyword = /详细攻略\s*$/.test(keyword) ? keyword : `${keyword}详细攻略`
        log(`打开小红书，问点点：${askKeyword}`)
        const res = await send({ type: 'xhs.ask', keyword: askKeyword })
        if (!res.ok) throw new Error(res.error)
        text = String(res.text || '').trim()
        if (text.length < 80) throw new Error('点点没有返回完整攻略')
        log(`点点回答已获取（${res.count || text.length} 字）`)
        log('DeepSeek 正在提取地点…')
      }
      const ex = await send({ type: 'ai.extract', keyword, text })
      if (!ex.ok) throw new Error(ex.error)
      const places = ex.data?.places ?? []
      state.title = keyword
      state.loop = Boolean(ex.data?.loop) || /环/.test(keyword)
      state.days = Number(ex.data?.days) || 0
      if (ex.data?.summary) log(`路线概要：${ex.data.summary}`)
      const nights = places.filter((p) => p.night).length
      log(
        `提取到 ${places.length} 个候选地点` +
          (state.days ? `，${state.days} 天` : '') +
          (nights ? `，${nights} 处过夜` : '') +
          (state.loop ? '，环线' : ''),
      )
      if (!places.length) throw new Error('没有生成到地点：换个路书名再试')

      for (let i = 0; i < places.length; i += 1) {
        const place = places[i]
        log(`定位 ${i + 1}/${places.length}：${place.name}`)
        const hit = await resolvePlace(place)
        state.resolved.push({ ...place, hit })
        renderPreview()
      }
      const ok = state.resolved.filter((r) => r.hit).length
      log(`定位完成：${ok}/${state.resolved.length}`)
      if (!ok) throw new Error('一个地点都没定位成功')
      await writeResolved()
    } catch (err) {
      warn(String((err && err.message) || err))
      setBusy(false)
    }
  }

  function errorMessage(status, data) {
    const code = data?.error || ''
    if (status === 401) return '服务端要求登录：会话可能已过期，请刷新页面重新登录'
    if (status === 403) return '没有编辑权限：这是别人的路书，请改用「新建路书」'
    if (status === 409 && code === 'duplicate_title') return 'duplicate_title'
    if (status === 409) return '路书已被其他地方修改，请刷新页面后重试'
    if (status === 413) return '地点太多，超出单本路书体积上限'
    if (status === 428)
      return '站点开启了人机校验：请先在页面里手动新建一本路书并打开，再重新生成'
    if (status === 503) return '服务端路书容量已满'
    return `写入失败（${status}${code ? ' ' + code : ''}）`
  }

  function pruneSplits(orderedIds, splitIds, loop) {
    const last = orderedIds[orderedIds.length - 1]
    return splitIds.filter((id) => {
      const i = orderedIds.indexOf(id)
      if (i <= 0) return false
      if (!loop && id === last) return false
      return true
    })
  }

  function evenNightIndexes(count, days, loop) {
    const last = loop ? count - 1 : count - 2
    const need = Math.min(Math.max(days - 1, 0), Math.max(last, 0))
    if (need <= 0 || count < 3) return []
    const out = []
    for (let k = 1; k <= need; k += 1) {
      const i = Math.round((k * last) / need)
      if (i >= 1 && i <= last && !out.includes(i)) out.push(i)
    }
    return out
  }

  async function putBook({ places, title, visibility, startId, endId, splitIds }) {
    const me = await getJson('/api/auth/me')
    if (!me || !me.user) throw new Error('未登录路书账号')

    // 始终写入当前打开的路书：id 取自地址栏 /d/{userId}/{bookId}。
    const id = matchBookIdInPath()
    if (!id) throw new Error('当前页不是一本路书（/d/…），无法写入')

    const token = getMetaToken(id) || randomHex(16)
    const now = Date.now()
    const doc = {
      id,
      title,
      startDate: '',
      visibility,
      places,
      startId,
      endId,
      orderedIds: places.map((p) => p.id),
      splitIds,
      createdAt: now,
      updatedAt: now,
    }

    // 已存在时带上基线做乐观并发检测。
    let base
    const head = await getJson(`/api/books/${id}`)
    if (head && typeof head.updatedAt === 'number') base = head.updatedAt

    let attempt = 0
    for (;;) {
      const res = await fetch(`/api/books/${id}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-edit-token': token,
          'x-owner-key': ownerKey(),
        },
        body: JSON.stringify({ doc, ...(base ? { baseUpdatedAt: base } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setBookMeta(id, {
          token,
          base: data.updatedAt,
          pushed: doc.updatedAt,
          owner: me.user.hashId,
        })
        return { id, updatedAt: data.updatedAt }
      }
      const message = errorMessage(res.status, data)
      if (message === 'duplicate_title' && attempt < 5) {
        attempt += 1
        doc.title = `${title} (${attempt + 1})`
        continue
      }
      throw new Error(message)
    }
  }

  async function writeResolved() {
    const chosen = []
    const nightIds = []
    for (const item of state.resolved) {
      if (!item.hit) continue
      const id = hashId()
      chosen.push({
        id,
        name: item.hit.name || item.name,
        address: item.hit.address || '',
        lng: item.hit.lng,
        lat: item.hit.lat,
      })
      if (item.night) nightIds.push(id)
    }
    if (!chosen.length) throw new Error('没有可写入的地点')

    const loop = Boolean(state.loop)
    const startId = chosen[0].id
    const endId = loop ? startId : chosen[chosen.length - 1].id
    const orderedIds = chosen.map((p) => p.id)
    let splitIds = pruneSplits(orderedIds, nightIds, loop)
    if (!splitIds.length && state.days >= 2) {
      splitIds = evenNightIndexes(chosen.length, state.days, loop).map((i) => chosen[i].id)
    }

    const cfgRes = await send({ type: 'config.get' })
    const visibility = cfgRes?.config?.visibility === 'public' ? 'public' : 'private'
    log(
      `写入当前路书（${chosen.length} 个地点` +
        (splitIds.length ? `，${splitIds.length} 处过夜` : '') +
        '）…',
    )
    const saved = await putBook({
      places: chosen,
      title: state.keyword || '未命名路书',
      visibility,
      startId,
      endId,
      splitIds,
    })
    log(`✅ 已保存：${saved.id}`)
    location.assign(location.pathname)
  }

  /* ── 事件绑定 ───────────────────────────────────────────────────────── */

  els.fab.addEventListener('click', () => {
    els.panel.hidden = !els.panel.hidden
    if (!els.panel.hidden) {
      void refreshStatus()
      void loadSourceMode()
      if (!els.keyword.value) els.keyword.focus()
    }
  })
  els.close.addEventListener('click', () => {
    els.panel.hidden = true
  })
  els.modeXhs.addEventListener('click', () => setSourceMode('xhs'))
  els.modeAi.addEventListener('click', () => setSourceMode('deepseek'))
  els.run.addEventListener('click', () => void run())
  els.settings.addEventListener('click', () => void send({ type: 'openOptions' }))
  els.keyword.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void run()
  })

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'lushu.progress') log(msg.line)
    if (msg?.type === 'lushu.openPanel') {
      els.panel.hidden = false
      void refreshStatus()
    }
  })

  // 站点是 SPA，切换路书只是 pushState；面板本身不用重建，只需刷新登录态。
  window.addEventListener('popstate', () => void refreshStatus())

  void refreshStatus()
  void loadSourceMode()
})()
