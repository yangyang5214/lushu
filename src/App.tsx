import { useEffect } from 'react'
import { MapCanvas } from './components/MapCanvas'
import { RouteList } from './components/RouteList'
import { Sidebar } from './components/Sidebar'
import { SplitRail } from './components/SplitRail'
import { readRoute, ROOT_PATH } from './lib/router'
import { pullBook, startSync } from './lib/sync'
import { useLushu, useStore } from './store'

function usePathRoute() {
  useEffect(() => {
    let cancelled = false

    const sync = async () => {
      const { bookId } = readRoute()
      const store = useStore.getState()

      if (!bookId) {
        store.closeBook()
        return
      }

      if (store.books[bookId]) {
        store.openBook(bookId)
        return
      }

      // 本地没有 → 可能是别人分享的链接，去云端取。
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
  }, [])

  const view = useLushu((s) => s.view)
  const activeId = useLushu((s) => s.activeId)
  const hasBook = useLushu((s) => (s.activeId ? Boolean(s.books[s.activeId]) : false))

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
