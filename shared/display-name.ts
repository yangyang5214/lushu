// 展示昵称：前端提示与 Pages Function 校验共用一份。
// 按 Unicode 码点计数（一个汉字 / 字母 / emoji 都算 1），不按 UTF-16 单元。
// 昵称不做唯一约束，允许和其他人重复。

export const MAX_DISPLAY_NAME = 5

export type DisplayNameError = 'empty_display_name' | 'display_name_too_long'

export function displayNameLength(name: string): number {
  return [...name].length
}

/** 去掉首尾空白；不做截断，截断交给输入框或校验报错。 */
export function normalizeChosenDisplayName(raw: unknown): string {
  return String(raw ?? '').trim()
}

export function validateDisplayName(name: string): DisplayNameError | null {
  if (!name) return 'empty_display_name'
  if (displayNameLength(name) > MAX_DISPLAY_NAME) return 'display_name_too_long'
  return null
}

/** 输入时硬截到上限。老账号若已超过上限，只允许往短了改，不突然截断。 */
export function limitDisplayNameInput(prev: string, incoming: string): string {
  const nextLen = displayNameLength(incoming)
  if (nextLen <= MAX_DISPLAY_NAME) return incoming
  if (nextLen < displayNameLength(prev)) return incoming
  return displayNameLength(prev) > MAX_DISPLAY_NAME
    ? prev
    : [...incoming].slice(0, MAX_DISPLAY_NAME).join('')
}
