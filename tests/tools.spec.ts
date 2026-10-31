import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { resolveSettings, type VideoSettings } from '../src/host/config.ts'
import { ProjectStore } from '../src/host/store.ts'
import { VideoStudio } from '../src/host/pipeline.ts'
import { parseOperations, registerVideoTools, videoCardMeta } from '../src/host/tools.ts'
import { makeProject, cleanup, makeTempSettings } from './support/fixtures.ts'

/** Capture definitions the way the registry would. */
function captureTools(settings: VideoSettings): Map<string, ToolDefinition> {
  const tools = new Map<string, ToolDefinition>()
  const ctx = {
    tools: {
      register(definition: ToolDefinition) {
        tools.set(definition.name, definition)
        return () => { tools.delete(definition.name) }
      },
    },
  } as unknown as Context
  const studio = new VideoStudio(new ProjectStore(settings.rootDir), settings)
  registerVideoTools(ctx, studio)
  return tools
}

/** Minimal execution context accepted by `execute`. */
function exec(): { signal: AbortSignal } {
  return { signal: new AbortController().signal }
}

/** Run one captured tool and return its canonical value. */
async function call(tools: Map<string, ToolDefinition>, name: string, args: unknown): Promise<Record<string, unknown>> {
  const definition = tools.get(name)
  if (definition === undefined) throw new Error(`missing tool ${name}`)
  return await definition.execute(args, exec() as never) as Record<string, unknown>
}

let settings: VideoSettings | undefined

afterEach(async () => {
  if (settings !== undefined) await cleanup(settings)
  settings = undefined
})

describe('registerVideoTools', () => {
  it('registers the whole video family with descriptions and schemas', () => {
    settings = makeTempSettings()
    const tools = captureTools(settings)
    expect([...tools.keys()].sort()).toEqual([
      'video_create',
      'video_edit_frames',
      'video_generate',
      'video_list',
      'video_outline',
      'video_preview',
      'video_render',
      'video_show',
    ])
    for (const definition of tools.values()) {
      expect(definition.description.length).toBeGreaterThan(20)
      expect(definition.output.schema).toBeDefined()
    }
  })

  it('runs create -> outline -> show -> list', async () => {
    settings = makeTempSettings()
    const tools = captureTools(settings)
    const created = await call(tools, 'video_create', { title: '演示视频', mode: 'image', style: 'warm-story' })
    const project = created.project as { id: string; style: string }
    expect(project.style).toBe('warm-story')

    const outlined = await call(tools, 'video_outline', {
      projectId: project.id,
      frames: [
        { narration: '第一镜，用问题开场。', visual: 'a question on a dark screen' },
        { narration: '第二镜，给出答案。', title: '答案' },
        { narration: '第三镜，收尾。', durationSec: 2 },
      ],
    })
    const timeline = outlined.timeline as Array<{ index: number; start: number; end: number }>
    expect(timeline).toHaveLength(3)
    expect(timeline[2]?.end).toBeGreaterThan(timeline[2]?.start ?? 0)

    const shown = await call(tools, 'video_show', { projectId: project.id })
    expect((shown.card as { kind: string }).kind).toBe('dsh-ai-video')
    expect((shown.card as { frames: unknown[] }).frames).toHaveLength(3)
    expect((shown.card as { status: string }).status).toBe('outline')
    expect((shown.project as { frames: unknown[] }).frames).toHaveLength(3)

    const listed = await call(tools, 'video_list', {})
    expect((listed.projects as unknown[])).toHaveLength(1)
  })

  it('edits frames through the tool and validates operations', async () => {
    settings = makeTempSettings()
    const tools = captureTools(settings)
    const created = await call(tools, 'video_create', { title: '编辑测试' })
    const projectId = (created.project as { id: string }).id
    await call(tools, 'video_outline', {
      projectId,
      frames: [{ narration: '第一镜。' }, { narration: '第二镜。' }],
    })
    const edited = await call(tools, 'video_edit_frames', {
      projectId,
      operations: [
        { op: 'update', frameId: 'f2', narration: '改写后的第二镜。' },
        { op: 'insert', index: 1, narration: '新的开场。' },
      ],
    })
    const frames = (edited.project as { frames: Array<{ id: string; narration: string }> }).frames
    expect(frames[0]?.narration).toBe('新的开场。')
    expect(frames[2]?.narration).toBe('改写后的第二镜。')

    await expect(call(tools, 'video_edit_frames', { projectId, operations: [{ op: 'nope' }] })).rejects.toThrow(/invalid arguments|unknown op/)
  })

  it('reports preview artifacts without encoding', async () => {
    settings = makeTempSettings()
    const tools = captureTools(settings)
    const created = await call(tools, 'video_create', { title: '预览测试' })
    const projectId = (created.project as { id: string }).id
    await call(tools, 'video_outline', { projectId, frames: [{ narration: '第一镜，预览。' }] })
    const preview = await call(tools, 'video_preview', { projectId })
    expect(String(preview.previewPath)).toMatch(/preview\.html$/)
    expect(String(preview.srtPath)).toMatch(/subtitles\.srt$/)
    expect(preview.cues).toBeGreaterThan(0)
  })
})

describe('parseOperations', () => {
  it('requires frame ids where they matter', () => {
    expect(() => parseOperations([{ op: 'update' }])).toThrow('needs frameId')
    expect(() => parseOperations([{ op: 'insert' }])).toThrow('needs narration')
    expect(() => parseOperations([{ op: 'move', frameId: 'f1' }])).toThrow('needs frameId and index')
  })

  it('carries optional fields through', () => {
    expect(parseOperations([{ op: 'insert', narration: 'x', afterFrameId: 'f1', durationSec: 2.5 }]))
      .toEqual([{ op: 'insert', narration: 'x', afterFrameId: 'f1', durationSec: 2.5 }])
  })
})

describe('videoCardMeta', () => {
  it('classifies project readiness', () => {
    settings = makeTempSettings()
    const empty = videoCardMeta(makeProject({ frames: [] }), settings)
    expect(empty.status).toBe('empty')
    const outlined = videoCardMeta(makeProject(), settings)
    expect(outlined.status).toBe('outline')
    const partial = videoCardMeta(makeProject({ frames: [{ id: 'f1', title: '', narration: 'x', visual: '', html: '', imagePath: '/tmp/a.png' }] }), settings)
    expect(partial.status).toBe('partial')
    const ready = videoCardMeta(makeProject({
      frames: [{ id: 'f1', title: '', narration: 'x', visual: '', html: '', imagePath: '/tmp/a.png', audioPath: '/tmp/a.mp3' }],
    }), settings)
    expect(ready.status).toBe('ready')
    expect(ready.images).toBe(1)
    expect(ready.audio).toBe(1)
  })
})

describe('resolveSettings', () => {
  it('defaults the root under DSH_HOME and keeps explicit paths', () => {
    const resolved = resolveSettings({ rootDir: '/tmp/explicit-root' })
    expect(resolved.rootDir).toBe('/tmp/explicit-root')
    expect(resolved.fps).toBe(30)
    expect(resolved.autoVisuals).toBe(true)
  })
})
