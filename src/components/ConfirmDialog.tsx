import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'

type ConfirmDialogProps = {
  /** 对话框标题，也作为无障碍名称。 */
  title: string
  /** 正文：说清楚要删的是哪一本、删掉会怎样。 */
  body: ReactNode
  confirmLabel: string
  cancelLabel: string
  /** 破坏性操作用红色实心按钮，普通操作用主色。 */
  tone?: 'danger' | 'normal'
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 二次确认浮层：Esc / 点遮罩 / 「取消」都能关掉，默认焦点在「取消」上，
 * 回车不会误删；关闭后焦点还给打开它的那个按钮。
 * 卡片上的「删除」用这个，而不是把按钮就地换成「确认删除」——
 * 后者确认按钮正好落在刚点过的位置上，双击就会直接删掉。
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  tone = 'normal',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // 事件回调走 ref：调用方每次渲染都会传新的函数，直接进依赖会让聚焦效果反复重跑。
  const cancel = useRef(onCancel)
  useEffect(() => {
    cancel.current = onCancel
  })

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        cancel.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  // 只有两个按钮，Tab 在两颗之间来回即可，别跑到底下的卡片上。
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const nodes = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
    if (!nodes || nodes.length === 0) return
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="confirm-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        ref={dialogRef}
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={onKeyDown}
      >
        <h3>{title}</h3>
        <div className="confirm-body">{body}</div>
        <div className="confirm-actions">
          <button ref={cancelRef} type="button" className="btn-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
