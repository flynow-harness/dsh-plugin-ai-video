/**
 * Storyboard editing without an LLM call: insert, update, remove and reorder
 * frames. Editing a frame's narration or visual invalidates the stale media
 * produced for it, so the next generation pass knows what to rebuild.
 */
import type { VideoFrame } from './types.ts'

/** Update every field of an existing frame. */
export interface UpdateFrameOperation {
  op: 'update'
  frameId: string
  title?: string
  narration?: string
  visual?: string
  html?: string
  durationSec?: number
}

/** Insert a new frame at `index` (1-based) or after `afterFrameId`. */
export interface InsertFrameOperation {
  op: 'insert'
  index?: number
  afterFrameId?: string
  title?: string
  narration: string
  visual?: string
  html?: string
  durationSec?: number
}

/** Remove one frame. */
export interface RemoveFrameOperation {
  op: 'remove'
  frameId: string
}

/** Move an existing frame to a 1-based position. */
export interface MoveFrameOperation {
  op: 'move'
  frameId: string
  index: number
}

/** One model-authored storyboard edit. */
export type FrameOperation = UpdateFrameOperation | InsertFrameOperation | RemoveFrameOperation | MoveFrameOperation

/** Highest numeric suffix among frame ids, so inserted ids never collide. */
function nextFrameNumber(frames: readonly VideoFrame[]): number {
  let max = 0
  for (const frame of frames) {
    const match = /^f(\d+)$/.exec(frame.id)
    if (match?.[1] !== undefined) max = Math.max(max, Number(match[1]))
  }
  return max + 1
}

/** Build the frame document for an insert operation. */
function createFrame(operation: InsertFrameOperation, id: string): VideoFrame {
  const narration = operation.narration.trim()
  if (narration.length === 0) throw new Error('inserted frame needs a non-empty narration')
  const frame: VideoFrame = {
    id,
    title: operation.title?.trim() ?? '',
    narration,
    visual: operation.visual?.trim() ?? '',
    html: operation.html ?? '',
  }
  if (operation.durationSec !== undefined) frame.durationSec = operation.durationSec
  return frame
}

/** Normalize a 1-based index into a valid array position. */
function clampIndex(index: number, length: number): number {
  if (!Number.isInteger(index)) throw new Error('index must be an integer')
  return Math.min(length, Math.max(0, index - 1))
}

/**
 * Apply storyboard operations in order.
 * @param frames - current frames; never mutated.
 * @param operations - edits to apply.
 * @returns a new ordered frame array.
 */
export function applyFrameOperations(frames: readonly VideoFrame[], operations: readonly FrameOperation[]): VideoFrame[] {
  if (operations.length === 0) throw new Error('operations must contain at least one edit')
  let current = frames.map(frame => ({ ...frame }))
  for (const operation of operations) {
    switch (operation.op) {
      case 'update': {
        const target = current.find(frame => frame.id === operation.frameId)
        if (target === undefined) throw new Error(`frame not found: ${operation.frameId}`)
        const narrationChanged = operation.narration !== undefined && operation.narration.trim() !== target.narration
        const visualChanged = (operation.visual !== undefined && operation.visual !== target.visual)
          || (operation.html !== undefined && operation.html !== target.html)
        if (operation.title !== undefined) target.title = operation.title.trim()
        if (operation.narration !== undefined) {
          const narration = operation.narration.trim()
          if (narration.length === 0) throw new Error(`frame ${target.id} narration must not be empty`)
          target.narration = narration
        }
        if (operation.visual !== undefined) target.visual = operation.visual.trim()
        if (operation.html !== undefined) target.html = operation.html
        if (operation.durationSec !== undefined) {
          if (!(operation.durationSec > 0)) throw new Error('durationSec must be positive')
          target.durationSec = operation.durationSec
        }
        if (narrationChanged) {
          delete target.audioPath
          delete target.audioDurationMs
          delete target.captionDir
        }
        if (visualChanged) {
          delete target.imagePath
          delete target.imageSource
        }
        break
      }
      case 'insert': {
        const frame = createFrame(operation, `f${nextFrameNumber(current)}`)
        const position = operation.index !== undefined
          ? clampIndex(operation.index, current.length)
          : operation.afterFrameId !== undefined
            ? current.findIndex(item => item.id === operation.afterFrameId) + 1
            : current.length
        current.splice(position < 0 ? current.length : position, 0, frame)
        break
      }
      case 'remove': {
        const position = current.findIndex(frame => frame.id === operation.frameId)
        if (position < 0) throw new Error(`frame not found: ${operation.frameId}`)
        if (current.length === 1) throw new Error('a project needs at least one frame; remove the project instead')
        current.splice(position, 1)
        break
      }
      case 'move': {
        const position = current.findIndex(frame => frame.id === operation.frameId)
        if (position < 0) throw new Error(`frame not found: ${operation.frameId}`)
        const [moving] = current.splice(position, 1)
        if (moving === undefined) throw new Error(`frame not found: ${operation.frameId}`)
        current.splice(clampIndex(operation.index, current.length), 0, moving)
        break
      }
      default: {
        const never: never = operation
        throw new Error(`unknown operation: ${JSON.stringify(never)}`)
      }
    }
  }
  if (current.length === 0) throw new Error('a project needs at least one frame')
  return current
}
