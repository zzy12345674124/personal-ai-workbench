import { readFileSync } from 'node:fs';

export interface WavInfo {
  channels: number;
  sampleRate: number;
  byteRate: number;
  bitsPerSample: number;
  dataSize: number;
  /** 音频时长（秒） */
  durationSeconds: number;
}

/** 解析 WAV 文件头（RIFF/PCM）获取时长，不依赖 ffprobe */
export function readWavInfo(path: string): WavInfo {
  const buf = readFileSync(path);
  if (buf.length < 44) throw new Error(`not a WAV file (too small): ${path}`);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`not a RIFF/WAVE file: ${path}`);
  }

  let offset = 12;
  let channels = 1;
  let sampleRate = 22050;
  let bitsPerSample = 16;
  let byteRate = 44100;
  let dataSize = 0;

  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;
    if (chunkId === 'fmt ') {
      if (chunkSize < 16) throw new Error(`malformed fmt chunk in ${path}`);
      channels = buf.readUInt16LE(bodyStart + 2);
      sampleRate = buf.readUInt32LE(bodyStart + 4);
      byteRate = buf.readUInt32LE(bodyStart + 8);
      bitsPerSample = buf.readUInt16LE(bodyStart + 14);
    } else if (chunkId === 'data') {
      dataSize = chunkSize;
      break;
    }
    offset = bodyStart + chunkSize + (chunkSize % 2);
  }

  if (dataSize === 0) throw new Error(`no data chunk found in ${path}`);
  return {
    channels,
    sampleRate,
    byteRate,
    bitsPerSample,
    dataSize,
    durationSeconds: byteRate > 0 ? dataSize / byteRate : 0,
  };
}
