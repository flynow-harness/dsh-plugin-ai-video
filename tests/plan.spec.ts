import { describe, expect, it } from 'vitest'
import { buildRenderPlan, escapeFilterPath } from '../src/host/render/plan.ts'

describe('buildRenderPlan', () => {
  it('creates one still input and one audio input per segment', () => {
    const plan = buildRenderPlan({
      width: 1920,
      height: 1080,
      fps: 30,
      burnIn: false,
      segments: [
        { duration: 2, imagePath: '/tmp/f1.png', audioPath: '/tmp/f1.mp3' },
        { duration: 3 },
      ],
    })
    expect(plan.inputs.filter(item => item === '-i')).toHaveLength(4)
    expect(plan.inputs).toContain('color=c=0x000000:s=1920x1080:r=30')
    expect(plan.inputs).toContain('anullsrc=r=48000:cl=stereo')
  })

  it('scales, pads and concatenates every frame', () => {
    const plan = buildRenderPlan({
      width: 1080,
      height: 1920,
      fps: 24,
      burnIn: false,
      segments: [{ duration: 1.5 }, { duration: 2.5 }],
    })
    expect(plan.filterGraph).toContain('scale=1080:1920:force_original_aspect_ratio=decrease')
    expect(plan.filterGraph).toContain('fps=24')
    expect(plan.filterGraph).toContain('concat=n=2:v=1:a=1[vc][ac]')
    expect(plan.filterGraph).toContain('[vc]null[vout]')
    expect(plan.filterGraph).toContain('apad=whole_dur=1.500')
  })

  it('burns subtitles when asked', () => {
    const plan = buildRenderPlan({
      width: 1920,
      height: 1080,
      fps: 30,
      burnIn: true,
      srtPath: '/tmp/my:video/subtitles.srt',
      segments: [{ duration: 2 }],
    })
    expect(plan.filterGraph).toContain('subtitles=filename=')
    expect(plan.filterGraph).toContain('force_style=')
    expect(plan.filterGraph).not.toContain('[vc]null[vout]')
  })

  it('never emits a zero-duration input', () => {
    const plan = buildRenderPlan({
      width: 640,
      height: 360,
      fps: 30,
      burnIn: false,
      segments: [{ duration: 0 }],
    })
    expect(plan.filterGraph).toContain('trim=duration=0.200')
  })
})

describe('escapeFilterPath', () => {
  it('escapes the filtergraph separators', () => {
    expect(escapeFilterPath('/tmp/a b/subtitles.srt')).toBe("'/tmp/a b/subtitles.srt'")
    expect(escapeFilterPath('/tmp/a:b.srt')).toBe("'/tmp/a\\:b.srt'")
    expect(escapeFilterPath("C:\\videos\\a.srt")).toBe("'C\\:/videos/a.srt'")
  })
})
