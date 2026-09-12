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
