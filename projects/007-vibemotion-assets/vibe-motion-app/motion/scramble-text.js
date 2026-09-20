// ScrambleText 核心算法（纯函数，无 React 依赖）。
// 确定性伪随机（mulberry32）：以帧号为种子，保证同一帧输出稳定，
// 符合 Remotion 并行/乱序渲染"每帧独立可计算"的要求（模板 AGENTS.md 规则一）。
export const seededRandom = (seed) => {
  let t = (seed + 0x6d2b79f5) | 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

export const CHARSETS = {
  upperAndLowerCase: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  upperCase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lowerCase: "abcdefghijklmnopqrstuvwxyz",
  numbers: "0123456789",
  XO: "XO",
  alphaNumeric: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  cjk: "的一是不了人我在有他这为之大来以个中上们到说国和地也子时道出而要于就下得可你年生自会那后能对着事其里所去行过家十用发天如然作方成者多日都三小军二无同么经法当起与好看学进种将还分此心前面又定见只主没公从",
};

const KEEP_CHARS = new Set([" ", ".", ",", "'", "!", "?", ";", ":", "-", "(", ")"]);

export const resolveCharset = (chars) => {
  if (typeof chars !== "string") {
    return CHARSETS.upperAndLowerCase;
  }
  return CHARSETS[chars] ?? chars;
};

// 逐字符构建当前帧应显示的文字：
// 帧达到该字符的揭示帧 -> 真实字符；未达到 -> 乱码字符（确定性随机）。
export const buildScrambledText = ({
  text,
  charset,
  frame,
  revealDelayFrames,
  revealSpanFrames,
  rand,
}) => {
  const length = text.length;
  if (length === 0) {
    return text;
  }
  const maxIndex = Math.max(1, length - 1);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    const char = text[i];
    if (KEEP_CHARS.has(char)) {
      out += char;
      continue;
    }
    const revealAt = revealDelayFrames + Math.round((i / maxIndex) * revealSpanFrames);
    if (frame >= revealAt) {
      out += char;
    } else {
      out += charset[Math.floor(rand() * charset.length)];
    }
  }
  return out;
};
