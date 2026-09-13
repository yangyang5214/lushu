type FitFn = () => Promise<void>

let fitFn: FitFn | null = null

/** 编辑页地图挂上时登记，导出前用来把所有地点收进视野。 */
export function registerMapFit(fn: FitFn | null): void {
  fitFn = fn
}

export function fitMapPlaces(): Promise<void> {
  return fitFn?.() ?? Promise.resolve()
}
