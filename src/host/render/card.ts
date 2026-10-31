/**
 * HTML sources rendered by Chrome: the built-in title card used when a frame
 * has no still yet, the wrapper around an `html` mode frame, and the caption
 * overlay used for subtitle burn-in. All three are self-contained documents
 * with no external requests, so a headless screenshot is deterministic.
 */
import { resolveStyle, type StylePreset } from '../styles.ts'
import type { VideoFrame, VideoProject } from '../types.ts'

/** Escape text that lands in HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Pick a display size from the title length so long Chinese titles still fit. */
function titleSize(title: string, width: number): number {
  const length = [...title].length
  const base = width / 16
  if (length <= 8) return base
  if (length <= 14) return base * 0.78
  if (length <= 22) return base * 0.6
  return base * 0.46
}

/** Shared reset and page box for every rendered document. */
function documentShell(width: number, height: number, style: string, body: string, extra = ''): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=${width}, initial-scale=1">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
  body { ${style} }
  ${extra}
</style>
</head>
<body>${body}</body>
</html>`
}

/** Decoration layer for each treatment. */
function decoration(preset: StylePreset): string {
  const { accent, accentAlt, muted } = preset.palette
  switch (preset.treatment) {
    case 'grid':
      return `
  <div class="grid-layer"></div>
  <div class="corner tl"></div><div class="corner tr"></div>
  <div class="corner bl"></div><div class="corner br"></div>
  <div class="glow"></div>`
    case 'scanlines':
      return `
  <div class="scan-layer"></div>
  <div class="terminal-bar"><span class="dot dot-r"></span><span class="dot dot-y"></span><span class="dot dot-g"></span><span class="path">~/dsh/video</span></div>
  <div class="ascii">${escapeHtml('::  ██████  ::')}</div>
  <div class="caret"></div>`
    case 'paper':
      return `
  <div class="paper-rule"></div>
  <div class="paper-grain"></div>
  <div class="folio"></div>`
    default:
      return `<div style="position:absolute;inset:0;background:${accent};opacity:0.02"></div><div class="muted">${escapeHtml(muted)}</div>`
  }
}

/** Treatment-specific CSS. */
function treatmentCss(preset: StylePreset, width: number, height: number): string {
  const { accent, accentAlt, muted, text, background, surface } = preset.palette
  const unit = Math.round(width / 100)
  switch (preset.treatment) {
    case 'grid':
      return `
  body { background: ${background}; color: ${text}; font-family: ${preset.fonts.body}; }
  .grid-layer { position: absolute; inset: 0; background-image: linear-gradient(${accent}0a 1px, transparent 1px), linear-gradient(90deg, ${accent}0a 1px, transparent 1px); background-size: ${unit * 6}px ${unit * 6}px; }
  .glow { position: absolute; inset: 0; background: radial-gradient(ellipse at 18% 0%, ${accent}22, transparent 52%), radial-gradient(ellipse at 85% 100%, ${accentAlt}1f, transparent 55%); }
  .corner { position: absolute; width: ${unit * 2.2}px; height: ${unit * 2.2}px; border: 2px solid ${accent}; opacity: 0.65; }
  .corner.tl { top: ${unit * 2.4}px; left: ${unit * 2.4}px; border-right: none; border-bottom: none; }
  .corner.tr { top: ${unit * 2.4}px; right: ${unit * 2.4}px; border-left: none; border-bottom: none; }
  .corner.bl { bottom: ${unit * 2.4}px; left: ${unit * 2.4}px; border-right: none; border-top: none; }
  .corner.br { bottom: ${unit * 2.4}px; right: ${unit * 2.4}px; border-left: none; border-top: none; }
  .stage { position: relative; display: flex; flex-direction: column; justify-content: center; height: 100%; padding: 0 ${width * 0.09}px; }
  .eyebrow { font-family: ${preset.fonts.mono}; font-size: ${unit * 1.35}px; letter-spacing: 0.32em; color: ${accent}; text-transform: uppercase; margin-bottom: ${unit * 2}px; }
  .title { font-family: ${preset.fonts.display}; font-weight: 700; line-height: 1.06; letter-spacing: -0.02em; color: ${text}; text-wrap: balance; }
  .title em { font-style: normal; color: ${accent}; }
  .rule { width: ${unit * 9}px; height: ${unit * 0.36}px; margin-top: ${unit * 2.6}px; background: linear-gradient(90deg, ${accent}, ${accentAlt}); border-radius: 99px; }
  .narration { margin-top: ${unit * 2.2}px; max-width: ${width * 0.72}px; color: ${muted}; font-size: ${unit * 1.5}px; line-height: 1.6; }
  .footer { position: absolute; left: ${width * 0.09}px; right: ${width * 0.09}px; bottom: ${unit * 4.2}px; display: flex; justify-content: space-between; align-items: center; font-family: ${preset.fonts.mono}; font-size: ${unit * 1.05}px; letter-spacing: 0.22em; color: ${muted}; text-transform: uppercase; }
  .meter { width: ${width * 0.22}px; height: 2px; background: ${surface}; position: relative; }
  .meter i { position: absolute; inset: 0 auto 0 0; background: ${accent}; }`
    case 'scanlines':
      return `
  body { background: ${background}; color: ${text}; font-family: ${preset.fonts.mono}; }
  .scan-layer { position: absolute; inset: 0; background: repeating-linear-gradient(0deg, ${accent}09 0px, ${accent}09 1px, transparent 1px, transparent 4px); }
  .terminal-bar { position: absolute; top: ${unit * 2.6}px; left: ${unit * 2.6}px; right: ${unit * 2.6}px; height: ${unit * 3.2}px; border: 1px solid ${accent}44; border-radius: ${unit * 0.7}px; display: flex; align-items: center; gap: ${unit * 0.8}px; padding: 0 ${unit * 1.4}px; background: ${surface}; }
  .dot { width: ${unit * 0.9}px; height: ${unit * 0.9}px; border-radius: 50%; display: inline-block; }
  .dot-r { background: #ef4444; } .dot-y { background: #eab308; } .dot-g { background: ${accent}; }
  .path { margin-left: ${unit}px; color: ${muted}; font-size: ${unit * 1.05}px; letter-spacing: 0.1em; }
  .ascii { position: absolute; right: ${unit * 2.6}px; bottom: ${unit * 3}px; color: ${accent}40; font-size: ${unit * 1.05}px; letter-spacing: 0.16em; }
  .caret { position: absolute; left: ${width * 0.1}px; bottom: ${unit * 6}px; width: ${unit * 1.1}px; height: ${unit * 2}px; background: ${accent}; opacity: 0.8; animation: blink 1.1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  .stage { position: relative; display: flex; flex-direction: column; justify-content: center; height: 100%; padding: 0 ${width * 0.1}px; }
  .eyebrow { font-size: ${unit * 1.25}px; color: ${muted}; letter-spacing: 0.2em; margin-bottom: ${unit * 2}px; }
  .eyebrow b { color: ${accent}; font-weight: 400; }
  .title { font-weight: 700; line-height: 1.1; color: ${text}; text-shadow: 0 0 ${unit * 2.4}px ${accent}66; text-wrap: balance; }
  .title em { font-style: normal; color: ${accent}; }
  .rule { width: ${unit * 8}px; height: 2px; margin-top: ${unit * 2.4}px; background: ${accent}; box-shadow: 0 0 ${unit}px ${accent}; }
  .narration { margin-top: ${unit * 2}px; max-width: ${width * 0.7}px; color: ${muted}; font-size: ${unit * 1.4}px; line-height: 1.7; }
  .footer { position: absolute; left: ${width * 0.1}px; right: ${width * 0.1}px; bottom: ${unit * 3.4}px; display: flex; justify-content: space-between; font-size: ${unit * 1}px; letter-spacing: 0.18em; color: ${muted}; text-transform: uppercase; }
  .meter { width: ${width * 0.2}px; height: 2px; background: ${surface}; }
  .meter i { display: block; height: 100%; background: ${accent}; }`
    case 'paper':
      return `
  body { background: ${background}; color: ${text}; font-family: ${preset.fonts.body}; }
  .paper-grain { position: absolute; inset: 0; background-image: radial-gradient(${accent}14 1px, transparent 1px); background-size: ${unit * 2.4}px ${unit * 2.4}px; opacity: 0.55; }
  .paper-rule { position: absolute; top: ${unit * 7}px; left: ${width * 0.1}px; right: ${width * 0.1}px; height: 1px; background: ${accent}55; }
  .folio { position: absolute; right: ${width * 0.1}px; top: ${unit * 4.6}px; font-family: ${preset.fonts.mono}; font-size: ${unit * 1.1}px; color: ${muted}; letter-spacing: 0.2em; }
  .stage { position: relative; display: flex; flex-direction: column; justify-content: center; height: 100%; padding: 0 ${width * 0.1}px; }
  .eyebrow { font-family: ${preset.fonts.mono}; font-size: ${unit * 1.2}px; letter-spacing: 0.3em; color: ${accent}; text-transform: uppercase; margin-bottom: ${unit * 2.4}px; }
  .title { font-family: ${preset.fonts.display}; font-weight: 600; line-height: 1.14; color: ${text}; text-wrap: balance; }
  .title em { font-style: italic; color: ${accentAlt}; }
  .rule { width: ${unit * 7}px; height: 3px; margin-top: ${unit * 2.6}px; background: ${accent}; }
  .narration { margin-top: ${unit * 2.2}px; max-width: ${width * 0.68}px; color: ${muted}; font-size: ${unit * 1.5}px; line-height: 1.75; }
  .footer { position: absolute; left: ${width * 0.1}px; right: ${width * 0.1}px; bottom: ${unit * 4}px; display: flex; justify-content: space-between; align-items: center; font-family: ${preset.fonts.mono}; font-size: ${unit * 1.05}px; letter-spacing: 0.18em; color: ${muted}; text-transform: uppercase; }
  .meter { width: ${width * 0.18}px; height: 2px; background: ${surface}; }
  .meter i { display: block; height: 100%; background: ${accent}; }`
    default:
      return ''
  }
}

/** Options for the generated title card. */
export interface CardOptions {
  style: string
  title: string
  narration: string
  /** 1-based position. */
  index: number
  total: number
  width: number
  height: number
  /** Project title shown in the footer. */
  projectTitle?: string
}

/**
 * Render the built-in static card for a frame.
 * @param options - text, style and dimensions.
 * @returns a complete HTML document.
 */
export function renderTitleCard(options: CardOptions): string {
  const preset = resolveStyle(options.style)
  const title = options.title.trim().length > 0 ? options.title.trim() : truncate(options.narration, 18)
  const narration = truncate(options.narration, 64)
  const progress = options.total > 0 ? Math.round((options.index / options.total) * 100) : 0
  const footerLeft = preset.treatment === 'paper' ? 'AI VIDEO · ' : 'DSH / AI VIDEO · '
  const body = `${decoration(preset)}
<main class="stage">
  <div class="eyebrow">${preset.treatment === 'scanlines' ? '&gt; frame <b>' : 'Frame '}${String(options.index).padStart(2, '0')} / ${String(options.total).padStart(2, '0')}</div>
  <h1 class="title" style="font-size:${Math.round(titleSize(title, options.width))}px">${escapeHtml(title)}</h1>
  <div class="rule"></div>
  ${narration.length > 0 ? `<p class="narration">${escapeHtml(narration)}</p>` : ''}
</main>
<footer class="footer">
  <span>${escapeHtml(footerLeft)}${escapeHtml(options.projectTitle ?? '')}</span>
  <span class="meter"><i style="width:${progress}%"></i></span>
  <span>${String(options.index).padStart(2, '0')}</span>
</footer>`
  const style = `width:${options.width}px;height:${options.height}px;position:relative;overflow:hidden;background:${preset.palette.background};`
  return documentShell(options.width, options.height, style, body, treatmentCss(preset, options.width, options.height))
}

/**
 * Render one `html` mode frame inside a fixed viewport.
 * @param project - owning project (size and style).
 * @param frame - frame whose `html` is rendered; falls back to a title card.
 * @returns a complete HTML document.
 */
export function renderHtmlFrame(project: VideoProject, frame: VideoFrame, index: number): string {
  if (frame.html.trim().length === 0) {
    return renderTitleCard({
      style: project.style,
      title: frame.title,
      narration: frame.narration,
      index,
      total: project.frames.length,
      width: project.width,
      height: project.height,
      projectTitle: project.title,
    })
  }
  const preset = resolveStyle(project.style)
  const base = `width:${project.width}px;height:${project.height}px;overflow:hidden;background:${preset.palette.background};color:${preset.palette.text};font-family:${preset.fonts.body};`
  // The frame may be a fragment or a full document; keep its <head> styles.
  if (/<html[\s>]/i.test(frame.html)) return frame.html
  return documentShell(project.width, project.height, base, frame.html)
}

/**
 * Transparent full-frame caption used for subtitle burn-in.
 * @param text - caption line.
 * @param style - preset id.
 * @param width - frame width.
 * @param height - frame height.
 * @returns a transparent HTML document.
 */
export function renderCaptionOverlay(text: string, style: string, width: number, height: number): string {
  const preset = resolveStyle(style)
  const unit = Math.round(width / 100)
  const body = `<div class="caption"><span>${escapeHtml(text)}</span></div>`
  const styleAttr = 'position:relative;width:' + width + 'px;height:' + height + 'px;background:transparent;'
  const extra = `
  .caption { position: absolute; left: 0; right: 0; bottom: ${unit * 7}px; display: flex; justify-content: center; padding: 0 ${unit * 8}px; }
  .caption span { max-width: 86%; padding: ${unit * 0.9}px ${unit * 2}px; border-radius: ${unit * 0.7}px; background: ${preset.treatment === 'paper' ? 'rgba(43,33,26,0.82)' : 'rgba(3,7,18,0.72)'}; color: #fff; font-family: ${preset.fonts.body}; font-size: ${unit * 2.05}px; line-height: 1.5; text-align: center; letter-spacing: 0.01em; }`
  return documentShell(width, height, styleAttr, body, extra)
}

/** Clip a string to a character budget, keeping surrogate pairs intact. */
export function truncate(text: string, max: number): string {
  const chars = [...text.trim()]
  if (chars.length <= max) return chars.join('')
  return `${chars.slice(0, max).join('')}…`
}
