// 轻量文案层：简体中文 / English。
//
// 设计：
//   · 不用外部依赖，一张扁平的 key → 文案表，`{name}` 占位符插值。
//   · 语言存在 zustand（persist 到 localStorage），组件用 useI18n() 订阅，
//     非组件代码（fmtDay / formatKm / authErrorText 等）用全局 t()。
//   · 首次访问按浏览器语言猜：zh* → 中文，其余 → 英文；之后记住用户的选择。

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Lang = 'zh' | 'en'

const zh = {
  // ── 通用 ─────────────────────────────────────────────────────────────────
  'common.backendUnavailable':
    '连不上后端：请确认已配置 wrangler.toml 并运行 pnpm pages:dev，或已完成部署。',
  'common.untitled': '未命名路书',
  'common.cancel': '取消',
  'common.delete': '删除',
  'common.loading': '正在加载…',
  'common.anonymous': '匿名',
  'common.none': '—',

  // ── 语言切换 ─────────────────────────────────────────────────────────────
  'lang.label': '切换语言',
  'lang.zh': '简体中文',
  'lang.en': 'English',

  // ── 页头 / 导航 ───────────────────────────────────────────────────────────
  'nav.mine': '我的路书',
  'nav.public': '公开路书',
  'nav.account': '账户',
  'nav.serviceDown': '服务不可用',
  'nav.accountTitle': '账户 · {email}',

  // ── 搜索 ─────────────────────────────────────────────────────────────────
  'search.placeholder': '搜索添加新目的地',
  'search.unknownPlace': '未命名地点',
  'search.noResults': '没有找到，试试更具体的地名',
  'search.offline': '在线搜索暂时不可用，请稍后再试',
  'map.fit': '回到全览',

  // ── 编辑页侧栏 ───────────────────────────────────────────────────────────
  'sidebar.back': '返回上一页',
  'sidebar.titlePlaceholder': '未命名路书',
  'sidebar.routeName': '路线名',
  'sidebar.day': '第{n}天',
  'sidebar.startBadge': '起',
  'sidebar.endBadge': '终',
  'sidebar.setStart': '起点',
  'sidebar.setEnd': '终点',
  'sidebar.hintEmpty': '搜索添加地点，再设起点和终点。起终点相同即为环线。',
  'sidebar.hintReady': '设好起点和终点后，其余点会按路程串成一条线。',
  'sidebar.export': '导出图片',
  'sidebar.exporting': '导出中…',
  'sidebar.exportFail': '导出失败，请重试',

  // ── 里程 / 时间 ──────────────────────────────────────────────────────────
  'unit.meters': '{n}米',
  'unit.km': '{n}公里',
  'eta.minutes': '约{n}分钟',
  'eta.hours': '约{n}小时',
  'eta.hoursMinutes': '约{h}小时{m}分钟',

  // ── 行程尺 ───────────────────────────────────────────────────────────────
  'rail.title': '行程尺',
  'rail.empty':
    '定好起点和终点后，整条路会铺在这根尺上。分割针钉在过夜的点上，可左右拖动改天数。',
  'rail.returnBadge': '回',
  'rail.startBadge': '起',
  'rail.endBadge': '终',
  'rail.nightBadge': '夜',
  'rail.day': '第{n}天 · {km}',
  'rail.dir': '环线方向',
  'rail.dirCw': '顺',
  'rail.dirCwTitle': '顺时针',
  'rail.dirCcw': '逆',
  'rail.dirCcwTitle': '逆时针',
  'rail.statsLabel': '总统计',
  'rail.statDays': '天数',
  'rail.statPlaces': '地点',
  'rail.statKm': '总里程',
  'rail.statTime': '驾驶时长',

  // ── 首页 ─────────────────────────────────────────────────────────────────
  'home.heroTitle1': '想去的都加进来，',
  'home.heroTitle2': '顺序自动排，按天好规划',
  'home.lede':
    '不用纠结先去哪、第几天走哪段。地点搜进来就好，路书按路程串联所有点；在过夜处钉分割针，行程自动分成一天天',
  'home.newBook': '新建路书',
  'home.seePublic': '看看公开路书',
  'home.flowHeading': '三步搞定行程',
  'home.flowSub': '先加点，再串线，最后分天——顺序不用你操心。',
  'home.featuresHeading': '还有这些',
  'home.featuresSub': '地图、书架与分享，写完之后随时查看和发布。',

  'flow.1.key': '地点',
  'flow.1.title': '随意加点',
  'flow.1.text':
    '城市、寺庙、老街、营地，想到什么就加什么。不用管顺序，也不用先想第几天。',
  'flow.2.key': '路线',
  'flow.2.title': '自动串线',
  'flow.2.text':
    '所有地点按路程自动排成合理顺序。需要的话还能钉起终点，起终点相同就是环线。',
  'flow.3.key': '天数',
  'flow.3.title': '过夜分天',
  'flow.3.text':
    '在任意地点设过夜分割针，行程自动分成第几天。拖动分割针还能调整每天走多远。',

  'feature.1.key': '地图',
  'feature.1.title': '地图按天画路',
  'feature.1.text':
    '地图按天着色，画出当天要走的路，点与点之间标出大概路程和时间。',
  'feature.2.key': '书架',
  'feature.2.title': '我的路书',
  'feature.2.text':
    '写过的路书都在书架上，可复制、可改名，也可设为仅自己可见。',
  'feature.3.key': '公开',
  'feature.3.title': '公开路书',
  'feature.3.text':
    '公开后出现在「公开路书」里，别人用链接也能看完整路线和每天行程。',

  // ── 路书卡片（我的 / 公开共用） ──────────────────────────────────────────
  'card.days': '{n} 天',
  'card.draft': '草稿',
  'card.loop': '环线',
  'card.private': '仅自己可见',
  'card.placesUnit': '个地点',
  'card.kmUnit': '公里',
  'card.updatedAt': '更新于 {date}',
  'card.noEnds': '未设起点与终点',
  'card.loopFrom': '{from} 出发 · 环线',
  'card.noPlaces': '还没有地点',
  'card.fromTo': '{from} → {to}',
  'card.copy': '复制',
  'card.copying': '复制中…',
  'card.copySuffix': '{title} 副本',

  // ── 我的路书 ─────────────────────────────────────────────────────────────
  'mine.heading': '我的路书',
  'mine.newBook': '新建路书',
  'mine.syncing': '正在同步路书…',
  'mine.empty': '还没有自己的路书',
  'mine.makePublic': '设为公开',
  'mine.makePrivate': '设为私密',
  'mine.confirmDelete': '确认删除',

  // ── 公开路书 ─────────────────────────────────────────────────────────────
  'public.heading': '公开路书',
  'public.count': '{n} 本',
  'public.empty': '还没有公开的路书',

  // ── 账号 / 登录 ──────────────────────────────────────────────────────────
  'auth.serviceDownTitle': '连不上服务',
  'auth.retry': '重试',
  'auth.checkEmailTitle': '查收激活邮件',
  'auth.checkEmailBefore': '我们已向 ',
  'auth.checkEmailAfter':
    ' 发送了一封激活邮件，请点击邮件中的链接完成注册。链接 24 小时内有效。',
  'auth.sending': '发送中…',
  'auth.resendPrompt': '没收到？重新发送',
  'auth.haveAccount': '已经有账号了？',
  'auth.goLogin': '去登录',
  'auth.tabLogin': '登录',
  'auth.tabRegister': '注册',
  'auth.email': '邮箱',
  'auth.password': '密码',
  'auth.passwordPlaceholder': '至少 {min} 位',
  'auth.resend': '重发激活邮件',
  'auth.busy': '请稍候…',
  'auth.noAccount': '还没有账号？',
  'auth.registerNow': '立即注册',
  'auth.resendDone': '激活邮件已重新发送，请查收。',
  'auth.activateExpired': '激活链接已过期，请重新注册或重发激活邮件。',
  'auth.activateInvalid': '激活链接无效，请重新注册或重发激活邮件。',
  'auth.showPassword': '显示密码',
  'auth.hidePassword': '隐藏密码',
  'auth.pwWeak': '强度：弱',
  'auth.pwFair': '强度：中',
  'auth.pwStrong': '强度：强',
  'auth.pwInvalid': '只能用字母、数字和特殊字符',

  'account.email': '登录邮箱',
  'account.userId': '用户 ID',
  'account.joined': '注册时间',
  'account.signOut': '退出登录',
  'account.checking': '正在确认登录状态…',
  'account.editNickname': '修改昵称',

  'err.invalid_credentials': '邮箱或密码不对',
  'err.invalid_email': '请输入有效的邮箱地址',
  'err.email_taken': '这个邮箱已经注册过了，直接登录即可',
  'err.email_not_activated': '账号尚未激活，请查收邮件并点击激活链接',
  'err.weak_password': '密码需 {min}–{max} 位',
  'err.invalid_password': '密码只能用字母、数字和特殊字符（不支持中文和空格）',
  'err.activation_cooldown': '发送太频繁，请稍后再试',
  'err.activation_rate_limit': '该邮箱今日发信次数已达上限，请稍后再试',
  'err.email_failed': '激活邮件发送失败，请稍后再试',
  'err.turnstile_required': '请先完成人机验证',
  'err.turnstile_failed': '人机验证失败，请重试',
  'err.rate_limited': '操作太频繁，请稍后再试',
  'err.empty_display_name': '请填写昵称',
  'err.display_name_too_long': '昵称最多 {max} 个字',
  'err.unauthorized': '登录已失效，请重新登录',
  'err.network': '网络不可用，账号暂时用不了',
  'err.generic': '出了点问题，请重试',

  // ── 日期 ─────────────────────────────────────────────────────────────────
  'date.none': '未定日期',

  // ── 示意图（首页首屏） ───────────────────────────────────────────────────
  'diagram.add': '随意添加',
  'diagram.route': '自动串联',
  'diagram.split': '过夜分天',
  'diagram.search': '搜地点…',
  'diagram.ruler': '行程尺',
  'diagram.night': '夜',
  'diagram.hangzhou': '杭州',
  'diagram.qiandaohu': '千岛湖',
  'diagram.huangshan': '黄山',
  'diagram.hongcun': '宏村',
  'diagram.jingdezhen': '景德镇',
  'diagram.day1': '第1天 · 286 km',
  'diagram.day2': '第2天 · 198 km',

  // ── 文档 ─────────────────────────────────────────────────────────────────
  'meta.title': '路书 · 随意加点，自动串线与分天',
} as const

export type MsgKey = keyof typeof zh

// 管理后台只用中文，不跟随站点语言，因此独立于上面的双语表。
const adminZh = {
  'admin.title': '管理后台',
  'admin.brand': '管理',
  'admin.overview': '概览',
  'admin.users': '用户',
  'admin.books': '路书',
  'admin.userDetail': '用户详情',
  'admin.bookDetail': '路书详情',
  'admin.login': '登录',
  'admin.disabled':
    '管理功能未启用：请在 wrangler.toml 的 [vars] 或 .dev.vars 中设置 ADMIN_SECRET（至少 6 字符），然后重启 Worker。',
  'admin.enterPrompt': '请输入管理员口令以继续。',
  'admin.passphrase': '管理员口令',
  'admin.verifying': '验证中…',
  'admin.enter': '进入',
  'admin.wrongPassphrase': '口令不正确',
  'admin.checking': '正在确认权限…',
  'admin.statUsers': '注册用户',
  'admin.statBooks': '路书总数',
  'admin.statPublic': '公开路书',
  'admin.statPrivate': '私密路书',
  'admin.prevPage': '上一页',
  'admin.nextPage': '下一页',
  'admin.pageInfo': '第 {page} / {pages} 页（共 {total} 条）',
  'admin.deleting': '删除中…',
  'admin.confirmDelete': '确认删除',
  'admin.searchEmailPlaceholder': '搜索邮箱或昵称',
  'admin.searchBookPlaceholder': '搜索路书标题',
  'admin.search': '搜索',
  'admin.colId': 'ID',
  'admin.colEmail': '邮箱',
  'admin.colName': '昵称',
  'admin.colHashId': '公开 ID',
  'admin.colBooks': '路书',
  'admin.colStatus': '状态',
  'admin.colCreated': '注册时间',
  'admin.colActions': '操作',
  'admin.colTitle': '标题',
  'admin.colVisibility': '可见性',
  'admin.colPlaces': '地点',
  'admin.colOwner': '书主',
  'admin.colUpdated': '更新时间',
  'admin.colLink': '链接',
  'admin.activated': '已激活',
  'admin.pending': '待激活',
  'admin.allVisibility': '全部可见性',
  'admin.onlyPublic': '仅公开',
  'admin.onlyPrivate': '仅私密',
  'admin.withBooks': '连同 {n} 本路书',
  'admin.untitled': '（未命名）',
  'admin.visPublic': '公开',
  'admin.visPrivate': '私密',
  'admin.backUsers': '← 返回用户列表',
  'admin.backBooks': '← 返回路书列表',
  'admin.publicId': '公开 ID',
  'admin.internalOwner': '内部 owner_key',
  'admin.status': '状态',
  'admin.booksCount': '路书（{n}）',
  'admin.open': '打开',
  'admin.bookId': '路书 ID',
  'admin.placesCount': '地点数',
  'admin.createdUpdated': '创建 / 更新',
  'admin.rawData': '完整数据',
  'admin.copyJson': '复制 JSON',
  'admin.copied': '已复制',
  'admin.copyFailed': '复制失败',
  'admin.routeMap': '路线地图',
  'admin.backToSite': '返回站点',
  'admin.signOut': '退出登录',
} as const

export type AdminMsgKey = keyof typeof adminZh

const en: Record<MsgKey, string> = {
  'common.backendUnavailable':
    'Cannot reach the backend: make sure wrangler.toml is configured and run pnpm pages:dev, or deploy the project.',
  'common.untitled': 'Untitled Roadbook',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.loading': 'Loading…',
  'common.anonymous': 'Anonymous',
  'common.none': '—',

  'lang.label': 'Change language',
  'lang.zh': '简体中文',
  'lang.en': 'English',

  'nav.mine': 'My Roadbooks',
  'nav.public': 'Public Roadbooks',
  'nav.account': 'Account',
  'nav.serviceDown': 'Service unavailable',
  'nav.accountTitle': 'Account · {email}',

  'search.placeholder': 'Search and add a destination',
  'search.unknownPlace': 'Unnamed place',
  'search.noResults': 'Nothing found — try a more specific place',
  'search.offline': 'Search is temporarily unavailable, please try again later',
  'map.fit': 'Fit route',

  'sidebar.back': 'Go back',
  'sidebar.titlePlaceholder': 'Untitled Roadbook',
  'sidebar.routeName': 'Route name',
  'sidebar.day': 'Day {n}',
  'sidebar.startBadge': 'S',
  'sidebar.endBadge': 'E',
  'sidebar.setStart': 'Start',
  'sidebar.setEnd': 'End',
  'sidebar.hintEmpty':
    'Search to add places, then set a start and an end. The same start and end makes a loop.',
  'sidebar.hintReady':
    'Once a start and an end are set, the other stops are strung into a route by distance.',
  'sidebar.export': 'Export image',
  'sidebar.exporting': 'Exporting…',
  'sidebar.exportFail': 'Could not export. Please try again.',

  'unit.meters': '{n} m',
  'unit.km': '{n} km',
  'eta.minutes': '~{n} min',
  'eta.hours': '~{n} h',
  'eta.hoursMinutes': '~{h} h {m} min',

  'rail.title': 'Trip ruler',
  'rail.empty':
    'Once a start and an end are set, the whole route is laid out on this ruler. Overnight pins split it into days — drag them to change the day count.',
  'rail.returnBadge': 'R',
  'rail.startBadge': 'S',
  'rail.endBadge': 'E',
  'rail.nightBadge': 'N',
  'rail.day': 'Day {n} · {km}',
  'rail.dir': 'Loop direction',
  'rail.dirCw': 'CW',
  'rail.dirCwTitle': 'Clockwise',
  'rail.dirCcw': 'CCW',
  'rail.dirCcwTitle': 'Counter-clockwise',
  'rail.statsLabel': 'Trip totals',
  'rail.statDays': 'Days',
  'rail.statPlaces': 'Stops',
  'rail.statKm': 'Distance',
  'rail.statTime': 'Drive time',

  'home.heroTitle1': 'Add every place you want to go,',
  'home.heroTitle2': 'order sorts itself — day-by-day planning is easy',
  'home.lede':
    'Stop agonizing over where to go first or how far to drive each day. Just search in the places; the Roadbook links them by distance, and pins at overnight stops split the trip into days.',
  'home.newBook': 'New Roadbook',
  'home.seePublic': 'Browse public Roadbooks',
  'home.flowHeading': 'Plan a trip in three steps',
  'home.flowSub':
    'Add places, link them, then split into days — the order takes care of itself.',
  'home.featuresHeading': 'And more',
  'home.featuresSub':
    'Map, shelf and sharing — review and publish whenever you are done.',

  'flow.1.key': 'Places',
  'flow.1.title': 'Add freely',
  'flow.1.text':
    'Cities, temples, old streets, campsites — add anything that comes to mind. No need to worry about order or which day it lands on.',
  'flow.2.key': 'Route',
  'flow.2.title': 'Auto-linked',
  'flow.2.text':
    'Every place is ordered by distance automatically. Pin a start and an end if you like — the same start and end makes a loop.',
  'flow.3.key': 'Days',
  'flow.3.title': 'Split by night',
  'flow.3.text':
    'Drop an overnight pin at any stop and the trip splits into days. Drag the pins to change how far you drive each day.',

  'feature.1.key': 'Map',
  'feature.1.title': 'Routes colored by day',
  'feature.1.text':
    'The map colors each day differently and shows the approximate distance and time between stops.',
  'feature.2.key': 'Shelf',
  'feature.2.title': 'My Roadbooks',
  'feature.2.text':
    'Every Roadbook you write lives on the shelf — duplicate it, rename it, or keep it to yourself.',
  'feature.3.key': 'Public',
  'feature.3.title': 'Public Roadbooks',
  'feature.3.text':
    'Publish it and it appears under Public Roadbooks; anyone with the link can see the full route and each day of the trip.',

  'card.days': '{n} days',
  'card.draft': 'Draft',
  'card.loop': 'Loop',
  'card.private': 'Only me',
  'card.placesUnit': 'stops',
  'card.kmUnit': 'km',
  'card.updatedAt': 'Updated {date}',
  'card.noEnds': 'No start or end yet',
  'card.loopFrom': 'Loop from {from}',
  'card.noPlaces': 'No places yet',
  'card.fromTo': '{from} → {to}',
  'card.copy': 'Duplicate',
  'card.copying': 'Duplicating…',
  'card.copySuffix': '{title} copy',

  'mine.heading': 'My Roadbooks',
  'mine.newBook': 'New Roadbook',
  'mine.syncing': 'Syncing your Roadbooks…',
  'mine.empty': 'You have no Roadbooks yet',
  'mine.makePublic': 'Make public',
  'mine.makePrivate': 'Make private',
  'mine.confirmDelete': 'Confirm delete',

  'public.heading': 'Public Roadbooks',
  'public.count': '{n} Roadbooks',
  'public.empty': 'No public Roadbooks yet',

  'auth.serviceDownTitle': 'Cannot reach the service',
  'auth.retry': 'Retry',
  'auth.checkEmailTitle': 'Check your inbox',
  'auth.checkEmailBefore': 'We sent an activation email to ',
  'auth.checkEmailAfter':
    '. Click the link in the email to finish signing up. The link is valid for 24 hours.',
  'auth.sending': 'Sending…',
  'auth.resendPrompt': 'Did not get it? Resend',
  'auth.haveAccount': 'Already have an account?',
  'auth.goLogin': 'Sign in',
  'auth.tabLogin': 'Sign in',
  'auth.tabRegister': 'Sign up',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.passwordPlaceholder': 'At least {min} characters',
  'auth.resend': 'Resend activation email',
  'auth.busy': 'Please wait…',
  'auth.noAccount': 'Do not have an account?',
  'auth.registerNow': 'Sign up',
  'auth.resendDone': 'Activation email sent. Please check your inbox.',
  'auth.activateExpired':
    'The activation link has expired. Please register again or resend the activation email.',
  'auth.activateInvalid':
    'The activation link is invalid. Please register again or resend the activation email.',
  'auth.showPassword': 'Show password',
  'auth.hidePassword': 'Hide password',
  'auth.pwWeak': 'Strength: weak',
  'auth.pwFair': 'Strength: fair',
  'auth.pwStrong': 'Strength: strong',
  'auth.pwInvalid': 'Letters, digits and special characters only',

  'account.email': 'Email',
  'account.userId': 'User ID',
  'account.joined': 'Joined',
  'account.signOut': 'Sign out',
  'account.checking': 'Checking your session…',
  'account.editNickname': 'Edit nickname',

  'err.invalid_credentials': 'Wrong email or password',
  'err.invalid_email': 'Enter a valid email address',
  'err.email_taken': 'This email is already registered — just sign in',
  'err.email_not_activated':
    'Your account is not activated yet. Open the email and click the activation link.',
  'err.weak_password': 'Password must be {min}–{max} characters',
  'err.invalid_password':
    'Password may only use letters, digits and special characters (no Chinese characters or spaces)',
  'err.activation_cooldown': 'Too many requests — please try again later',
  'err.activation_rate_limit':
    'This email has hit the daily sending limit. Please try again later.',
  'err.email_failed': 'Could not send the activation email. Please try again later.',
  'err.turnstile_required': 'Please complete the human verification first',
  'err.turnstile_failed': 'Human verification failed — please try again',
  'err.rate_limited': 'Too many attempts — please try again later',
  'err.empty_display_name': 'Please enter a nickname',
  'err.display_name_too_long': 'Nickname can be at most {max} characters',
  'err.unauthorized': 'Your session has expired. Please sign in again.',
  'err.network': 'Network unavailable — the account is temporarily unusable',
  'err.generic': 'Something went wrong. Please try again.',

  'date.none': 'No date',

  'diagram.add': 'Add freely',
  'diagram.route': 'Auto-link',
  'diagram.split': 'Split by night',
  'diagram.search': 'Search…',
  'diagram.ruler': 'Trip ruler',
  'diagram.night': 'N',
  'diagram.hangzhou': 'Hangzhou',
  'diagram.qiandaohu': 'Qiandao Lake',
  'diagram.huangshan': 'Huangshan',
  'diagram.hongcun': 'Hongcun',
  'diagram.jingdezhen': 'Jingdezhen',
  'diagram.day1': 'Day 1 · 286 km',
  'diagram.day2': 'Day 2 · 198 km',

  'meta.title': 'Roadbook · Add places freely, auto-link and split into days',
}

const CATALOG: Record<Lang, Record<MsgKey, string>> = { zh, en }

export type TParams = Record<string, string | number>

function interpolate(template: string, params?: TParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  )
}

/** 首次访问按浏览器语言猜：认得 zh* 就用中文，否则英文。 */
function detectLang(): Lang {
  if (typeof navigator === 'undefined') return 'zh'
  const list = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const raw of list) {
    const tag = (raw ?? '').toLowerCase()
    if (tag.startsWith('zh')) return 'zh'
    if (tag.startsWith('en')) return 'en'
  }
  return 'zh'
}

type LangStore = {
  lang: Lang
  setLang: (lang: Lang) => void
  toggle: () => void
}

const useLangStore = create<LangStore>()(
  persist(
    (set, get) => ({
      lang: detectLang(),
      setLang: (lang) => set({ lang }),
      toggle: () => set({ lang: get().lang === 'zh' ? 'en' : 'zh' }),
    }),
    {
      name: 'lushu-lang-v1',
      partialize: (s) => ({ lang: s.lang }),
    },
  ),
)

/** 非组件代码用的当前语言。 */
export function getLang(): Lang {
  return useLangStore.getState().lang
}

/** 翻译一条文案，可带 `{name}` 占位符。非组件代码用这个。 */
export function t(key: MsgKey, params?: TParams): string {
  const lang = getLang()
  return interpolate(CATALOG[lang][key] ?? zh[key] ?? key, params)
}

/**
 * 书名是不是「未命名路书」的默认值（任一语言）。默认书名在创建时按当时的
 * 界面语言落盘，之后切换语言不会改写已有书名，所以两种都要认。
 */
export function isUntitledTitle(title: string): boolean {
  return !title || title === zh['common.untitled'] || title === en['common.untitled']
}

/**
 * 管理后台文案：固定中文，优先取 adminZh，其余（common.* 等）回落到中文主表。
 */
export function adminT(key: AdminMsgKey | MsgKey, params?: TParams): string {
  const table: Record<string, string> = adminZh
  return interpolate(table[key] ?? (zh as Record<string, string>)[key] ?? key, params)
}

/**
 * 组件里用：返回当前语言与切换方法。`t` 是全局函数，但这里的 lang 订阅
 * 保证语言一变组件就重渲染。
 */
export function useI18n(): {
  lang: Lang
  setLang: (lang: Lang) => void
  toggle: () => void
  t: typeof t
} {
  const lang = useLangStore((s) => s.lang)
  const setLang = useLangStore((s) => s.setLang)
  const toggle = useLangStore((s) => s.toggle)
  return { lang, setLang, toggle, t }
}
