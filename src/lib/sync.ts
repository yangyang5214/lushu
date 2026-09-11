// 本地优先同步：zustand 立刻更新界面，后台防抖推送到 D1。
//
// 关键约束（免费档额度）：
//   · D1 写 10 万行/天 → 一次编辑会话只允许落几次库，必须防抖；并用持久化的
//     meta.pushed 记下"本机最后成功推送的版本"，避免每次开页重推没改的书。
//   · Workers 10 万请求/天 → 只推送脏书，不做轮询。

import { create } from 'zustand'
import { useStore } from '../store'
import {
  deleteRemoteBook,
  fetchBook,
  listRemoteBooks,
  saveBook,
  type BookSummary,
  type RemoteBook,
} from './api'
import { dropMeta, ensureToken, getMeta, setMeta } from './keys'
import { requestTurnstileToken } from './turnstile'

export type SyncStatus =
  | 'local' // 尚无云端副本
  | 'syncing' // 正在推送
  | 'saved' // 已同步
  | 'readonly' // 别人的分享，只读
  | 'offline' // 网络失败
  | 'conflict' // 云端有更新
  | 'full' // 服务端名额已满
  | 'error' // 其它失败

type Conflict = { id: string; remote: RemoteBook }

type SyncStore = { status: SyncStatus; at: number; conflict: Conflict | null }
export const useSync = create<SyncStore>(() => ({ status: 'local', at: 0, conflict: null }))

type CloudStore = { books: BookSummary[]; loaded: boolean }
export const useCloud = create<CloudStore>(() => ({ books: [], loaded: false }))

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
  // 已经推过的版本不再重复推（例如刚采用云端版本时的回声）。
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
    if (res.reason === 'forbidden') {
      // 服务端确认我们没写权限 → 记住只读，不再白推。
      setMeta(id, { remote: true })
      update({ status: 'readonly' })
      return
    }
    if (res.reason === 'conflict' && res.remote) {
      update({ status: 'conflict', conflict: { id, remote: res.remote } })
      return
    }
    if (res.reason === 'capacity') {
      update({ status: 'full' })
      return
    }
    if (res.reason === 'unavailable') {
      // 后端还没部署（只跑纯静态）：静默当作本机存储。
      update({ status: 'local' })
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
  for (const id of [...timers.keys()]) void push(id)
}

export async function refreshCloud(): Promise<void> {
  try {
    const books = await listRemoteBooks()
    useCloud.setState({ books, loaded: true })
  } catch {
    /* 离线就保持现状 */
  }
}

/** 打开一个本地没有的路书时调用：从云端拉下来。 */
export async function pullBook(id: string): Promise<boolean> {
  try {
    const remote = await fetchBook(id)
    if (!remote) return false
    useStore.getState().upsertRemoteBook(remote.doc)
    const meta = getMeta(id)
    if (meta.token) setMeta(id, { base: remote.updatedAt, pushed: remote.doc.updatedAt })
    else setMeta(id, { remote: true, base: remote.updatedAt, pushed: remote.doc.updatedAt })
    return true
  } catch {
    return false
  }
}

/** 冲突处理：用云端版本覆盖本地，或用本地强制覆盖云端。 */
export async function resolveConflict(choice: 'remote' | 'local'): Promise<void> {
  const conflict = useSync.getState().conflict
  if (!conflict) return
  const { id, remote } = conflict

  if (choice === 'remote') {
    useStore.getState().upsertRemoteBook(remote.doc)
    setMeta(id, { base: remote.updatedAt, pushed: remote.doc.updatedAt })
    update({ status: 'saved', at: Date.now(), conflict: null })
    return
  }

  const book = useStore.getState().books[id]
  if (!book) {
    update({ conflict: null })
    return
  }
  const token = ensureToken(id)
  try {
    // base 用云端版本，等于"我知道云端更新了，仍以本地为准"。
    const res = await saveBook(book, { token, base: remote.updatedAt })
    if (res.ok) {
      setMeta(id, { base: res.updatedAt, pushed: book.updatedAt })
      update({ status: 'saved', at: Date.now(), conflict: null })
    } else {
      update({ status: 'error', conflict: null })
    }
  } catch {
    update({ status: 'offline' })
  }
}

/** 删除：本地 + 云端一起清掉。 */
export async function removeBook(id: string): Promise<void> {
  const meta = getMeta(id)
  useStore.getState().deleteBook(id)
  dropMeta(id)
  if (meta.token && !meta.remote) {
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
    update({ status: meta.remote ? 'readonly' : meta.token ? 'saved' : 'local' })
  }

  useStore.subscribe(onStoreChange)

  // 首次运行：把本机已有（但云端没有）的路书补传一次，链接才分享得出去。
  // meta.pushed 保证之后不再重复推送。
  for (const id of Object.keys(useStore.getState().books)) consider(id)

  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })

  void refreshCloud()
}
