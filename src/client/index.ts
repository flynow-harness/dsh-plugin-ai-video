/**
 * Browser half: one keyed `tool.call.toolview` entry per video tool, rendering
 * the storyboard card. No host service, Remote or Session projection is
 * involved, so the plugin works with every DSH Web layout that has the tool
 * layer.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only imports load the current client Context and slot declarations.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { en, NS, zh } from './locales.ts'
import { VideoToolRow } from './VideoToolRow.tsx'

export { en, NS, zh } from './locales.ts'
export type { AiVideoKey } from './locales.ts'
export { VideoToolRow, readCardMeta } from './VideoToolRow.tsx'

/** Wire tool names that receive the storyboard card. */
export const VIDEO_TOOL_NAMES = [
  'video_create',
  'video_list',
  'video_show',
  'video_outline',
  'video_edit_frames',
  'video_generate',
  'video_preview',
  'video_render',
] as const

/** Services required by the tool view: the keyed slot and localization. */
export const inject = ['slots', 'locale']

/**
 * Register the dictionaries and one card per video tool.
 * @param ctx - client plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ai-video: dictionaries')
  for (const tool of VIDEO_TOOL_NAMES) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
      { name: 'tool.call.toolview', key: tool, locale: NS },
      VideoToolRow,
    ))
  }
}
