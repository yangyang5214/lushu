import type { SearchHit } from '../types'
import { searchGazetteer } from './gazetteer'
import { t } from './i18n'

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
  const name = props.name || props.street || props.city || t('search.unknownPlace')
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

async function searchAmap(q: string): Promise<SearchHit[]> {
  // 首选：Worker 里的高德 POI 检索，服务端已把 GCJ02 转回 WGS84。
  const res = await fetch(`/api/places?q=${encodeURIComponent(q)}`)
  if (!res.ok) throw new Error('amap')
  const data = (await res.json()) as SearchHit[]
  if (!Array.isArray(data)) throw new Error('amap')
  return data.filter((hit) => Number.isFinite(hit.lng) && Number.isFinite(hit.lat))
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

  // 优先高德；没配 key / 限流失败 / 连高德都没有结果时，才回落到 Photon + Nominatim。
  let amap: SearchHit[] | null = null
  try {
    amap = await searchAmap(q)
  } catch {
    amap = null
  }
  if (amap === null || (amap.length === 0 && local.length === 0)) {
    const remote = await Promise.allSettled([searchPhoton(q), searchNominatim(q)])
    const extra = remote.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    return dedupe([...local, ...extra]).slice(0, 10)
  }
  return dedupe([...local, ...amap]).slice(0, 10)
}
