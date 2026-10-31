/**
 * ffmpeg execution: probe durations and filters, then encode the plan from
 * `plan.ts`. Every external command is resolved from settings, so a user can
 * point the plugin at a static ffmpeg build or `ffmpeg-full`.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { VideoSettings } from '../config.ts'
import { buildRenderPlan, type PlanSegment } from './plan.ts'
import type { Timeline } from './timeline.ts'
import type { VideoProject } from '../types.ts'

const run = promisify(execFile)

/** Run one ffmpeg-family binary, surfacing the tail of stderr on failure. */
async function execBinary(binary: string, args: string[], signal: AbortSignal | undefined, timeout = 20 * 60_000): Promise<string> {
  try {
    const { stdout } = await run(binary, args, {
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      ...(signal === undefined ? {} : { signal }),
    })
    return stdout
  } catch (error) {
    const stderr = (error as Error & { stderr?: string }).stderr
    const tail = typeof stderr === 'string' ? stderr.trim().split('\n').slice(-6).join('\n') : ''
    throw new Error(`${binary} failed: ${(error as Error).message}${tail.length > 0 ? `\n${tail}` : ''}`)
  }
}

/**
 * Read a media file's duration in seconds.
 * @param settings - resolved settings.
 * @param path - audio or video file.
 * @param signal - tool cancellation.
 * @returns duration, or undefined when ffprobe cannot read the file.
 */
export async function probeDuration(settings: VideoSettings, path: string, signal?: AbortSignal): Promise<number | undefined> {
  try {
    const stdout = await execBinary(settings.ffprobePath, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=nw=1:nk=1',
      path,
    ], signal, 30_000)
    const value = Number.parseFloat(stdout.trim())
    return Number.isFinite(value) && value > 0 ? value : undefined
  } catch {
    return undefined
  }
}

/** Whether a named ffmpeg filter is compiled in. */
const filterCache = new Map<string, Set<string>>()

/**
 * Check filter availability (drives subtitle burn-in support).
 * @param settings - resolved settings.
 * @param name - filter name such as `subtitles`.
 * @returns true when the filter exists.
 */
export async function hasFilter(settings: VideoSettings, name: string): Promise<boolean> {
  const cached = filterCache.get(settings.ffmpegPath)
  if (cached !== undefined) return cached.has(name)
  try {
    const stdout = await execBinary(settings.ffmpegPath, ['-hide_banner', '-filters'], undefined, 30_000)
    const names = new Set<string>()
    for (const line of stdout.split('\n')) {
      const match = /^\s*[A-Z.]{2,3}\s+(\S+)\s/.exec(line)
      if (match?.[1] !== undefined) names.add(match[1])
    }
    filterCache.set(settings.ffmpegPath, names)
    return names.has(name)
  } catch {
    filterCache.set(settings.ffmpegPath, new Set())
    return false
  }
}

/** Result of one render. */
export interface RenderResult {
  mp4Path: string
  durationSec: number
  bytes: number
  burnIn: boolean
}

/** Options for {@link renderVideo}. */
export interface RenderVideoOptions {
  project: VideoProject
  timeline: Timeline
  settings: VideoSettings
  outPath: string
  srtPath?: string
  /** Burn subtitles when libass is available. */
  burnSubtitles: boolean
  signal?: AbortSignal
}

/**
 * Encode the timeline to an H.264/AAC MP4.
 * @param options - project, timeline, settings and destination.
 * @returns the encoded file's metadata.
 */
export async function renderVideo(options: RenderVideoOptions): Promise<RenderResult> {
  const { project, timeline, settings, outPath } = options
  if (timeline.frames.length === 0) throw new Error('nothing to render: the project has no frames')
  const burnIn = options.burnSubtitles
    && options.srtPath !== undefined
    && existsSync(options.srtPath)
    && await hasFilter(settings, 'subtitles')
  const segments: PlanSegment[] = timeline.frames.map(placed => {
    const segment: PlanSegment = { duration: placed.duration }
    if (placed.frame.imagePath !== undefined && existsSync(placed.frame.imagePath)) segment.imagePath = placed.frame.imagePath
    if (placed.frame.audioPath !== undefined && existsSync(placed.frame.audioPath)) segment.audioPath = placed.frame.audioPath
    return segment
  })
  const plan = buildRenderPlan({
    width: project.width,
    height: project.height,
    fps: settings.fps,
    segments,
    burnIn,
    ...(options.srtPath === undefined ? {} : { srtPath: options.srtPath }),
  })
  // Keep the graph beside the output for inspection; ffmpeg receives it inline
  // because `-filter_complex_script` was removed in ffmpeg 9.
  const graphPath = join(dirname(outPath), 'filtergraph.txt')
  await writeFile(graphPath, plan.filterGraph, 'utf8')
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    ...plan.inputs,
    '-filter_complex', plan.filterGraph,
    '-map', '[vout]',
    '-map', '[ac]',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', String(settings.crf),
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    '-movflags', '+faststart',
    outPath,
  ]
  await execBinary(settings.ffmpegPath, args, options.signal)
  const info = await stat(outPath)
  const durationSec = await probeDuration(settings, outPath, options.signal) ?? timeline.duration
  return { mp4Path: outPath, durationSec, bytes: info.size, burnIn }
}
