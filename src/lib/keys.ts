// 编辑口令 / 书架密钥 / 同步基线，全部只存本机，不进 URL。
//
// 安全模型（沿用 24-hex id 的"链接即凭证"）：
//   · URL 里的 book.id      = 只读凭证：公开的书拿到就能看，私密的书只有 owner 能读
//   · meta[id].token        = 编辑口令，只有创建者的浏览器有，写操作靠它
//   · owner key             = 书架密钥，用于"我的路书"列表与跨设备编辑
//
// 可见性存在路书自己身上（Book.visibility），默认 'private'，在「我的路书」里改。
//
// 这三个都是 localStorage 里的随机串，不会出现在分享链接里。

const META_KEY = 'lushu-meta-v1'
const OWNER_KEY = 'lushu-owner-v1'

export type BookMeta = {
  /** 编辑口令；有它 = 本机创建/可编辑 */
  token?: string
  /** 服务端确认我们无写权限，后续不再尝试推送 */
  remote?: boolean
  /** 上一次成功同步后服务端的 updatedAt，用于乐观并发检测 */
  base?: number
  /** 本机最后一次成功推送的 book.updatedAt，避免每次开页重推 */
  pushed?: number
  /**
   * 书主的公开短 ID（从服务端取回这本时记下），用来把地址栏规范成
   * `/{userId}/{bookId}`。本机自己创建的书没有这一项，回退到当前登录用户的 hashId。
   */
  owner?: string
  /** 书主昵称（从服务端取回这本时记下）。 */
  author?: string
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(arr)
  } else {
    for (let i = 0; i < arr.length; i += 1) arr[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

function readMeta(): Record<string, BookMeta> {
  try {
    const raw = localStorage.getItem(META_KEY)
    return raw ? (JSON.parse(raw) as Record<string, BookMeta>) : {}
  } catch {
    return {}
  }
}

function writeMeta(all: Record<string, BookMeta>): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(all))
  } catch {
    /* 存储写满/隐私模式：静默降级为纯本地 */
  }
}

export function getMeta(id: string): BookMeta {
  return readMeta()[id] ?? {}
}

export function setMeta(id: string, patch: Partial<BookMeta>): void {
  const all = readMeta()
  all[id] = { ...all[id], ...patch }
  writeMeta(all)
}

export function dropMeta(id: string): void {
  const all = readMeta()
  delete all[id]
  writeMeta(all)
}

/** 没有口令就现场生成一个（仅本机保存）。 */
export function ensureToken(id: string): string {
  const meta = getMeta(id)
  if (meta.token) return meta.token
  const token = randomHex(16)
  setMeta(id, { token })
  return token
}

export function hasToken(id: string): boolean {
  return Boolean(getMeta(id).token)
}

/** 书架密钥：本机首次使用时生成，可手动导出/导入以跨设备。 */
export function ownerKey(): string {
  try {
    const cur = localStorage.getItem(OWNER_KEY)
    if (cur) return cur
    const key = randomHex(16)
    localStorage.setItem(OWNER_KEY, key)
    return key
  } catch {
    return ''
  }
}

export function setOwnerKey(key: string): void {
  try {
    localStorage.setItem(OWNER_KEY, key.trim())
  } catch {
    /* ignore */
  }
}
