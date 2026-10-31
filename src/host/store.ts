/**
 * Project persistence: one directory per project under the configured root,
 * a single `project.json`, generated media in `assets/`, and deliverables in
 * `out/`. Plain files keep the studio inspectable with any editor and let the
 * agent hand a directory to the user unchanged.
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { ASPECT_SIZES, type ProjectSummary, type VideoAspect, type VideoMode, type VideoProject } from './types.ts'
import { buildTimeline } from './render/timeline.ts'

/** Project ids are directory names, so keep them to a safe alphabet. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

/** Reject an id that could escape the projects root. */
export function assertProjectId(id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error(`invalid project id: ${JSON.stringify(id)}`)
  return id
}

/** Deterministic, readable slug; non-ASCII titles fall back to `video`. */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return slug.length > 0 ? slug : 'video'
}

/** Timestamp + random suffix keeps ids unique without a database. */
function newId(title: string): string {
  const stamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 6)
  return `${slugify(title)}-${stamp}${random}`
}

/** Input accepted when creating a project. */
export interface CreateProjectInput {
  title: string
  summary?: string
  mode?: VideoMode
  style?: string
  aspect?: VideoAspect
}

/**
 * File-backed store for every project under one root directory.
 */
export class ProjectStore {
  readonly rootDir: string

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir)
  }

  /** Create the root directory once, before any project is written. */
  async init(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true })
  }

  /** Directory of one project. */
  projectDir(id: string): string {
    return join(this.rootDir, assertProjectId(id))
  }

  /** Generated images, audio and caption overlays. */
  assetsDir(id: string): string {
    return join(this.projectDir(id), 'assets')
  }

  /** Rendered deliverables. */
  outDir(id: string): string {
    return join(this.projectDir(id), 'out')
  }

  /** Create the directories a project needs. */
  async ensureDirs(id: string): Promise<void> {
    await mkdir(this.assetsDir(id), { recursive: true })
    await mkdir(this.outDir(id), { recursive: true })
  }

  /** Build a fresh project document; does not touch disk. */
  createDocument(input: CreateProjectInput): VideoProject {
    const title = input.title.trim()
    if (title.length === 0) throw new Error('title must be a non-empty string')
    const aspect: VideoAspect = input.aspect ?? '16:9'
    const size = ASPECT_SIZES[aspect]
    const now = new Date().toISOString()
    return {
      version: 1,
      id: newId(title),
      title,
      summary: input.summary?.trim() ?? '',
      mode: input.mode ?? 'image',
      style: input.style ?? 'cyber-clean',
      aspect,
      width: size.width,
      height: size.height,
      fps: 30,
      createdAt: now,
      updatedAt: now,
      frames: [],
    }
  }

  /** Create a project on disk and return it. */
  async create(input: CreateProjectInput): Promise<VideoProject> {
    const project = this.createDocument(input)
    await this.ensureDirs(project.id)
    await this.save(project)
    return project
  }

  /** Load one project document. */
  async load(id: string): Promise<VideoProject> {
    const path = join(this.projectDir(id), 'project.json')
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch {
      throw new Error(`project not found: ${id}`)
    }
    return parseProject(raw, id)
  }

  /** Persist a project document atomically, refreshing `updatedAt`. */
  async save(project: VideoProject): Promise<VideoProject> {
    assertProjectId(project.id)
    const updated: VideoProject = { ...project, updatedAt: new Date().toISOString() }
    const dir = this.projectDir(updated.id)
    await mkdir(dir, { recursive: true })
    const path = join(dir, 'project.json')
    const temp = join(dir, `.project-${process.pid}.json`)
    await writeFile(temp, `${JSON.stringify(updated, null, 2)}\n`, 'utf8')
    await rename(temp, path)
    return updated
  }

  /** Delete one project directory. */
  async remove(id: string): Promise<void> {
    await rm(this.projectDir(id), { recursive: true, force: true })
  }

  /** List projects newest-first, skipping unreadable directories. */
  async list(): Promise<ProjectSummary[]> {
    let entries: string[]
    try {
      entries = await readdir(this.rootDir)
    } catch {
      return []
    }
    const summaries: ProjectSummary[] = []
    for (const entry of entries) {
      if (entry.startsWith('.') || !ID_PATTERN.test(entry)) continue
      try {
        const project = await this.load(entry)
        summaries.push(summarize(project))
      } catch {
        // A half-written or foreign directory is not a project; ignore it.
      }
    }
    return summaries.sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1))
  }

  /** Relative media path the preview player can resolve beside `project.json`. */
  relativeAsset(id: string, ...parts: string[]): string {
    return ['assets', ...parts].join('/')
  }
}

/** Parse and sanity-check a stored document. */
function parseProject(raw: string, id: string): VideoProject {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`project file is not valid JSON: ${id}`)
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`project file is malformed: ${id}`)
  const record = parsed as Partial<VideoProject>
  if (record.id !== id) throw new Error(`project id mismatch: expected ${id}`)
  if (!Array.isArray(record.frames)) throw new Error(`project has no frames array: ${id}`)
  return record as VideoProject
}

/** Compact description of a project for list output. */
export function summarize(project: VideoProject): ProjectSummary {
  const timeline = buildTimeline(project, 0)
  return {
    id: project.id,
    title: project.title,
    mode: project.mode,
    style: project.style,
    aspect: project.aspect,
    frames: project.frames.length,
    images: project.frames.filter(frame => frame.imagePath !== undefined).length,
    audio: project.frames.filter(frame => frame.audioPath !== undefined).length,
    durationSec: Math.round(timeline.duration * 10) / 10,
    updatedAt: project.updatedAt,
    rendered: project.output !== undefined,
  }
}

/** Parent directory helper used by tests and diagnostics. */
export function parentOf(path: string): string {
  return dirname(path)
}
