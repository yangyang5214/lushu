import { useEffect, useState } from 'react'
import { resolveConflict, useSync, type SyncStatus } from '../lib/sync'

function clock(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const LABELS: Record<SyncStatus, string> = {
  local: '仅本地',
  syncing: '同步中…',
  saved: '已同步',
  readonly: '只读分享',
  offline: '离线',
  conflict: '有冲突',
  full: '服务已满',
  error: '同步失败',
}

export function SyncBadge() {
  const status = useSync((s) => s.status)
  const at = useSync((s) => s.at)
  const conflict = useSync((s) => s.conflict)

  if (conflict) {
    return (
      <span className="sync-badge conflict" role="status">
        <span className="sync-dot" />
        云端有更新
        <button type="button" onClick={() => void resolveConflict('remote')}>
          用云端
        </button>
        <button type="button" onClick={() => void resolveConflict('local')}>
          留本地
        </button>
      </span>
    )
  }

  const label = status === 'saved' && at ? `${LABELS[status]} ${clock(at)}` : LABELS[status]
  return (
    <span
      className={`sync-badge ${status}`}
      role="status"
      title={
        status === 'readonly'
          ? '这是别人的分享链接，改动只存在本机'
          : status === 'full'
            ? '服务端的路书名额已满，这本暂时只存在本机'
            : undefined
      }
    >
      <span className="sync-dot" />
      {label}
    </span>
  )
}

export function ShareButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])

  const share = async () => {
    const url = `${window.location.origin}/${encodeURIComponent(id)}`
    try {
      if (navigator.share) {
        await navigator.share({ title: '路书', url })
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      window.prompt('复制这个链接分享：', url)
    }
  }

  return (
    <button type="button" className="share-btn" onClick={() => void share()} title="复制分享链接">
      {copied ? '已复制' : '分享'}
    </button>
  )
}
