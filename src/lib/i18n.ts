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
  'nav.features': '功能',
  'nav.account': '账户',
  'nav.serviceDown': '服务不可用',
  'nav.accountTitle': '账户 · {email}',
  'nav.github': '在 GitHub 上看源码',
  'nav.feedback': '功能反馈',

  // ── 搜索 ─────────────────────────────────────────────────────────────────
  'search.placeholder': '搜地点 如 泉州 关岳庙',
  'search.noResults': '没有找到，试试更具体的地名',
  'search.offline': '在线搜索暂时不可用，请稍后再试',
  'map.fit': '回到全览',
  'map.unavailable': '高德地图加载失败：请在 wrangler.toml 的 [vars].AMAP_JS_KEY 里配置高德「Web端(JS API)」key。',

  // ── 点地图看地点（右侧卡片） ────────────────────────────────────────────
  'poi.title': '高德地点',
  'poi.add': '加入路线',
  'poi.added': '✓ 已在路线中',
  'poi.skip': '不加入',
  'poi.loading': '正在查这一点附近的地点…',
  'poi.empty': '这一点附近没有高德收录的地点，换个位置再点。',
  'poi.error': '暂时取不到高德地点信息，稍后再试。',
  'poi.ratingNote': '高德评分',
  'poi.cost': '人均 ¥{n}',
  'poi.hours': '营业时间',
  'poi.tel': '电话',
  'poi.address': '地址',
  'poi.distance': '直线距离',
  'poi.photos': '{n} 张照片',
  'poi.reviews': '高德评价',
  'poi.openReviews': '在高德看全部评价',
  'poi.reviewNote': '评分与照片来自高德，完整评价在高德地图里看。',
  'poi.nearby': '附近地点',

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
  'sidebar.note': '备注',
  'sidebar.noteEdit': '编辑备注',
  'sidebar.notePlaceholder': '停车、门票、联系人…',

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
  'home.userCount': '已有 {n} 位旅行者加入',

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

  'feat.add.title': '搜了就能加',
  'feat.add.text':
    '在搜索框里打地名，点中结果就加进路线；想到什么加什么，顺序不用管。',
  'feat.add.alt': '示意图：在搜索框里搜到地点，点一下加进行程清单',
  'feat.ends.title': '定起点终点',
  'feat.ends.text':
    '在任意一行的右侧点「起点」或「终点」。定好之后，其余地点按路程自动串成一条顺路的线；起点和终点选同一个点，就是环线。',
  'feat.ends.alt': '示意图：给地点设起点和终点，地图上串成一条路线',
  'feat.night.title': '过夜分天',
  'feat.night.text':
    '在今晚要住下的那个地点点「过夜」，全程立刻分成第 1 天、第 2 天，清单和地图的颜色一起变。',
  'feat.night.alt': '示意图：在过夜的地点钉上分割针，行程分成两天',
  'feat.note.title': '地点备注',
  'feat.note.text':
    '在任意一行点「备注」，写一句停车、门票、联系人之类的话，最多 20 字；名字后面立刻挂上小标签，只读的分享页里也看得到。',
  'feat.note.alt': '示意图：点行末的「备注」，在名字下方写一句话',
  'feat.rail.title': '行程尺看全程',
  'feat.rail.text':
    '整条路线按里程铺成一根尺子，一颗珠就是一个地点：点珠子选地点或钉过夜，拖动「夜」就能改分天。',
  'feat.rail.alt': '示意图：底部行程尺上的珠子，把「夜」拖到另一个点',
  'feat.legs.title': '每段开多久',
  'feat.legs.text':
    '相邻两点之间标着里程和驾驶时长；天数、地点数、总里程、时长跟着改动实时重算。',
  'feat.legs.alt': '示意图：地点之间的里程与驾驶时长，以及总统计',

  // ── /features：功能一览（功能点 / 描述 / 截图） ─────────────────────────
  'features.heading': '功能一览',
  'features.caption': '功能点、功能点描述与功能截图',
  'features.colFeature': '功能点',
  'features.colDesc': '功能点描述',
  'features.colShot': '功能截图',
  'features.zoom': '点开看大图',
  'features.link': '这一条功能点的链接',
  'features.visibility': '可见性',

  'feat.poi.title': '点地图看地点',
  'feat.poi.text':
    '在地图上点任意一处，右侧弹出附近的高德地点：评分、照片、电话、地址。确认后点「加入路线」就行。',
  'feat.poi.alt': '示意图：点地图弹出高德地点卡片，可以加入路线',
  'feat.table.title': '行程表',
  'feat.table.text':
    '点「行程表」整屏铺开：一天一行，写着当天的途经、里程和驾驶时长；点某一天，地图就高亮那一段。',
  'feat.table.alt': '示意图：整屏行程表，一天一行列出途经、里程与驾驶时长',
  'feat.shelf.title': '云端书架',
  'feat.shelf.text':
    '改动先落本地，1.4 秒后写进云端 D1。「我的路书」管自己的书，「公开路书」逛别人的书，卡片上直接画出缩略线路。',
  'feat.shelf.alt': '示意图：我的路书列表，卡片带缩略线路与可见性',
  'feat.share.title': '公开与私密',
  'feat.share.text':
    '每本路书都有固定链接，设为公开后任何人不用登录就能打开；改回私密，对外一律打不开。',
  'feat.share.note': '拿到链接的人不用登录也能看。',
  'feat.share.alt': '示意图：分享对话框，复制链接并切换公开 / 私密',
  'feat.account.title': '账号与同步',
  'feat.account.text':
    '邮箱加口令注册、邮件激活；口令加盐哈希后入库，会话 cookie 里只有 token 摘要。界面中英双语。',
  'feat.account.alt': '示意图：登录表单与账户信息卡片',
  'feat.mp.title': '微信小程序',
  'feat.mp.text': '小程序 gpx merge：按天查看行程，点地点直接导航，不用在手机上重新找路。',
  'feat.mp.alt': '小程序路书列表与详情截图',

  'shot.book': '闽南 5 天',
  'shot.book2': '潮汕 3 天',
  'shot.public': '公开',
  'shot.p1': '泉州 关岳庙',
  'shot.p2': '洛阳桥',
  'shot.p3': '崇武古城',
  'shot.p4': '漳州古城',
  'shot.p5': '云水谣',
  'shot.loop': '环线',
  'shot.p5b': '云水谣古道',
  'shot.p5addr': '南靖县 · 云水谣古镇',
  'shot.note': '停车在西门',

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

  // ── 路书页：书名下方的「去手机查看 / 分享」 ───────────────────────────────
  'book.phone': '去手机查看',
  'book.share': '分享',
  'book.phoneTitle': '手机上看这本路书',
  'book.phoneHint':
    '用微信扫一扫，打开小程序 gpx merge，路上按天查看行程、点地点直接导航。',
  'book.shareTitle': '分享路书',
  'book.sharePrivateAsk': '这本路书现在是私密的，只有你自己能打开。',
  'book.sharePrivateNote': '设为公开后，别人拿到链接不用登录也能看。',
  'book.sharePublicNote': '这本路书已公开，别人不用登录就能打开这个链接。',
  'book.shareLink': '分享链接',
  'book.shareCopy': '复制链接',
  'book.shareCopied': '已复制',
  'book.shareCopyFailed': '复制失败',
  'book.sharePublic': '设为公开并复制链接',
  'book.shareWorking': '正在公开…',
  'book.shareFailed': '公开失败，请检查网络后重试',

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
  'nav.features': 'Features',
  'nav.account': 'Account',
  'nav.serviceDown': 'Service unavailable',
  'nav.accountTitle': 'Account · {email}',
  'nav.github': 'View the source on GitHub',
  'nav.feedback': 'Feedback',

  'search.placeholder': 'Search a place, e.g. Quanzhou Guanyue',
  'search.noResults': 'Nothing found — try a more specific place',
  'search.offline': 'Search is temporarily unavailable, please try again later',
  'map.fit': 'Fit route',
  'map.unavailable':
    'AMap failed to load: set an AMap JS API key in [vars].AMAP_JS_KEY of wrangler.toml.',

  'poi.title': 'AMap place',
  'poi.add': 'Add to route',
  'poi.added': '✓ On the route',
  'poi.skip': 'Not now',
  'poi.loading': 'Looking up places near this point…',
  'poi.empty': 'No AMap place near this point — try another spot.',
  'poi.error': 'AMap place info is unavailable right now, please try again.',
  'poi.ratingNote': 'AMap rating',
  'poi.cost': '¥{n} per person',
  'poi.hours': 'Hours',
  'poi.tel': 'Phone',
  'poi.address': 'Address',
  'poi.distance': 'Straight-line distance',
  'poi.photos': '{n} photos',
  'poi.reviews': 'AMap reviews',
  'poi.openReviews': 'See all reviews on AMap',
  'poi.reviewNote': 'Rating and photos come from AMap; the full reviews live on AMap.',
  'poi.nearby': 'Nearby places',

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
  'sidebar.note': 'Note',
  'sidebar.noteEdit': 'Edit note',
  'sidebar.notePlaceholder': 'Parking, tickets, contacts…',

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
  'home.userCount': 'Joined by {n} travelers',

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

  'feat.add.title': 'Search and add',
  'feat.add.text':
    'Type a place in the search box and pick a result — it joins the route. Add in any order.',
  'feat.add.alt': 'Diagram: searching for a place and adding it to the itinerary',
  'feat.ends.title': 'Start and end',
  'feat.ends.text':
    'Click Start or End on any stop. The other places are then strung into one sensible route by distance — pick the same stop for both and you get a loop.',
  'feat.ends.alt': 'Diagram: setting a start and an end on stops, drawn as a route on the map',
  'feat.night.title': 'Split by night',
  'feat.night.text':
    'Click Overnight on the stop where you will sleep: the trip splits into Day 1, Day 2 right away, and the itinerary and map recolor.',
  'feat.night.alt': 'Diagram: pinning an overnight stop, splitting the trip into two days',
  'feat.note.title': 'Place notes',
  'feat.note.text':
    'Click “Note” on any stop and write one line — parking, tickets, a contact — up to 20 characters. It appears as a small tag after the name, and read-only shared pages keep it.',
  'feat.note.alt': 'Diagram: clicking Note at the end of a row and typing a line under the name',
  'feat.rail.title': 'Trip ruler',
  'feat.rail.text':
    'The route is laid out on a ruler by distance, one bead per stop: click a bead to select a stop or pin an overnight there, and drag the “N” to change days.',
  'feat.rail.alt': 'Diagram: beads on the trip ruler with the night pin dragged to another stop',
  'feat.legs.title': 'Drive time per leg',
  'feat.legs.text':
    'Every leg shows its distance and drive time; days, stops, distance and drive time recompute as you edit.',
  'feat.legs.alt': 'Diagram: distance and drive time between stops, plus the trip totals',

  // ── /features: the feature list (feature / description / screenshot) ─────
  'features.heading': 'Features',
  'features.caption': 'Feature, description and screenshot',
  'features.colFeature': 'Feature',
  'features.colDesc': 'Description',
  'features.colShot': 'Screenshot',
  'features.zoom': 'Click to enlarge',
  'features.link': 'Link to this feature',
  'features.visibility': 'Visibility',

  'feat.poi.title': 'Tap the map for places',
  'feat.poi.text':
    'Tap anywhere on the map and a card shows the nearest AMap place: rating, photos, phone and address. Hit “Add to route” to keep it.',
  'feat.poi.alt': 'Diagram: tapping the map opens an AMap place card that can be added to the route',
  'feat.table.title': 'Itinerary table',
  'feat.table.text':
    'Open “Itinerary” full screen: one row per day with its stops, distance and drive time — click a day to highlight that stretch on the map.',
  'feat.table.alt': 'Diagram: the full-screen itinerary table, one row per day with stops, distance and drive time',
  'feat.shelf.title': 'Cloud shelf',
  'feat.shelf.text':
    'Edits land locally first and are written to D1 after 1.4 s. “My Roadbooks” holds yours, “Public Roadbooks” browses others, and every card draws a thumbnail of its route.',
  'feat.shelf.alt': 'Diagram: the My Roadbooks list with route thumbnails and visibility',
  'feat.share.title': 'Public or private',
  'feat.share.text':
    'Every Roadbook has a stable link. Make it public and anyone can open it without signing in; switch it back to private and it closes to outsiders.',
  'feat.share.note': 'Anyone with the link can read it.',
  'feat.share.alt': 'Diagram: the share dialog with a copyable link and a public / private switch',
  'feat.account.title': 'Account & sync',
  'feat.account.text':
    'Sign up with an email and a passphrase, activate by email; passphrases are salted and hashed, and the session cookie holds only a token digest. The UI is bilingual.',
  'feat.account.alt': 'Diagram: the sign-in form and the account card',
  'feat.mp.title': 'WeChat Mini Program',
  'feat.mp.text':
    'The gpx merge Mini Program shows the trip day by day and navigates straight from a stop — no re-searching on the phone.',
  'feat.mp.alt': 'Mini Program screenshots of the roadbook list and detail',

  'shot.book': 'Minnan · 5 days',
  'shot.book2': 'Chaoshan · 3 days',
  'shot.public': 'Public',
  'shot.p1': 'Quanzhou',
  'shot.p2': 'Luoyang Bridge',
  'shot.p3': 'Chongwu',
  'shot.p4': 'Zhangzhou',
  'shot.p5': 'Yunshuiyao',
  'shot.loop': 'Loop',
  'shot.p5b': 'Yunshuiyao Old Trail',
  'shot.p5addr': 'Nanjing County, Fujian',
  'shot.note': 'Park at the west gate',

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

  // ── Book page: “View on phone / Share” under the title ───────────────────
  'book.phone': 'View on phone',
  'book.share': 'Share',
  'book.phoneTitle': 'Open this Roadbook on your phone',
  'book.phoneHint':
    'Scan with WeChat to open the gpx merge Mini Program: follow the trip day by day and tap a stop to navigate.',
  'book.shareTitle': 'Share this Roadbook',
  'book.sharePrivateAsk': 'This Roadbook is private — only you can open it.',
  'book.sharePrivateNote':
    'Make it public and anyone with the link can open it without signing in.',
  'book.sharePublicNote': 'This Roadbook is public — anyone can open the link without signing in.',
  'book.shareLink': 'Share link',
  'book.shareCopy': 'Copy link',
  'book.shareCopied': 'Copied',
  'book.shareCopyFailed': 'Copy failed',
  'book.sharePublic': 'Make public & copy link',
  'book.shareWorking': 'Publishing…',
  'book.shareFailed': 'Could not make it public — check your network and retry.',

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
