/**
 * Storyboard card for every `video_*` tool call. The pending state names what
 * the call is doing; the settled state shows the produced storyboard: mode,
 * style, media readiness per frame and total duration. All data comes from the
 * recorded call arguments and the tool's persisted presentation metadata, so
 * the card replays from the Session log.
 */
import { useState } from 'react'
import { DisclosureRow, IconPlayOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { VideoCardMeta } from '../host/tools.ts'
import type { AiVideoKey } from './locales.ts'
import css from './VideoToolRow.module.css'

type VideoToolRowProps = ToolCallViewProps & PropsLocale<'aiVideo'>

/** Call states rendered by the row. */
type RowState = 'preparing' | 'running' | 'empty' | 'outline' | 'partial' | 'ready' | 'error'

/** Tool name to pending title key. */
const TOOL_TITLES: Readonly<Record<string, AiVideoKey>> = {
  video_create: 'row.create',
  video_list: 'row.list',
  video_outline: 'row.outline',
  video_edit_frames: 'row.edit',
  video_generate: 'row.generate',
  video_preview: 'row.preview',
  video_render: 'row.render',
  video_show: 'row.show',
}

/** State label key per status. */
const STATUS_KEYS: Readonly<Record<Exclude<RowState, 'preparing' | 'running' | 'error'>, AiVideoKey>> = {
  empty: 'status.empty',
  outline: 'status.outline',
  partial: 'status.partial',
  ready: 'status.ready',
}

/** Total minutes and seconds of a duration. */
function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Validate the persisted metadata; a foreign or older shape falls back to text. */
export function readCardMeta(meta: unknown): VideoCardMeta | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined
  const candidate = meta as Partial<VideoCardMeta>
  if (candidate.kind !== 'dsh-ai-video') return undefined
  if (typeof candidate.projectId !== 'string' || typeof candidate.title !== 'string') return undefined
  if (!Array.isArray(candidate.frames)) return undefined
  return candidate as VideoCardMeta
}

/** Join the model-facing text blocks of a result. */
function textOf(block: ToolCallViewProps['block']): string {
  return block.content.flatMap((item: ContentBlock) => item.type === 'text' ? [item.text] : []).join('\n').trim()
}

/**
 * Render one video tool call as a storyboard row.
 * @param props - tool call, phase and localized copy.
 * @returns the disclosure row.
 */
export function VideoToolRow(props: VideoToolRowProps) {
  const { block, phase, toolName, t, inspect } = props
  const [open, setOpen] = useState(false)
  const meta = readCardMeta('meta' in block ? block.meta : undefined)
  const projectHint = block.args.text('projectId') ?? block.args.text('title') ?? ''
  const pendingTitle = t(TOOL_TITLES[toolName] ?? 'row.title')
  const failed = phase === 'result' && block.isError
  const errorText = failed ? textOf(block) : ''
  const resultText = phase === 'result' && !failed ? textOf(block) : ''
  const state: RowState = phase === 'preparing'
    ? 'preparing'
    : phase === 'start'
      ? 'running'
      : failed
        ? 'error'
        : meta?.status ?? 'ready'
  const running = state === 'preparing' || state === 'running'
  const title = meta?.title ?? (projectHint.length > 0 ? projectHint : pendingTitle)
  const frames = meta?.frames ?? []
  const expandable = frames.length > 0 || errorText.length > 0 || (resultText.length > 0 && meta === undefined)
  const statusLabel = state === 'preparing'
    ? t('status.preparing')
    : state === 'running'
      ? t('status.running')
      : state === 'error'
        ? t('status.error')
        : t(STATUS_KEYS[state])

  // The settled row names the tool that ran; readiness still shows through the
  // frame counts and the outline/partial states.
  const toolLabel = t(TOOL_TITLES[toolName] ?? 'row.title')
  const showStatus = state !== 'ready'
  const summary = (
    <span className={css.summary}>
      <span className={css.chip}>{phase === 'result' && meta === undefined ? pendingTitle : toolLabel}</span>
      {showStatus && meta !== undefined && <span className={css.chip}>{statusLabel}</span>}
      {meta !== undefined && (
        <>
          <span className={css.chip}>{t(meta.mode === 'html' ? 'chip.mode.html' : 'chip.mode.image')}</span>
          <span className={css.chip}>{meta.styleName}</span>
          <span className={css.chip}>{t('chip.frames').replace('{count}', String(meta.frames.length))}</span>
          <span className={css.chip}>{clock(meta.durationSec)}</span>
          <span className={`${css.chip} ${css.accent}`}>
            {t('chip.images').replace('{count}', String(meta.images))}
            {' · '}
            {t('chip.audio').replace('{count}', String(meta.audio))}
          </span>
        </>
      )}
      {meta === undefined && phase !== 'result' && projectHint.length > 0 && (
        <span className={css.muted}>{projectHint}</span>
      )}
    </span>
  )

  return (
    <div className={css.root} data-tool={toolName} data-state={state}>
      <DisclosureRow
        title={title}
        icon={<IconPlayOutlineRegular size={14} />}
        running={running}
        open={open}
        expandable={expandable}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setOpen(value => !value) }}
        collapsedContent={summary}
      >
        <div className={css.panel}>
          {errorText.length > 0 && (
            <div>
              <div className={css.meta}>{t('error')}</div>
              <pre className={css.error}>{errorText}</pre>
            </div>
          )}
          {frames.length > 0 && (
            <div className={css.frames}>
              {frames.slice(0, 24).map(frame => (
                <div className={css.frame} key={frame.index} data-frame={frame.index}>
                  <span className={css.index}>{String(frame.index).padStart(2, '0')}</span>
                  <span className={css.frameBody}>
                    <span className={css.frameTitle}>{frame.title.length > 0 ? frame.title : t('frame.narration')}</span>
                    <span className={css.narration}>{t('frame.chars').replace('{count}', String(frame.chars))}</span>
                  </span>
                  <span className={css.badges}>
                    <span className={`${css.badge} ${frame.hasImage ? css.badgeOn : ''}`}>{t('frame.image')}</span>
                    <span className={`${css.badge} ${frame.hasAudio ? css.badgeOn : ''}`}>{t('frame.audio')}</span>
                  </span>
                  <span className={css.duration}>{frame.duration.toFixed(1)}s</span>
                </div>
              ))}
              {frames.length > 24 && (
                <div className={css.muted}>{t('more').replace('{count}', String(frames.length - 24))}</div>
              )}
            </div>
          )}
          {meta === undefined && resultText.length > 0 && (
            <pre className={css.error}>{resultText}</pre>
          )}
          {meta !== undefined && (
            <div className={css.meta}>
              <span>{meta.projectId}</span>
              {meta.mp4Path !== undefined && <span>{meta.mp4Path}</span>}
            </div>
          )}
          {inspect !== undefined && (
            <button type="button" className={css.inspect} onClick={inspect}>{t('inspect')}</button>
          )}
        </div>
      </DisclosureRow>
    </div>
  )
}
