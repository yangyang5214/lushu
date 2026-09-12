// WGS84 → GCJ02（国测局坐标，高德/腾讯底图用）。
//
// 前端、Pages Function 和本地 Vite 代理都要用，所以放在共享目录：
// src/ 与 functions/ 都不反向依赖对方的运行时文件。

const PI = Math.PI
const A = 6378245
const EE = 0.00669342162296594323

function outOfChina(lng: number, lat: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function transformLat(lng: number, lat: number): number {
  let r = -100 + 2 * lng + 3 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng))
  r += ((20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2) / 3
  r += ((20 * Math.sin(lat * PI) + 40 * Math.sin((lat / 3) * PI)) * 2) / 3
  r += ((160 * Math.sin((lat / 12) * PI) + 320 * Math.sin((lat * PI) / 30)) * 2) / 3
  return r
}

function transformLng(lng: number, lat: number): number {
  let r = 300 + lng + 2 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng))
  r += ((20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2) / 3
  r += ((20 * Math.sin(lng * PI) + 40 * Math.sin((lng / 3) * PI)) * 2) / 3
  r += ((150 * Math.sin((lng / 12) * PI) + 300 * Math.sin((lng / 30) * PI)) * 2) / 3
  return r
}

/** 偏移量本身是坐标的连续函数：先按猜测点算一次偏移，差值迭代几次即可收敛到米级以内。 */
export function gcj02ToWgs84(lng: number, lat: number): [number, number] {
  if (outOfChina(lng, lat)) return [lng, lat]
  let wlng = lng
  let wlat = lat
  for (let i = 0; i < 3; i += 1) {
    const [glng, glat] = wgs84ToGcj02(wlng, wlat)
    wlng += lng - glng
    wlat += lat - glat
  }
  return [wlng, wlat]
}

/** WGS84 经纬度 → GCJ02 [lng, lat]。 */
export function wgs84ToGcj02(lng: number, lat: number): [number, number] {
  if (outOfChina(lng, lat)) return [lng, lat]
  let dLat = transformLat(lng - 105, lat - 35)
  let dLng = transformLng(lng - 105, lat - 35)
  const rad = (lat / 180) * PI
  let magic = Math.sin(rad)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI)
  dLng = (dLng * 180) / ((A / sqrtMagic) * Math.cos(rad) * PI)
  return [lng + dLng, lat + dLat]
}
