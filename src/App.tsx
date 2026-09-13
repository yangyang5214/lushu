import { useEffect } from 'react'
import { AccountPage } from './components/Account'
import { AdminPage } from './components/AdminPage'
import { MapCanvas } from './components/MapCanvas'
import { MinePage } from './components/MinePage'
import { PublicList } from './components/PublicList'
import { RouteList } from './components/RouteList'
import { Sidebar } from './components/Sidebar'
import { SplitRail } from './components/SplitRail'
import { initAuth, useAuth } from './lib/auth'
import { adminT, t, useI18n } from './lib/i18n'
import { getMeta } from './lib/keys'
import { bookPath, readRoute, ROOT_PATH } from './lib/router'
import { prefetchBookRoads } from './lib/route'
import { pullBook, startSync } from './lib/sync'
import { useLushu, useStore } from './store'

/**
 * 把地址栏规范成 `/d/{userId}/{bookId}`：书主公开 ID 优先用本机记下的（从服务端
 * 取回的书），否则用当前登录用户的 hashId。拿不到（未登录 / 匿名书架）就保留原样。
 */
function canonicalizeBookUrl(bookId: string): void {
  const meta = getMeta(bookId)
  // 从服务端取回的书：owner 可能确实是空串（匿名书架），此时不要退回到访问者的
  // hashId，否则会把这本误标成「你的」。没记录过 owner 才是本机自己的书。
  const owner = 'owner' in meta ? meta.owner : useAuth.getState().user?.hashId
  if (!owner) return
  const path = bookPath(bookId, owner)
  if (path !== window.location.pathname) {
    window.history.replaceState(null, '', path)
  }
}

function usePathRoute() {
  useEffect(() => {
    let cancelled = false

    const sync = async () => {
      const route = readRoute()
      const store = useStore.getState()

      if (route.name !== 'book') {
        store.closeBook()
        store.setView(route.name)
        return
      }

      const bookId = route.bookId
      // 路网预热可以和拉云端并行：本机有副本就先按它取（坐标没变会命中缓存）。
      const local = store.books[bookId]
      if (local) prefetchBookRoads(local)
      // 每次打开都拉云端，不用本机缓存当展示源；离线才退回本地副本。
      const found = await pullBook(bookId)
      if (cancelled) return
      if (found || store.books[bookId]) {
        store.openBook(bookId)
        canonicalizeBookUrl(bookId)
        const book = store.books[bookId]
        if (book && book !== local) prefetchBookRoads(book)
        return
      }
      store.closeBook()
      window.history.replaceState(null, '', ROOT_PATH)
    }

    void sync()
    const onPop = () => void sync()
    window.addEventListener('popstate', onPop)
    return () => {
      cancelled = true
      window.removeEventListener('popstate', onPop)
    }
  }, [])

  // 账号是异步探测的：刚打开页面时还不知道 hashId，登录态就位后补一次规范化。
  // 归属会随登录态变化：之前判成只读的路书，登录后可能正是自己的，再对一次账。
  const user = useAuth((s) => s.user)
  useEffect(() => {
    const route = readRoute()
    if (route.name !== 'book') return
    canonicalizeBookUrl(route.bookId)
    if (useStore.getState().readonlyIds[route.bookId]) void pullBook(route.bookId)
  }, [user])
}

export default function App() {
  usePathRoute()

  // 文档层面跟随语言：<html lang> 与标题。
  const { lang } = useI18n()
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
    document.title = t('meta.title')
  }, [lang])

  useEffect(() => {
    startSync()
    // 账号是异步探测的；sync 会监听账号变化并刷新账号里的路书列表。
    void initAuth()
  }, [])

  const view = useLushu((s) => s.view)

  // 管理后台固定中文，不跟随站点语言。
  useEffect(() => {
    if (view !== 'admin') return
    document.documentElement.lang = 'zh-CN'
    document.title = `${adminT('admin.title')} · 路书`
  }, [view])

  const activeId = useLushu((s) => s.activeId)
  const hasBook = useLushu((s) => (s.activeId ? Boolean(s.books[s.activeId]) : false))
  // 账号是异步探测的：探测完成前 user 还是 null，先按未登录处理，免得闪出书架。
  const user = useAuth((s) => s.user)

  if (view === 'admin') return <AdminPage />
  if (view === 'public') return <PublicList />
  // 我的路书是个人数据，要登录才能用：未登录（含正在探测）先落在账户页的
  // 登录表单上，不解释理由；登录态就位后这一页自动换回书架。
  if (view === 'account' || (view === 'mine' && !user)) return <AccountPage />
  if (view === 'mine') return <MinePage />
  if (view !== 'edit' || !activeId || !hasBook) return <RouteList />

  return (
    <div className="app">
      <div className="workspace">
        <Sidebar />
        <MapCanvas />
      </div>
      <SplitRail />
    </div>
  )
}
