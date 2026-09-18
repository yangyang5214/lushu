import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { saveVisibility } from '../lib/api'
import { requireLogin } from '../lib/auth'
import { useI18n } from '../lib/i18n'
import { getMeta } from '../lib/keys'
import { pushBook, refreshCloud, refreshPublic, useCloud } from '../lib/sync'
import { useLushu, useReadonly } from '../store'
import type { Book } from '../types'

/** 微信公众平台下载的小程序码（太阳码），与 `/mp` 落地页共用一张。 */
const MP_CODE_SRC = '/mp-code.jpg'

function IconPhone() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M8 3.5h8v17H8Z" />
      <path d="M10.5 17.5h3" />
    </svg>
  )
}

function IconShare() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 3.5v10" />
      <path d="M8.5 7 12 3.5 15.5 7" />
      <path d="M6 12.5v7h12v-7" />
    </svg>
  )
}

/** 复制文本；非安全上下文（http）下 navigator.clipboard 不可用，退回 textarea。 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 继续走兜底方案 */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

/**
 * 编辑页的小弹层：Esc / 点遮罩都能关掉，打开时焦点落在第一颗按钮上，
 * 关闭后还给打开它的那个按钮。用编辑页的纸感配色，不复用主页的 .confirm-*。
 * 挂到 body 上：侧栏 .sheet 自带 z-index，弹层留在里面会盖不住右侧的高德卡片。
 */
function SheetDialog({
  title,
  onClose,
  children,
  actions,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  actions: ReactNode
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  // 调用方每次渲染都会传新的 onClose，直接进依赖会让监听反复重挂。
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // 先聚焦弹层本身：回车不会误触「关闭」等按钮，Tab 才进到按钮上。
    boxRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  return createPortal(
    <div
      className="sheet-dialog-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={boxRef}
        className="sheet-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <h3>{title}</h3>
        <div className="sheet-dialog-body">{children}</div>
        <div className="sheet-dialog-actions">{actions}</div>
      </div>
    </div>,
    document.body,
  )
}

/** 「去手机查看」：亮出小程序码，微信扫码即进小程序。 */
function PhoneDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  return (
    <SheetDialog
      title={t('book.phoneTitle')}
      onClose={onClose}
      actions={
        <button type="button" className="btn-primary" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className="sheet-qr">
        <img src={MP_CODE_SRC} width={258} height={258} alt={t('mp.alt')} />
      </div>
      <p className="sheet-dialog-note">{t('book.phoneHint')}</p>
    </SheetDialog>
  )
}

/**
 * 「分享」：私密的书先提示设为公开（别人不用登录也能看），确认后公开并复制链接；
 * 已公开的直接给链接。
 */
function ShareDialog({ book, onClose }: { book: Book; onClose: () => void }) {
  const { t } = useI18n()
  const setVisibility = useLushu((s) => s.setVisibility)
  const cloud = useCloud((s) => s.books)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle')
  const isPublic = book.visibility === 'public'
  // 地址栏在 App 里已经被规范成 `/d/{userId}/{bookId}`，直接拿来当分享链接。
  const link = window.location.href

  const copy = async () => {
    const ok = await copyText(link)
    setCopied(ok ? 'ok' : 'fail')
    window.setTimeout(() => setCopied('idle'), 2000)
  }

  // 改权限是写操作，要登录；账号书架里的书即使没有本机口令也能改。
  const publish = () =>
    requireLogin(() => {
      setBusy(true)
      setFailed(false)
      setVisibility(book.id, 'public')
      const onServer =
        cloud.some((c) => c.id === book.id) || getMeta(book.id).pushed !== undefined
      const finish = (ok: boolean) => {
        setBusy(false)
        if (!ok) {
          setFailed(true)
          return
        }
        void refreshCloud()
        void refreshPublic()
        void copy()
      }
      if (onServer) {
        void saveVisibility(book.id, 'public').then(finish)
        return
      }
      void pushBook(book.id).then(() => finish(getMeta(book.id).pushed !== undefined))
    })

  const copyLabel =
    copied === 'ok'
      ? t('book.shareCopied')
      : copied === 'fail'
        ? t('book.shareCopyFailed')
        : t('book.shareCopy')

  return (
    <SheetDialog
      title={t('book.shareTitle')}
      onClose={onClose}
      actions={
        isPublic ? (
          <>
            <button type="button" className="btn-ghost" onClick={onClose}>
              {t('common.close')}
            </button>
            <button type="button" className="btn-primary" onClick={() => void copy()}>
              {copyLabel}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-ghost" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={publish}>
              {busy ? t('book.shareWorking') : t('book.sharePublic')}
            </button>
          </>
        )
      }
    >
      {isPublic ? (
        <>
          <p className="sheet-dialog-note first">{t('book.sharePublicNote')}</p>
          <input
            className="sheet-link"
            value={link}
            readOnly
            aria-label={t('book.shareLink')}
            onFocus={(e) => e.currentTarget.select()}
          />
        </>
      ) : (
        <>
          <p className="sheet-dialog-ask">{t('book.sharePrivateAsk')}</p>
          <p className="sheet-dialog-note">{t('book.sharePrivateNote')}</p>
        </>
      )}
      {failed ? <p className="sheet-dialog-error">{t('book.shareFailed')}</p> : null}
    </SheetDialog>
  )
}

/**
 * 路书名下方的两个操作：「去手机查看」（微信扫码进小程序 / 介绍页）与
 * 「分享」（设为公开，别人不用登录也能看）。别人的分享是只读，没有分享入口。
 */
export function BookActions() {
  const { t } = useI18n()
  const readonly = useReadonly()
  const book = useLushu((s) => (s.activeId ? s.books[s.activeId] : undefined))
  const [phoneOpen, setPhoneOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)

  if (!book) return null

  return (
    <>
      <div className="sheet-actions">
        <button type="button" className="sheet-action" onClick={() => setPhoneOpen(true)}>
          <IconPhone />
          {t('book.phone')}
        </button>
        {readonly ? null : (
          <button type="button" className="sheet-action" onClick={() => setShareOpen(true)}>
            <IconShare />
            {t('book.share')}
          </button>
        )}
      </div>
      {phoneOpen ? <PhoneDialog onClose={() => setPhoneOpen(false)} /> : null}
      {shareOpen ? <ShareDialog book={book} onClose={() => setShareOpen(false)} /> : null}
    </>
  )
}
