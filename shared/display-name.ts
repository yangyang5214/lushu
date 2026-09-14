// 展示昵称：前端提示与 Pages Function 校验共用一份。
// 按 Unicode 码点计数（一个汉字 / 字母 / emoji 都算 1），不按 UTF-16 单元。
// 昵称不做唯一约束，允许和其他人重复。
//
// 规则：2–20 个 Unicode 字符，只允许中文、英文、数字和 _ - .，
// 不允许空格、换行、控制字符，也不允许纯空白。

export const MIN_DISPLAY_NAME = 2
export const MAX_DISPLAY_NAME = 20

export type DisplayNameError =
  | 'empty_display_name'
  | 'display_name_too_short'
  | 'display_name_too_long'
  | 'invalid_display_name'

/**
 * 单个允许的字符：中日韩汉字（含扩展区）、拉丁字母（含重音等变体）、
 * 十进制数字、下划线 / 连字符 / 点。其余（空格、换行、控制字符、其它符号、
 * emoji）一律不允许。
 */
const ALLOWED_CHAR_RE = /[\p{Script=Han}\p{Script=Latin}\p{Nd}_.-]/u

/** 该字符是否可以出现在昵称里。 */
export function isAllowedDisplayNameChar(ch: string): boolean {
  return ALLOWED_CHAR_RE.test(ch)
}

export function displayNameLength(name: string): number {
  return [...name].length
}

/** 只留允许的字符；不做长度截断。 */
export function sanitizeDisplayNameChars(raw: string): string {
  return [...raw].filter(isAllowedDisplayNameChar).join('')
}

/** 去掉首尾空白；不做截断，截断交给输入框或校验报错。 */
export function normalizeChosenDisplayName(raw: unknown): string {
  return String(raw ?? '').trim()
}

export function validateDisplayName(name: string): DisplayNameError | null {
  if (!name) return 'empty_display_name'
  if (sanitizeDisplayNameChars(name) !== name) return 'invalid_display_name'
  const len = displayNameLength(name)
  if (len < MIN_DISPLAY_NAME) return 'display_name_too_short'
  if (len > MAX_DISPLAY_NAME) return 'display_name_too_long'
  return null
}

/**
 * 输入时收敛：过滤掉不允许的字符，并硬截到上限。
 * 老账号若已超过上限，只允许往短了改，不突然截断。
 *
 * 注意：不要在输入法组合（IME）过程中调用，否则会把还在拼的中文打断；
 * 组合结束后再调用一次即可。
 */
export function limitDisplayNameInput(prev: string, incoming: string): string {
  const cleaned = sanitizeDisplayNameChars(incoming)
  if (displayNameLength(cleaned) <= MAX_DISPLAY_NAME) return cleaned
  if (displayNameLength(cleaned) < displayNameLength(prev)) return cleaned
  return displayNameLength(prev) > MAX_DISPLAY_NAME
    ? prev
    : [...cleaned].slice(0, MAX_DISPLAY_NAME).join('')
}
