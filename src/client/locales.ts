/** `aiVideo` namespace dictionaries for the storyboard tool cards. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'aiVideo'

/** Key set shared by both locales. */
export type AiVideoKey =
  | 'row.title'
  | 'row.list'
  | 'row.create'
  | 'row.outline'
  | 'row.edit'
  | 'row.generate'
  | 'row.preview'
  | 'row.render'
  | 'row.show'
  | 'status.preparing'
  | 'status.running'
  | 'status.empty'
  | 'status.outline'
  | 'status.partial'
  | 'status.ready'
  | 'status.error'
  | 'chip.frames'
  | 'chip.images'
  | 'chip.audio'
  | 'chip.duration'
  | 'chip.mode.image'
  | 'chip.mode.html'
  | 'frame.image'
  | 'frame.audio'
  | 'frame.narration'
  | 'frame.chars'
  | 'expand'
  | 'collapse'
  | 'inspect'
  | 'error'
  | 'more'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Storyboard tool card strings. */
    aiVideo: AiVideoKey
  }
}

/** Simplified Chinese dictionary. */
export const zh: Record<AiVideoKey, string> = {
  'row.title': '视频项目',
  'row.list': '视频项目列表',
  'row.create': '创建视频项目',
  'row.outline': '写入分镜',
  'row.edit': '编辑分镜',
  'row.generate': '生成配音与图像',
  'row.preview': '生成预览',
  'row.render': '导出 MP4',
  'row.show': '查看视频项目',
  'status.preparing': '准备中',
  'status.running': '生成中',
  'status.empty': '待写分镜',
  'status.outline': '分镜已就绪',
  'status.partial': '部分媒体已生成',
  'status.ready': '已就绪',
  'status.error': '失败',
  'chip.frames': '{count} 镜',
  'chip.images': '{count} 图',
  'chip.audio': '{count} 音',
  'chip.duration': '{duration}',
  'chip.mode.image': '图片模式',
  'chip.mode.html': 'HTML 模式',
  'frame.image': '图',
  'frame.audio': '音',
  'frame.narration': '旁白',
  'frame.chars': '{count} 字',
  'expand': '展开分镜',
  'collapse': '收起分镜',
  'inspect': '在轨迹中查看',
  'error': '失败原因',
  'more': '还有 {count} 镜',
}

/** English dictionary. */
export const en: Record<AiVideoKey, string> = {
  'row.title': 'Video project',
  'row.list': 'Video projects',
  'row.create': 'Create video project',
  'row.outline': 'Write storyboard',
  'row.edit': 'Edit storyboard',
  'row.generate': 'Generate narration and stills',
  'row.preview': 'Build preview',
  'row.render': 'Export MP4',
  'row.show': 'Inspect video project',
  'status.preparing': 'Preparing',
  'status.running': 'Rendering',
  'status.empty': 'No frames yet',
  'status.outline': 'Outline ready',
  'status.partial': 'Some media ready',
  'status.ready': 'Ready',
  'status.error': 'Failed',
  'chip.frames': '{count} frames',
  'chip.images': '{count} images',
  'chip.audio': '{count} tracks',
  'chip.duration': '{duration}',
  'chip.mode.image': 'Image mode',
  'chip.mode.html': 'HTML mode',
  'frame.image': 'IMG',
  'frame.audio': 'AUD',
  'frame.narration': 'Narration',
  'frame.chars': '{count} chars',
  'expand': 'Expand storyboard',
  'collapse': 'Collapse storyboard',
  'inspect': 'Inspect in trajectory',
  'error': 'Failure',
  'more': '{count} more frames',
}
