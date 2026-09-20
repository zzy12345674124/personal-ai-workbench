import argparse
import json
import sys

from faster_whisper import WhisperModel


def main() -> None:
    # Windows 默认 stdout 可能是 GBK；Node 端固定按 UTF-8 解码。
    # 在输出源头锁定 UTF-8，避免中文转写变为替换字符。
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", required=True)
    args = parser.parse_args()

    model = WhisperModel(args.model, device="cpu", compute_type="int8", local_files_only=True)
    source, info = model.transcribe(
        args.audio,
        language=None,
        beam_size=5,
        vad_filter=True,
        condition_on_previous_text=True,
    )
    segments = []
    for segment in source:
        text = segment.text.strip()
        if not text:
            continue
        segments.append({
            "text": text,
            "start": round(float(segment.start), 3),
            "end": round(float(segment.end), 3),
            "avgLogProb": round(float(segment.avg_logprob), 4),
        })
    print(json.dumps({
        "transcript": "".join(item["text"] for item in segments),
        "segments": segments,
        "provider": "faster-whisper-base",
        "locale": info.language or "und",
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
