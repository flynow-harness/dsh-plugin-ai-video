import { describe, expect, it } from 'vitest'
import { escapeHtml, renderCaptionOverlay, renderHtmlFrame, renderTitleCard, truncate } from '../src/host/render/card.ts'
import { renderPreviewDocument } from '../src/host/render/preview.ts'
import { buildTimeline } from '../src/host/render/timeline.ts'
import { buildCues } from '../src/host/subtitles.ts'
import { makeProject } from './support/fixtures.ts'

describe('renderTitleCard', () => {
  it('renders a sized document with the title and frame counter', () => {
    const html = renderTitleCard({
      style: 'cyber-clean',
      title: '什么是 RAG',
      narration: '用一个问题开场',
      index: 2,
      total: 5,
      width: 1080,
      height: 1920,
      projectTitle: '测试视频',
    })
    expect(html).toContain('width: 1080px')
    expect(html).toContain('什么是 RAG')
    expect(html).toContain('Frame 02 / 05')
    expect(html).toContain('测试视频')
    expect(html).toContain('#38bdf8')
  })

  it('escapes user text', () => {
    const html = renderTitleCard({ style: 'warm-story', title: '<script>alert(1)</script>', narration: '', index: 1, total: 1, width: 800, height: 600 })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('falls back to the narration when there is no title', () => {
    const html = renderTitleCard({ style: 'terminal-matrix', title: '  ', narration: '一段没有标题的旁白', index: 1, total: 3, width: 800, height: 600 })
    expect(html).toContain('一段没有标题的旁白')
  })
})

describe('renderHtmlFrame', () => {
  it('uses the frame html when present', () => {
    const project = makeProject()
    const html = renderHtmlFrame(project, { id: 'f1', title: '', narration: '', visual: '', html: '<div class="x">hi</div>' }, 1)
    expect(html).toContain('<div class="x">hi</div>')
  })

  it('falls back to the title card for an empty frame', () => {
    const project = makeProject()
    const html = renderHtmlFrame(project, { id: 'f1', title: '标题', narration: '旁白', visual: '', html: '' }, 1)
    expect(html).toContain('Frame 01 / 01')
  })
})

describe('renderCaptionOverlay', () => {
  it('renders a transparent caption document', () => {
    const html = renderCaptionOverlay('一句字幕', 'cyber-clean', 1920, 1080)
    expect(html).toContain('一句字幕')
    expect(html).toContain('background:transparent')
  })
})

describe('escapeHtml/truncate', () => {
  it('escapes the five document characters', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;')
  })

  it('truncates on code points', () => {
    expect(truncate('一二三四五', 3)).toBe('一二三…')
    expect(truncate('abc', 5)).toBe('abc')
  })
})

describe('renderPreviewDocument', () => {
  const project = makeProject({
    title: '预览标题',
    summary: '预览摘要',
    frames: [
      { id: 'f1', title: '', narration: '第一镜旁白。', visual: '', html: '', imagePath: '/projects/demo-1/assets/f1.png', audioPath: '/projects/demo-1/assets/f1.m4a', durationSec: 3 },
      { id: 'f2', title: '', narration: '第二镜旁白。', visual: '', html: '<div>anim</div>', durationSec: 2 },
    ],
  })
  const timeline = buildTimeline(project, 0)
  const cues = buildCues(project, timeline)
  const html = renderPreviewDocument(project, timeline, cues, '/projects/demo-1')

  it('embeds the timeline and relative asset URLs', () => {
    expect(html).toContain('预览标题')
    expect(html).toContain('assets/f1.png')
    expect(html).toContain('assets/f1.m4a')
    expect(html).toContain('"duration":5')
    expect(html).toContain('第一镜旁白')
  })

  it('stays self-contained and safe for inline embedding', () => {
    expect(html).toContain('<!doctype html>')
    expect(html).not.toContain('http://')
    expect(html).not.toContain('": "</script"'.replace('"', ''))
    expect(html.includes('</script>\n</body>')).toBe(true)
  })

  it('keeps HTML-mode frames as animation sources', () => {
    expect(html).toContain('anim')
    expect(html).not.toContain('<div>anim</div>')
  })
})
