#!/usr/bin/env node
/**
 * Minimal headless demo: build a short explainer without any chat session.
 *
 *   pnpm build
 *   node examples/make-demo.mjs "什么是 RAG" ./demo-output
 *
 * Uses the same studio the tools use, so it exercises the real pipeline:
 * built-in title cards (headless Chrome), narration (gateway or OS voice),
 * subtitles, the preview player and the MP4.
 */
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveSettings } from '../lib/index.js'

const title = process.argv[2] ?? '什么是 RAG'
const outputRoot = resolve(process.argv[3] ?? './demo-output')

const { ProjectStore, VideoStudio, buildTimeline, formatClock } = await import(
  pathToFileURL(join(import.meta.dirname, '..', 'lib', 'index.js')).href
)

const settings = resolveSettings({ rootDir: outputRoot })
const studio = new VideoStudio(new ProjectStore(settings.rootDir), settings)

const project = await studio.create({ title, mode: 'image', style: 'cyber-clean', aspect: '16:9' })
console.log(`project: ${project.id}`)

await studio.setOutline(project.id, {
  frames: [
    { title: '问题', narration: '大模型什么都懂，但它真的记得你给它的资料吗？' },
    { title: '检索', narration: 'RAG 先从知识库里找出最相关的几段材料。' },
    { title: '增强', narration: '再把材料和问题一起交给模型，让它照着材料回答。' },
    { title: '价值', narration: '答案因此有出处，也能跟上最新的知识。' },
  ],
})

const generated = await studio.generate(project.id, { targets: 'all' })
console.log(`assets: ${generated.report.assets.length}, failed: ${generated.report.failed.length}`)
for (const failure of generated.report.failed) console.log(`  failed ${failure.frameId}/${failure.kind}: ${failure.error}`)

const { report, project: rendered } = await studio.render(project.id, {})
console.log(`duration: ${formatClock(buildTimeline(rendered, settings.frameTailSec).duration)}`)
console.log(`mp4:     ${report.mp4Path}`)
console.log(`preview: ${report.previewPath}`)
console.log(`srt:     ${report.srtPath}`)
console.log(`burned:  ${report.burnIn}`)
