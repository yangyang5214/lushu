// 口令规则：前端提示与 Pages Function 校验共用一份，避免两边门槛不一致。
//
// 允许的字符：ASCII 字母、数字与可见特殊字符（`!` 到 `~`，即 0x21–0x7E）。
// 不支持中文等非 ASCII 字符，也不允许空格。

export const MIN_PASSWORD = 8
export const MAX_PASSWORD = 128

/** 口令只允许可见 ASCII：字母、数字、特殊字符。 */
export const PASSWORD_RE = /^[!-~]+$/

/** 是否含不允许的字符（中文、空格、emoji、控制字符等）。 */
export function hasInvalidPasswordChars(password: string): boolean {
  return !PASSWORD_RE.test(password)
}

export type PasswordStrength = 'weak' | 'fair' | 'strong'

/**
 * 强度分级（只用于注册页提示，不作准入门槛）：
 *   · strong：≥ MIN_PASSWORD 位，且字母 / 数字 / 特殊字符三类都有；
 *   · fair：长度够，但只凑齐两类；
 *   · weak：长度不够，或只有一类字符。
 */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length < MIN_PASSWORD) return 'weak'
  const hasLetter = /[A-Za-z]/.test(password)
  const hasDigit = /[0-9]/.test(password)
  const hasSymbol = /[^A-Za-z0-9]/.test(password)
  if (hasLetter && hasDigit && hasSymbol) return 'strong'
  return hasLetter && hasDigit ? 'fair' : 'weak'
}
