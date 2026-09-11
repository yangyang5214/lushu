import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import { buildJourney } from './lib/journey'
import { insertNearest, isSamePlace, orderRoute, suggestSplitId } from './lib/geo'
import { readRoute } from './lib/router'
import { SAMPLE_DATE, SAMPLE_PLACES, SAMPLE_TITLE } from './lib/sample'
import type { Book, Journey, Place } from './types'

export type View = 'list' | 'edit'

type NewBook = Partial<
  Pick<
    Book,
    'title' | 'startDate' | 'places' | 'startId' | 'endId' | 'orderedIds' | 'splitIds'
  >
>

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 24-char hex id, same shape as 高德路书的 /plan/<id>. */
function hashId(): string {
  const bytes = new Uint8Array(12)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function isHashId(id: string): boolean {
  return /^[0-9a-f]{24}$/.test(id)
}

type State = {
  books: Record<string, Book>
  order: string[]
  activeId: string | null
  view: View
  selectedId: string | null
}

type Actions = {
  setView: (view: View) => void
  createBook: (seed?: NewBook) => string
  openBook: (id: string) => void
  closeBook: () => void
  duplicateBook: (id: string) => string
  deleteBook: (id: string) => void
  renameBook: (id: string, title: string) => void
  loadSample: () => string

  setTitle: (title: string) => void
  setStartDate: (startDate: string) => void
  addPlace: (input: Omit<Place, 'id'> & { id?: string }) => string
  removePlace: (id: string) => void
  setStart: (id: string) => void
  setEnd: (id: string) => void
  closeLoop: () => void
  clearEnds: () => void
  movePlace: (id: string, dir: -1 | 1) => void
  resort: () => void
  addSplit: (id: string) => void
  removeSplit: (id: string) => void
  moveSplit: (fromId: string, toId: string) => void
  suggestSplit: () => void
  selectPlace: (id: string | null) => void
  reset: () => void
}

type Store = State & Actions

const EMPTY_BOOK: Book = {
  id: '',
  title: '未命名路书',
  startDate: '',
  places: [],
  startId: null,
  endId: null,
  orderedIds: [],
  splitIds: [],
  createdAt: 0,
  updatedAt: 0,
}

function bothEnds(b: Book): boolean {
  return Boolean(b.startId && b.endId)
}

function loopOf(b: Book): boolean {
  const start = b.places.find((p) => p.id === b.startId)
  const end = b.places.find((p) => p.id === b.endId)
  return !!(start && end && (start.id === end.id || isSamePlace(start, end)))
}

function reorderAll(b: Book): string[] {
  if (!b.startId || !b.endId) return b.places.map((p) => p.id)
  return orderRoute(b.places, b.startId, b.endId).map((p) => p.id)
}

function pruneSplits(orderedIds: string[], splitIds: string[], loop: boolean): string[] {
  const last = orderedIds[orderedIds.length - 1]
  return splitIds.filter((id) => {
    const i = orderedIds.indexOf(id)
    if (i <= 0) return false
    if (!loop && id === last) return false
    return true
  })
}

/** Apply a patch to the currently open book and bump its updatedAt. */
function activePatch(s: Store, f: (b: Book) => Partial<Book>): Partial<Store> {
  const id = s.activeId
  if (!id) return {}
  const b = s.books[id]
  if (!b) return {}
  return {
    books: { ...s.books, [id]: { ...b, ...f(b), updatedAt: Date.now() } },
  }
}

/** Give every book a proper 24-hex hash id (older builds used non-hash ids). */
function remapBookIds(persisted: unknown): unknown {
  const p = (persisted ?? {}) as Partial<State>
  if (!p.books) return persisted
  const idMap: Record<string, string> = {}
  const books: Record<string, Book> = {}
  Object.values(p.books).forEach((book) => {
    const nextId = isHashId(book.id) ? book.id : hashId()
    idMap[book.id] = nextId
    books[nextId] = nextId === book.id ? book : { ...book, id: nextId }
  })
  const order = (p.order ?? Object.keys(p.books)).map((id) => idMap[id] ?? id)
  return { ...p, books, order }
}

const initialRoute = readRoute()

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      books: {},
      order: [],
      activeId: initialRoute.bookId,
      view: initialRoute.bookId ? 'edit' : 'list',
      selectedId: null,

      setView: (view) => set({ view }),

      createBook: (seed) => {
        const id = hashId()
        const now = Date.now()
        const book: Book = {
          id,
          title: seed?.title ?? '未命名路书',
          startDate: seed?.startDate ?? '',
          places: seed?.places ?? [],
          startId: seed?.startId ?? null,
          endId: seed?.endId ?? null,
          orderedIds: seed?.orderedIds ?? [],
          splitIds: seed?.splitIds ?? [],
          createdAt: now,
          updatedAt: now,
        }
        set((s) => ({
          books: { ...s.books, [id]: book },
          order: [id, ...s.order],
          activeId: id,
          view: 'edit',
          selectedId: null,
        }))
        return id
      },

      openBook: (id) =>
        set((s) =>
          s.books[id] ? { activeId: id, view: 'edit', selectedId: null } : {},
        ),

      closeBook: () => set({ view: 'list', selectedId: null }),

      duplicateBook: (id) => {
        const src = get().books[id]
        if (!src) return id
        const nid = hashId()
        const now = Date.now()
        const copy: Book = {
          ...src,
          id: nid,
          title: `${src.title} 副本`,
          places: src.places.map((p) => ({ ...p })),
          createdAt: now,
          updatedAt: now,
        }
        set((s) => ({ books: { ...s.books, [nid]: copy }, order: [nid, ...s.order] }))
        return nid
      },

      deleteBook: (id) =>
        set((s) => {
          if (!s.books[id]) return {}
          const books = { ...s.books }
          delete books[id]
          const wasActive = s.activeId === id
          return {
            books,
            order: s.order.filter((x) => x !== id),
            ...(wasActive ? { activeId: null, view: 'list' as View, selectedId: null } : {}),
          }
        }),

      renameBook: (id, title) =>
        set((s) =>
          s.books[id]
            ? { books: { ...s.books, [id]: { ...s.books[id], title, updatedAt: Date.now() } } }
            : {},
        ),

      loadSample: () => {
        const startId = SAMPLE_PLACES[0].id
        return get().createBook({
          title: SAMPLE_TITLE,
          startDate: SAMPLE_DATE,
          places: SAMPLE_PLACES.map((p) => ({ ...p })),
          startId,
          endId: startId,
          orderedIds: SAMPLE_PLACES.map((p) => p.id),
        })
      },

      setTitle: (title) => set((s) => activePatch(s, () => ({ title }))),

      setStartDate: (startDate) => set((s) => activePatch(s, () => ({ startDate }))),

      addPlace: (input) => {
        const id = input.id ?? uid('p')
        const place: Place = { ...input, id }
        set((s) =>
          activePatch(s, (b) => {
            const places = [...b.places, place]
            if (bothEnds(b) && b.orderedIds.length > 0) {
              const path = b.orderedIds
                .map((pid) => places.find((p) => p.id === pid))
                .filter((p): p is Place => Boolean(p))
              const next = insertNearest(path, place, loopOf({ ...b, places }))
              return { places, orderedIds: next.map((p) => p.id) }
            }
            return { places, orderedIds: [...b.orderedIds, id] }
          }),
        )
        return id
      },

      removePlace: (id) =>
        set((s) => ({
          ...activePatch(s, (b) => {
            const places = b.places.filter((p) => p.id !== id)
            const startId = b.startId === id ? null : b.startId
            const endId = b.endId === id ? null : b.endId
            const next = { ...b, places, startId, endId }
            const orderedIds = startId && endId ? reorderAll(next) : places.map((p) => p.id)
            return {
              places,
              startId,
              endId,
              orderedIds,
              splitIds: pruneSplits(
                orderedIds,
                b.splitIds.filter((x) => x !== id),
                loopOf({ ...next, orderedIds }),
              ),
            }
          }),
          ...(s.selectedId === id ? { selectedId: null } : {}),
        })),

      setStart: (id) =>
        set((s) =>
          activePatch(s, (b) => {
            const nb = { ...b, startId: id }
            const orderedIds = bothEnds(nb)
              ? reorderAll(nb)
              : [id, ...b.orderedIds.filter((x) => x !== id)]
            return {
              startId: id,
              orderedIds,
              splitIds: pruneSplits(orderedIds, b.splitIds, loopOf(nb)),
            }
          }),
        ),

      setEnd: (id) =>
        set((s) =>
          activePatch(s, (b) => {
            const nb = { ...b, endId: id }
            const orderedIds = bothEnds(nb)
              ? reorderAll(nb)
              : [...b.orderedIds.filter((x) => x !== id), id]
            return {
              endId: id,
              orderedIds,
              splitIds: pruneSplits(orderedIds, b.splitIds, loopOf(nb)),
            }
          }),
        ),

      closeLoop: () =>
        set((s) =>
          activePatch(s, (b) => {
            if (!b.startId) return {}
            const nb = { ...b, endId: b.startId }
            const orderedIds = reorderAll(nb)
            return {
              endId: b.startId,
              orderedIds,
              splitIds: pruneSplits(orderedIds, b.splitIds, true),
            }
          }),
        ),

      clearEnds: () =>
        set((s) =>
          activePatch(s, (b) => ({
            startId: null,
            endId: null,
            orderedIds: b.places.map((p) => p.id),
            splitIds: [],
          })),
        ),

      movePlace: (id, dir) =>
        set((s) =>
          activePatch(s, (b) => {
            const ids = b.orderedIds.slice()
            const i = ids.indexOf(id)
            const j = i + dir
            if (i < 0 || j < 0 || j >= ids.length) return {}
            if (id === b.startId || id === b.endId) return {}
            if (ids[j] === b.startId || (ids[j] === b.endId && !loopOf(b))) return {}
            ;[ids[i], ids[j]] = [ids[j], ids[i]]
            return { orderedIds: ids }
          }),
        ),

      resort: () =>
        set((s) =>
          activePatch(s, (b) => {
            if (!bothEnds(b)) return {}
            const orderedIds = reorderAll(b)
            return { orderedIds, splitIds: pruneSplits(orderedIds, b.splitIds, loopOf(b)) }
          }),
        ),

      addSplit: (id) =>
        set((s) =>
          activePatch(s, (b) => {
            if (b.splitIds.includes(id)) return {}
            return {
              splitIds: pruneSplits(b.orderedIds, [...b.splitIds, id], loopOf(b)),
            }
          }),
        ),

      removeSplit: (id) =>
        set((s) => activePatch(s, (b) => ({ splitIds: b.splitIds.filter((x) => x !== id) }))),

      moveSplit: (fromId, toId) =>
        set((s) =>
          activePatch(s, (b) => {
            if (fromId === toId) return {}
            const next = b.splitIds.filter((x) => x !== fromId && x !== toId)
            next.push(toId)
            return { splitIds: pruneSplits(b.orderedIds, next, loopOf(b)) }
          }),
        ),

      suggestSplit: () =>
        set((s) =>
          activePatch(s, (b) => {
            const ordered = b.orderedIds
              .map((id) => b.places.find((p) => p.id === id))
              .filter((p): p is Place => Boolean(p))
            const id = suggestSplitId(ordered, b.splitIds, loopOf(b))
            if (!id) return {}
            return { splitIds: [...b.splitIds, id] }
          }),
        ),

      selectPlace: (id) => set({ selectedId: id }),

      reset: () => set({ books: {}, order: [], activeId: null, view: 'list', selectedId: null }),
    }),
    {
      name: 'lushu-v1',
      version: 4,
      // The open book / view live in the URL hash, so only the library is stored.
      partialize: (s) => ({ books: s.books, order: s.order }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<State>
        return {
          ...current,
          books: p.books ?? current.books,
          order: p.order ?? current.order,
        }
      },
      migrate: (persisted, version) => {
        let state: unknown = persisted
        if (version < 2) {
          const old = (persisted ?? {}) as Partial<{
            title: string
            startDate: string
            places: Place[]
            startId: string | null
            endId: string | null
            orderedIds: string[]
            splitIds: string[]
          }>
          const now = Date.now()
          const id = hashId()
          const hasContent = Boolean(old.places?.length)
          const book: Book = {
            id,
            title: old.title ?? '未命名路书',
            startDate: old.startDate ?? '',
            places: old.places ?? [],
            startId: old.startId ?? null,
            endId: old.endId ?? null,
            orderedIds: old.orderedIds ?? [],
            splitIds: old.splitIds ?? [],
            createdAt: now,
            updatedAt: now,
          }
          state = {
            books: hasContent ? { [id]: book } : {},
            order: hasContent ? [id] : [],
          }
        }
        if (version < 4) state = remapBookIds(state)
        return state
      },
    },
  ),
)

/**
 * Selector hook over the currently open book. Book fields (title, places, …) are
 * exposed at the top level so components can read them like a flat store, while
 * actions and the book library (books/order/activeId/view) are also available.
 */
export function useLushu<T>(selector: (s: Store & Book) => T): T {
  const state = useStore((s) => s)
  const book = (state.activeId && state.books[state.activeId]) || EMPTY_BOOK
  const flat = useMemo(() => ({ ...book, ...state }) as Store & Book, [book, state])
  return selector(flat)
}

export function useJourney(): Journey {
  const data = useLushu(
    useShallow((s) => ({
      title: s.title,
      startDate: s.startDate,
      places: s.places,
      startId: s.startId,
      endId: s.endId,
      orderedIds: s.orderedIds,
      splitIds: s.splitIds,
    })),
  )
  return useMemo(() => buildJourney(data), [data])
}

export function useSelectedId(): string | null {
  return useStore((s) => s.selectedId)
}
