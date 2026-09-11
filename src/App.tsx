import { useEffect } from 'react'
import { AccountPage } from './components/Account'
import { MapCanvas } from './components/MapCanvas'
import { MinePage } from './components/MinePage'
import { PublicList } from './components/PublicList'
import { RouteList } from './components/RouteList'
import { Sidebar } from './components/Sidebar'
import { SplitRail } from './components/SplitRail'
import { initAuth } from './lib/auth'
import { readRoute, ROOT_PATH } from './lib/router'
import { pullBook, startSync } from './lib/sync'
import { useLushu, useStore } from './store'

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
      if (store.books[bookId]) {
        store.openBook(bookId)
        return
      }

      // 本地没有这本 → 可能是别人分享的链接，去服务端取。
      const found = await pullBook(bookId)
      if (cancelled) return
      if (found) {
        store.openBook(bookId)
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
}

export default function App() {
  usePathRoute()

  useEffect(() => {
    startSync()
    // 账号是异步探测的；sync 会监听账号变化并刷新账号里的路书列表。
    void initAuth()
  }, [])

  const view = useLushu((s) => s.view)
  const activeId = useLushu((s) => s.activeId)
  const hasBook = useLushu((s) => (s.activeId ? Boolean(s.books[s.activeId]) : false))

  if (view === 'public') return <PublicList />
  if (view === 'account') return <AccountPage />
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
