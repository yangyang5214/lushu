/**
 * 「点地图看地点」卡片：点击地图任意一点时，那一点的高德地点。
 * 点中底图上的 POI 招牌时 JS API 直接给出 POI id，卡片就是那个点（和高德官网一样
 * 「点哪个是哪个」）；否则靠坐标推断（v3 geocode/regeo 的包含面 + v5 place/around
 * 的周边检索）。前后端共用，前端只负责画，字段裁剪都在服务端做。
 *
 * 坐标是 GCJ02 —— 高德底图 / 高德 Web 服务的坐标系，与 shared/coords.ts 里
 * 「落库一律 WGS84」的约定不同。这里只用来展示（打点、拼高德链接），不回写路书。
 */
export type PoiCard = {
  /** 高德 POI id，例如 `B00155L7QD`。 */
  id: string
  name: string
  /** 省 · 市 · 区 · 街道；认不出结构时为空串。 */
  address: string
  /** 高德分类的最后一级，如「国家级景点」；没有则空串。 */
  category: string
  /** 高德 POI 详情页：完整评价在那里看。 */
  url: string
  /** 到点击处的直线距离（米）。 */
  distance: number
  /** GCJ02 经度。 */
  lng: number
  /** GCJ02 纬度。 */
  lat: number
  /** 高德评分，如 `"4.7"`；没评分是空串。 */
  rating: string
  /** 人均消费（元），如 `"57.00"`；没有则空串。 */
  cost: string
  /** 电话，可能多号用 `;` 分隔。 */
  tel: string
  /** 标签（高德 keytag / tag），去重后最多 6 个。 */
  tags: string[]
  /** 今日营业时间，如 `"09:00-17:30"`。 */
  opentimeToday: string
  /** 一周营业时间（可能很长，含节假日说明）。 */
  opentimeWeek: string
  /** 高德 POI 图片（大多是用户评价图），最多 9 张，一律 https。 */
  photos: string[]
}
