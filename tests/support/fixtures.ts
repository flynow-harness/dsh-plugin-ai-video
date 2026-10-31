/** Shared fixtures and environment probes for the test suite. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveSettings, type AiVideoConfig, type VideoSettings } from '../../src/host/config.ts'
import type { VideoFrame, VideoProject } from '../../src/host/types.ts'

/** Create a throwaway projects root and its settings. */
export function makeTempSettings(overrides: Partial<AiVideoConfig> = {}): VideoSettings {
  const root = mkdtempSync(join(tmpdir(), 'dsh-video-test-'))
  return resolveSettings({
    rootDir: root,
    browserRender: false,
    autoVisuals: false,
    localTts: false,
    ...overrides,
  })
}

/** Remove a temporary root. */
export async function cleanup(settings: VideoSettings): Promise<void> {
  await rm(settings.rootDir, { recursive: true, force: true })
}

/** Whether a binary runs. */
export function hasBinary(binary: string): boolean {
  try {
    execFileSync('which', [binary], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Whether headless Chrome can be detected on this machine. */
export function hasChrome(): boolean {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]
  return candidates.some(path => {
    try {
      execFileSync('test', ['-x', path])
      return true
    } catch {
      return false
    }
  }) || hasBinary('google-chrome') || hasBinary('chromium')
}

/** One frame document with overridable fields. */
export function makeFrame(overrides: Partial<VideoFrame> = {}): VideoFrame {
  return {
    id: 'f1',
    title: '开场',
    narration: '你好，这是一个测试分镜。',
    visual: 'a dark studio with cyan light',
    html: '',
    ...overrides,
  }
}

/** One project document with overridable fields. */
export function makeProject(overrides: Partial<VideoProject> = {}): VideoProject {
  return {
    version: 1,
    id: 'demo-1',
    title: '测试视频',
    summary: '一个用于测试的项目',
    mode: 'image',
    style: 'cyber-clean',
    aspect: '16:9',
    width: 1920,
    height: 1080,
    fps: 30,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    frames: [makeFrame()],
    ...overrides,
  }
}
