/**
 * The studio pipeline: outline replacement, storyboard edits, media
 * generation, preview and MP4 export. Tools are thin wrappers over this class,
 * so the same operations stay testable without a Session.
 */
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { VideoSettings } from './config.ts'
import { applyFrameOperations, type FrameOperation } from './frame-ops.ts'
import { generateStill } from './media/image.ts'
import { screenshotHtml } from './media/browser.ts'
import { synthesizeNarration } from './media/tts.ts'
import { renderCaptionOverlay, renderHtmlFrame, renderTitleCard } from './render/card.ts'
import { renderVideo } from './render/ffmpeg.ts'
import { renderPreviewDocument } from './render/preview.ts'
import { buildTimeline, formatClock, type Timeline } from './render/timeline.ts'
import { buildCues, toSrt, toVtt, type Cue } from './subtitles.ts'
import { summarize, type ProjectStore } from './store.ts'
import { resolveStyle } from './styles.ts'
import type { ProjectSummary, VideoFrame, VideoProject } from './types.ts'

/** Frame input accepted by {@link VideoStudio.setOutline}. */
export interface OutlineFrameInput {
  title?: string
  narration: string
  visual?: string
  html?: string
  durationSec?: number
}

/** Outline replacement input. */
export interface OutlineInput {
  frames: OutlineFrameInput[]
  title?: string
  summary?: string
}

/** Media generation scope. */
export type GenerateTargets = 'all' | 'images' | 'audio'

/** One successfully generated asset. */
export interface GeneratedAsset {
  frameId: string
  kind: 'image' | 'audio'
  provider: string
  path: string
}

/** One failed asset. */
export interface FailedAsset {
  frameId: string
  kind: 'image' | 'audio'
  error: string
}

/** Result of a generation run. */
export interface GenerateReport {
  assets: GeneratedAsset[]
  failed: FailedAsset[]
  skipped: string[]
}

/** Preview deliverables. */
export interface PreviewReport {
  previewPath: string
  srtPath: string
  vttPath: string
  durationSec: number
  cues: Cue[]
  timeline: Timeline
}

/** Render deliverables. */
export interface RenderReport extends PreviewReport {
  mp4Path: string
  bytes: number
  burnIn: boolean
}

/** Deep copy through JSON so optional properties never reach the registry as `undefined`. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Readable message from an unknown thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Clamp an index option into the frames array. */
function frameFilter(project: VideoProject, frameIds: readonly string[] | undefined): VideoFrame[] {
  if (frameIds === undefined || frameIds.length === 0) return [...project.frames]
  const wanted = new Set(frameIds)
  const unknown = [...wanted].filter(id => !project.frames.some(frame => frame.id === id))
  if (unknown.length > 0) throw new Error(`unknown frame ids: ${unknown.join(', ')}`)
  return project.frames.filter(frame => wanted.has(frame.id))
}

/** Project + timeline shape every tool returns. */
export function projectPayload(project: VideoProject, settings: VideoSettings): Record<string, unknown> {
  const timeline = buildTimeline(project, settings.frameTailSec)
  const cues = buildCues(project, timeline)
  return plain({
    project,
    summary: summarize(project),
    timeline: timeline.frames.map(placed => ({
      index: placed.index,
      frameId: placed.frame.id,
      title: placed.frame.title,
      start: Number(placed.start.toFixed(2)),
      end: Number(placed.end.toFixed(2)),
      duration: Number(placed.duration.toFixed(2)),
      hasImage: placed.frame.imagePath !== undefined,
      hasAudio: placed.frame.audioPath !== undefined,
      narration: placed.frame.narration,
    })),
    cues,
    durationSec: Number(timeline.duration.toFixed(2)),
  })
}

/**
 * All studio operations over one store and settings.
 */
export class VideoStudio {
  constructor(
    readonly store: ProjectStore,
    readonly settings: VideoSettings,
  ) {}

  /** Create an empty project. */
  async create(input: { title: string; mode?: 'image' | 'html'; style?: string; aspect?: '16:9' | '9:16' | '1:1'; summary?: string }): Promise<VideoProject> {
    await this.store.init()
    return this.store.create(input)
  }

  /** List projects. */
  async list(): Promise<ProjectSummary[]> {
    await this.store.init()
    return this.store.list()
  }

  /** Load one project. */
  async load(id: string): Promise<VideoProject> {
    return this.store.load(id)
  }

  /** Replace the outline while keeping the project's identity and output cleared. */
  async setOutline(id: string, input: OutlineInput): Promise<VideoProject> {
    if (input.frames.length === 0) throw new Error('frames must contain at least one frame')
    if (input.frames.length > 80) throw new Error('a project supports at most 80 frames')
    const project = await this.store.load(id)
    const frames: VideoFrame[] = input.frames.map((frame, position) => {
      const narration = frame.narration.trim()
      if (narration.length === 0) throw new Error(`frame ${position + 1} needs a non-empty narration`)
      const built: VideoFrame = {
        id: `f${position + 1}`,
        title: frame.title?.trim() ?? '',
        narration,
        visual: frame.visual?.trim() ?? '',
        html: frame.html ?? '',
      }
      if (frame.durationSec !== undefined) built.durationSec = frame.durationSec
      return built
    })
    const next: VideoProject = {
      ...project,
      frames,
      title: input.title?.trim() ?? project.title,
      summary: input.summary?.trim() ?? project.summary,
    }
    delete next.output
    await this.store.ensureDirs(id)
    return this.store.save(next)
  }

  /** Apply storyboard edits. */
  async editFrames(id: string, operations: readonly FrameOperation[]): Promise<VideoProject> {
    const project = await this.store.load(id)
    const frames = applyFrameOperations(project.frames, operations)
    const next: VideoProject = { ...project, frames }
    delete next.output
    return this.store.save(next)
  }

  /** Generate stills and/or narration for the selected frames. */
  async generate(id: string, options: { targets?: GenerateTargets; frameIds?: readonly string[]; signal?: AbortSignal }): Promise<{ report: GenerateReport; project: VideoProject }> {
    const project = await this.store.load(id)
    const targets = options.targets ?? 'all'
    const selected = frameFilter(project, options.frameIds)
    await this.store.ensureDirs(id)
    const report: GenerateReport = { assets: [], failed: [], skipped: [] }
    const assetsDir = this.store.assetsDir(id)
    let working: VideoProject = project
    for (const frame of working.frames) {
      if (!selected.some(item => item.id === frame.id)) continue
      if (targets === 'all' || targets === 'images') {
        try {
          const result = await this.generateStillFor(working, frame, assetsDir, options.signal)
          const target = working.frames.find(item => item.id === frame.id)
          if (result === undefined || target === undefined) {
            report.skipped.push(`${frame.id}: no still source available`)
          } else {
            target.imagePath = result.path
            target.imageSource = result.source
            report.assets.push({ frameId: frame.id, kind: 'image', provider: result.source, path: result.path })
            working = await this.store.save(working)
          }
        } catch (error) {
          report.failed.push({ frameId: frame.id, kind: 'image', error: messageOf(error) })
        }
      }
      if (options.signal?.aborted) break
      if (targets === 'all' || targets === 'audio') {
        try {
          const audio = await synthesizeNarration({
            text: frame.narration,
            frameId: frame.id,
            outDir: assetsDir,
            settings: this.settings,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          })
          const target = working.frames.find(item => item.id === frame.id)
          if (target !== undefined) {
            target.audioPath = audio.path
            target.audioDurationMs = audio.durationMs
            report.assets.push({ frameId: frame.id, kind: 'audio', provider: audio.provider, path: audio.path })
            working = await this.store.save(working)
          }
        } catch (error) {
          report.failed.push({ frameId: frame.id, kind: 'audio', error: messageOf(error) })
        }
      }
      if (options.signal?.aborted) break
    }
    return { report, project: working }
  }

  /** Pick the cheapest still source for one frame. */
  private async generateStillFor(
    project: VideoProject,
    frame: VideoFrame,
    assetsDir: string,
    signal?: AbortSignal,
  ): Promise<{ path: string; source: 'api' | 'browser' } | undefined> {
    const index = project.frames.findIndex(item => item.id === frame.id) + 1
    const canBrowser = this.settings.browserRender
    const hasGateway = this.settings.imageBaseUrl.length > 0
    if (project.mode === 'html' && frame.html.trim().length > 0 && canBrowser) {
      const html = renderHtmlFrame(project, frame, index)
      const path = join(assetsDir, `${frame.id}.png`)
      await screenshotHtml(this.settings, html, path, {
        width: project.width,
        height: project.height,
        settleMs: 1500,
        workDir: assetsDir,
        ...(signal === undefined ? {} : { signal }),
      })
      return { path, source: 'browser' }
    }
    if (frame.visual.trim().length > 0 && hasGateway) {
      const still = await generateStill({
        prompt: frame.visual,
        frameId: frame.id,
        outDir: assetsDir,
        settings: this.settings,
        ...(signal === undefined ? {} : { signal }),
      })
      return { path: still.path, source: 'api' }
    }
    if (this.settings.autoVisuals && canBrowser) {
      const html = renderTitleCard({
        style: project.style,
        title: frame.title,
        narration: frame.narration,
        index,
        total: project.frames.length,
        width: project.width,
        height: project.height,
        projectTitle: project.title,
      })
      const path = join(assetsDir, `${frame.id}.png`)
      await screenshotHtml(this.settings, html, path, {
        width: project.width,
        height: project.height,
        settleMs: 500,
        workDir: assetsDir,
        ...(signal === undefined ? {} : { signal }),
      })
      return { path, source: 'browser' }
    }
    return undefined
  }

  /** Write `.srt`, `.vtt` and the preview player, filling missing stills when allowed. */
  async writePreview(id: string, options: { fillStills?: boolean; signal?: AbortSignal } = {}): Promise<PreviewReport> {
    let project = await this.store.load(id)
    const assetsDir = this.store.assetsDir(id)
    const outDir = this.store.outDir(id)
    await this.store.ensureDirs(id)
    if (options.fillStills !== false && this.settings.autoVisuals) {
      let changed = false
      for (const [position, frame] of project.frames.entries()) {
        if (frame.imagePath !== undefined) continue
        try {
          const result = await this.generateStillFor(project, frame, assetsDir, options.signal)
          if (result !== undefined) {
            frame.imagePath = result.path
            frame.imageSource = result.source
            changed = true
          }
        } catch {
          // A preview without a still falls back to the player's CSS card.
        }
        void position
      }
      if (changed) project = await this.store.save(project)
    }
    const timeline = buildTimeline(project, this.settings.frameTailSec)
    const cues = buildCues(project, timeline)
    const srt = toSrt(cues)
    const vtt = toVtt(cues)
    const srtPath = join(outDir, 'subtitles.srt')
    const vttPath = join(outDir, 'subtitles.vtt')
    await writeFile(srtPath, srt, 'utf8')
    await writeFile(vttPath, vtt, 'utf8')
    const previewPath = join(this.store.projectDir(id), 'preview.html')
    await writeFile(previewPath, renderPreviewDocument(project, timeline, cues, this.store.projectDir(id)), 'utf8')
    return { previewPath, srtPath, vttPath, durationSec: timeline.duration, cues, timeline }
  }

  /** Render the MP4 (and refresh the preview). */
  async render(id: string, options: { burnSubtitles?: boolean; signal?: AbortSignal } = {}): Promise<{ report: RenderReport; project: VideoProject }> {
    const preview = await this.writePreview(id, options.signal === undefined ? {} : { signal: options.signal })
    const project = await this.store.load(id)
    if (project.frames.length === 0) throw new Error('nothing to render: the project has no frames')
    const outDir = this.store.outDir(id)
    await mkdir(outDir, { recursive: true })
    const mp4Path = join(outDir, `${project.id}.mp4`)
    const encoded = await renderVideo({
      project,
      timeline: preview.timeline,
      settings: this.settings,
      outPath: mp4Path,
      srtPath: preview.srtPath,
      burnSubtitles: options.burnSubtitles ?? this.settings.burnSubtitles,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    const next: VideoProject = {
      ...project,
      output: {
        mp4Path: encoded.mp4Path,
        previewPath: preview.previewPath,
        srtPath: preview.srtPath,
        vttPath: preview.vttPath,
        durationSec: Number(encoded.durationSec.toFixed(2)),
        bytes: encoded.bytes,
        burnIn: encoded.burnIn,
        renderedAt: new Date().toISOString(),
      },
    }
    const saved = await this.store.save(next)
    return {
      report: {
        ...preview,
        mp4Path: encoded.mp4Path,
        bytes: encoded.bytes,
        burnIn: encoded.burnIn,
      },
      project: saved,
    }
  }
}

/** Human-readable one-line project heading for tool results. */
export function describeProject(project: VideoProject, settings: VideoSettings): string {
  const timeline = buildTimeline(project, settings.frameTailSec)
  const style = resolveStyle(project.style)
  return `${project.title} · ${project.mode === 'html' ? 'HTML' : '图片'}模式 · ${style.name.zh} · ${project.aspect} · ${project.frames.length} 镜 · ${formatClock(timeline.duration)}`
}

/** Size of a file in bytes, or 0 when missing. */
export async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

/** Caption overlay HTML for burn-in experiments and future per-cue rendering. */
export function captionHtml(text: string, style: string, width: number, height: number): string {
  return renderCaptionOverlay(text, style, width, height)
}
