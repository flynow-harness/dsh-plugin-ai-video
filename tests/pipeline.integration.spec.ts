/**
 * End-to-end run against the real toolchain: headless Chrome for stills,
 * the OS speech synthesizer for narration, and ffmpeg for the MP4. The suite
 * skips itself when a required binary is missing, so `pnpm test` stays usable
 * on a minimal machine and on CI.
 */
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { VideoSettings } from '../src/host/config.ts'
import { ProjectStore } from '../src/host/store.ts'
import { VideoStudio } from '../src/host/pipeline.ts'
import { cleanup, hasBinary, hasChrome, makeTempSettings } from './support/fixtures.ts'

const chromeReady = hasChrome()
const ffmpegReady = hasBinary('ffmpeg') && hasBinary('ffprobe')
const speechReady = (process.platform === 'darwin' && hasBinary('say')) || hasBinary('espeak-ng')
let settings: VideoSettings | undefined

afterAll(async () => {
  if (settings !== undefined) await cleanup(settings)
})

describe.skipIf(!chromeReady || !ffmpegReady)('studio pipeline', () => {
  it('renders stills, narration, subtitles, a preview and an MP4', async () => {
    settings = makeTempSettings({ browserRender: true, autoVisuals: true, localTts: speechReady })
    const studio = new VideoStudio(new ProjectStore(settings.rootDir), settings)
    const project = await studio.create({ title: '集成测试', mode: 'image', style: 'cyber-clean', aspect: '16:9' })
    await studio.setOutline(project.id, {
      frames: [
        { title: '开场', narration: '你有没有想过，机器是怎么读懂一句话的？', visual: 'a glowing sentence on a dark screen' },
        { title: '答案', narration: '答案就藏在向量里。', durationSec: 2 },
      ],
    })
    const generated = await studio.generate(project.id, { targets: 'all' })
    expect(generated.report.assets.filter(asset => asset.kind === 'image')).toHaveLength(2)
    expect(generated.report.assets.every(asset => asset.kind !== 'image' || asset.provider === 'browser')).toBe(true)
    if (speechReady) expect(generated.report.assets.filter(asset => asset.kind === 'audio')).toHaveLength(2)

    const preview = await studio.render(project.id, { burnSubtitles: false })
    expect(preview.report.cues.length).toBeGreaterThan(0)
    const previewHtml = await readFile(preview.report.previewPath, 'utf8')
    expect(previewHtml).toContain('集成测试')
    expect(previewHtml).toContain('assets/f1.png')

    const info = await stat(preview.report.mp4Path)
    expect(info.size).toBeGreaterThan(20_000)
    expect(preview.report.durationSec).toBeGreaterThan(3)

    const saved = await studio.load(project.id)
    expect(saved.output?.mp4Path).toBe(preview.report.mp4Path)
    expect(saved.output?.burnIn).toBe(false)
    const srt = await readFile(preview.report.srtPath, 'utf8')
    expect(srt).toContain('-->')
  }, 180_000)

  it('captures an HTML animation frame as a still', async () => {
    settings = makeTempSettings({ browserRender: true, autoVisuals: false, localTts: false })
    const studio = new VideoStudio(new ProjectStore(settings.rootDir), settings)
    const project = await studio.create({ title: 'HTML 帧', mode: 'html', style: 'terminal-matrix' })
    await studio.setOutline(project.id, {
      frames: [{
        title: '终端',
        narration: '这是一段 HTML 动画。',
        html: '<div class="stage"><h1>HELLO</h1><p>terminal matrix</p></div><style>body{background:#030803;color:#22c55e;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100%}</style>',
        visual: '',
      }],
    })
    const generated = await studio.generate(project.id, { targets: 'images' })
    expect(generated.report.failed).toEqual([])
    const image = generated.report.assets[0]
    expect(image?.provider).toBe('browser')
    const saved = await studio.load(project.id)
    expect(saved.frames[0]?.imagePath).toBeDefined()
    const size = await stat(join(saved.frames[0]?.imagePath ?? ''))
    expect(size.size).toBeGreaterThan(1000)
  }, 120_000)
})
