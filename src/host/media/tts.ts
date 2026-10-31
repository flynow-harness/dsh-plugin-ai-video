/**
 * Narration synthesis. A configured OpenAI-compatible speech gateway is used
 * first; otherwise the plugin falls back to the OS speech synthesizer so the
 * pipeline still produces a voiced draft without any account. Every result is
 * probed for its real duration, which then drives the frame timeline.
 */
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { VideoSettings } from '../config.ts'
import { probeDuration } from '../render/ffmpeg.ts'
import { estimateNarrationSec } from '../render/timeline.ts'

const run = promisify(execFile)

/** Provider that produced the audio. */
export type TtsProvider = 'api' | 'say' | 'espeak' | 'silent'

/** One synthesized narration. */
export interface TtsResult {
  path: string
  durationMs: number
  provider: TtsProvider
}

/** Normalize a gateway base URL, adding `/v1` when the user omitted it. */
export function normalizeBaseUrl(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '')
  if (trimmed.length === 0) throw new Error('endpoint base URL is empty')
  return /\/v\d+$/i.test(trimmed) ? trimmed : `${trimmed}/v1`
}

/** Detect an audio container from its leading bytes. */
export function detectAudioExtension(buffer: Buffer): 'wav' | 'mp3' | 'aiff' | 'm4a' | 'ogg' {
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE') return 'wav'
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'FORM') return 'aiff'
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') return 'm4a'
  if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'OggS') return 'ogg'
  return 'mp3'
}

/** Whether a binary is on PATH. */
async function available(binary: string): Promise<boolean> {
  try {
    await run('which', [binary])
    return true
  } catch {
    return false
  }
}

/**
 * Find a narration duration.
 * @param settings - resolved settings.
 * @param path - audio file.
 * @param text - narration used as the estimate fallback.
 * @param signal - cancellation.
 * @returns milliseconds.
 */
async function durationOf(settings: VideoSettings, path: string, text: string, signal?: AbortSignal): Promise<number> {
  const seconds = await probeDuration(settings, path, signal)
  return Math.round((seconds ?? estimateNarrationSec(text)) * 1000)
}

/** Ask the configured gateway for speech. */
async function synthesizeWithApi(
  text: string,
  outDir: string,
  frameId: string,
  settings: VideoSettings,
  signal?: AbortSignal,
): Promise<{ path: string; buffer: Buffer }> {
  const base = normalizeBaseUrl(settings.ttsBaseUrl)
  const response = await fetch(`${base}/audio/speech`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, audio/mpeg;q=0.9, */*;q=0.5',
      ...(settings.ttsApiKey.length > 0 ? { authorization: `Bearer ${settings.ttsApiKey}` } : {}),
    },
    body: JSON.stringify({
      model: settings.ttsModel,
      voice: settings.ttsVoice,
      input: text,
      response_format: 'mp3',
    }),
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 400)
    throw new Error(`TTS gateway returned ${response.status}: ${detail}`)
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const payload = await response.json() as { audio?: string; data?: string; url?: string; error?: { message?: string } }
    if (payload.error?.message !== undefined) throw new Error(`TTS gateway error: ${payload.error.message}`)
    const inline = payload.audio ?? payload.data
    if (typeof inline === 'string' && inline.length > 0) {
      const buffer = Buffer.from(inline, 'base64')
      const path = join(outDir, `${frameId}.${detectAudioExtension(buffer)}`)
      await writeFile(path, buffer)
      return { path, buffer }
    }
    if (typeof payload.url === 'string' && payload.url.length > 0) {
      const audioResponse = await fetch(payload.url, signal === undefined ? {} : { signal })
      if (!audioResponse.ok) throw new Error(`TTS download returned ${audioResponse.status}`)
      const buffer = Buffer.from(await audioResponse.arrayBuffer())
      const path = join(outDir, `${frameId}.${detectAudioExtension(buffer)}`)
      await writeFile(path, buffer)
      return { path, buffer }
    }
    throw new Error('TTS gateway returned JSON without audio data')
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length === 0) throw new Error('TTS gateway returned an empty body')
  const path = join(outDir, `${frameId}.${detectAudioExtension(buffer)}`)
  await writeFile(path, buffer)
  return { path, buffer }
}

/** macOS `say`, optionally transcoded to AAC so browsers can play it. */
async function synthesizeWithSay(text: string, outDir: string, frameId: string, settings: VideoSettings, signal?: AbortSignal): Promise<string> {
  const raw = join(outDir, `${frameId}.aiff`)
  const args = settings.localVoice.length > 0 ? ['-v', settings.localVoice, '-o', raw, text] : ['-o', raw, text]
  await run('say', args, timeoutOptions(signal))
  const m4a = join(outDir, `${frameId}.m4a`)
  try {
    await run(settings.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-i', raw, '-c:a', 'aac', '-b:a', '160k', m4a], timeoutOptions(signal))
    return m4a
  } catch {
    return raw
  }
}

/** Linux `espeak-ng` fallback. */
async function synthesizeWithEspeak(text: string, outDir: string, frameId: string, signal?: AbortSignal): Promise<string> {
  const path = join(outDir, `${frameId}.wav`)
  await run('espeak-ng', ['-w', path, text], timeoutOptions(signal))
  return path
}

/** Shared spawn options. */
function timeoutOptions(signal: AbortSignal | undefined): { timeout: number; maxBuffer: number } & { signal?: AbortSignal } {
  return {
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    ...(signal === undefined ? {} : { signal }),
  }
}

/** Options for {@link synthesizeNarration}. */
export interface SynthesizeOptions {
  text: string
  frameId: string
  outDir: string
  settings: VideoSettings
  signal?: AbortSignal
}

/**
 * Synthesize one frame's narration and measure it.
 * @param options - text, destination directory and settings.
 * @returns the audio file and its measured duration.
 */
export async function synthesizeNarration(options: SynthesizeOptions): Promise<TtsResult> {
  const text = options.text.trim()
  if (text.length === 0) throw new Error('narration is empty')
  if (options.settings.ttsBaseUrl.length > 0) {
    const { path } = await synthesizeWithApi(text, options.outDir, options.frameId, options.settings, options.signal)
    return { path, durationMs: await durationOf(options.settings, path, text, options.signal), provider: 'api' }
  }
  if (!options.settings.localTts) {
    throw new Error('no TTS gateway configured: set `ttsBaseUrl`/`ttsApiKey` or enable `localTts`')
  }
  if (process.platform === 'darwin' && await available('say')) {
    const path = await synthesizeWithSay(text, options.outDir, options.frameId, options.settings, options.signal)
    return { path, durationMs: await durationOf(options.settings, path, text, options.signal), provider: 'say' }
  }
  if (await available('espeak-ng')) {
    const path = await synthesizeWithEspeak(text, options.outDir, options.frameId, options.signal)
    return { path, durationMs: await durationOf(options.settings, path, text, options.signal), provider: 'espeak' }
  }
  throw new Error('no speech synthesizer available: configure `ttsBaseUrl`/`ttsApiKey`, enable `localTts` on macOS, or install espeak-ng')
}
