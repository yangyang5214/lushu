// 同步：zustand 立刻更新界面，后台防抖推送到 D1。
// 同一本路书全局只有一个版本；两边都改过时按 updatedAt 取更晚的一次，不需要用户在
// 两份之间做选择。
//
// 关键约束（免费档额度）：
//   · D1 写 10 万行/天 → 一次编辑会话只允许落几次库，必须防抖；并用持久化的
//     meta.pushed 记下"本机最后成功推送的版本"，避免每次开页重推没改的书。
//   · Workers 10 万请求/天 → 只推送脏书，不做轮询。

import { create } from 'zustand'
import { useStore } from '../store'
import { useAuth } from './auth'
import {
  deleteRemoteBook,
  fetchBook,
  listPublicBooks,
  listRemoteBooks,
  saveBook,
  type BookSummary,
  type PublicBook,
} from './api'
import { dropMeta, ensureToken, getMeta, setMeta } from './keys'
import { requestTurnstileToken } from './turnstile'

export type SyncStatus =
  | 'idle' // 无同步会话（未打开任何书）
  | 'syncing' // 正在推送
  | 'saved' // 已同步
  | 'readonly' // 别人的分享，只读
  | 'offline' // 网络失败
  | 'full' // 服务端名额已满
  | 'error' // 其它失败（含后端不可达 / 缺配置）

type SyncStore = { status: SyncStatus; at: number }
export const useSync = create<SyncStore>(() => ({ status: 'idle', at: 0 }))

type CloudStore = { books: BookSummary[]; loaded: boolean; error: boolean }
export const useCloud = create<CloudStore>(() => ({ books: [], loaded: false, error: false }))

type PublicStore = { books: PublicBook[]; loaded: boolean; error: boolean }
export const usePublic = create<PublicStore>(() => ({ books: [], loaded: false, error: false }))

function update(patch: Partial<SyncStore>): void {
  useSync.setState(patch)
}

const DEBOUNCE_MS = 1400
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let started = false

async function push(id: string): Promise<void> {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }

  const book = useStore.getState().books[id]
  if (!book) return

  const meta = getMeta(id)
  if (meta.remote) {
    update({ status: 'readonly' })
    return
  }
  // 已经推过的版本不再重复推（例如刚采用服务端版本时的回声）。
  if (meta.pushed !== undefined && book.updatedAt <= meta.pushed) return

  const token = ensureToken(id)
  update({ status: 'syncing' })

  try {
    let res = await saveBook(book, { token, base: meta.base })

    // 新建被 Turnstile 拦下 → 取一个 token 重试一次（只在新建那一次发生）。
    if (!res.ok && res.reason === 'turnstile') {
      const tsToken = await requestTurnstileToken()
      if (tsToken) res = await saveBook(book, { token, base: meta.base, turnstile: tsToken })
    }

    if (res.ok) {
      setMeta(id, { base: res.updatedAt, pushed: book.updatedAt })
      update({ status: 'saved', at: Date.now() })
      return
    }
    if (res.reason === 'login') {
      // 新建必须登录；登录过期也会走到这里。书还在本机，登录后会补推。
      update({ status: 'idle' })
      return
    }
    if (res.reason === 'forbidden') {
      // 服务端确认我们没写权限 → 记住只读，不再白推。
      setMeta(id, { remote: true })
      update({ status: 'readonly' })
      return
    }
    if (res.reason === 'conflict' && res.remote) {
      const remote = res.remote
      // 服务端已被写入了更新的版本 → 直接采用；否则以服务端当前版本为基线再写一次。
      if (remote.doc.updatedAt > book.updatedAt) {
        useStore.getState().upsertRemoteBook(remote.doc)
        setMeta(id, { base: remote.updatedAt, pushed: remote.doc.updatedAt })
        update({ status: 'saved', at: Date.now() })
        return
      }
      try {
        const retry = await saveBook(book, { token, base: remote.updatedAt })
        if (retry.ok) {
          setMeta(id, { base: retry.updatedAt, pushed: book.updatedAt })
          update({ status: 'saved', at: Date.now() })
          return
        }
      } catch {
        update({ status: 'offline' })
        return
      }
      update({ status: 'error' })
      return
    }
    if (res.reason === 'capacity') {
      update({ status: 'full' })
      return
    }
    update({ status: 'error' })
  } catch {
    update({ status: 'offline' })
  }
}

function schedule(id: string): void {
  const cur = timers.get(id)
  if (cur) clearTimeout(cur)
  timers.set(
    id,
    setTimeout(() => {
      void push(id)
    }, DEBOUNCE_MS),
  )
}

/** 只有在"本机确有改动、且没推过该版本"时才排推送。 */
function consider(id: string): void {
  const book = useStore.getState().books[id]
  if (!book) return
  const meta = getMeta(id)
  if (meta.remote) return
  if (meta.pushed !== undefined && book.updatedAt <= meta.pushed) return
  schedule(id)
}

function onStoreChange(): void {
  const id = useStore.getState().activeId
  if (id) consider(id)
}

/** 立即把待推送的都发出去（关页 / 切后台时用）。 */
export function flush(): void {
  void flushPending()
}

/**
 * 立刻推送指定的某一本（列表页的显式操作，如「改权限」）。
 * 不等防抖：用户刚点的那下应该马上落到服务端。
 */
export async function pushBook(id: string): Promise<void> {
  await push(id)
}

/** 等所有待推送的都发完（退出登录前用，确保服务端拿到最新版本）。 */
export async function flushPending(): Promise<void> {
  const ids = [...timers.keys()]
  await Promise.all(ids.map((id) => push(id)))
}

export async function refreshCloud(): Promise<void> {
  try {
    const books = await listRemoteBooks()
    useCloud.setState({ books, loaded: true, error: false })
  } catch {
    useCloud.setState({ loaded: true, error: true })
  }
}

/** 主页默认的公开路书列表。失败时把错误暴露给界面，不再假装空列表。 */
export async function refreshPublic(): Promise<void> {
  try {
    const books = await listPublicBooks()
    usePublic.setState({ books, loaded: true, error: false })
  } catch {
    usePublic.setState({ loaded: true, error: true })
  }
}

/**
 * 打开本机已有的路书时和服务端对一次账：同一个 id 每次都去远端确认最新版本，
 * 远端更新就采用远端（作废本机旧副本），本地更新就留着交给正常的推送逻辑。
 * 注意：未登录 / 离线 / 无权读（404）时静默保持本地版本。
 */
export async function reconcileBook(id: string): Promise<void> {
  const local = useStore.getState().books[id]
  if (!local) return
  const meta = getMeta(id)
  try {
    const remote = await fetchBook(id)
    if (!remote) return
    if (remote.doc.updatedAt > local.updatedAt) {
      useStore.getState().upsertRemoteBook(remote.doc)
      setMeta(id, {
        base: remote.updatedAt,
        pushed: remote.doc.updatedAt,
        owner: remote.owner,
      })
      return
    }
    // 本地不旧（或更新的本地版本还没推上去）：只刷新同步基线，别误判成冲突。
    if (remote.updatedAt > (meta.base ?? 0)) {
      setMeta(id, { base: remote.updatedAt, owner: remote.owner })
    }
  } catch {
    /* 离线 / 后端不可达：保持本地版本 */
  }
}

/**
 * 打开一本还没取到的路书时调用：从服务端取下来。
 * `own`：账号书架里的书（换设备同步），本机补编辑口令后可继续改。
 */
export async function pullBook(id: string, opts?: { own?: boolean }): Promise<boolean> {
  try {
    const remote = await fetchBook(id)
    if (!remote) return false
    useStore.getState().upsertRemoteBook(remote.doc)
    const meta = getMeta(id)
    // 书主公开 ID 一并记下（可能为空串 = 匿名书架），地址栏才能规范成 `/{userId}/{bookId}`。
    const owner = { owner: remote.owner }
    const synced = {
      base: remote.updatedAt,
      pushed: remote.doc.updatedAt,
      ...owner,
      remote: undefined as boolean | undefined,
    }
    if (meta.token || opts?.own) {
      if (opts?.own) ensureToken(id)
      setMeta(id, synced)
    } else {
      setMeta(id, { ...synced, remote: true })
    }
    return true
  } catch {
    return false
  }
}

/**
 * 把公开路书复制进个人书架：拉完整 doc → 本地新建私密副本 → 推到账号。
 * 需已登录（调用方用 requireLogin 包一层）。
 */
export async function copyPublicBook(id: string): Promise<string | null> {
  try {
    let src = useStore.getState().books[id]
    if (!src) {
      const remote = await fetchBook(id)
      if (!remote) return null
      src = remote.doc
    }
    const newId = useStore.getState().importBookCopy(src)
    ensureToken(newId)
    await pushBook(newId)
    void refreshCloud()
    return newId
  } catch {
    return null
  }
}

/** 把账号书架里有、本机还没有的路书拉下来（打开「我的路书」时用）。 */
export async function pullMissingCloudBooks(): Promise<void> {
  const cloud = useCloud.getState().books
  const local = useStore.getState().books
  const missing = cloud.filter((c) => !local[c.id])
  if (missing.length === 0) return
  await Promise.all(missing.map((c) => pullBook(c.id, { own: true })))
}

/** 删除：本地与服务端一起清掉。 */
export async function removeBook(id: string): Promise<void> {
  const meta = getMeta(id)
  const inCloud = useCloud.getState().books.some((c) => c.id === id)
  useStore.getState().deleteBook(id)
  dropMeta(id)
  // 账号书架里的、或曾推送过的：服务端也要删（归属靠会话 / owner_key，不依赖编辑口令）。
  // 仅「别人的分享、且不在本人云端列表」时只清本机。
  const purgeRemote = inCloud || meta.pushed !== undefined || (Boolean(meta.token) && !meta.remote)
  if (purgeRemote) {
    try {
      await deleteRemoteBook(id, meta.token)
    } catch {
      /* 删不掉就留着，下次书架刷新会再出现 */
    }
  }
  void refreshCloud()
}

export function startSync(): void {
  if (started) return
  started = true

  const active = useStore.getState().activeId
  if (active) {
    const meta = getMeta(active)
    update({
      status: meta.remote ? 'readonly' : meta.pushed !== undefined ? 'saved' : 'idle',
    })
  }

  useStore.subscribe(onStoreChange)

  // 账号探测 / 登录 / 绑定完成后，书架归属会变，重拉一次账号里的路书列表。
  useAuth.subscribe((state, prev) => {
    if (state.user?.id !== prev.user?.id) void refreshCloud()
  })

  // 首次运行：把已有（但服务端还没有）的路书补传一次，链接才分享得出去。
  // meta.pushed 保证之后不再重复推送。
  for (const id of Object.keys(useStore.getState().books)) consider(id)

  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })

  void refreshCloud()
  void refreshPublic()
}
