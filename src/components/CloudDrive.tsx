// 云游浮层：把当前路书交给 Remotion Player 播放。
//
// 打开时才去要各路段的驾车几何（多数情况已经在浏览器缓存 / 内存里），
// 凑齐后算成 DriveScene —— 舞台坐标、里程、停靠点、文案都在这一刻定下来，
// Player 只负责按帧播放。
//
// 「下载 MP4」把同一份 composition 逐帧编码成视频：走 @remotion/web-renderer，
// 全部在浏览器本地完成（WebCodecs），服务端不参与。这个包的体积不小，
// 所以点下载时才 import —— 独立 chunk，不下载就不会加载。

import { useEffect, useRef, useState } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import {
  DRIVE_FPS,
  buildDriveScene,
  driveLegs,
  type DriveLabels,
  type DriveScene,
} from '../lib/drive'
import { formatDuration, formatKm } from '../lib/geo'
import { useI18n } from '../lib/i18n'
import { fetchRoad } from '../lib/route'
import { useJourney } from '../store'
import { DriveComposition } from './DriveVideo'

/** 导出状态：没开始 / 正在逐帧编码（带百分比）/ 失败（分了「浏览器不支持」）。 */
type ExportState =
  | { kind: 'idle' }
  | { kind: 'rendering'; progress: number }
  | { kind: 'failed'; unsupported: boolean }

/** 下载文件名：书名去掉文件系统不认的字符，空书名兜底。 */
function fileName(title: string): string {
  const clean = title
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `${clean || 'lushu-roadbook'}.mp4`
}

/** 把 blob 交给浏览器下载：同一个 URL 不能立刻 revoke，否则有些浏览器还没开始下载。 */
function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** 下载：箭头落进托盘。 */
function IconDownload() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 4v10.5" />
      <path d="m8 11 4 4 4-4" />
      <path d="M5 19.5h14" />
    </svg>
  )
}

export function CloudDrive({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n()
  const journey = useJourney()
  const closeRef = useRef<HTMLButtonElement>(null)
  const playerRef = useRef<PlayerRef>(null)
  // 正在导出时不能关弹层（Esc / 点遮罩都会走到这），要退出请点「取消」。
  const busyRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const [scene, setScene] = useState<DriveScene | null>(null)
  const [empty, setEmpty] = useState(false)
  const [save, setSave] = useState<ExportState>({ kind: 'idle' })
  // 路书的驾车里程在打开后才陆续回来，useJourney 会换一次身份；
  // 这时保留已算好的画面，不让播放器重挂、动画从头再来。
  const drawn = useRef(false)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busyRef.current) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    busyRef.current = save.kind === 'rendering'
  }, [save.kind])

  // 导出跑一半被关掉弹层（比如切换页面）：把编码也停掉，别让它在后台空转。
  useEffect(() => () => abortRef.current?.abort(), [])

  // lang 进依赖：切换语言后用新文案重建场景（几何有缓存，重建很便宜）。
  useEffect(() => {
    let cancelled = false
    const legs = driveLegs(journey)
    if (legs.length === 0) {
      if (!drawn.current) setEmpty(true)
      return
    }
    if (!drawn.current) setEmpty(false)
    void Promise.all(legs.map((places) => fetchRoad(places))).then((routes) => {
      if (cancelled) return
      const labels: DriveLabels = {
        brand: t('book.drive'),
        dayTitles: journey.ready ? journey.days.map((_, i) => t('drive.day', { n: i + 1 })) : [],
        start: t('drive.start'),
        end: t('drive.end'),
        totalLine: '',
        legendLine: t('drive.legend', {
          days: journey.ready ? journey.days.length : 1,
          stops: journey.ready ? journey.ordered.length : journey.places.length,
        }),
        traveled: t('drive.traveled'),
        unitKm: t('drive.unitKm'),
        completed: t('drive.completed'),
      }
      const built = buildDriveScene(journey, routes, labels)
      if (!built) {
        // 只有一个点（或重合的两个点）时没有可放的东西。
        if (!drawn.current) setEmpty(true)
        return
      }
      // 书名、里程 / 时长要等几何算完才齐，这里一并补上片头那几行。
      drawn.current = true
      setScene({
        ...built,
        title: journey.title || t('common.untitled'),
        labels: {
          ...labels,
          totalLine: `${formatKm(built.distanceKm)} · ${formatDuration(built.durationMin)}`,
        },
      })
    })
    return () => {
      cancelled = true
    }
  }, [journey, lang, t])

  /** 逐帧渲染 → 编码 → 存成 mp4。整个流程都在这个浏览器里跑。 */
  const exportMp4 = async () => {
    const current = scene
    // abortRef 非空 = 上一次导出还没结束（取消 / 完成后才会清掉），顺手挡住连点两下。
    if (!current || abortRef.current) return
    const controller = new AbortController()
    abortRef.current = controller
    // 编码要占满 CPU，先把预览停下来，别两边抢。
    if (playerRef.current?.isPlaying()) playerRef.current.pause()
    setSave({ kind: 'rendering', progress: 0 })
    try {
      const { canRenderMediaOnWeb, renderMediaOnWeb } = await import('@remotion/web-renderer')
      const can = await canRenderMediaOnWeb({
        container: 'mp4',
        videoCodec: 'h264',
        width: current.width,
        height: current.height,
        muted: true,
      })
      if (!can.canRender) {
        setSave({ kind: 'failed', unsupported: true })
        return
      }
      const { getBlob } = await renderMediaOnWeb({
        composition: {
          id: 'lushu-drive',
          component: DriveComposition,
          width: current.width,
          height: current.height,
          fps: DRIVE_FPS,
          durationInFrames: current.introFrames + current.driveFrames + current.outroFrames,
          defaultProps: { scene: current },
        },
        inputProps: { scene: current },
        container: 'mp4',
        videoCodec: 'h264',
        // 地图底图细节多，码率按分辨率换算（约 1.7 Mbps / 1024×576），别让线糊掉。
        videoBitrate: 'high',
        // 一直在内存里拼，不落 OPFS：几十 MB 的片子，省一道临时文件。
        outputTarget: 'arraybuffer',
        // 动画本身没有音轨，别让编码器去找音频。
        muted: true,
        // Remotion 免费许可：按它的要求在调用处声明，换来不带警告的日志。
        licenseKey: 'free-license',
        signal: controller.signal,
        onProgress: ({ progress }) => {
          setSave((prev) => (prev.kind === 'rendering' ? { kind: 'rendering', progress } : prev))
        },
      })
      const blob = await getBlob()
      if (controller.signal.aborted) return
      saveBlob(blob, fileName(current.title))
      setSave({ kind: 'idle' })
    } catch {
      // 用户点了取消：不弹错误。
      if (controller.signal.aborted) return
      setSave({ kind: 'failed', unsupported: false })
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const cancelExport = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setSave({ kind: 'idle' })
  }

  const rendering = save.kind === 'rendering'
  const pct = rendering ? Math.round(save.progress * 100) : 0
  const failed = save.kind === 'failed' ? save : null

  return (
    <div
      className="drive-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busyRef.current) onClose()
      }}
    >
      <section
        className="drive-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('book.driveTitle')}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drive-head">
          <h3>{t('book.driveTitle')}</h3>
          {failed ? (
            <span
              className="drive-ask"
              title={
                failed.unsupported
                  ? t('drive.exportUnsupportedHint')
                  : t('drive.exportFailedHint')
              }
            >
              {failed.unsupported ? t('drive.exportUnsupported') : t('drive.exportFailed')}
            </span>
          ) : null}
          {scene ? (
            rendering ? (
              <button type="button" className="drive-export" disabled>
                {t('drive.exporting', { pct })}
              </button>
            ) : (
              <button
                type="button"
                className="drive-export"
                onClick={() => void exportMp4()}
                title={t('drive.export')}
              >
                <IconDownload />
                {failed ? t('drive.exportRetry') : t('drive.export')}
              </button>
            )
          ) : null}
          {rendering ? (
            <button type="button" className="drive-close wide" onClick={cancelExport}>
              {t('common.cancel')}
            </button>
          ) : (
            <button
              ref={closeRef}
              type="button"
              className="drive-close"
              onClick={onClose}
              title={t('common.close')}
              aria-label={t('common.close')}
            >
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M6 6l12 12" />
                <path d="M18 6 6 18" />
              </svg>
            </button>
          )}
        </header>

        <div className="drive-stage">
          {scene ? (
            <Player
              ref={playerRef}
              component={DriveComposition}
              inputProps={{ scene }}
              durationInFrames={scene.introFrames + scene.driveFrames + scene.outroFrames}
              fps={DRIVE_FPS}
              compositionWidth={scene.width}
              compositionHeight={scene.height}
              style={{ width: '100%' }}
              controls
              autoPlay
              acknowledgeRemotionLicense
              clickToPlay={false}
              doubleClickToFullscreen
              spaceKeyToPlayOrPause
              showVolumeControls={false}
              moveToBeginningWhenEnded={false}
            />
          ) : (
            <p className="drive-note">
              {empty ? t('book.driveEmpty') : t('book.driveLoading')}
            </p>
          )}
          {rendering ? (
            <div
              className="drive-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <i style={{ width: `${pct}%` }} />
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
