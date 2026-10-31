/**
 * Visual style presets, ported from the reference workbench: three distinct
 * treatments that drive generated stills, HTML frames, title cards and the
 * preview player's chrome.
 */
import { VIDEO_MODES, type VideoMode } from './types.ts'

/** Decorative treatment applied by the built-in card and preview renderers. */
export type StyleTreatment = 'grid' | 'scanlines' | 'paper'

/** One named look. */
export interface StylePreset {
  id: string
  /** Localized display name. */
  name: Record<'zh' | 'en', string>
  /** One-line guidance the model can fold into an image prompt. */
  guidance: Record<'zh' | 'en', string>
  modes: readonly VideoMode[]
  palette: {
    background: string
    surface: string
    text: string
    muted: string
    accent: string
    accentAlt: string
  }
  fonts: {
    display: string
    body: string
    mono: string
  }
  treatment: StyleTreatment
}

/** Built-in presets keyed by id. */
export const STYLE_PRESETS: Readonly<Record<string, StylePreset>> = {
  'cyber-clean': {
    id: 'cyber-clean',
    name: { zh: '科技博主', en: 'Cyber Clean' },
    guidance: {
      zh: '深色科技感、青色霓虹、卡片化信息布局，适合测评、拆解、科技分享',
      en: 'Dark tech backdrop, cyan neon accents, card-based information layout for reviews and explainers',
    },
    modes: VIDEO_MODES,
    palette: {
      background: '#0a0e1a',
      surface: 'rgba(148, 163, 184, 0.08)',
      text: '#e2e8f0',
      muted: '#64748b',
      accent: '#38bdf8',
      accentAlt: '#a855f7',
    },
    fonts: {
      display: "'SF Pro Display', 'PingFang SC', 'Helvetica Neue', sans-serif",
      body: "'SF Pro Text', 'PingFang SC', 'Helvetica Neue', sans-serif",
      mono: "'SF Mono', 'JetBrains Mono', Menlo, monospace",
    },
    treatment: 'grid',
  },
  'terminal-matrix': {
    id: 'terminal-matrix',
    name: { zh: '黑客风', en: 'Terminal Matrix' },
    guidance: {
      zh: '终端界面、Matrix 绿、ASCII 装饰、扫描线效果，适合技术演示和极客内容',
      en: 'Terminal chrome, matrix green, ASCII ornaments and scanlines for technical and hacker content',
    },
    modes: VIDEO_MODES,
    palette: {
      background: '#030803',
      surface: 'rgba(34, 197, 94, 0.08)',
      text: '#dcfce7',
      muted: '#4ade80',
      accent: '#22c55e',
      accentAlt: '#a3e635',
    },
    fonts: {
      display: "'SF Mono', 'JetBrains Mono', Menlo, monospace",
      body: "'SF Mono', 'JetBrains Mono', Menlo, monospace",
      mono: "'SF Mono', 'JetBrains Mono', Menlo, monospace",
    },
    treatment: 'scanlines',
  },
  'warm-story': {
    id: 'warm-story',
    name: { zh: '暖色系', en: 'Warm Story' },
    guidance: {
      zh: '奶油米色、暖橘琥珀、衬线标题和大留白，适合人文、生活方式、故事表达',
      en: 'Cream paper, warm amber, serif headings and generous whitespace for human and lifestyle stories',
    },
    modes: VIDEO_MODES,
    palette: {
      background: '#f6efe3',
      surface: 'rgba(120, 72, 20, 0.08)',
      text: '#2b211a',
      muted: '#8a6f56',
      accent: '#d97706',
      accentAlt: '#b45309',
    },
    fonts: {
      display: "'Iowan Old Style', 'Songti SC', Georgia, serif",
      body: "'PingFang SC', 'Helvetica Neue', sans-serif",
      mono: "'SF Mono', Menlo, monospace",
    },
    treatment: 'paper',
  },
}

/** Default preset id when a project does not name one. */
export const DEFAULT_STYLE = 'cyber-clean'

/**
 * Resolve a style id, falling back to the default instead of failing a run.
 * @param id - preset id from the project.
 * @returns the preset.
 */
export function resolveStyle(id: string | undefined): StylePreset {
  if (id === undefined) return STYLE_PRESETS[DEFAULT_STYLE] as StylePreset
  return STYLE_PRESETS[id] ?? (STYLE_PRESETS[DEFAULT_STYLE] as StylePreset)
}

/**
 * Whether a preset is allowed for a mode (all built-ins allow both).
 * @param id - preset id.
 * @param mode - project mode.
 * @returns true when usable.
 */
export function styleSupportsMode(id: string, mode: VideoMode): boolean {
  return resolveStyle(id).modes.includes(mode)
}

/** List preset ids in display order. */
export function styleIds(): string[] {
  return Object.keys(STYLE_PRESETS)
}
