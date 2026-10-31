import { describe, expect, it } from 'vitest'
import { buildTimeline, estimateNarrationSec, formatClock, frameDuration } from '../src/host/render/timeline.ts'
import { makeFrame, makeProject } from './support/fixtures.ts'

describe('estimateNarrationSec', () => {
  it('scales with Chinese characters and pauses', () => {
    const short = estimateNarrationSec('你好')
    const long = estimateNarrationSec('这是一段更长一些的中文旁白，用来验证估算。')
    expect(short).toBeGreaterThanOrEqual(1.5)
    expect(long).toBeGreaterThan(short)
  })

  it('returns the empty-frame fallback for empty text', () => {
    expect(estimateNarrationSec('   ')).toBe(3)
  })
})

describe('frameDuration', () => {
  it('prefers an explicit duration', () => {
    expect(frameDuration(makeFrame({ durationSec: 7 }), 0.35)).toBe(7)
  })

  it('adds the tail to measured audio', () => {
    expect(frameDuration(makeFrame({ audioDurationMs: 4000 }), 0.5)).toBeCloseTo(4.5, 5)
  })

  it('falls back to the narration estimate', () => {
    const frame = makeFrame({ narration: '一二三四五六七八九十' })
    expect(frameDuration(frame, 0.35)).toBeCloseTo(2.0, 5)
  })
})

describe('buildTimeline', () => {
  it('places frames back to back', () => {
    const project = makeProject({
      frames: [
        makeFrame({ id: 'f1', durationSec: 2 }),
        makeFrame({ id: 'f2', durationSec: 3 }),
      ],
    })
    const timeline = buildTimeline(project, 0)
    expect(timeline.duration).toBe(5)
    expect(timeline.frames[1]).toMatchObject({ index: 2, start: 2, end: 5, duration: 3 })
  })

  it('is empty for a project without frames', () => {
    expect(buildTimeline(makeProject({ frames: [] }), 0)).toEqual({ frames: [], duration: 0 })
  })
})

describe('formatClock', () => {
  it('uses zero-padded minutes and seconds', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(65)).toBe('01:05')
    expect(formatClock(-3)).toBe('00:00')
  })
})
