import L from 'leaflet'
import type { Lang } from './i18n'

/** 高德栅格底图（无需 JS API key），语言跟随界面语言（zh_cn / en）。 */
export function tileUrl(lang: Lang): string {
  return `https://webrd0{s}.is.autonavi.com/appmaptile?lang=${lang === 'en' ? 'en' : 'zh_cn'}&size=1&scale=1&style=8&x={x}&y={y}&z={z}`
}

export const TILE_SUBDOMAINS = '1234'

/** 圆点标记：起点 / 终点显示文字徽标，其余显示序号。 */
export function markerHtml(label: string, color: string, active = false): string {
  return `<div class="pin${active ? ' on' : ''}" style="--ink:${color}"><span>${label}</span></div>`
}

type LatLng = [number, number]

/** 路线方向标：折线上取的点 + 朝向（顺时针角度，0 = 正北）。 */
export type RouteArrow = { lat: number; lng: number; angle: number }

/** 屏幕上两个方向标识的间距（像素）：按屏幕距离放，长线短线、几天都一个密度。 */
const ARROW_GAP_PX = 58
/** 一条线最多几个，防止极长线在低缩放下堆成一条白带。 */
const ARROW_MAX = 120

/**
 * 沿折线（Leaflet 的 [lat, lng]）等距取方向标。距离按当前缩放的像素算，
 * 所以同一屏里不同长度、不同天的路线看起来密度一致；太短（不足 1.5 个间距）不放。
 */
export function routeArrows(map: L.Map, latlngs: LatLng[]): RouteArrow[] {
  if (latlngs.length < 2) return []
  const pts = latlngs.map(([lat, lng]) => map.latLngToLayerPoint(L.latLng(lat, lng)))
  const cum: number[] = [0]
  for (let i = 1; i < pts.length; i += 1) {
    cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]))
  }
  const total = cum[cum.length - 1]
  if (total < ARROW_GAP_PX) return []

  // 个数向下取整，再均匀分布：间距落在 GAP/2 ~ GAP 之间，不会比别的线密一截。
  const count = Math.min(ARROW_MAX, Math.max(1, Math.floor(total / ARROW_GAP_PX)))
  const out: RouteArrow[] = []
  let seg = 0
  for (let k = 1; k <= count; k += 1) {
    const target = (total * k) / (count + 1)
    while (seg < cum.length - 2 && cum[seg + 1] < target) seg += 1
    const a = pts[seg]
    const b = pts[seg + 1]
    const len = cum[seg + 1] - cum[seg]
    const t = len > 0 ? (target - cum[seg]) / len : 0
    // 朝向跨两段取：单个极短路段的角度噪声很大。
    const from = pts[Math.max(0, seg - 1)]
    const to = pts[Math.min(pts.length - 1, seg + 2)]
    const ll = map.layerPointToLatLng(
      L.point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t),
    )
    out.push({
      lat: ll.lat,
      lng: ll.lng,
      angle: (Math.atan2(to.x - from.x, from.y - to.y) * 180) / Math.PI,
    })
  }
  return out
}

/** 路线上的方向标识：白色双尖角（《 形），尺寸压在线宽（5.5px）以内，不盖住线路。 */
export function arrowIcon(angle: number): L.DivIcon {
  return L.divIcon({
    className: 'arrow-wrap',
    html:
      `<div class="route-arrow" style="transform:rotate(${angle.toFixed(1)}deg)">` +
      '<svg viewBox="0 0 8 8" aria-hidden="true">' +
      '<path d="M1.8 4.6 4 1.8 6.2 4.6"/>' +
      '<path d="M1.8 6.8 4 4 6.2 6.8"/>' +
      '</svg></div>',
    iconSize: [8, 8],
    iconAnchor: [4, 4],
  })
}

export type RouteArrowLayer = { set(lines: LatLng[][]): void; remove(): void }

/**
 * 方向标识图层：缩放结束后按新的像素比例重算，
 * 所以拉近拉远、换不同长度的路书，屏幕上的间距都差不多。
 */
export function createArrowLayer(map: L.Map): RouteArrowLayer {
  const group = L.layerGroup().addTo(map)
  let lines: LatLng[][] = []
  let frame = 0

  const render = () => {
    group.clearLayers()
    lines.forEach((line) => {
      routeArrows(map, line).forEach((a) => {
        L.marker([a.lat, a.lng], { icon: arrowIcon(a.angle), interactive: false }).addTo(group)
      })
    })
  }

  const onZoomEnd = () => {
    if (frame) return
    frame = window.requestAnimationFrame(() => {
      frame = 0
      render()
    })
  }
  map.on('zoomend', onZoomEnd)

  return {
    set(next) {
      lines = next
      render()
    },
    remove() {
      map.off('zoomend', onZoomEnd)
      if (frame) window.cancelAnimationFrame(frame)
      group.remove()
    },
  }
}
