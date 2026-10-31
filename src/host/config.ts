/**
 * Plugin configuration. Everything is flat so a profile patch can override one
 * key without restating a nested object, and secrets may also arrive through
 * environment variables (which win over an empty config value).
 */
import z from '@deepseek-ai/schemastery'

/** Raw config as written in `cordis.patch.yml`; every field has a default. */
export interface AiVideoConfig {
  /** Directory holding every project. Defaults to `$DSH_HOME/ai-video`. */
  rootDir: string
  /** ffmpeg executable used for MP4 assembly. */
  ffmpegPath: string
  /** ffprobe executable used for audio durations. */
  ffprobePath: string
  /** Chrome/Chromium executable used to rasterize HTML frames and title cards. */
  chromePath: string
  /** Whether HTML → PNG rendering through Chrome is allowed. */
  browserRender: boolean
  /** Whether a still is generated for frames that have no image yet. */
  autoVisuals: boolean
  /** Whether narration falls back to the OS speech synthesizer when no TTS gateway is configured. */
  localTts: boolean
  /** OpenAI-compatible image endpoint, without `/images/generations`. */
  imageBaseUrl: string
  imageApiKey: string
  imageModel: string
  /** `WxH` pixel size sent to the image endpoint. */
  imageSize: string
  /** OpenAI-compatible speech endpoint, without `/audio/speech`. */
  ttsBaseUrl: string
  ttsApiKey: string
  ttsModel: string
  ttsVoice: string
  /** Voice used by the macOS `say` fallback. */
  localVoice: string
  /** Output frames per second. */
  fps: number
  /** Default frame width when a project does not set one. */
  width: number
  /** Default frame height when a project does not set one. */
  height: number
  /** libx264 quality knob. */
  crf: number
  /** Whether `video_render` burns subtitles when the local ffmpeg has libass. */
  burnSubtitles: boolean
  /** Seconds of silence appended after each narration to avoid clipped tails. */
  frameTailSec: number
}

/** Default image and speech gateways mirror the upstream OpenAI-compatible setup. */
export const DEFAULT_CONFIG: AiVideoConfig = {
  rootDir: '',
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
  chromePath: '',
  browserRender: true,
  autoVisuals: true,
  localTts: true,
  imageBaseUrl: '',
  imageApiKey: '',
  imageModel: 'gpt-image-1',
  imageSize: '1536x1024',
  ttsBaseUrl: '',
  ttsApiKey: '',
  ttsModel: 'gpt-4o-mini-tts',
  ttsVoice: 'alloy',
  localVoice: '',
  fps: 30,
  width: 1920,
  height: 1080,
  crf: 20,
  burnSubtitles: true,
  frameTailSec: 0.35,
}

/** Schemastery schema applied by the Loader before `apply` runs. */
export const Config: z<AiVideoConfig> = z.object({
  rootDir: z.string().default(''),
  ffmpegPath: z.string().default('ffmpeg'),
  ffprobePath: z.string().default('ffprobe'),
  chromePath: z.string().default(''),
  browserRender: z.boolean().default(true),
  autoVisuals: z.boolean().default(true),
  localTts: z.boolean().default(true),
  imageBaseUrl: z.string().default(''),
  imageApiKey: z.string().default(''),
  imageModel: z.string().default('gpt-image-1'),
  imageSize: z.string().default('1536x1024'),
  ttsBaseUrl: z.string().default(''),
  ttsApiKey: z.string().default(''),
  ttsModel: z.string().default('gpt-4o-mini-tts'),
  ttsVoice: z.string().default('alloy'),
  localVoice: z.string().default(''),
  fps: z.number().default(30),
  width: z.number().default(1920),
  height: z.number().default(1080),
  crf: z.number().default(20),
  burnSubtitles: z.boolean().default(true),
  frameTailSec: z.number().default(0.35),
})

/** Fully resolved settings handed to the media pipeline. */
export interface VideoSettings {
  rootDir: string
  ffmpegPath: string
  ffprobePath: string
  chromePath: string
  browserRender: boolean
  autoVisuals: boolean
  localTts: boolean
  imageBaseUrl: string
  imageApiKey: string
  imageModel: string
  imageSize: string
  ttsBaseUrl: string
  ttsApiKey: string
  ttsModel: string
  ttsVoice: string
  localVoice: string
  fps: number
  width: number
  height: number
  crf: number
  burnSubtitles: boolean
  frameTailSec: number
}

/** Read a non-empty environment variable, honouring the documented prefixes. */
function envValue(name: string): string {
  const value = process.env[name]
  return value === undefined ? '' : value.trim()
}

/** First non-empty value, so config wins only when it was actually set. */
function first(...values: string[]): string {
  for (const value of values) if (value.trim().length > 0) return value.trim()
  return ''
}

/** Home directory fallback without importing `node:os` in every caller. */
function defaultRoot(): string {
  const home = process.env.DSH_HOME ?? process.env.HOME ?? process.cwd()
  return `${home.replace(/\/+$/, '')}/ai-video`
}

/** Positive number guard with a fallback, so a bad patch never breaks rendering silently. */
function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * Merge schema defaults, environment overrides and the user's directory choice.
 * Env overrides exist so credentials never need to live in a tracked patch file.
 */
export function resolveSettings(config: Partial<AiVideoConfig> | undefined): VideoSettings {
  const merged: AiVideoConfig = { ...DEFAULT_CONFIG, ...(config ?? {}) }
  const rootDir = first(merged.rootDir, envValue('DSH_VIDEO_ROOT'), defaultRoot())
  return {
    rootDir,
    ffmpegPath: first(merged.ffmpegPath, envValue('DSH_VIDEO_FFMPEG'), 'ffmpeg'),
    ffprobePath: first(merged.ffprobePath, envValue('DSH_VIDEO_FFPROBE'), 'ffprobe'),
    chromePath: first(merged.chromePath, envValue('DSH_VIDEO_CHROME'), envValue('CHROME_PATH')),
    browserRender: merged.browserRender,
    autoVisuals: merged.autoVisuals,
    localTts: merged.localTts,
    imageBaseUrl: first(merged.imageBaseUrl, envValue('DSH_VIDEO_IMAGE_BASE_URL')),
    imageApiKey: first(merged.imageApiKey, envValue('DSH_VIDEO_IMAGE_API_KEY')),
    imageModel: first(merged.imageModel, 'gpt-image-1'),
    imageSize: first(merged.imageSize, '1536x1024'),
    ttsBaseUrl: first(merged.ttsBaseUrl, envValue('DSH_VIDEO_TTS_BASE_URL')),
    ttsApiKey: first(merged.ttsApiKey, envValue('DSH_VIDEO_TTS_API_KEY')),
    ttsModel: first(merged.ttsModel, 'gpt-4o-mini-tts'),
    ttsVoice: first(merged.ttsVoice, 'alloy'),
    localVoice: merged.localVoice.trim(),
    fps: positive(merged.fps, 30),
    width: positive(merged.width, 1920),
    height: positive(merged.height, 1080),
    crf: merged.crf >= 0 && merged.crf <= 51 ? merged.crf : 20,
    burnSubtitles: merged.burnSubtitles,
    frameTailSec: merged.frameTailSec >= 0 ? merged.frameTailSec : 0.35,
  }
}
