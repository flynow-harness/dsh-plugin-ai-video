/**
 * Frame timing. A frame's duration comes from an explicit override, else the
 * measured narration plus a tail, else an estimate from the narration text, so
 * an outline can be previewed and exported before any audio exists.
 */
import type { VideoFrame, VideoProject } from '../types.ts'

/** Fallback for a frame with no narration at all. */
export const EMPTY_FRAME_SEC = 3
/** Floor for any frame, including a one-word narration. */
export const MIN_FRAME_SEC = 1.5
/** Ceiling that keeps a runaway narration from becoming a static slide. */
export const MAX_FRAME_SEC = 30

/** Count CJK characters; each one is a spoken syllable. */
function cjkCount(text: string): number {
  return [...text].filter(char => /\p{Script=Han}/u.test(char)).length
}

/** Latin words, the other speech-rate unit. */
function wordCount(text: string): number {
  return (text.match(/[A-Za-z0-9][A-Za-z0-9'’.-]*/g) ?? []).length
}

/**
 * Estimate narration length from its text.
 * @param narration - spoken text of one frame.
 * @returns seconds at a calm presentation pace.
 */
export function estimateNarrationSec(narration: string): number {
  const text = narration.trim()
  if (text.length === 0) return EMPTY_FRAME_SEC
  const seconds = cjkCount(text) * 0.2 + wordCount(text) * 0.32
  const punctuationPauses = (text.match(/[，,。！？!?；;：:]/g) ?? []).length * 0.12
  return clamp(seconds + punctuationPauses, MIN_FRAME_SEC, MAX_FRAME_SEC)
}

/** Clamp without surprising NaN through `Math.min`. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/**
 * Resolve one frame's duration.
 * @param frame - storyboard frame.
 * @param tailSec - silence appended after narration audio.
 * @returns seconds, always ≥ {@link MIN_FRAME_SEC}.
 */
export function frameDuration(frame: VideoFrame, tailSec: number): number {
  if (frame.durationSec !== undefined && frame.durationSec > 0) {
    return clamp(frame.durationSec, MIN_FRAME_SEC, MAX_FRAME_SEC * 4)
  }
  if (frame.audioDurationMs !== undefined && frame.audioDurationMs > 0) {
    return clamp(frame.audioDurationMs / 1000 + tailSec, MIN_FRAME_SEC, MAX_FRAME_SEC * 4)
  }
  return estimateNarrationSec(frame.narration)
}

/** One frame placed on the project-wide timeline. */
export interface TimelineFrame {
  frame: VideoFrame
  /** 1-based storyboard position. */
  index: number
  /** Seconds from the start of the video. */
  start: number
  /** Seconds from the start of the video. */
  end: number
  duration: number
}

/** Full timeline of a project. */
export interface Timeline {
  frames: TimelineFrame[]
  duration: number
}

/**
 * Place every frame on the project timeline.
 * @param project - project with ordered frames.
 * @param tailSec - narration tail silence.
 * @returns the timeline in frames-per-second-independent seconds.
 */
export function buildTimeline(project: VideoProject, tailSec: number): Timeline {
  const frames: TimelineFrame[] = []
  let cursor = 0
  for (const [offset, frame] of project.frames.entries()) {
    const duration = frameDuration(frame, tailSec)
    frames.push({ frame, index: offset + 1, start: cursor, end: cursor + duration, duration })
    cursor += duration
  }
  return { frames, duration: cursor }
}

/** `mm:ss` label used in model-facing text and the preview player. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}
