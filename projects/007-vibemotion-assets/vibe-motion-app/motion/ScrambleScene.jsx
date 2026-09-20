import React, { useEffect, useMemo } from "react";
import { useVideoConfig } from "remotion";
import "@fontsource-variable/jetbrains-mono";
import {
  buildScrambledText,
  resolveCharset,
  seededRandom,
} from "./scramble-text.js";

export const ScrambleScene = ({
  texts,
  chars,
  revealSeconds,
  revealDelay,
  fontSize,
  textColor,
  frame,
  segmentIndex,
  segmentFrame,
  fps,
  onAutoLayoutReady,
}) => {
  useEffect(() => {
    onAutoLayoutReady?.();
  }, [onAutoLayoutReady]);

  const { width, height } = useVideoConfig();

  const charset = useMemo(() => resolveCharset(chars), [chars]);
  const currentText = texts[Math.min(segmentIndex, texts.length - 1)] ?? "";

  const revealFrames = Math.max(1, Math.round(revealSeconds * fps));
  const revealDelayFrames = Math.round(revealDelay * fps);
  // 段落内"揭示阶段"结束于 revealDelay + revealSpan 帧，之后整句保留显示
  const revealSpanFrames = Math.max(1, revealFrames - revealDelayFrames);

  const displayText = useMemo(() => {
    if (segmentFrame >= revealFrames) {
      return currentText;
    }
    // 用 (段序号, 帧号) 双种子：不同段即使帧号相同也产生不同乱码序列
    const rand = seededRandom(segmentIndex * 104729 + frame * 2654435761);
    return buildScrambledText({
      text: currentText,
      charset,
      frame: segmentFrame,
      revealDelayFrames,
      revealSpanFrames,
      rand,
    });
  }, [charset, currentText, frame, revealDelayFrames, revealFrames, revealSpanFrames, segmentFrame, segmentIndex]);

  const scale = Math.min(width / 1080, height / 1440);

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{
        backgroundColor: "transparent",
      }}
    >
      <div className="absolute inset-0 flex items-center justify-center px-[10%]">
        <div
          style={{
            fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', monospace",
            fontWeight: 600,
            fontSize: Math.round(fontSize * scale) + "px",
            lineHeight: 1.35,
            letterSpacing: "0.02em",
            color: textColor,
            textAlign: "center",
            maxWidth: "100%",
            wordBreak: "break-word",
            textShadow: "0 4px 24px rgba(0, 0, 0, 0.55)",
          }}
        >
          {displayText}
        </div>
      </div>
    </div>
  );
};
