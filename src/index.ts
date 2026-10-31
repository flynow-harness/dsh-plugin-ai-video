/**
 * Host entry: resolves configuration, creates the file-backed studio and
 * registers the `video_*` tool family. The browser half lives in
 * `src/client` and only renders storyboard cards.
 */
import type { Context } from '@deepseek-ai/cordis'
import { resolveSettings, type AiVideoConfig } from './host/config.ts'
import { ProjectStore } from './host/store.ts'
import { VideoStudio } from './host/pipeline.ts'
import { registerVideoTools } from './host/tools.ts'

export { Config, DEFAULT_CONFIG, resolveSettings } from './host/config.ts'
export type { AiVideoConfig, VideoSettings } from './host/config.ts'
export { ProjectStore, summarize } from './host/store.ts'
export { VideoStudio, describeProject, projectPayload } from './host/pipeline.ts'
export { registerVideoTools, videoCardMeta, parseOperations } from './host/tools.ts'
export type { VideoCardMeta } from './host/tools.ts'
export { applyFrameOperations } from './host/frame-ops.ts'
export type { FrameOperation } from './host/frame-ops.ts'
export { buildCues, splitNarration, splitSubtitles, toSrt, toVtt } from './host/subtitles.ts'
export type { Cue } from './host/subtitles.ts'
export { buildTimeline, estimateNarrationSec, formatClock, frameDuration } from './host/render/timeline.ts'
export type { Timeline, TimelineFrame } from './host/render/timeline.ts'
export { buildRenderPlan, escapeFilterPath } from './host/render/plan.ts'
export type { BuildPlanInput, PlanSegment, RenderPlan } from './host/render/plan.ts'
export { STYLE_PRESETS, resolveStyle, styleIds } from './host/styles.ts'
export type { StylePreset } from './host/styles.ts'
export { renderTitleCard, renderHtmlFrame, renderCaptionOverlay } from './host/render/card.ts'
export { renderPreviewDocument } from './host/render/preview.ts'
export * from './host/types.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'ai-video'

/** The tool registry is the only required Host service. */
export const inject = ['tools']

/**
 * Resolve config, create the studio, and register every tool.
 * @param ctx - Host context.
 * @param config - Loader-applied config; schemastery filled the defaults.
 */
export function apply(ctx: Context, config: Partial<AiVideoConfig>): void {
  const settings = resolveSettings(config)
  const studio = new VideoStudio(new ProjectStore(settings.rootDir), settings)
  registerVideoTools(ctx, studio)
}
