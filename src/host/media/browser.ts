/**
 * Headless Chrome rasterization. HTML frames and the built-in title cards are
 * real documents; Chrome turns them into exactly-sized PNGs, which keeps the
 * plugin free of a native image pipeline and gives `html` mode a path to MP4.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import type { VideoSettings } from '../config.ts'

const run = promisify(execFile)

/** Absolute candidates per platform, most common first. */
const POSIX_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Arc.app/Contents/MacOS/Arc',
]

/** Command candidates resolved on PATH. */
const PATH_CANDIDATES = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'microsoft-edge',
  'chrome',
]

/** Windows install locations. */
const WINDOWS_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

/** Whether a PATH command exists. */
async function onPath(command: string): Promise<string | undefined> {
  try {
    const { stdout } = await run('which', [command])
    const path = stdout.trim()
    return path.length > 0 ? path : undefined
  } catch {
    return undefined
  }
}

/**
 * Find a Chromium-family browser.
 * @param settings - resolved plugin settings (explicit path wins).
 * @returns absolute executable path, or undefined when none is installed.
 */
export async function detectBrowser(settings: VideoSettings): Promise<string | undefined> {
  const explicit = settings.chromePath.trim()
  if (explicit.length > 0) {
    if (existsSync(explicit)) return explicit
    const found = await onPath(explicit)
    if (found !== undefined) return found
  }
  if (process.platform === 'win32') {
    for (const candidate of WINDOWS_CANDIDATES) if (existsSync(candidate)) return candidate
  }
  if (process.platform === 'darwin') {
    for (const candidate of POSIX_CANDIDATES) if (existsSync(candidate)) return candidate
  }
  for (const candidate of PATH_CANDIDATES) {
    const found = await onPath(candidate)
    if (found !== undefined) return found
  }
  return undefined
}

/** Options for one screenshot. */
export interface ScreenshotOptions {
  width: number
  height: number
  /** Render the page background transparent (used for caption overlays). */
  transparent?: boolean
  /** Virtual time the page may run before the capture, so CSS animations settle. */
  settleMs?: number
  /** Working directory for intermediate HTML files. */
  workDir: string
  /** Abort signal from the tool call. */
  signal?: AbortSignal
}

/** Cached browser path per settings object, so frames do not re-detect. */
const browserCache = new WeakMap<VideoSettings, string | undefined>()

/**
 * Render an HTML document to a PNG.
 * @param settings - resolved settings.
 * @param html - complete document.
 * @param outPath - destination PNG path.
 * @param options - viewport and timing.
 * @returns the destination path.
 */
export async function screenshotHtml(
  settings: VideoSettings,
  html: string,
  outPath: string,
  options: ScreenshotOptions,
): Promise<string> {
  const browser = browserCache.get(settings) ?? await detectBrowser(settings)
  browserCache.set(settings, browser)
  if (browser === undefined) {
    throw new Error('no Chrome/Chromium found; set `chromePath` in the plugin config or install Google Chrome')
  }
  const workDir = await mkdtemp(join(tmpdir(), 'dsh-video-'))
  const htmlPath = join(workDir, 'frame.html')
  const profileDir = join(workDir, 'profile')
  await writeFile(htmlPath, html, 'utf8')
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--force-device-scale-factor=1',
    `--user-data-dir=${profileDir}`,
    `--window-size=${Math.round(options.width)},${Math.round(options.height)}`,
    `--virtual-time-budget=${Math.round(options.settleMs ?? 1200)}`,
    '--run-all-compositor-stages-before-draw',
    ...(options.transparent === true ? ['--default-background-color=00000000'] : []),
    `--screenshot=${outPath}`,
    pathToFileURL(htmlPath).href,
  ]
  try {
    await run(browser, args, {
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch (error) {
    throw new Error(`Chrome screenshot failed: ${messageOf(error)}`)
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
  const info = await stat(outPath).catch(() => undefined)
  if (info === undefined || info.size === 0) throw new Error('Chrome produced no screenshot')
  return outPath
}

/** Readable message from an unknown thrown value. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) {
    const stderr = (error as Error & { stderr?: string }).stderr
    const detail = typeof stderr === 'string' && stderr.trim().length > 0 ? stderr.trim().split('\n').slice(-3).join(' ') : ''
    return detail.length > 0 ? `${error.message}: ${detail}` : error.message
  }
  return String(error)
}
