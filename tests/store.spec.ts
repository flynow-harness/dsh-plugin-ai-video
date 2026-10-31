import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore, assertProjectId } from '../src/host/store.ts'
import { cleanup, makeTempSettings } from './support/fixtures.ts'
import type { VideoSettings } from '../src/host/config.ts'

let settings: VideoSettings
let store: ProjectStore

beforeEach(async () => {
  settings = makeTempSettings()
  store = new ProjectStore(settings.rootDir)
  await store.init()
})

afterEach(async () => {
  await cleanup(settings)
})

describe('ProjectStore', () => {
  it('creates a project directory and document', async () => {
    const project = await store.create({ title: '什么是 RAG', mode: 'image', style: 'cyber-clean', aspect: '16:9' })
    expect(project.id).toMatch(/^video-[a-z0-9]+$|^[a-z0-9-]+$/)
    expect(project.width).toBe(1920)
    const entries = await readdir(settings.rootDir)
    expect(entries).toContain(project.id)
    const loaded = await store.load(project.id)
    expect(loaded.title).toBe('什么是 RAG')
  })

  it('slugifies ASCII titles and falls back for Chinese ones', async () => {
    const english = await store.create({ title: 'My First Video' })
    expect(english.id.startsWith('my-first-video-')).toBe(true)
    const chinese = await store.create({ title: '中文标题' })
    expect(chinese.id.startsWith('video-')).toBe(true)
  })

  it('rejects an empty title', () => {
    expect(() => store.createDocument({ title: '  ' })).toThrow('title must be a non-empty string')
  })

  it('saves atomically and refreshes updatedAt', async () => {
    const project = await store.create({ title: 'update me' })
    await new Promise(resolve => setTimeout(resolve, 5))
    const saved = await store.save({ ...project, summary: 'changed' })
    expect(saved.summary).toBe('changed')
    expect(saved.updatedAt >= project.updatedAt).toBe(true)
    expect(await store.load(project.id)).toMatchObject({ summary: 'changed' })
  })

  it('lists projects newest first and ignores junk directories', async () => {
    const first = await store.create({ title: 'first' })
    await new Promise(resolve => setTimeout(resolve, 5))
    const second = await store.create({ title: 'second' })
    await mkdir(join(settings.rootDir, 'not-a-project'), { recursive: true })
    await writeFile(join(settings.rootDir, 'stray.txt'), 'x')
    const list = await store.list()
    expect(list.map(item => item.id)).toEqual([second.id, first.id])
  })

  it('removes a project', async () => {
    const project = await store.create({ title: 'remove me' })
    await store.remove(project.id)
    await expect(store.load(project.id)).rejects.toThrow('project not found')
  })

  it('reports progress in the summary', async () => {
    const project = await store.create({ title: 'progress' })
    await store.save({
      ...project,
      frames: [
        { id: 'f1', title: '', narration: '第一镜', visual: '', html: '', imagePath: '/tmp/a.png', audioPath: '/tmp/a.mp3' },
        { id: 'f2', title: '', narration: '第二镜', visual: '', html: '' },
      ],
    })
    const [summary] = await store.list()
    expect(summary).toMatchObject({ frames: 2, images: 1, audio: 1, rendered: false })
  })
})

describe('assertProjectId', () => {
  it('accepts ids produced by the store', () => {
    expect(assertProjectId('video-abc123')).toBe('video-abc123')
  })

  it('rejects traversal and foreign ids', () => {
    expect(() => assertProjectId('../escape')).toThrow('invalid project id')
    expect(() => assertProjectId('UPPER')).toThrow('invalid project id')
    expect(() => assertProjectId('')).toThrow('invalid project id')
  })
})
