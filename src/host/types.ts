/**
 * Durable shapes of one video project: the outline-level frames the agent
 * writes, the generated media paths on disk, and the rendered output record.
 * Everything here is plain JSON so `project.json` is reproducible and the
 * Session log can carry the same values.
 */

/** Creation modes ported from the reference workbench. */
export const VIDEO_MODES = ['image', 'html'] as const
/** Storyboard mode: generated stills, or generated HTML/CSS/JS animation frames. */
export type VideoMode = (typeof VIDEO_MODES)[number]

/** Supported output shapes, mapped to pixel dimensions by {@link ASPECT_SIZES}. */
export const VIDEO_ASPECTS = ['16:9', '9:16', '1:1'] as const
export type VideoAspect = (typeof VIDEO_ASPECTS)[number]

/** Default frame size per aspect ratio. */
export const ASPECT_SIZES: Readonly<Record<VideoAspect, { width: number; height: number }>> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
}

/** Which pipeline steps produced a frame's current media. */
export type ImageSource = 'api' | 'browser' | 'file'

/** One storyboard frame. */
export interface VideoFrame {
  /** Stable id such as `f1`; survives reordering and editing. */
  id: string
  /** Short on-screen title; may be empty. */
  title: string
  /** Narration read aloud and split into subtitles. */
  narration: string
  /** Image prompt (`image` mode) or a note describing the animation (`html` mode). */
  visual: string
  /** Complete HTML document body for `html` mode; empty in `image` mode. */
  html: string
  /** Manual duration override in seconds; otherwise derived from audio or narration length. */
  durationSec?: number
  /** Absolute path of the still used for this frame. */
  imagePath?: string
  imageSource?: ImageSource
  /** Absolute path of the narration audio. */
  audioPath?: string
  /** Measured narration length. */
  audioDurationMs?: number
  /** Absolute path of a full-frame caption overlay rendered for burn-in. */
  captionDir?: string
}

/** Rendered deliverables of one project. */
export interface VideoOutput {
  mp4Path: string
  previewPath: string
  srtPath: string
  vttPath: string
  durationSec: number
  bytes: number
  renderedAt: string
  /** Whether subtitles were burned into the video (requires an ffmpeg with libass). */
  burnIn: boolean
}

/** The stored project document. */
export interface VideoProject {
  /** Schema marker for future migrations. */
  version: 1
  id: string
  title: string
  summary: string
  mode: VideoMode
  style: string
  aspect: VideoAspect
  width: number
  height: number
  fps: number
  createdAt: string
  updatedAt: string
  frames: VideoFrame[]
  output?: VideoOutput
}

/** Compact row for `video_list`. */
export interface ProjectSummary {
  id: string
  title: string
  mode: VideoMode
  style: string
  aspect: VideoAspect
  frames: number
  images: number
  audio: number
  durationSec: number
  updatedAt: string
  rendered: boolean
}

/** A project plus the directory it lives in. */
export interface ProjectRef {
  project: VideoProject
  dir: string
}
