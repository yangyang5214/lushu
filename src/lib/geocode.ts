import type { SearchHit } from '../types'
import { searchGazetteer } from './gazetteer'

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
  // 唯一远端搜索：Worker 里的高德 POI 检索，服务端已把 GCJ02 转回 WGS84。
  const res = await fetch(`/api/places?q=${encodeURIComponent(q)}`)
  if (!res.ok) throw new Error('amap')
  const data = (await res.json()) as SearchHit[]
  if (!Array.isArray(data)) throw new Error('amap')
  return data.filter((hit) => Number.isFinite(hit.lng) && Number.isFinite(hit.lat))
}

export async function searchPlaces(query: string): Promise<SearchHit[]> {
  const q = query.trim()
  if (q.length < 1) return []
  const local = searchGazetteer(q)

  // 只用高德：没配 key / 限流失败时退回本地地名库，不再回落到其他地图服务。
  let amap: SearchHit[] = []
  try {
    amap = await searchAmap(q)
  } catch {
    amap = []
  }
  return dedupe([...local, ...amap]).slice(0, 25)
}
