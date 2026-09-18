import type { LoopDir } from '../shared/geo'

export type Place = {
  id: string
  name: string
  address: string
  lng: number
  lat: number
  /** 自定义备注：停车、门票、联系人等出发前想记下的话。可选，老数据没有。 */
  note?: string
}

/** 地点备注字数上限：只记一句话（停车、门票、联系人…），界面与 store 都按它截断。 */
export const PLACE_NOTE_MAX = 20

/** 路书可见性：默认私密；设为 public 后出现在「公开路书」页。 */
export type Visibility = 'public' | 'private'

export type Book = {
  id: string
  title: string
  startDate: string
  visibility: Visibility
  places: Place[]
  startId: string | null
  endId: string | null
  orderedIds: string[]
  splitIds: string[]
  /** 环线绕行方向；未设置时用优化器默认解。非环线忽略。 */
  loopDir?: LoopDir
  /** 高德驾车总里程（公里）；与 driveKey 一起存，路线变了就作废。 */
  driveKm?: number
  /** 高德驾车总时长（分钟）。 */
  driveMin?: number
  /** 算出 driveKm 时的坐标 / 切天指纹，对不上就当没数。 */
  driveKey?: string
  createdAt: number
  updatedAt: number
}

export type SearchHit = {
  name: string
  address: string
  lng: number
  lat: number
}

export type DayPlan = {
  index: number
  places: Place[]
  distanceKm: number
  driveMin: number
}

export type Journey = {
  title: string
  startDate: string
  places: Place[]
  start: Place | null
  end: Place | null
  ordered: Place[]
  isLoop: boolean
  ready: boolean
  splitIds: string[]
  days: DayPlan[]
  totalKm: number
  totalMin: number
  /** 驾车里程已齐：总统计 / 每天公里可以显示。 */
  driveReady: boolean
}
