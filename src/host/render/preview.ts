/**
 * Offline preview player. Writes one self-contained `preview.html` beside the
 * project: no server, no CDN, no build step. It plays the same timeline and
 * cues that the MP4 uses, so a preview is a faithful review surface before
 * spending an encode.
 */
import { relative } from 'node:path'
import { resolveStyle } from '../styles.ts'
import type { Cue } from '../subtitles.ts'
import type { Timeline } from './timeline.ts'
import { formatClock } from './timeline.ts'
import type { VideoProject } from '../types.ts'

/** One frame as the player sees it. */
interface PreviewFrame {
  index: number
  title: string
  narration: string
  start: number
  end: number
  image?: string
  audio?: string
  html?: string
}

/** Serialized player payload. */
interface PreviewData {
  title: string
  summary: string
  duration: number
  width: number
  height: number
  style: {
    id: string
    background: string
    surface: string
    text: string
    muted: string
    accent: string
    accentAlt: string
    display: string
    body: string
    mono: string
  }
  frames: PreviewFrame[]
  cues: Array<{ start: number; end: number; text: string }>
}

/** POSIX path relative to the project directory, for `<img src>` and `<audio src>`. */
function assetUrl(projectDir: string, absolute: string): string {
  const path = relative(projectDir, absolute).split('\\').join('/')
  return encodeURI(path)
}

/**
 * Build the player document.
 * @param project - project to preview.
 * @param timeline - placed frames.
 * @param cues - project caption track.
 * @param projectDir - directory the document is written to.
 * @returns complete HTML.
 */
export function renderPreviewDocument(project: VideoProject, timeline: Timeline, cues: readonly Cue[], projectDir: string): string {
  const preset = resolveStyle(project.style)
  const frames: PreviewFrame[] = timeline.frames.map(placed => {
    const frame: PreviewFrame = {
      index: placed.index,
      title: placed.frame.title,
      narration: placed.frame.narration,
      start: placed.start,
      end: placed.end,
    }
    if (placed.frame.imagePath !== undefined) frame.image = assetUrl(projectDir, placed.frame.imagePath)
    if (placed.frame.audioPath !== undefined) frame.audio = assetUrl(projectDir, placed.frame.audioPath)
    if (placed.frame.html.trim().length > 0) frame.html = placed.frame.html
    return frame
  })
  const data: PreviewData = {
    title: project.title,
    summary: project.summary,
    duration: timeline.duration,
    width: project.width,
    height: project.height,
    style: {
      id: preset.id,
      background: preset.palette.background,
      surface: preset.palette.surface,
      text: preset.palette.text,
      muted: preset.palette.muted,
      accent: preset.palette.accent,
      accentAlt: preset.palette.accentAlt,
      display: preset.fonts.display,
      body: preset.fonts.body,
      mono: preset.fonts.mono,
    },
    frames,
    cues: cues.map(cue => ({ start: cue.start, end: cue.end, text: cue.text })),
  }
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  const chips = [
    project.mode === 'html' ? 'HTML 动画' : '图片轮播',
    preset.name.zh,
    project.aspect,
    `${frames.length} 镜`,
    formatClock(timeline.duration),
  ].map(label => `<span>${escape(label)}</span>`).join('')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(project.title)} · AI Video</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root { color-scheme: dark; }
  body { min-height: 100vh; background: #07090f; color: #e5e7eb; font-family: ${preset.fonts.body}; display: flex; align-items: center; justify-content: center; padding: 28px; }
  .shell { width: min(1180px, 100%); display: flex; flex-direction: column; gap: 16px; }
  header { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; flex-wrap: wrap; }
  h1 { font-family: ${preset.fonts.display}; font-size: 26px; font-weight: 700; letter-spacing: -0.01em; }
  .summary { margin-top: 6px; color: #8b94a7; font-size: 13px; max-width: 62ch; line-height: 1.6; }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; }
  .chips span { font-family: ${preset.fonts.mono}; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: ${preset.palette.accent}; border: 1px solid ${preset.palette.accent}44; background: ${preset.palette.accent}12; padding: 5px 9px; border-radius: 5px; }
  .stage-wrap { position: relative; width: 100%; aspect-ratio: ${project.width} / ${project.height}; background: #000; border-radius: 14px; overflow: hidden; border: 1px solid #1f2937; box-shadow: 0 24px 70px rgba(0,0,0,0.55); }
  .stage { position: absolute; inset: 0; background: ${preset.palette.background}; }
  .frame { position: absolute; inset: 0; opacity: 0; transition: opacity 220ms ease; }
  .frame.active { opacity: 1; }
  .frame img { width: 100%; height: 100%; object-fit: contain; background: #000; display: block; }
  .frame iframe { width: 100%; height: 100%; border: 0; display: block; background: ${preset.palette.background}; }
  .ghost { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; gap: 18px; padding: 8% 10%; background: radial-gradient(ellipse at 20% 0%, ${preset.palette.accent}22, transparent 55%), ${preset.palette.background}; }
  .ghost .n { font-family: ${preset.fonts.mono}; font-size: 12px; letter-spacing: 0.3em; color: ${preset.palette.accent}; text-transform: uppercase; }
  .ghost .t { font-family: ${preset.fonts.display}; font-size: clamp(28px, 4.2vw, 62px); font-weight: 700; line-height: 1.1; color: ${preset.palette.text}; }
  .ghost .r { width: 64px; height: 3px; background: linear-gradient(90deg, ${preset.palette.accent}, ${preset.palette.accentAlt}); }
  .caption { position: absolute; left: 0; right: 0; bottom: 5.5%; display: flex; justify-content: center; padding: 0 8%; pointer-events: none; }
  .caption span { max-width: 88%; padding: 9px 18px; border-radius: 8px; background: rgba(3, 7, 18, 0.72); color: #fff; font-size: clamp(13px, 1.55vw, 24px); line-height: 1.5; text-align: center; opacity: 0; transition: opacity 120ms; }
  .caption span.visible { opacity: 1; }
  .controls { display: flex; align-items: center; gap: 14px; background: #0d1119; border: 1px solid #1f2937; border-radius: 12px; padding: 12px 16px; }
  button { background: none; border: 1px solid #253044; color: #cbd5e1; border-radius: 8px; cursor: pointer; font-family: ${preset.fonts.mono}; }
  button:hover { border-color: ${preset.palette.accent}; color: ${preset.palette.accent}; }
  #play { width: 40px; height: 34px; font-size: 14px; }
  #fs { width: 40px; height: 34px; font-size: 15px; }
  .time, .count { font-family: ${preset.fonts.mono}; font-size: 12px; color: #8b94a7; letter-spacing: 0.05em; white-space: nowrap; }
  .track { position: relative; flex: 1; height: 26px; cursor: pointer; display: flex; align-items: center; }
  .track .rail { position: absolute; left: 0; right: 0; height: 4px; border-radius: 99px; background: #1f2937; }
  .track .filled { position: absolute; left: 0; height: 4px; border-radius: 99px; background: linear-gradient(90deg, ${preset.palette.accent}, ${preset.palette.accentAlt}); width: 0%; }
  .track .mark { position: absolute; top: -4px; width: 1px; height: 12px; background: #475569; }
  .dots { display: flex; gap: 6px; }
  .dots button { width: 26px; height: 26px; font-size: 11px; border-radius: 6px; }
  .dots button.on { border-color: ${preset.palette.accent}; color: ${preset.palette.accent}; background: ${preset.palette.accent}18; }
  .empty { text-align: center; padding: 80px 20px; color: #8b94a7; }
  @media (max-width: 720px) { .dots { display: none; } h1 { font-size: 20px; } }
</style>
</head>
<body>
<div class="shell">
  <header>
    <div>
      <h1>${escape(project.title)}</h1>
      <div class="summary">${escape(project.summary.length > 0 ? project.summary : '由 DeepSeek Harness AI 视频工坊生成')}</div>
    </div>
    <div class="chips">${chips}</div>
  </header>
  <div class="stage-wrap" id="stageWrap">
    <div class="stage" id="stage"></div>
    <div class="caption"><span id="caption"></span></div>
  </div>
  <div class="controls">
    <button id="play" aria-label="播放/暂停">▶</button>
    <span class="time" id="time">00:00 / ${formatClock(timeline.duration)}</span>
    <div class="track" id="track"><div class="rail"></div><div class="filled" id="filled"></div><div id="marks"></div></div>
    <div class="dots" id="dots"></div>
    <button id="fs" aria-label="全屏">⛶</button>
  </div>
</div>
<script>
const DATA = ${json};
const stage = document.getElementById('stage');
const caption = document.getElementById('caption');
const playButton = document.getElementById('play');
const timeLabel = document.getElementById('time');
const filled = document.getElementById('filled');
const track = document.getElementById('track');
const marks = document.getElementById('marks');
const dots = document.getElementById('dots');
const audio = new Audio();
audio.preload = 'auto';

if (!DATA.frames.length) {
  stage.innerHTML = '<div class="empty">这个项目还没有分镜。</div>';
  playButton.disabled = true;
}

const elements = DATA.frames.map(function (frame, position) {
  const host = document.createElement('div');
  host.className = 'frame';
  if (frame.image) {
    const img = document.createElement('img');
    img.src = frame.image;
    img.alt = frame.title || frame.narration;
    host.appendChild(img);
  } else if (frame.html) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.srcdoc = frame.html;
    host.appendChild(iframe);
  } else {
    host.innerHTML = '<div class="ghost"><div class="n">Frame ' + String(frame.index).padStart(2, '0') + '</div><div class="t"></div><div class="r"></div></div>';
    host.querySelector('.t').textContent = frame.title || frame.narration.slice(0, 24);
  }
  stage.appendChild(host);
  if (position > 0) {
    const mark = document.createElement('div');
    mark.className = 'mark';
    mark.style.left = (DATA.duration > 0 ? (frame.start / DATA.duration) * 100 : 0) + '%';
    marks.appendChild(mark);
  }
  const dot = document.createElement('button');
  dot.textContent = String(frame.index);
  dot.title = frame.title || frame.narration.slice(0, 20);
  dot.addEventListener('click', function () { pause(); seek(frame.start + 0.001); });
  dots.appendChild(dot);
  return host;
});

let index = -1;
let playing = false;
let clock = 0;
let previous = 0;
let request = 0;

function frameAt(time) {
  for (let i = DATA.frames.length - 1; i >= 0; i -= 1) {
    if (time >= DATA.frames[i].start - 1e-6) return i;
  }
  return 0;
}

function show(next) {
  if (next === index) return;
  index = next;
  const frame = DATA.frames[next];
  elements.forEach(function (host, position) { host.classList.toggle('active', position === next); });
  Array.from(dots.children).forEach(function (dot, position) { dot.classList.toggle('on', position === next); });
  if (frame.audio) {
    audio.src = frame.audio;
  } else {
    audio.removeAttribute('src');
    audio.load();
  }
  if (playing && frame.audio) {
    audio.currentTime = Math.max(0, clock - frame.start);
    const started = audio.play();
    if (started && started.catch) started.catch(function () {});
  }
}

function cueAt(time) {
  for (let i = 0; i < DATA.cues.length; i += 1) {
    const cue = DATA.cues[i];
    if (time >= cue.start && time < cue.end) return cue;
  }
  return null;
}

function paint() {
  const frame = DATA.frames[index];
  const cue = cueAt(clock);
  if (cue) {
    caption.textContent = cue.text;
    caption.classList.add('visible');
  } else {
    caption.classList.remove('visible');
  }
  filled.style.width = (DATA.duration > 0 ? Math.min(100, (clock / DATA.duration) * 100) : 0) + '%';
  timeLabel.textContent = format(clock) + ' / ' + format(DATA.duration);
}

function format(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

function seek(time) {
  clock = Math.min(Math.max(0, time), DATA.duration);
  const next = frameAt(clock);
  const frame = DATA.frames[next];
  if (next !== index) {
    show(next);
  }
  if (playing && frame.audio) {
    audio.currentTime = Math.max(0, clock - frame.start);
    const started = audio.play();
    if (started && started.catch) started.catch(function () {});
  }
  paint();
}

function play() {
  if (playing) return;
  if (clock >= DATA.duration - 0.01) clock = 0;
  playing = true;
  playButton.textContent = '❚❚';
  previous = performance.now();
  show(frameAt(clock));
  if (DATA.frames[index] && DATA.frames[index].audio) {
    audio.currentTime = Math.max(0, clock - DATA.frames[index].start);
    const started = audio.play();
    if (started && started.catch) started.catch(function () {});
  }
  request = requestAnimationFrame(tick);
}

function pause() {
  playing = false;
  playButton.textContent = '▶';
  cancelAnimationFrame(request);
  audio.pause();
}

function tick(now) {
  if (!playing) return;
  const delta = (now - previous) / 1000;
  previous = now;
  clock += delta;
  if (clock >= DATA.duration) {
    clock = DATA.duration;
    show(DATA.frames.length - 1);
    paint();
    pause();
    return;
  }
  const next = frameAt(clock);
  if (next !== index) show(next);
  paint();
  request = requestAnimationFrame(tick);
}

playButton.addEventListener('click', function () { playing ? pause() : play(); });
document.addEventListener('keydown', function (event) {
  if (!DATA.frames.length) return;
  if (event.code === 'Space') { event.preventDefault(); playing ? pause() : play(); }
  if (event.code === 'ArrowRight') { event.preventDefault(); seek(DATA.frames[Math.min(DATA.frames.length - 1, index + 1)].start + 0.001); }
  if (event.code === 'ArrowLeft') { event.preventDefault(); seek(DATA.frames[Math.max(0, index - 1)].start + 0.001); }
});
track.addEventListener('pointerdown', function (event) {
  const rect = track.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  seek(ratio * DATA.duration);
});
document.getElementById('fs').addEventListener('click', function () {
  const wrap = document.getElementById('stageWrap');
  if (document.fullscreenElement) document.exitFullscreen();
  else if (wrap.requestFullscreen) wrap.requestFullscreen();
});
show(0);
paint();
</script>
</body>
</html>`
}

/** Escape text for HTML. */
function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
