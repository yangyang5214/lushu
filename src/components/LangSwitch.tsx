import { useEffect, useRef, useState } from 'react'
import { useI18n, type Lang } from '../lib/i18n'

/** 菜单里永远用各语言本名，不随界面语言翻译。 */
const OPTIONS: { id: Lang; native: string }[] = [
  { id: 'zh', native: '简体中文' },
  { id: 'en', native: 'English' },
]

function GlobeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg
      className="lang-switch-chevron"
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

/** 语言切换：地球图标 + 下拉（对齐 Obsidian 官网）。 */
export function LangSwitch({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div
      ref={rootRef}
      className={className ? `lang-switch ${className}` : 'lang-switch'}
    >
      <button
        type="button"
        className="lang-switch-toggle"
        aria-label={t('lang.label')}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <GlobeIcon />
        <span className="lang-switch-code">{lang}</span>
        <ChevronIcon />
      </button>
      {open ? (
        <div className="lang-menu" role="listbox" aria-label={t('lang.label')}>
          {OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="option"
              className="lang-option"
              aria-current={lang === opt.id ? true : undefined}
              aria-selected={lang === opt.id}
              onClick={() => {
                setLang(opt.id)
                setOpen(false)
              }}
            >
              {opt.native}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
