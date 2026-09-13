// 扩展配置：全部存在 chrome.storage.local（DeepSeek Key 只在本机浏览器里）。
// 所有可调项都有默认值，getConfig() 返回的是「默认值 + 用户覆盖」。

export const DEFAULTS = {
  // ── DeepSeek ──────────────────────────────────────────────────────────────
  deepseekKey: '',
  deepseekBase: 'https://api.deepseek.com',
  deepseekModel: 'deepseek-chat',

  // ── 小红书 ────────────────────────────────────────────────────────────────
  // 只有一条路：打开首页 → 搜索框输入关键词 → 点「问点点」→ 读回答。
  xhsHomeUrl: 'https://www.xiaohongshu.com/explore',
  /** 抓取时是否把小红书标签页切到前台（输入/点击需要焦点，默认打开）。 */
  xhsOpenActive: true,
  /** 抓完是否保留标签页（调试用）。 */
  xhsKeepTab: false,
  /** 等待点点回答的时间（毫秒）。 */
  xhsTimeoutMs: 120000,
  /** 输入关键词后，等「问点点」入口出现的时间（毫秒）。 */
  dianWaitMs: 8000,
  /** 页面选择器：小红书改版后可在设置页改，不用重新打包。逗号分隔。 */
  inputSelectors:
    'input[placeholder*="搜索小红书"], input[placeholder*="搜索"], input#search-input, header input[type="text"]',
  dianEntrySelectors: '',
  sendSelectors: 'button[type="submit"], [class*="send"], [aria-label*="发送"]',
  answerSelectors: '[class*="markdown"], [class*="message"], [class*="answer"]',

  /** 生成方式：xhs（问点点再提取）/ deepseek（按路书名直接生成）。 */
  sourceMode: 'xhs',

  // ── 路书写入 ──────────────────────────────────────────────────────────────
  /** 写入后路书的可见性：private（默认）/ public。 */
  visibility: 'private',
  maxPlaces: 30,
}

export async function getConfig() {
  const stored = await chrome.storage.local.get(DEFAULTS)
  return { ...DEFAULTS, ...stored }
}

export async function setConfig(patch) {
  await chrome.storage.local.set(patch)
}

/** 把逗号 / 换行分隔的选择器字符串切成数组。 */
export function splitList(value) {
  return String(value ?? '')
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}
