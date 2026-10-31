import { describe, expect, it } from 'vitest'
import { applyFrameOperations } from '../src/host/frame-ops.ts'
import { makeFrame } from './support/fixtures.ts'

const base = [
  makeFrame({ id: 'f1', narration: '第一镜' }),
  makeFrame({ id: 'f2', narration: '第二镜' }),
  makeFrame({ id: 'f3', narration: '第三镜' }),
]

describe('applyFrameOperations', () => {
  it('updates copy without mutating the input', () => {
    const result = applyFrameOperations(base, [{ op: 'update', frameId: 'f2', title: '新标题' }])
    expect(result[1]?.title).toBe('新标题')
    expect(base[1]?.title).toBe('开场')
  })

  it('clears stale narration audio when the narration changes', () => {
    const withAudio = applyFrameOperations(base, [{ op: 'update', frameId: 'f1', narration: '改写后的旁白' }])
    expect(withAudio[0]?.narration).toBe('改写后的旁白')
    const frames = [{ ...base[0]!, audioPath: '/tmp/a.mp3', audioDurationMs: 1200 }]
    const result = applyFrameOperations(frames, [{ op: 'update', frameId: 'f1', narration: '新旁白' }])
    expect(result[0]?.audioPath).toBeUndefined()
    expect(result[0]?.audioDurationMs).toBeUndefined()
  })

  it('keeps audio when an unrelated field changes', () => {
    const frames = [{ ...base[0]!, audioPath: '/tmp/a.mp3' }]
    const result = applyFrameOperations(frames, [{ op: 'update', frameId: 'f1', title: '只改标题' }])
    expect(result[0]?.audioPath).toBe('/tmp/a.mp3')
  })

  it('clears the still when the visual prompt changes', () => {
    const frames = [{ ...base[0]!, imagePath: '/tmp/a.png', imageSource: 'api' as const }]
    const result = applyFrameOperations(frames, [{ op: 'update', frameId: 'f1', visual: 'a new prompt' }])
    expect(result[0]?.imagePath).toBeUndefined()
    expect(result[0]?.imageSource).toBeUndefined()
  })

  it('inserts at a 1-based index with a fresh id', () => {
    const result = applyFrameOperations(base, [{ op: 'insert', index: 2, narration: '插入镜' }])
    expect(result.map(frame => frame.id)).toEqual(['f1', 'f4', 'f2', 'f3'])
    expect(result[1]?.narration).toBe('插入镜')
  })

  it('inserts after a named frame', () => {
    const result = applyFrameOperations(base, [{ op: 'insert', afterFrameId: 'f3', narration: '收尾' }])
    expect(result.map(frame => frame.id)).toEqual(['f1', 'f2', 'f3', 'f4'])
  })

  it('removes a frame', () => {
    const result = applyFrameOperations(base, [{ op: 'remove', frameId: 'f2' }])
    expect(result.map(frame => frame.id)).toEqual(['f1', 'f3'])
  })

  it('moves a frame to a 1-based position', () => {
    const result = applyFrameOperations(base, [{ op: 'move', frameId: 'f1', index: 3 }])
    expect(result.map(frame => frame.id)).toEqual(['f2', 'f3', 'f1'])
  })

  it('applies several operations in order', () => {
    const result = applyFrameOperations(base, [
      { op: 'update', frameId: 'f1', narration: '新的第一镜' },
      { op: 'remove', frameId: 'f3' },
      { op: 'insert', afterFrameId: 'f2', narration: '新的收尾' },
    ])
    expect(result).toHaveLength(3)
    expect(result[0]?.narration).toBe('新的第一镜')
    expect(result[2]?.narration).toBe('新的收尾')
  })

  it('rejects unknown frames and empty edits', () => {
    expect(() => applyFrameOperations(base, [{ op: 'remove', frameId: 'f9' }])).toThrow('frame not found')
    expect(() => applyFrameOperations(base, [])).toThrow('at least one edit')
    expect(() => applyFrameOperations(base, [{ op: 'update', frameId: 'f1', narration: '  ' }])).toThrow('must not be empty')
  })

  it('keeps at least one frame', () => {
    expect(() => applyFrameOperations([base[0]!], [{ op: 'remove', frameId: 'f1' }])).toThrow('at least one frame')
  })
})
