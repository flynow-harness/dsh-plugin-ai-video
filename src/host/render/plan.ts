/**
 * Pure ffmpeg plan construction: per-frame inputs plus one filtergraph. Keeping
 * this free of I/O lets the command shape be unit-tested and lets the renderer
 * decide which media actually exists.
 */

/** One timeline segment to encode. */
export interface PlanSegment {
  /** Seconds on screen. */
  duration: number
  /** Existing still, or undefined for a solid-color slide. */
  imagePath?: string
  /** Existing narration track. */
  audioPath?: string
}

/** Options for {@link buildRenderPlan}. */
export interface BuildPlanInput {
  width: number
  height: number
  fps: number
  segments: readonly PlanSegment[]
  /** Burn a subtitle file into the picture (requires libass). */
  burnIn: boolean
  /** Absolute `.srt` path when burning. */
  srtPath?: string
  /** Solid background for frames without a still, as an ffmpeg color. */
  background?: string
}

/** Ready-to-run arguments plus the filtergraph file contents. */
export interface RenderPlan {
  /** ffmpeg arguments preceding `-filter_complex_script`. */
  inputs: string[]
  filterGraph: string
}

/** Escape a path for use inside a filtergraph option value. */
export function escapeFilterPath(path: string): string {
  const escaped = path
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
  return `'${escaped}'`
}

/**
 * Build the input list and filtergraph for a timeline.
 * @param input - viewport, segments and burn-in choice.
 * @returns plan handed to ffmpeg.
 */
export function buildRenderPlan(input: BuildPlanInput): RenderPlan {
  const background = input.background ?? '0x000000'
  const inputs: string[] = []
  const chains: string[] = []
  const concatInputs: string[] = []
  input.segments.forEach((segment, position) => {
    const duration = Math.max(0.2, segment.duration).toFixed(3)
    const videoIndex = position * 2
    if (segment.imagePath !== undefined) {
      inputs.push('-loop', '1', '-framerate', String(input.fps), '-t', duration, '-i', segment.imagePath)
    } else {
      inputs.push('-f', 'lavfi', '-t', duration, '-i', `color=c=${background}:s=${input.width}x${input.height}:r=${input.fps}`)
    }
    chains.push(
      `[${videoIndex}:v]scale=${input.width}:${input.height}:force_original_aspect_ratio=decrease:flags=lanczos,`
      + `pad=${input.width}:${input.height}:(ow-iw)/2:(oh-ih)/2:color=${background},setsar=1,fps=${input.fps},format=yuv420p,`
      + `trim=duration=${duration},setpts=PTS-STARTPTS[v${position}]`,
    )
    const audioIndex = videoIndex + 1
    if (segment.audioPath !== undefined) {
      inputs.push('-i', segment.audioPath)
    } else {
      inputs.push('-f', 'lavfi', '-t', duration, '-i', 'anullsrc=r=48000:cl=stereo')
    }
    chains.push(
      `[${audioIndex}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,`
      + `apad=whole_dur=${duration},atrim=duration=${duration},asetpts=PTS-STARTPTS[a${position}]`,
    )
    concatInputs.push(`[v${position}][a${position}]`)
  })
  chains.push(`${concatInputs.join('')}concat=n=${input.segments.length}:v=1:a=1[vc][ac]`)
  if (input.burnIn && input.srtPath !== undefined) {
    chains.push(
      `[vc]subtitles=filename=${escapeFilterPath(input.srtPath)}:force_style='FontName=PingFang SC,FontSize=22,`
      + `PrimaryColour=&H00FFFFFF,OutlineColour=&H66000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=42'[vout]`,
    )
  } else {
    chains.push('[vc]null[vout]')
  }
  return { inputs, filterGraph: `${chains.join(';\n')}\n` }
}
