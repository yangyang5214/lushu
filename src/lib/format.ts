/** 日期展示：数字时间戳或 `YYYY-MM-DD` 都吃。 */
export function fmtDay(value: number | string): string {
  if (!value) return '未定日期'
  const d = typeof value === 'number' ? new Date(value) : new Date(`${value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return String(value)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}
