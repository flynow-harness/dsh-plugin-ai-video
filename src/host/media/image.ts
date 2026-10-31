/**
 * Still generation for `image` mode. Speaks the OpenAI images protocol
 * (`/images/generations` with `b64_json` or a URL) and also understands the
 * asynchronous task shape some gateways expose. Images are saved with the
 * extension their magic bytes imply.
 */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { VideoSettings } from '../config.ts'
import { normalizeBaseUrl } from './tts.ts'

/** One generated still. */
export interface StillResult {
  path: string
  provider: 'api'
}

/** Detect an image container from its leading bytes. */
export function detectImageExtension(buffer: Buffer): 'png' | 'jpg' | 'webp' | 'gif' {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') return 'png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  if (buffer.length >= 6 && buffer.toString('ascii', 0, 3) === 'GIF') return 'gif'
  return 'png'
}

/** Pull an image reference out of any of the shapes gateways return. */
function extractReference(payload: Record<string, unknown>): { base64?: string; url?: string; taskId?: string } {
  const data = payload.data
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0] as Record<string, unknown> | undefined
    if (first !== undefined) {
      if (typeof first.b64_json === 'string') return { base64: first.b64_json }
      if (typeof first.url === 'string') return { url: first.url }
    }
  }
  if (typeof payload.b64_json === 'string') return { base64: payload.b64_json }
  if (typeof payload.image_url === 'string') return { url: payload.image_url }
  if (typeof payload.url === 'string') return { url: payload.url }
  if (Array.isArray(payload.images) && typeof payload.images[0] === 'string') return { url: payload.images[0] as string }
  const output = payload.output
  if (typeof output === 'string') return { url: output }
  if (Array.isArray(output) && typeof (output[0] as Record<string, unknown> | undefined)?.url === 'string') {
    return { url: (output[0] as { url: string }).url }
  }
  if (typeof payload.id === 'string' && typeof payload.status === 'string') return { taskId: payload.id }
  return {}
}

/** Read a remote image, following one redirect. */
async function download(url: string, signal?: AbortSignal): Promise<Buffer> {
  const response = await fetch(url, signal === undefined ? {} : { signal })
  if (!response.ok) throw new Error(`image download returned ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

/** Poll a task-style gateway until it finishes. */
async function pollTask(base: string, taskId: string, settings: VideoSettings, signal?: AbortSignal): Promise<Buffer> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (signal?.aborted === true) throw new Error('image generation aborted')
    const response = await fetch(`${base}/tasks/${encodeURIComponent(taskId)}`, {
      headers: settings.imageApiKey.length > 0 ? { authorization: `Bearer ${settings.imageApiKey}` } : {},
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) throw new Error(`image task poll returned ${response.status}`)
    const payload = await response.json() as Record<string, unknown>
    const status = String(payload.status ?? '')
    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      const reference = extractReference(payload)
      if (reference.url !== undefined) return download(reference.url, signal)
      if (reference.base64 !== undefined) return Buffer.from(reference.base64, 'base64')
      throw new Error('image task completed without a URL')
    }
    if (status === 'failed' || status === 'error') throw new Error(`image task failed: ${JSON.stringify(payload).slice(0, 300)}`)
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  throw new Error('image task timed out after 120s')
}

/** Options for {@link generateStill}. */
export interface GenerateStillOptions {
  prompt: string
  frameId: string
  outDir: string
  settings: VideoSettings
  signal?: AbortSignal
}

/**
 * Generate one still from a prompt.
 * @param options - prompt, destination and settings.
 * @returns the saved image path.
 */
export async function generateStill(options: GenerateStillOptions): Promise<StillResult> {
  const prompt = options.prompt.trim()
  if (prompt.length === 0) throw new Error('image prompt is empty')
  const { settings } = options
  if (settings.imageBaseUrl.length === 0) {
    throw new Error('no image gateway configured: set `imageBaseUrl` and `imageApiKey`')
  }
  const base = normalizeBaseUrl(settings.imageBaseUrl)
  const endpoint = `${base}/images/generations`
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (settings.imageApiKey.length > 0) headers.authorization = `Bearer ${settings.imageApiKey}`
  const fullBody = {
    model: settings.imageModel,
    prompt,
    n: 1,
    size: settings.imageSize,
    response_format: 'b64_json',
  }
  let response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(fullBody),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  if (response.status === 400) {
    // Some gateways reject `n`, `size` or `response_format`; retry with the minimum.
    const minimal = { model: settings.imageModel, prompt }
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(minimal),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 400)
    throw new Error(`image gateway returned ${response.status}: ${detail}`)
  }
  const payload = await response.json() as Record<string, unknown>
  const reference = extractReference(payload)
  let buffer: Buffer
  if (reference.taskId !== undefined) buffer = await pollTask(base, reference.taskId, settings, options.signal)
  else if (reference.base64 !== undefined) buffer = Buffer.from(reference.base64, 'base64')
  else if (reference.url !== undefined) buffer = await download(reference.url, options.signal)
  else throw new Error(`image gateway response has no image: ${JSON.stringify(payload).slice(0, 300)}`)
  if (buffer.length < 512) throw new Error('image gateway returned an empty image')
  const path = join(options.outDir, `${options.frameId}.${detectImageExtension(buffer)}`)
  await writeFile(path, buffer)
  return { path, provider: 'api' }
}
