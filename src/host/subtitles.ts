/**
 * Subtitle generation. A frame's narration is split at punctuation, the frame
 * duration is shared by character weight, and the per-frame cues are shifted
 * onto the project timeline. The same cues feed `.srt`, `.vtt` and the preview
 * player, so the three never disagree.
 */
import type { Timeline } from './render/timeline.ts'
import type { VideoProject } from './types.ts'

/** One timed caption. */
export interface Cue {
  /** Seconds from the start of the video. */
  start: number
  /** Seconds from the start of the video. */
  end: number
  text: string
  /** 1-based storyboard frame the cue belongs to. */
  frame: number
}

/** A caption shorter than this reads as a flicker. */
const MIN_CUE_SEC = 0.7
/** Long captions are split so a viewer can read them. */
const MAX_CUE_CHARS = 26

/** Weight one segment: CJK characters and Latin words read at different speeds. */
function segmentWeight(text: string): number {
  const cjk = (text.match(/\p{Script=Han}/gu) ?? []).length
  const words = (text.match(/[A-Za-z0-9][A-Za-z0-9'’.-]*/g) ?? []).length
  return Math.max(1, cjk + words * 1.6)
}

/** Split one over-long segment on a space or clause punctuation near the midpoint. */
function splitLongSegment(segment: string): string[] {
  if ([...segment].length <= MAX_CUE_CHARS) return [segment]
  const chars = [...segment]
  const half = Math.floor(chars.length / 2)
  const searchFrom = Math.max(0, half - 8)
  const searchTo = Math.min(chars.length - 1, half + 8)
  let cut = -1
  for (let offset = 0; offset <= searchTo - searchFrom; offset += 1) {
    for (const candidate of [searchFrom + offset, searchTo - offset]) {
      const char = chars[candidate]
      if (char === ' ' || char === '，' || char === ',' || char === '、') cut = candidate
      if (cut >= 0) break
    }
    if (cut >= 0) break
  }
  if (cut < 0) cut = half
  const head = chars.slice(0, cut).join('').trim()
  const tail = chars.slice(cut + 1).join('').trim()
  if (head.length === 0 || tail.length === 0) return [segment]
  return [head, ...splitLongSegment(tail)]
}

/**
 * Split narration into readable segments.
 * @param narration - spoken text of one frame.
 * @returns non-empty segments in reading order.
 */
export function splitNarration(narration: string): string[] {
  const cleaned = narration.trim().replace(/[。！？.!?]+\s*$/u, '').trim()
  if (cleaned.length === 0) return []
  const raw = cleaned
    .split(/(?<=[，,。！？!?；;：:])\s*/u)
    .map(segment => segment.replace(/[，,。！？!?；;：:]+$/u, '').trim())
    .filter(segment => segment.length > 0)
  return raw.flatMap(splitLongSegment)
}

/**
 * Time one frame's segments inside that frame's window.
 * @param narration - spoken text.
 * @param duration - frame duration in seconds.
 * @returns cues relative to the frame start.
 */
export function splitSubtitles(narration: string, duration: number): Array<{ text: string; start: number; end: number }> {
  if (!(duration > 0)) return []
  const segments = splitNarration(narration)
  if (segments.length === 0) return []
  if (segments.length === 1) return [{ text: segments[0] ?? '', start: 0, end: duration }]
  const weights = segments.map(segmentWeight)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const cues: Array<{ text: string; start: number; end: number }> = []
  let cursor = 0
  for (const [index, segment] of segments.entries()) {
    const weight = weights[index] ?? 1
    const start = cursor
    const end = index === segments.length - 1 ? duration : Math.min(duration, start + (weight / total) * duration)
    cursor = end
    if (end - start < MIN_CUE_SEC && cues.length > 0) {
      const previous = cues[cues.length - 1]
      if (previous !== undefined) {
        previous.end = end
        previous.text = `${previous.text} ${segment}`.trim()
        continue
      }
    }
    cues.push({ text: segment, start, end })
  }
  return cues
}

/**
 * Build the project-wide caption track.
 * @param project - project with narration.
 * @param timeline - placed frames.
 * @returns cues ordered by start time, clipped to each frame.
 */
export function buildCues(project: VideoProject, timeline: Timeline): Cue[] {
  const cues: Cue[] = []
  for (const placed of timeline.frames) {
    const local = splitSubtitles(placed.frame.narration, placed.duration)
    for (const cue of local) {
      const start = placed.start + cue.start
      const end = Math.min(placed.start + cue.end, placed.end)
      if (end - start <= 0.05) continue
      cues.push({ start, end, text: cue.text, frame: placed.index })
    }
  }
  return cues
}

/** `HH:MM:SS,mmm` for SRT. */
function srtTime(seconds: number): string {
  const clamped = Math.max(0, seconds)
  const hours = Math.floor(clamped / 3600)
  const minutes = Math.floor((clamped % 3600) / 60)
  const secs = Math.floor(clamped % 60)
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(Math.min(999, millis)).padStart(3, '0')}`
}

/** `HH:MM:SS.mmm` for WebVTT. */
function vttTime(seconds: number): string {
  return srtTime(seconds).replace(',', '.')
}

/**
 * Serialize cues as SubRip.
 * @param cues - project caption track; `frame` is ignored.
 * @returns the complete `.srt` document.
 */
export function toSrt(cues: readonly Cue[]): string {
  return `${cues.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${cue.text}`).join('\n\n')}\n`
}

/**
 * Serialize cues as WebVTT.
 * @param cues - project caption track; `frame` is ignored.
 * @returns the complete `.vtt` document.
 */
export function toVtt(cues: readonly Cue[]): string {
  const body = cues.map(cue => `${vttTime(cue.start)} --> ${vttTime(cue.end)}\n${cue.text}`).join('\n\n')
  return `WEBVTT\n\n${body}\n`
}
