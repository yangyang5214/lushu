/** 可以下发给浏览器的公开配置（本来就会出现在前端）。 */

export type PublicConfig = {
  /** 高德「Web端(JS API)」key。空字符串 = 未配置，地图不渲染。 */
  amapJsKey: string
  /** 可选：JS API 2.0 安全密钥。 */
  amapSecurityCode: string
}
