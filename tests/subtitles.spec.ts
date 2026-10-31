import { describe, expect, it } from 'vitest'
import { buildCues, splitNarration, splitSubtitles, toSrt, toVtt } from '../src/host/subtitles.ts'
import { buildTimeline } from '../src/host/render/timeline.ts'
import { makeProject } from './support/fixtures.ts'

describe('splitNarration', () => {
  it('splits at Chinese clause punctuation and drops the trailing stop', () => {
    expect(splitNarration('你好，世界。这是测试！')).toEqual(['你好', '世界', '这是测试'])
  })

  it('keeps a single sentence whole', () => {
    expect(splitNarration('只有一句话没有标点')).toEqual(['只有一句话没有标点'])
  })

  it('returns nothing for empty narration', () => {
    expect(splitNarration('   ')).toEqual([])
    expect(splitNarration('。！？')).toEqual([])
  })

  it('keeps short clauses separate for the timing pass to merge', () => {
    expect(splitNarration('这是一段比较长的开头，好')).toEqual(['这是一段比较长的开头', '好'])
  })

  it('splits over-long segments so a caption stays readable', () => {
    const long = '这是一个非常非常长的句子用来验证字幕切片算法会把过长的片段进一步拆开处理'
    const segments = splitNarration(long)
    expect(segments.length).toBeGreaterThan(1)
    for (const segment of segments) expect([...segment].length).toBeLessThanOrEqual(28)
  })
})

describe('splitSubtitles', () => {
  it('shares the frame duration by character weight', () => {
    const cues = splitSubtitles('你好世界，再见世界', 4)
    expect(cues).toHaveLength(2)
    expect(cues[0]?.start).toBe(0)
    expect(cues[1]?.end).toBeCloseTo(4, 5)
    expect(cues[0]?.end).toBeCloseTo(cues[1]?.start ?? 0, 5)
    expect(cues[0]?.end).toBeGreaterThan(0)
  })

  it('merges a cue that would flash into its neighbour', () => {
    const cues = splitSubtitles('这是一段比较长的开头，好', 2)
    expect(cues).toHaveLength(1)
    expect(cues[0]?.end).toBe(2)
  })

  it('returns one full-length cue for a single sentence', () => {
    expect(splitSubtitles('一句话', 3)).toEqual([{ text: '一句话', start: 0, end: 3 }])
  })

  it('returns nothing for a zero duration', () => {
    expect(splitSubtitles('一句话', 0)).toEqual([])
  })
})

describe('buildCues', () => {
  it('offsets per-frame cues onto the project timeline', () => {
    const project = makeProject({
      frames: [
        { id: 'f1', title: '', narration: '第一句，第二句。', visual: '', html: '', durationSec: 4 },
        { id: 'f2', title: '', narration: '第三句。', visual: '', html: '', durationSec: 2 },
      ],
    })
    const timeline = buildTimeline(project, 0)
    const cues = buildCues(project, timeline)
    expect(cues.length).toBe(3)
    expect(cues[0]?.start).toBe(0)
    expect(cues[2]?.start).toBeCloseTo(4, 5)
    expect(cues[2]?.end).toBeCloseTo(6, 5)
    expect(cues.every((cue, position) => position === 0 || cue.start >= (cues[position - 1]?.start ?? 0))).toBe(true)
  })

  it('skips empty narration', () => {
    const project = makeProject({ frames: [{ id: 'f1', title: '', narration: '', visual: '', html: '', durationSec: 2 }] })
    expect(buildCues(project, buildTimeline(project, 0))).toEqual([])
  })
})

describe('serialization', () => {
  const cues = [
    { start: 0, end: 1.5, text: '第一句', frame: 1 },
    { start: 1.5, end: 3.25, text: '第二句', frame: 1 },
  ]

  it('writes SubRip with millisecond commas', () => {
    expect(toSrt(cues)).toBe('1\n00:00:00,000 --> 00:00:01,500\n第一句\n\n2\n00:00:01,500 --> 00:00:03,250\n第二句\n')
  })

  it('writes WebVTT with a header and millisecond dots', () => {
    expect(toVtt(cues)).toBe('WEBVTT\n\n00:00:00.000 --> 00:00:01.500\n第一句\n\n00:00:01.500 --> 00:00:03.250\n第二句\n')
  })
})
