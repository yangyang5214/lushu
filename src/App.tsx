import { useEffect } from 'react'
import { MapCanvas } from './components/MapCanvas'
import { RouteList } from './components/RouteList'
import { Sidebar } from './components/Sidebar'
import { SplitRail } from './components/SplitRail'
import { readRoute, ROOT_PATH } from './lib/router'
import { useLushu, useStore } from './store'

function usePathRoute() {
  useEffect(() => {
    const sync = () => {
      const { bookId } = readRoute()
      const store = useStore.getState()
      if (bookId && store.books[bookId]) {
        store.openBook(bookId)
        return
      }
      store.closeBook()
      if (bookId) window.history.replaceState(null, '', ROOT_PATH)
    }

    sync()
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])
}

export default function App() {
  usePathRoute()

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
