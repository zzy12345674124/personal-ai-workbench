export interface SubtitleLine {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface SubtitleOptions {
  /** 句与句之间的停顿（秒） */
  gapSeconds?: number;
  /** 首句起始偏移（秒） */
  leadSeconds?: number;
}

/**
 * 字幕时间轴：按每句音频时长顺延排布，句间加固定停顿。
 * 输出每句的 start/end（用于 Remotion 字幕与 SRT 导出）。
 */
export function buildSubtitleTimeline(
  sentences: string[],
  durationsSeconds: number[],
  options: SubtitleOptions = {},
): SubtitleLine[] {
  const gap = options.gapSeconds ?? 0.25;
  const lead = options.leadSeconds ?? 0.5;
  const count = Math.min(sentences.length, durationsSeconds.length);
  const lines: SubtitleLine[] = [];
  let cursor = lead;
  for (let i = 0; i < count; i++) {
    const duration = durationsSeconds[i] ?? 0;
    lines.push({
      index: i + 1,
      startSeconds: cursor,
      endSeconds: cursor + duration,
      text: sentences[i] ?? '',
    });
    cursor += duration + gap;
  }
  return lines;
}

/** 生成 SRT 文本（供通用播放器/剪辑软件使用） */
export function toSrt(lines: SubtitleLine[]): string {
  const fmt = (seconds: number): string => {
    const ms = Math.round(seconds * 1000);
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    const mm = ms % 1000;
    const pad = (n: number, w: number): string => String(n).padStart(w, '0');
    return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(mm, 3)}`;
  };
  return lines
    .map((l) => `${l.index}\n${fmt(l.startSeconds)} --> ${fmt(l.endSeconds)}\n${l.text}`)
    .join('\n\n');
}
