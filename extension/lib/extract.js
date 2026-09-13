// 用 DeepSeek 从「小红书抓取到的原始文本」里抽地点，并标过夜（分天）。
//
// 输出严格 JSON，字段：
//   title / summary / days / loop
//   places[]  { name, city, query, note, day, night }

const SYSTEM = `你是一个中文旅行路线规划助手。用户会给你一段来自小红书（问点点/搜索笔记）的原始文本。
你的任务：从文本里提取出「真实、可在地图上定位的游玩地点」，按顺路顺序排好，并标出过夜点以便把行程拆成一天天。

只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块。JSON 结构：
{
  "title": "简洁的路书名（12 字以内）",
  "summary": "一句话概括这条路线",
  "days": 8,
  "loop": false,
  "places": [
    {
      "name": "地点名（景点/景区/村镇/地标，不要餐厅、酒店、店铺，除非是著名的打卡点）",
      "city": "所在城市或区县（尽量填）",
      "query": "用于地图 POI 检索的最可能命中的关键词，通常就是地点全名；可带城市前缀",
      "note": "10 字以内的推荐理由，可为空字符串",
      "day": 1,
      "night": false
    }
  ]
}

规则：
1. 只提取文本里真实出现过的地点，绝对不要自己编造、不要补充文本里没有的地方。
2. 去掉重复项（同一地点的不同叫法只保留一个，用最完整规范的名称）。
3. 过滤掉与出行无关的内容（广告、价格、注意事项、穿搭、美食店名等）。
4. 如果文本里连一个明确地点都没有，places 返回空数组。
5. 按「从起点到终点顺路」的合理游览顺序排列；如果信息不足以判断，就按文本出现顺序。
6. 文本里如果出现多条路线（方案 A/B、几日版、经典线/深度线等），只保留「地点最多」的那一条，不要混在一起。
7. 选中的那条路线尽量把真实地点都留下，数量控制在 5~30 个。
8. day 从 1 开始：文本有「D1 / 第一天 / Day1」就按文本；主题带「N日 / N天」就必须拆成 N 天。
9. night=true 表示在此过夜（当天最后一站，或住宿所在的城镇/景点）。N 天行程必须给出 N-1 个过夜点；最后一天的终点不要标过夜。
10. 起点不要标过夜。主题含「环线 / 环游」或终点回到起点时 loop=true。`

const GENERATE = `你是一个中文旅行路线规划助手。用户只给了路书名。请根据路书名生成一条最经典、地点最多、可在地图上定位的真实游览路线。

只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块。JSON 结构与字段含义同上：
{
  "title": "简洁的路书名（12 字以内）",
  "summary": "一句话概括这条路线",
  "days": 8,
  "loop": false,
  "places": [
    {
      "name": "地点名（景点/景区/村镇/地标）",
      "city": "所在城市或区县",
      "query": "地图检索词",
      "note": "10 字以内推荐理由",
      "day": 1,
      "night": false
    }
  ]
}

规则：
1. 只使用真实存在、能在地图上搜到的地点，不要编造不存在的地方。
2. 该主题若有多条经典路线，只输出地点最多的那一条。
3. places 控制在 8~25 个，按顺路顺序。
4. day / night / days / loop 规则：主题带「N日 / N天」就拆成 N 天，给 N-1 个过夜点；最后一天终点和起点不要标过夜；含「环线 / 环游」则 loop=true。`

/** 构造发给 DeepSeek 的消息。无原文时按路书名直接生成。 */
export function buildExtractMessages(keyword, text) {
  const body = String(text ?? '').trim()
  if (body.length < 80) {
    return [
      { role: 'system', content: GENERATE },
      {
        role: 'user',
        content: `路书名：${keyword}\n\n请按系统要求只输出 json。`,
      },
    ]
  }
  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `路书主题：${keyword}\n\n小红书原始内容：\n${body}\n\n若原文有多条路线，只提取地点最多的那一条。请按系统要求只输出 json。`,
    },
  ]
}

function stripFence(raw) {
  const text = String(raw ?? '').trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (fenced ? fenced[1] : text).trim()
}

function pickString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function truthy(value) {
  if (value === true || value === 1) return true
  if (typeof value === 'string') return /^(1|true|yes|是|过夜)$/i.test(value.trim())
  return false
}

function pickDay(value) {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 60 ? n : 0
}

function inferDaysFromText(text) {
  const m = String(text || '').match(/(\d+)\s*[日天]/)
  if (!m) return 0
  const n = Number(m[1])
  return n >= 2 && n <= 30 ? n : 0
}

/** 同一天里最后一个点标过夜；最后一天除外。 */
function markNightsFromDays(places) {
  const lastOfDay = new Map()
  places.forEach((place, index) => {
    if (place.day >= 1) lastOfDay.set(place.day, index)
  })
  if (!lastOfDay.size) return places
  const maxDay = Math.max(...lastOfDay.keys())
  return places.map((place, index) => {
    if (place.day >= 1 && place.day < maxDay && lastOfDay.get(place.day) === index) {
      return { ...place, night: true }
    }
    return place
  })
}

/** 按天数均匀插过夜，避开起点；非环线也避开终点。 */
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

/**
 * 解析并规整 DeepSeek 的返回。
 * 即使模型不听话（多包了一层 / 少了字段）也尽量救回来。
 */
export function parseExtract(raw, keyword, maxPlaces = 30) {
  const cleaned = stripFence(raw)
  let data
  try {
    data = JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('DeepSeek 没有返回合法 JSON')
    data = JSON.parse(cleaned.slice(start, end + 1))
  }

  const asPlaces = (row) => {
    if (Array.isArray(row)) return row
    if (Array.isArray(row?.places)) return row.places
    return []
  }
  const candidates = []
  if (Array.isArray(data)) candidates.push({ places: data, meta: {} })
  if (Array.isArray(data?.places)) candidates.push({ places: data.places, meta: data })
  if (Array.isArray(data?.data?.places)) candidates.push({ places: data.data.places, meta: data.data })
  for (const row of [data, data?.data]) {
    if (!Array.isArray(row?.routes)) continue
    for (const route of row.routes) {
      const list = asPlaces(route)
      if (list.length) candidates.push({ places: list, meta: route })
    }
  }
  const picked = candidates.reduce((best, row) => {
    if (!best || row.places.length > best.places.length) return row
    return best
  }, null)
  const rawPlaces = picked?.places ?? []
  if (picked?.meta && typeof picked.meta === 'object' && !Array.isArray(picked.meta)) {
    data = {
      ...(data && typeof data === 'object' && !Array.isArray(data) ? data : {}),
      ...picked.meta,
      places: rawPlaces,
    }
  }

  const seen = new Set()
  const places = []
  for (const item of rawPlaces) {
    if (!item) continue
    const name = pickString(typeof item === 'string' ? item : item.name)
    if (!name) continue
    const city = pickString(item.city)
    const query = pickString(item.query) || (city ? `${city}${name}` : name)
    const note = pickString(item.note)
    const day = pickDay(item.day)
    const night = truthy(item.night)
    const key = `${city}|${name}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    places.push({ name, city, query, note, day, night })
    if (places.length >= maxPlaces) break
  }

  const title = pickString(data?.title) || pickString(keyword) || '未命名路书'
  const summary = pickString(data?.summary)
  const loop = truthy(data?.loop) || /环/.test(`${keyword} ${title}`)
  const days = pickDay(data?.days) || inferDaysFromText(`${keyword} ${title} ${summary}`)
  const withNights = markNightsFromDays(places)
  if (!withNights.some((place) => place.night) && days >= 2) {
    for (const i of evenNightIndexes(withNights.length, days, loop)) {
      withNights[i].night = true
    }
  }
  return { title, summary, places: withNights, loop, days }
}
