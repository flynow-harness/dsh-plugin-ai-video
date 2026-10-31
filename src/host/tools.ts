/**
 * Model-facing tools. Each tool is a thin wrapper over {@link VideoStudio};
 * the agent supplies the creative writing (outline, prompts, HTML) and the
 * plugin owns persistence, media generation, timing, subtitles and encoding.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { VideoSettings } from './config.ts'
import { applyFrameOperations, type FrameOperation } from './frame-ops.ts'
import { describeProject, projectPayload, type GenerateTargets, VideoStudio } from './pipeline.ts'
import { buildTimeline, formatClock } from './render/timeline.ts'
import { STYLE_PRESETS, resolveStyle, styleIds } from './styles.ts'
import { summarize } from './store.ts'
import { VIDEO_ASPECTS, VIDEO_MODES, type VideoAspect, type VideoFrame, type VideoMode, type VideoProject } from './types.ts'

/** Plain classification used by the Web card. */
export interface VideoCardMeta {
  kind: 'dsh-ai-video'
  projectId: string
  title: string
  mode: VideoMode
  style: string
  styleName: string
  aspect: string
  frames: Array<{ index: number; title: string; chars: number; hasImage: boolean; hasAudio: boolean; duration: number }>
  durationSec: number
  images: number
  audio: number
  status: 'empty' | 'outline' | 'partial' | 'ready'
  mp4Path?: string
  previewPath?: string
}

/** Present a lossless JSON value to the registry schema without losing the local type. */
function asJson<T>(value: T): JsonValue {
  return value as unknown as JsonValue
}

/** One text block, the only content shape this plugin renders. */
function text(text: string): ContentBlock[] {
  return [{ type: 'text', text }]
}

/** Format bytes for a model/user-facing line. */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Build the storyboard card payload from a project document. */
export function videoCardMeta(project: VideoProject, settings: VideoSettings): VideoCardMeta {
  const timeline = buildTimeline(project, settings.frameTailSec)
  const frames = timeline.frames.map(placed => ({
    index: placed.index,
    title: placed.frame.title,
    chars: [...placed.frame.narration].length,
    hasImage: placed.frame.imagePath !== undefined,
    hasAudio: placed.frame.audioPath !== undefined,
    duration: Number(placed.duration.toFixed(2)),
  }))
  const images = frames.filter(frame => frame.hasImage).length
  const audio = frames.filter(frame => frame.hasAudio).length
  const style = resolveStyle(project.style)
  const meta: VideoCardMeta = {
    kind: 'dsh-ai-video',
    projectId: project.id,
    title: project.title,
    mode: project.mode,
    style: project.style,
    styleName: style.name.zh,
    aspect: project.aspect,
    frames,
    durationSec: Number(timeline.duration.toFixed(1)),
    images,
    audio,
    status: project.output !== undefined
      ? 'ready'
      : project.frames.length === 0
        ? 'empty'
        : images === project.frames.length && audio === project.frames.length
          ? 'ready'
          : images > 0 || audio > 0
            ? 'partial'
            : 'outline',
  }
  if (project.output !== undefined) {
    meta.mp4Path = project.output.mp4Path
    meta.previewPath = project.output.previewPath
  }
  return meta
}

/** Frame lines shared by outline/show/edit renderers. */
function frameLines(project: VideoProject, settings: VideoSettings): string {
  const timeline = buildTimeline(project, settings.frameTailSec)
  return timeline.frames.map(placed => {
    const badges = [
      placed.frame.imagePath === undefined ? '缺图' : '图✓',
      placed.frame.audioPath === undefined ? '缺音' : '音✓',
    ].join(' · ')
    const label = placed.frame.title.length > 0 ? placed.frame.title : '（未命名）'
    return `${String(placed.index).padStart(2, '0')}. ${label} [${formatClock(placed.start)}–${formatClock(placed.end)}] ${badges} · ${placed.frame.narration}`
  }).join('\n')
}

/** Project footer with paths and next steps. */
function projectFooter(project: VideoProject, settings: VideoSettings): string {
  const summary = summarize(project)
  const lines = [
    '',
    `项目：${project.id}`,
    `目录：${settings.rootDir}/${project.id}`,
    `状态：${summary.images}/${summary.frames} 张图 · ${summary.audio}/${summary.frames} 段配音 · 预计 ${formatClock(summary.durationSec)}`,
  ]
  return lines.join('\n')
}

/** Generic pending card for a call with a title. */
function pendingTitle(title: string): ToolCallView {
  return { card: 'generic', title }
}

/** Output schema shared by every project-returning tool. */
const projectOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'json', required: true, description: 'Compact project statistics' },
    project: { type: 'json', required: true, description: 'Full project document' },
    timeline: { type: 'json', required: true, description: 'Placed frames with start/end/duration' },
    cues: { type: 'json', required: true, description: 'Subtitle cues on the project timeline' },
    durationSec: { type: 'number', required: true, description: 'Total duration in seconds' },
    card: { type: 'json', required: true, description: 'Storyboard card payload for the Web GUI' },
  },
} as const

/** Canonical value of a project-returning tool. */
interface ProjectOutput {
  summary: JsonValue
  project: JsonValue
  timeline: JsonValue
  cues: JsonValue
  durationSec: number
  card: JsonValue
}

/** Build the canonical project value including the card payload. */
function buildProjectOutput(project: VideoProject, settings: VideoSettings): ProjectOutput {
  const payload = projectPayload(project, settings)
  return {
    summary: asJson(payload.summary),
    project: asJson(payload.project),
    timeline: asJson(payload.timeline),
    cues: asJson(payload.cues),
    durationSec: payload.durationSec as number,
    card: asJson(videoCardMeta(project, settings)),
  }
}

/** Narrow a canonical value back into the project document for presenters. */
function projectFrom(value: unknown): VideoProject | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = (value as { project?: unknown }).project
  if (typeof candidate !== 'object' || candidate === null) return undefined
  const project = candidate as VideoProject
  if (typeof project.id !== 'string' || !Array.isArray(project.frames)) return undefined
  return project
}

/** Meta projector shared by project tools. */
function projectMeta(settings: VideoSettings) {
  return (_args: unknown, value: unknown): JsonValue => {
    const project = projectFrom(value)
    return asJson(project === undefined ? { kind: 'dsh-ai-video' } : videoCardMeta(project, settings))
  }
}

/** Describe a frame's media readiness for the result card. */
function frameBadge(frame: VideoFrame): string {
  const image = frame.imagePath === undefined ? '缺图' : '图✓'
  const audio = frame.audioPath === undefined ? '缺音' : '音✓'
  return `${image} ${audio}`
}

/** Convert loose tool arguments into typed frame operations. */
function parseOperations(raw: readonly Record<string, unknown>[]): FrameOperation[] {
  return raw.map((item, position) => {
    const op = item.op
    const frameId = typeof item.frameId === 'string' ? item.frameId : undefined
    const index = typeof item.index === 'number' ? item.index : undefined
    switch (op) {
      case 'update': {
        if (frameId === undefined) throw new Error(`operation ${position + 1}: update needs frameId`)
        const operation: FrameOperation = { op: 'update', frameId }
        if (typeof item.title === 'string') operation.title = item.title
        if (typeof item.narration === 'string') operation.narration = item.narration
        if (typeof item.visual === 'string') operation.visual = item.visual
        if (typeof item.html === 'string') operation.html = item.html
        if (typeof item.durationSec === 'number') operation.durationSec = item.durationSec
        return operation
      }
      case 'insert': {
        if (typeof item.narration !== 'string' || item.narration.trim().length === 0) {
          throw new Error(`operation ${position + 1}: insert needs narration`)
        }
        const operation: FrameOperation = { op: 'insert', narration: item.narration }
        if (index !== undefined) operation.index = index
        if (typeof item.afterFrameId === 'string') operation.afterFrameId = item.afterFrameId
        if (typeof item.title === 'string') operation.title = item.title
        if (typeof item.visual === 'string') operation.visual = item.visual
        if (typeof item.html === 'string') operation.html = item.html
        if (typeof item.durationSec === 'number') operation.durationSec = item.durationSec
        return operation
      }
      case 'remove': {
        if (frameId === undefined) throw new Error(`operation ${position + 1}: remove needs frameId`)
        return { op: 'remove', frameId }
      }
      case 'move': {
        if (frameId === undefined || index === undefined) throw new Error(`operation ${position + 1}: move needs frameId and index`)
        return { op: 'move', frameId, index }
      }
      default:
        throw new Error(`operation ${position + 1}: unknown op ${JSON.stringify(op)}`)
    }
  })
}

/** Helper used by `video_show` to expose file locations. */
function projectPaths(project: VideoProject, settings: VideoSettings): Record<string, string> {
  const dir = `${settings.rootDir.replace(/\/+$/, '')}/${project.id}`
  const paths: Record<string, string> = {
    dir,
    preview: `${dir}/preview.html`,
    subtitles: `${dir}/out/subtitles.srt`,
  }
  if (project.output !== undefined) paths.mp4 = project.output.mp4Path
  return paths
}

/**
 * Register every `video_*` tool.
 * @param ctx - host context with the tool registry.
 * @param studio - pipeline bound to the resolved settings.
 */
export function registerVideoTools(ctx: Context, studio: VideoStudio): void {
  const settings: VideoSettings = studio.settings
  ctx.tools.register(defineTool({
    name: 'video_create',
    description: [
      'Create an AI video project. You (the model) write the outline and per-frame narration/prompts; this plugin stores the project,',
      'generates narration, stills and subtitles, and renders an MP4. Start here, then call video_outline.',
      'Modes: `image` (generated stills per frame) or `html` (generated HTML/CSS/JS animation per frame).',
      'Styles: cyber-clean (科技博主), terminal-matrix (黑客风), warm-story (暖色系).',
    ].join(' '),
    parameters: {
      title: { type: 'string', required: true, description: 'Project title, e.g. "什么是 RAG"' },
      mode: { type: 'string', enum: VIDEO_MODES, description: 'Storyboard mode; defaults to image' },
      style: { type: 'string', enum: styleIds(), description: 'Visual preset id; defaults to cyber-clean' },
      aspect: { type: 'string', enum: VIDEO_ASPECTS, description: 'Output aspect ratio; defaults to 16:9' },
      summary: { type: 'string', description: 'One-line summary of the video' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          project: { type: 'json', required: true },
          path: { type: 'string', required: true },
          card: { type: 'json', required: true },
        },
      },
      render: (_args, value) => {
        const project = projectFrom(value)
        if (project === undefined) return text('项目已创建。')
        return text([
          `已创建视频项目：${project.title}`,
          describeProject(project, settings),
          `项目 ID：${project.id}`,
          `目录：${settings.rootDir}/${project.id}`,
          '',
          '下一步：用 video_outline 写入 3–8 个分镜（每镜旁白 15–60 字），然后 video_generate 生成图像与配音，video_preview 预览，video_render 导出 MP4。',
        ].join('\n'))
      },
      presentationMeta: (args, value) => {
        const project = projectFrom(value)
        if (project === undefined) return asJson({ kind: 'dsh-ai-video', title: String((args as { title?: string }).title ?? '') })
        return asJson(videoCardMeta(project, settings))
      },
    },
    presentCall: args => pendingTitle(`创建视频项目：${(args as { title: string }).title}`),
    presentResult: (_args, result) => ({ card: 'generic', title: '视频项目已创建', content: result.content }),
    async execute(args) {
      if (!STYLE_PRESETS[args.style ?? 'cyber-clean']) throw new Error(`unknown style: ${args.style}`)
      const project = await studio.create({
        title: args.title,
        ...(args.mode === undefined ? {} : { mode: args.mode as VideoMode }),
        ...(args.style === undefined ? {} : { style: args.style }),
        ...(args.aspect === undefined ? {} : { aspect: args.aspect as VideoAspect }),
        ...(args.summary === undefined ? {} : { summary: args.summary }),
      })
      return {
        project: asJson(project),
        path: `${settings.rootDir}/${project.id}`,
        card: asJson(videoCardMeta(project, settings)),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'video_list',
    description: 'List every AI video project on this machine, newest first, with frame/media counts and render status.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projects: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                mode: { type: 'string', required: true },
                style: { type: 'string', required: true },
                frames: { type: 'number', required: true },
                images: { type: 'number', required: true },
                audio: { type: 'number', required: true },
                durationSec: { type: 'number', required: true },
                rendered: { type: 'boolean', required: true },
                updatedAt: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const projects = (value as { projects: Array<Record<string, unknown>> }).projects
        if (projects.length === 0) return text('还没有视频项目。用 video_create 创建一个。')
        return text([
          `共 ${projects.length} 个视频项目：`,
          ...projects.map(project => `- ${String(project.title)}（${String(project.id)}）· ${String(project.frames)} 镜 · ${formatClock(Number(project.durationSec))}${project.rendered === true ? ' · 已导出' : ''}`),
        ].join('\n'))
      },
    },
    presentCall: () => pendingTitle('列出视频项目'),
    async execute() {
      const projects = await studio.list()
      return {
        projects: projects.map(project => ({
          id: project.id,
          title: project.title,
          mode: project.mode,
          style: project.style,
          frames: project.frames,
          images: project.images,
          audio: project.audio,
          durationSec: project.durationSec,
          rendered: project.rendered,
          updatedAt: project.updatedAt,
        })),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'video_show',
    description: 'Read one AI video project: outline, per-frame narration and prompts, media readiness, timeline, subtitle cues and output paths.',
    parameters: {
      projectId: { type: 'string', required: true, description: 'Project id from video_create or video_list' },
    },
    output: {
      schema: {
        ...projectOutputSchema,
        properties: {
          ...projectOutputSchema.properties,
          paths: { type: 'json', required: true, description: 'Directory and deliverable paths' },
        },
      },
      render: (_args, value) => {
        const project = projectFrom(value)
        if (project === undefined) return text('项目不存在。')
        const paths = (value as { paths: Record<string, string> }).paths
        const style = resolveStyle(project.style)
        return text([
          `${project.title}`,
          `${project.mode === 'html' ? 'HTML 动画' : '图片轮播'} · ${style.name.zh} · ${project.aspect} · ${project.frames.length} 镜`,
          project.summary.length > 0 ? project.summary : '',
          '',
          project.frames.length === 0 ? '（还没有分镜，先用 video_outline 写入）' : frameLines(project, settings),
          projectFooter(project, settings),
          `预览：${paths.preview ?? ''}`,
          project.output === undefined ? '' : `成片：${project.output.mp4Path}（${formatBytes(project.output.bytes)}）`,
        ].filter(line => line.length > 0).join('\n'))
      },
      presentationMeta: projectMeta(settings),
    },
    presentCall: args => pendingTitle(`查看视频项目 ${(args as { projectId: string }).projectId}`),
    presentResult: (_args, result) => ({ card: 'generic', title: '视频项目', content: result.content }),
    async execute(args) {
      const project = await studio.load(args.projectId)
      return { ...buildProjectOutput(project, settings), paths: asJson(projectPaths(project, settings)) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'video_outline',
    description: [
      'Write (or replace) the storyboard of a video project. You author every frame: `narration` is the spoken line (15–60 Chinese characters),',
      '`visual` is the still prompt for image mode, `html` is a complete HTML fragment for html mode, and `durationSec` is optional.',
      'Keep one idea per frame and make frame 1 a hook and the last frame a closing. This replaces all existing frames and clears stale media.',
    ].join(' '),
    parameters: {
      projectId: { type: 'string', required: true },
      title: { type: 'string', description: 'Optionally retitle the project' },
      summary: { type: 'string', description: 'Optionally replace the project summary' },
      frames: {
        type: 'array',
        required: true,
        description: 'Ordered frames; 3–8 recommended, 80 maximum',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            title: { type: 'string', description: 'Short on-screen title' },
            narration: { type: 'string', required: true, description: 'Spoken line, 15–60 Chinese characters' },
            visual: { type: 'string', description: 'Image prompt (image mode) or an animation brief (html mode)' },
            html: { type: 'string', description: 'Complete HTML fragment for html mode; inline CSS only' },
            durationSec: { type: 'number', description: 'Manual duration override in seconds' },
          },
        },
      },
    },
    output: {
      schema: projectOutputSchema,
      render: (_args, value) => {
        const project = projectFrom(value)
        if (project === undefined) return text('大纲已写入。')
        return text([
          `已写入 ${project.frames.length} 个分镜：${project.title}`,
          describeProject(project, settings),
          '',
          frameLines(project, settings),
          '',
          '下一步：video_generate（生成图像与配音）→ video_preview（浏览器预览）→ video_render（导出 MP4）。',
        ].join('\n'))
      },
      presentationMeta: projectMeta(settings),
    },
    presentCall: args => pendingTitle(`写入分镜：${(args as { frames: unknown[] }).frames.length} 镜`),
    presentResult: (_args, result) => ({ card: 'generic', title: '分镜已写入', content: result.content }),
    async execute(args) {
      const project = await studio.setOutline(args.projectId, {
        frames: args.frames.map(frame => ({
          ...(frame.title === undefined ? {} : { title: frame.title }),
          narration: frame.narration,
          ...(frame.visual === undefined ? {} : { visual: frame.visual }),
          ...(frame.html === undefined ? {} : { html: frame.html }),
          ...(frame.durationSec === undefined ? {} : { durationSec: frame.durationSec }),
        })),
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.summary === undefined ? {} : { summary: args.summary }),
      })
      return buildProjectOutput(project, settings)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'video_edit_frames',
    description: [
      'Edit a storyboard without rewriting it: one ordered list of operations. Each item is',
      '{ op: "update", frameId, title?, narration?, visual?, html?, durationSec? },',
      '{ op: "insert", index? | afterFrameId?, narration, title?, visual?, html?, durationSec? },',
      '{ op: "remove", frameId } or { op: "move", frameId, index }.',
      'Changing narration clears that frame\'s audio; changing visual/html clears its still, so regenerate afterwards.',
    ].join(' '),
    parameters: {
      projectId: { type: 'string', required: true },
      operations: {
        type: 'array',
        required: true,
        description: 'Operations applied in order',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            op: { type: 'string', enum: ['update', 'insert', 'remove', 'move'], required: true },
            frameId: { type: 'string', description: 'Target frame id (update/remove/move)' },
            index: { type: 'integer', description: '1-based position (insert/move)' },
            afterFrameId: { type: 'string', description: 'Insert after this frame id' },
            title: { type: 'string' },
            narration: { type: 'string' },
            visual: { type: 'string' },
            html: { type: 'string' },
            durationSec: { type: 'number' },
          },
        },
      },
    },
    output: {
      schema: projectOutputSchema,
      render: (_args, value) => {
        const project = projectFrom(value)
        if (project === undefined) return text('分镜已更新。')
        return text([
          `分镜已更新：${project.title}（${project.frames.length} 镜）`,
          '',
          frameLines(project, settings),
          '',
          '受影响的分镜需要重新执行 video_generate。',
        ].join('\n'))
      },
      presentationMeta: projectMeta(settings),
    },
    presentCall: args => pendingTitle(`编辑分镜：${(args as { operations: unknown[] }).operations.length} 步`),
    presentResult: (_args, result) => ({ card: 'generic', title: '分镜已更新', content: result.content }),
    async execute(args) {
      const project = await studio.editFrames(args.projectId, parseOperations(args.operations as unknown as Array<Record<string, unknown>>))
      return buildProjectOutput(project, settings)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'video_generate',
    description: [
      'Generate narration audio and stills for a project. Stills come from the configured image gateway when `visual` is set,',
      'else from an HTML render of the frame (built-in title card), so a run without an image account still produces frames.',
      'Narration uses the configured TTS gateway, or the OS speech synthesizer as a fallback. Long-running: pass `frameIds` to retry only some frames.',
    ].join(' '),
    parameters: {
      projectId: { type: 'string', required: true },
      targets: { type: 'string', enum: ['all', 'images', 'audio'], description: 'What to generate; defaults to all' },
      frameIds: { type: 'array', items: { type: 'string' }, description: 'Limit to these frame ids' },
    },
    timeoutMs: 15 * 60_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          assets: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                frameId: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                provider: { type: 'string', required: true },
                path: { type: 'string', required: true },
              },
            },
          },
          failed: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                frameId: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                error: { type: 'string', required: true },
              },
            },
          },
          skipped: { type: 'array', required: true, items: { type: 'string' } },
          project: { type: 'json', required: true },
          card: { type: 'json', required: true },
        },
      },
      render: (_args, value) => {
        const result = value as { assets: Array<Record<string, string>>; failed: Array<Record<string, string>>; skipped: string[] }
        const project = projectFrom(value)
        const lines = [`生成完成：${result.assets.length} 个资源${result.failed.length > 0 ? `，${result.failed.length} 个失败` : ''}`]
        if (project !== undefined) lines.push(describeProject(project, settings))
        if (result.assets.length > 0) {
          lines.push('', ...result.assets.map(asset => `- ${asset.frameId} ${asset.kind === 'image' ? '图像' : '配音'}（${asset.provider}）→ ${asset.path}`))
        }
        if (result.failed.length > 0) {
          lines.push('', '失败：', ...result.failed.map(item => `- ${item.frameId} ${item.kind}: ${item.error}`))
        }
        if (result.skipped.length > 0) lines.push('', `跳过：${result.skipped.join('；')}`)
        lines.push('', '下一步：video_preview 预览，video_render 导出 MP4。')
        return text(lines.join('\n'))
      },
      presentationMeta: projectMeta(settings),
    },
    presentCall: args => pendingTitle(`生成配音与图像：${(args as { projectId: string }).projectId}`),
    presentResult: (_args, result) => ({ card: 'generic', title: '媒体生成完成', content: result.content }),
    async execute(args, exec) {
      const { report, project } = await studio.generate(args.projectId, {
        ...(args.targets === undefined ? {} : { targets: args.targets as GenerateTargets }),
        ...(args.frameIds === undefined ? {} : { frameIds: args.frameIds }),
        signal: exec.signal,
      })
      return {
        assets: report.assets,
        failed: report.failed,
        skipped: report.skipped,
        project: asJson(project),
        card: asJson(videoCardMeta(project, settings)),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'video_preview',
    description: [
      'Build the review artifacts without encoding: writes subtitles.srt, subtitles.vtt and a self-contained preview.html player.',
      'Missing stills are filled with the built-in title card when Chrome is available. Open preview.html in a browser to play it.',
    ].join(' '),
    parameters: {
      projectId: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          previewPath: { type: 'string', required: true },
          srtPath: { type: 'string', required: true },
          vttPath: { type: 'string', required: true },
          durationSec: { type: 'number', required: true },
          frames: { type: 'number', required: true },
          cues: { type: 'number', required: true },
          card: { type: 'json', required: true },
        },
      },
      render: (_args, value) => {
        const result = value as { previewPath: string; srtPath: string; durationSec: number; frames: number; cues: number }
        return text([
          `预览已生成：${result.frames} 镜 · ${formatClock(result.durationSec)} · ${result.cues} 条字幕`,
          `播放器：${result.previewPath}`,
          `字幕：${result.srtPath}`,
          '',
          '用浏览器打开 preview.html 即可播放（图片、HTML 动画、配音、字幕同步）。确认后再执行 video_render 导出 MP4。',
        ].join('\n'))
      },
      presentationMeta: (_args, value) => {
        const card = (value as { card?: unknown }).card
        return asJson(card ?? { kind: 'dsh-ai-video' })
      },
    },
    presentCall: args => pendingTitle(`生成预览：${(args as { projectId: string }).projectId}`),
    presentResult: (_args, result) => ({ card: 'generic', title: '预览已生成', content: result.content }),
    async execute(args, exec) {
      const report = await studio.writePreview(args.projectId, { signal: exec.signal })
      const project = await studio.load(args.projectId)
      return {
        previewPath: report.previewPath,
        srtPath: report.srtPath,
        vttPath: report.vttPath,
        durationSec: Number(report.durationSec.toFixed(2)),
        frames: project.frames.length,
        cues: report.cues.length,
        card: asJson(videoCardMeta(project, settings)),
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'video_render',
    description: [
      'Render the project to an MP4 (H.264 + AAC) with ffmpeg, and refresh the preview and subtitles.',
      'Subtitles are burned in when the local ffmpeg has libass; otherwise the .srt/.vtt ship beside the video.',
      'This can take a while for long projects; preflight with video_preview first.',
    ].join(' '),
    parameters: {
      projectId: { type: 'string', required: true },
      burnSubtitles: { type: 'boolean', description: 'Override the configured burn-in choice' },
    },
    timeoutMs: 30 * 60_000,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mp4Path: { type: 'string', required: true },
          previewPath: { type: 'string', required: true },
          srtPath: { type: 'string', required: true },
          vttPath: { type: 'string', required: true },
          durationSec: { type: 'number', required: true },
          bytes: { type: 'number', required: true },
          burnIn: { type: 'boolean', required: true },
          project: { type: 'json', required: true },
          card: { type: 'json', required: true },
        },
      },
      render: (_args, value) => {
        const result = value as { mp4Path: string; previewPath: string; durationSec: number; bytes: number; burnIn: boolean }
        const project = projectFrom(value)
        return text([
          `MP4 已导出：${result.mp4Path}`,
          `${formatClock(result.durationSec)} · ${formatBytes(result.bytes)} · 字幕${result.burnIn ? '已烧录' : '外挂（本地 ffmpeg 无 libass）'}`,
          project === undefined ? '' : describeProject(project, settings),
          `预览：${result.previewPath}`,
          '',
          '可以把 mp4Path 交给用户，或继续用 video_edit_frames 调整分镜后重新生成。',
        ].filter(line => line.length > 0).join('\n'))
      },
      presentationMeta: projectMeta(settings),
    },
    presentCall: args => pendingTitle(`导出 MP4：${(args as { projectId: string }).projectId}`),
    presentResult: (_args, result) => ({ card: 'generic', title: 'MP4 已导出', content: result.content }),
    async execute(args, exec) {
      const { report, project } = await studio.render(args.projectId, {
        ...(args.burnSubtitles === undefined ? {} : { burnSubtitles: args.burnSubtitles }),
        signal: exec.signal,
      })
      return {
        mp4Path: report.mp4Path,
        previewPath: report.previewPath,
        srtPath: report.srtPath,
        vttPath: report.vttPath,
        durationSec: Number(report.durationSec.toFixed(2)),
        bytes: report.bytes,
        burnIn: report.burnIn,
        project: asJson(project),
        card: asJson(videoCardMeta(project, settings)),
      }
    },
  }))
}

/** Re-exported for the Web card and tests. */
export { applyFrameOperations, frameBadge, parseOperations, projectPaths, resolveStyle }
export type { FrameOperation }
