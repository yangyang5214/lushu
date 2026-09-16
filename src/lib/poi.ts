import type { PoiCard } from '../../shared/poi'

export type { PoiCard }

/** 一次「点地图」请求：坐标是 GCJ02（底图坐标系）。 */
export type PoiQuery = {
  lng: number
  lat: number
  /** 点击时的地图级别：服务端据此决定搜索半径，视野越远半径越大。 */
  zoom: number
  /**
   * 点在底图的 POI 招牌上时，JS API（`hotspotclick`）直接给的 POI id。
   * 带着它就出那个点本身（"点哪个是哪个"），不用靠坐标猜。
   */
  id?: string
}

/**
 * 点击地图某点 → 那一点的高德地点（评分 / 图片 / 电话 / 营业时间）。
 * 服务端把高德原始响应裁成 PoiCard，并按距离升序返回，最近的排第一。
 * 失败时抛错，由卡片自己提示；搜不到地点时返回空数组。
 */
export async function fetchPoi({ lng, lat, zoom, id }: PoiQuery, signal?: AbortSignal): Promise<PoiCard[]> {
  const params = new URLSearchParams({
    lng: lng.toFixed(6),
    lat: lat.toFixed(6),
    z: String(Math.round(zoom)),
  })
  if (id) params.set('id', id)
  const res = await fetch(`/api/poi?${params.toString()}`, { signal })
  if (!res.ok) throw new Error(`poi ${res.status}`)
  const data = (await res.json()) as { pois?: PoiCard[] }
  return Array.isArray(data.pois) ? data.pois : []
}
