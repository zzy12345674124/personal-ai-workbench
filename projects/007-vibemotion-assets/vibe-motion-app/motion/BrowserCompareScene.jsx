import React, { useEffect } from "react";
import { Img, staticFile } from "remotion";
import "@fontsource-variable/jetbrains-mono";

const FOLDER_SRC = staticFile("img/folder.png");
const CHROME_SRC = staticFile("img/chrome.png");

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
// 出现动画：返回 [scale, opacity]
const appearAnim = (frame, start, dur) => {
  const t = clamp01((frame - start) / dur);
  return { scale: easeOutCubic(t), opacity: t };
};
const popAnim = (frame, start, dur) => {
  const t = clamp01((frame - start) / dur);
  return { scale: easeOutBack(t), opacity: clamp01(t * 1.2) };
};

export const BrowserCompareScene = ({
  folderCount,
  act,
  actFrame,
  actFrames,
  transition,
  act1Title,
  act1Caption,
  act2Title,
  act2Caption,
  chromeGlow,
  onAutoLayoutReady,
}) => {
  useEffect(() => {
    onAutoLayoutReady?.();
  }, [onAutoLayoutReady]);

  // ---- 转场：cut = 硬切；fade = 整幅画面渐出再渐入 ----
  const FADE_FRAMES = 20;
  let sceneOpacity = 1;
  if (transition === "fade") {
    if (act === 1) {
      sceneOpacity =
        1 - easeOutCubic(clamp01((actFrame - (actFrames - FADE_FRAMES)) / FADE_FRAMES));
    } else {
      sceneOpacity = easeOutCubic(clamp01(actFrame / FADE_FRAMES));
    }
  }

  const W = 1080;
  const H = 1440;
  const count = folderCount;
  const gap = W / count;
  const folderX = (i) => (i + 0.5) * gap;
  const isAct1 = act === 1;

  // ---- 幕一：文件夹依次出现，每个上方弹出一个 Chrome ----
  const act1FolderAnim = (i) => appearAnim(actFrame, 8 + i * 26, 8);
  const act1ChromeAnim = (i) => popAnim(actFrame, 8 + i * 26 + 14, 12);

  // ---- 幕二：文件夹汇聚到中央共享 Chrome ----
  const act2FolderAnim = (i) => appearAnim(actFrame, 8 + i * 8, 8);
  const centerChromeAnim = (() => {
    const t = clamp01((actFrame - 12) / 16);
    const pulse = 1 + 0.05 * Math.sin((actFrame - 28) * 0.15);
    return {
      scale: (0.4 + 0.6 * easeOutBack(t)) * pulse,
      opacity: clamp01(t * 1.2),
    };
  })();
  const lineDraw = (i) => easeOutCubic(clamp01((actFrame - 20 - i * 6) / 30));

  const folderSize = 170;
  const folderY1 = 820;
  const chromeSmallSize = 118;
  const chromeY1 = 585;
  const folderY2 = 520;
  const chromeBigSize = 270;
  const chromeCenter = { x: W / 2, y: 1010 };

  const bgColor = isAct1 ? "hsl(222 35% 7%)" : "hsl(150 30% 7%)";
  const accent = isAct1 ? "hsl(215 85% 60%)" : "hsl(150 65% 50%)";
  const title = isAct1 ? act1Title : act2Title;
  const caption = isAct1 ? act1Caption : act2Caption;

  const folderNodes = [];
  const chromeNodes = [];
  const lineNodes = [];

  for (let i = 0; i < count; i += 1) {
    if (isAct1) {
      const fa = act1FolderAnim(i);
      folderNodes.push(
        <Img
          key={`f1-${i}`}
          src={FOLDER_SRC}
          style={{
            position: "absolute",
            left: folderX(i) - folderSize / 2,
            top: folderY1 - folderSize / 2,
            width: folderSize,
            height: folderSize,
            transform: `scale(${fa.scale})`,
            opacity: fa.opacity,
          }}
        />
      );
      const ca = act1ChromeAnim(i);
      chromeNodes.push(
        <Img
          key={`c1-${i}`}
          src={CHROME_SRC}
          style={{
            position: "absolute",
            left: folderX(i) - chromeSmallSize / 2,
            top: chromeY1 - chromeSmallSize / 2,
            width: chromeSmallSize,
            height: chromeSmallSize,
            transform: `scale(${ca.scale})`,
            opacity: ca.opacity,
            filter: chromeGlow
              ? `drop-shadow(0 0 18px hsla(30 90% 60% / 0.55))`
              : undefined,
          }}
        />
      );
    } else {
      const fa = act2FolderAnim(i);
      const draw = lineDraw(i);
      const x = folderX(i);
      lineNodes.push(
        <line
          key={`ln-${i}`}
          x1={x}
          y1={folderY2}
          x2={chromeCenter.x}
          y2={chromeCenter.y}
          stroke={accent}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={`${(draw * 600).toFixed(1)} 600`}
          opacity={0.85 * draw}
        />
      );
      folderNodes.push(
        <Img
          key={`f2-${i}`}
          src={FOLDER_SRC}
          style={{
            position: "absolute",
            left: x - folderSize / 2,
            top: folderY2 - folderSize / 2,
            width: folderSize,
            height: folderSize,
            transform: `scale(${fa.scale})`,
            opacity: fa.opacity,
          }}
        />
      );
    }
  }

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      style={{
        backgroundColor: bgColor,
        fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', monospace",
        opacity: sceneOpacity,
      }}
    >
      {/* 标题 */}
      <div
        style={{
          position: "absolute",
          top: 120,
          left: 0,
          width: W,
          textAlign: "center",
          color: accent,
          fontSize: 88,
          fontWeight: 800,
          letterSpacing: "0.06em",
          textShadow: `0 0 40px ${accent}55`,
        }}
      >
        {title}
      </div>
      <div
        style={{
          position: "absolute",
          top: 250,
          left: 0,
          width: W,
          textAlign: "center",
          color: "hsla(0 0% 90% / 0.75)",
          fontSize: 30,
          letterSpacing: "0.04em",
        }}
      >
        {caption}
      </div>

      {/* 幕二：汇聚连线（SVG 层） */}
      {!isAct1 && (
        <svg
          style={{ position: "absolute", left: 0, top: 0, width: W, height: H }}
        >
          {lineNodes}
        </svg>
      )}

      {/* 幕二：中央共享 Chrome */}
      {!isAct1 && (
        <Img
          src={CHROME_SRC}
          style={{
            position: "absolute",
            left: chromeCenter.x - chromeBigSize / 2,
            top: chromeCenter.y - chromeBigSize / 2,
            width: chromeBigSize,
            height: chromeBigSize,
            transform: `scale(${centerChromeAnim.scale})`,
            opacity: centerChromeAnim.opacity,
            filter: chromeGlow
              ? `drop-shadow(0 0 34px hsla(30 90% 60% / 0.7))`
              : undefined,
          }}
        />
      )}

      {folderNodes}
      {chromeNodes}

      {/* 底部脚注 */}
      <div
        style={{
          position: "absolute",
          bottom: 60,
          left: 0,
          width: W,
          textAlign: "center",
          color: "hsla(0 0% 85% / 0.45)",
          fontSize: 24,
          letterSpacing: "0.05em",
        }}
      >
        {isAct1 ? "每个项目 → 各自的浏览器" : "所有项目 → 同一个浏览器"}
      </div>
    </div>
  );
};
