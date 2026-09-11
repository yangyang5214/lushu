import type { SearchHit } from '../types'
import { searchGazetteer } from './gazetteer'

type PhotonFeature = {
  geometry: { coordinates: [number, number] }
  properties: {
    name?: string
    street?: string
    city?: string
    district?: string
    county?: string
    state?: string
    country?: string
  }
}

type NominatimHit = {
  lat: string
  lon: string
  display_name: string
  name?: string
}

function labelOf(props: PhotonFeature['properties']): { name: string; address: string } {
  const name = props.name || props.street || props.city || '未命名地点'
  const parts = [props.district, props.city, props.county, props.state, props.country].filter(
    (part, i, arr) => part && arr.indexOf(part) === i && part !== name,
  )
  return { name, address: parts.join(' · ') }
}

function dedupe(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>()
  const out: SearchHit[] = []
  hits.forEach((hit) => {
    const key = `${hit.name}|${hit.lng.toFixed(3)}|${hit.lat.toFixed(3)}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(hit)
  })
  return out
}

async function searchPhoton(q: string): Promise<SearchHit[]> {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8`
  const res = await fetch(url)
  if (!res.ok) throw new Error('photon')
  const data = (await res.json()) as { features?: PhotonFeature[] }
  return (data.features ?? []).map((f) => {
    const [lng, lat] = f.geometry.coordinates
    const { name, address } = labelOf(f.properties)
    return { name, address, lng, lat }
  })
}

async function searchNominatim(q: string): Promise<SearchHit[]> {
  // 走 Worker 代理：满足 Nominatim 的 User-Agent 政策，并在边缘缓存 7 天。
  const url = `/api/geocode?q=${encodeURIComponent(q)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error('nominatim')
  const data = (await res.json()) as NominatimHit[]
  return data.map((row) => {
    const parts = row.display_name.split(',').map((s) => s.trim())
    return {
      name: row.name || parts[0] || q,
      address: parts.slice(1, 4).join(' · '),
      lng: Number(row.lon),
      lat: Number(row.lat),
    }
  })
}

export async function searchPlaces(query: string): Promise<SearchHit[]> {
  const q = query.trim()
  if (q.length < 1) return []
  const local = searchGazetteer(q)
  const remote = await Promise.allSettled([searchPhoton(q), searchNominatim(q)])
  const extra = remote.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
  return dedupe([...local, ...extra]).slice(0, 10)
}
