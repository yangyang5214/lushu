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
  'common.close': '关闭',

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
  'nav.github': '在 GitHub 上看源码',

  // ── 搜索 ─────────────────────────────────────────────────────────────────
  'search.placeholder': '搜地点 如 泉州 关岳庙',
  'search.noResults': '没有找到，试试更具体的地名',
  'search.offline': '在线搜索暂时不可用，请稍后再试',
  'map.fit': '回到全览',
  'map.unavailable': '高德地图加载失败：请在 wrangler.toml 的 [vars].AMAP_JS_KEY 里配置高德「Web端(JS API)」key。',

  // ── 编辑页侧栏 ───────────────────────────────────────────────────────────
  'sidebar.back': '返回上一页',
  'sidebar.titlePlaceholder': '未命名路书',
  'sidebar.routeName': '路线名',
  'sidebar.day': '第{n}天',
  'sidebar.startBadge': '起',
  'sidebar.endBadge': '终',
  'sidebar.setStart': '起点',
  'sidebar.setEnd': '终点',
  'sidebar.night': '过夜',
  'sidebar.cancelNight': '取消过夜',
  'sidebar.hintEmpty': '搜索添加地点，再设起点和终点。起终点相同即为环线。',
  'sidebar.hintReady': '设好起点和终点后，其余点会按路程串成一条线。',

  // ── 行程表（多天） ───────────────────────────────────────────────────────
  'table.title': '行程表',
  'table.open': '行程表',
  'table.day': '天',
  'table.route': '途经',
  'table.km': '里程',
  'table.time': '驾驶时长',
  'table.select': '在地图上查看第{n}天',

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
  'home.guideHeading': '每个按钮，都对应路上的一件事',
  'home.guideSub':
    '编辑页里能点的东西不多。下面一个一个说，每个动作都配了张图。',

  'nav.mp': '小程序',
  'mp.kicker': '微信小程序',
  'mp.name': 'gpx merge',
  'mp.title1': '电脑规划',
  'mp.title2': '手机带着跑',
  'mp.hint': '微信扫一扫打开',
  'mp.alt': '微信小程序 gpx merge 的小程序码',
  'mp.f1.title': '扫码即开',
  'mp.f1.text': '不用装 App',
  'mp.f2.title': '按天看路',
  'mp.f2.text': '哪天走哪段、在哪过夜',
  'mp.f3.title': '随时翻看',
  'mp.f3.text': '路上对照当天行程',
  'mp.shotsHeading': '打开之后',
  'mp.shotsSub': '列表、详情、按天、导航。',
  'mp.s1.title': '路书列表',
  'mp.s1.text': '天数、里程一眼看清',
  'mp.s1.alt': '小程序路书列表截图',
  'mp.s2.title': '路线详情',
  'mp.s2.text': '地图和行程同一页，一目了然',
  'mp.s2.alt': '小程序路书详情截图',
  'mp.s3.title': '按天展开',
  'mp.s3.text': '当天行程，点开对照',
  'mp.s3.alt': '小程序按天行程截图',
  'mp.s4.title': '一键导航',
  'mp.s4.text': '点地点就能走，不用再手动切导航 App',
  'mp.s4.alt': '小程序地点导航截图',
  // ── 主页功能介绍：每张卡片一份文案 ────────────────────────────────────────

  'feat.add.title': '搜一下就加进来',
  'feat.add.text':
    '在地图左上角的搜索框里打地名，点中结果就加进行程清单。想到什么加什么，顺序不用管。',
  'feat.add.alt': '示意图：在搜索框里搜到地点，点一下加进行程清单',
  'feat.ends.title': '起点终点，定下方向',
  'feat.ends.text':
    '在任意一行的右侧点「起点」或「终点」。定好之后，其余地点按路程自动串成一条顺路的线；起点和终点选同一个点，就是环线。',
  'feat.ends.alt': '示意图：给地点设起点和终点，地图上串成一条路线',
  'feat.night.title': '点一下「过夜」，行程就分天',
  'feat.night.text':
    '在今晚要住下的那个地点点「过夜」，全程立刻分成第 1 天、第 2 天，清单和地图的颜色一起变。',
  'feat.night.alt': '示意图：在过夜的地点钉上分割针，行程分成两天',
  'feat.rail.title': '底部的行程尺，一眼看完整个行程',
  'feat.rail.text':
    '整条路线按实际里程铺开，一颗珠就是一个地点：点珠子能选中地点，也能直接钉过夜；按住「夜」拖到别的点就能改分天。',
  'feat.rail.alt': '示意图：底部行程尺上的珠子，把「夜」拖到另一个点',
  'feat.legs.title': '点与点之间，标着大概要开多久',
  'feat.legs.text':
    '相邻两个地点之间会显示里程和驾驶时长；天数、地点数、总里程、驾驶时长这四个总数，跟着你的改动实时重算。',
  'feat.legs.alt': '示意图：地点之间的里程与驾驶时长，以及总统计',

  'shot.book': '闽南 5 天',
  'shot.p1': '泉州 关岳庙',
  'shot.p2': '洛阳桥',
  'shot.p3': '崇武古城',
  'shot.p4': '漳州古城',
  'shot.p5': '云水谣',
  'shot.loop': '环线',
  'shot.p5b': '云水谣古道',
  'shot.p5addr': '南靖县 · 云水谣古镇',

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
  'mine.deleteTitle': '删除路书',
  'mine.deleteAsk': '确定要删除《{title}》吗？',
  'mine.deleteWarnLocal': '删除后无法恢复。',
  'mine.deleteWarnCloud': '删除后无法恢复；云端保存的这一份也会一并删掉，分享出去的链接随即失效。',
  'mine.deleteAria': '删除《{title}》',

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
  'err.display_name_too_short': '昵称至少 {min} 个字符',
  'err.display_name_too_long': '昵称最多 {max} 个字符',
  'err.invalid_display_name': '昵称只能用中文、英文、数字和 _ - .',
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
  'common.close': 'Close',

  'lang.label': 'Change language',
  'lang.zh': '简体中文',
  'lang.en': 'English',

  'nav.mine': 'My Roadbooks',
  'nav.public': 'Public Roadbooks',
  'nav.account': 'Account',
  'nav.serviceDown': 'Service unavailable',
  'nav.accountTitle': 'Account · {email}',
  'nav.github': 'View the source on GitHub',

  'search.placeholder': 'Search a place, e.g. Quanzhou Guanyue',
  'search.noResults': 'Nothing found — try a more specific place',
  'search.offline': 'Search is temporarily unavailable, please try again later',
  'map.fit': 'Fit route',
  'map.unavailable':
    'AMap failed to load: set an AMap JS API key in [vars].AMAP_JS_KEY of wrangler.toml.',

  'sidebar.back': 'Go back',
  'sidebar.titlePlaceholder': 'Untitled Roadbook',
  'sidebar.routeName': 'Route name',
  'sidebar.day': 'Day {n}',
  'sidebar.startBadge': 'S',
  'sidebar.endBadge': 'E',
  'sidebar.setStart': 'Start',
  'sidebar.setEnd': 'End',
  'sidebar.night': 'Overnight',
  'sidebar.cancelNight': 'Cancel overnight',
  'sidebar.hintEmpty':
    'Search to add places, then set a start and an end. The same start and end makes a loop.',
  'sidebar.hintReady':
    'Once a start and an end are set, the other stops are strung into a route by distance.',

  // ── Trip table (multi-day) ───────────────────────────────────────────────
  'table.title': 'Itinerary',
  'table.open': 'Itinerary',
  'table.day': 'Day',
  'table.route': 'Route',
  'table.km': 'Distance',
  'table.time': 'Drive time',
  'table.select': 'Show day {n} on the map',

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
  'home.guideHeading': 'Every button maps to one thing on the road',
  'home.guideSub':
    'The editor has only a handful of controls. Here they are, one at a time, each with a picture.',

  'nav.mp': 'Mini Program',
  'mp.kicker': 'WeChat Mini Program',
  'mp.name': 'gpx merge',
  'mp.title1': 'Write on desktop,',
  'mp.title2': 'open on your phone',
  'mp.hint': 'Scan with WeChat to open',
  'mp.alt': 'WeChat Mini Program QR code for gpx merge',
  'mp.f1.title': 'Scan to open',
  'mp.f1.text': 'No extra app.',
  'mp.f2.title': 'See each day',
  'mp.f2.text': 'Which stretch, where you stay.',
  'mp.f3.title': 'Check on the road',
  'mp.f3.text': 'Match today’s plan as you go.',
  'mp.shotsHeading': 'Once it’s open',
  'mp.shotsSub': 'List, detail, days, navigate.',
  'mp.s1.title': 'Book list',
  'mp.s1.text': 'Days and distance at a glance.',
  'mp.s1.alt': 'Mini Program screenshot of the roadbook list',
  'mp.s2.title': 'Route detail',
  'mp.s2.text': 'Map and itinerary on one screen.',
  'mp.s2.alt': 'Mini Program screenshot of a roadbook detail',
  'mp.s3.title': 'Day by day',
  'mp.s3.text': 'Today’s stretch — tap to check.',
  'mp.s3.alt': 'Mini Program screenshot of the day-by-day itinerary',
  'mp.s4.title': 'Navigate',
  'mp.s4.text': 'Tap a stop and go.',
  'mp.s4.alt': 'Mini Program screenshot of place navigation',
  // ── Home feature guide: one copy block per card ──────────────────────────

  'feat.add.title': 'Search, and it joins the trip',
  'feat.add.text':
    'Type a place into the search box at the top-left of the map and pick a result — it lands in the itinerary. Add in any order.',
  'feat.add.alt': 'Diagram: searching for a place and adding it to the itinerary',
  'feat.ends.title': 'A start and an end set the direction',
  'feat.ends.text':
    'Click Start or End on any stop. The other places are then strung into one sensible route by distance — pick the same stop for both and you get a loop.',
  'feat.ends.alt': 'Diagram: setting a start and an end on stops, drawn as a route on the map',
  'feat.night.title': 'One click on Overnight splits the days',
  'feat.night.text':
    'Click Overnight on the stop where you will sleep: the trip splits into Day 1, Day 2 right away, and the itinerary and map recolor.',
  'feat.night.alt': 'Diagram: pinning an overnight stop, splitting the trip into two days',
  'feat.rail.title': 'The trip ruler shows the whole trip at a glance',
  'feat.rail.text':
    'The route is laid out on a ruler by real distance, one bead per stop: click a bead to select the stop or pin an overnight there; drag the night pin onto another bead to move it.',
  'feat.rail.alt': 'Diagram: beads on the trip ruler with the night pin dragged to another stop',
  'feat.legs.title': 'Between stops: how far, and how long',
  'feat.legs.text':
    'Every leg shows its distance and drive time; the four totals — days, stops, distance, drive time — recompute as you edit.',
  'feat.legs.alt': 'Diagram: distance and drive time between stops, plus the trip totals',

  'shot.book': 'Minnan · 5 days',
  'shot.p1': 'Quanzhou',
  'shot.p2': 'Luoyang Bridge',
  'shot.p3': 'Chongwu',
  'shot.p4': 'Zhangzhou',
  'shot.p5': 'Yunshuiyao',
  'shot.loop': 'Loop',
  'shot.p5b': 'Yunshuiyao Old Trail',
  'shot.p5addr': 'Nanjing County, Fujian',

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
  'mine.deleteTitle': 'Delete Roadbook',
  'mine.deleteAsk': 'Delete “{title}”?',
  'mine.deleteWarnLocal': 'This cannot be undone.',
  'mine.deleteWarnCloud':
    'This cannot be undone. The copy saved in the cloud is deleted with it, and links you have shared stop working.',
  'mine.deleteAria': 'Delete “{title}”',

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
  'err.display_name_too_short': 'Nickname must be at least {min} characters',
  'err.display_name_too_long': 'Nickname can be at most {max} characters',
  'err.invalid_display_name':
    'Nickname may only use Chinese characters, letters, digits and _ - .',
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

  'meta.title': '路书 Roadbook · Road-trip itinerary planner, auto-route & day splits',
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
