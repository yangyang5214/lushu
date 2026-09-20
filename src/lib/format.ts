import { getLang, t } from './i18n'

/** 日期展示：数字时间戳或 `YYYY-MM-DD` 都吃。按当前语言格式化。 */
export function fmtDay(value: number | string): string {
  if (!value) return t('date.none')
  const d = typeof value === 'number' ? new Date(value) : new Date(`${value}T00:00:00`)
  if (Number.isNaN(d.getTime())) return String(value)
  if (getLang() === 'en') {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 出发日 + 第几天 = 当天日期（`offset` 从 0 起）；没有出发日或日期非法时返回空串。 */
export function fmtDayOffset(startDate: string, offset: number): string {
  if (!startDate) return ''
  const d = new Date(`${startDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  d.setDate(d.getDate() + offset)
  return fmtDay(d.getTime())
}
