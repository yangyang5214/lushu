import { useEffect, useRef, useState } from 'react'
import { searchGazetteer } from '../lib/gazetteer'
import { searchPlaces } from '../lib/geocode'
import { useI18n } from '../lib/i18n'
import type { SearchHit } from '../types'
import { useLushu } from '../store'

type Props = {
  placeholder?: string
}

export function SearchBox({ placeholder }: Props) {
  const { t } = useI18n()
  const addPlace = useLushu((s) => s.addPlace)
  const selectPlace = useLushu((s) => s.selectPlace)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)
  const genRef = useRef(0)

  useEffect(() => {
    const qn = q.trim()
    const gen = ++genRef.current
    if (qn.length < 1) {
      setHits([])
      setErr('')
      setBusy(false)
      return
    }
    const local = searchGazetteer(qn)
    setHits(local)
    setOpen(true)
    setErr('')
    setBusy(true)
    const timer = window.setTimeout(() => {
      searchPlaces(qn)
        .then((rows) => {
          if (gen !== genRef.current) return
          setHits(rows)
          setErr(rows.length ? '' : t('search.noResults'))
          setOpen(true)
        })
        .catch(() => {
          if (gen !== genRef.current) return
          if (local.length === 0) setErr(t('search.offline'))
        })
        .finally(() => {
          if (gen === genRef.current) setBusy(false)
        })
    }, 280)
    return () => window.clearTimeout(timer)
  }, [q, t])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = (hit: SearchHit) => {
    genRef.current += 1
    const id = addPlace(hit)
    selectPlace(id)
    setQ('')
    setHits([])
    setOpen(false)
    setBusy(false)
    setErr('')
  }

  return (
    <div className="search" ref={boxRef}>
      <div className="search-field">
        <input
          id="place-search"
          value={q}
          placeholder={placeholder ?? t('search.placeholder')}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => (hits.length || err) && setOpen(true)}
          autoComplete="off"
        />
        {busy ? <span className="search-spin" aria-hidden /> : null}
      </div>
      {open && (hits.length > 0 || err) ? (
        <ul className="search-list">
          {hits.map((hit, i) => (
            <li key={`${hit.lng}-${hit.lat}-${i}`}>
              <button type="button" onClick={() => pick(hit)}>
                <strong>{hit.name}</strong>
                <span>{hit.address}</span>
              </button>
            </li>
          ))}
          {err ? <li className="search-empty">{err}</li> : null}
        </ul>
      ) : null}
    </div>
  )
}
