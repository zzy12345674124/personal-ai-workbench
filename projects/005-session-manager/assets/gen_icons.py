"""生成 3 款 Fluent 风格应用图标备选（PNG 预览 + 多尺寸 .ico）。

运行：python gen_icons.py（输出到本目录）
依赖：pip install pillow
"""
import io
import struct
import sys

if sys.stdout is not None and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from pathlib import Path

from PIL import Image, ImageDraw

S = 256
OUT = Path(__file__).parent


def v_gradient(size: int, top: tuple, bottom: tuple) -> Image.Image:
    img = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        color = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        d.line([(0, y), (size, y)], fill=color)
    return img


def rounded(img: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.width - 1, img.height - 1], radius=radius, fill=255)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def speech_bubble(draw: ImageDraw.ImageDraw, box: tuple, fill) -> None:
    x0, y0, x1, y1 = box
    w = x1 - x0
    draw.rounded_rectangle(box, radius=w // 3, fill=fill)
    tail_w = int(w * 0.24)
    draw.polygon(
        [(x0 + int(w * 0.22), y1), (x0 + int(w * 0.22), y1 + int(w * 0.20)), (x0 + int(w * 0.46), y1)],
        fill=fill,
    )


def three_dots(draw: ImageDraw.ImageDraw, cx: int, cy: int, r: int, color, gap: int) -> None:
    for dx in (-gap, 0, gap):
        draw.ellipse([cx + dx - r, cy - r, cx + dx + r, cy + r], fill=color)


def chat_history_small(size: int) -> Image.Image:
    """绘制像素对齐的小尺寸“会话历史”图标，避免细线缩放后发灰。"""
    if size not in (16, 20, 24, 32):
        raise ValueError(f"不支持的小尺寸：{size}")

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    scale = size / 16
    px = lambda value: round(value * scale)

    # 小尺寸使用纯色、无阴影底板，让轮廓在资源管理器列表中保持清楚。
    margin = 1 if size <= 20 else 2
    radius = px(3)
    draw.rounded_rectangle(
        [margin, margin, size - 1 - margin, size - 1 - margin],
        radius=radius,
        fill=(0, 120, 212, 255),
    )

    stroke = 2 if size <= 24 else 3
    clock_box = [px(4), px(4), px(12), px(12)]
    white = (255, 255, 255, 255)

    # 圆环在左上角留出缺口，并用实心箭头强化“历史”含义。
    draw.arc(clock_box, start=225, end=360, fill=white, width=stroke)
    draw.arc(clock_box, start=0, end=190, fill=white, width=stroke)
    draw.polygon(
        [(px(4), px(4)), (px(4), px(8)), (px(7), px(5))],
        fill=white,
    )

    center = px(8)
    hand_width = 1 if size == 16 else 2
    draw.line([(center, px(6)), (center, center), (px(10), center)], fill=white, width=hand_width)
    return img


def write_png_ico(path: Path, frames: dict[int, Image.Image]) -> None:
    """把每个手工优化的 PNG 帧写进 ICO，避免统一缩放覆盖小尺寸细节。"""
    encoded: list[tuple[int, bytes]] = []
    for size, frame in sorted(frames.items()):
        buffer = io.BytesIO()
        frame.save(buffer, format="PNG")
        encoded.append((size, buffer.getvalue()))

    directory_size = 6 + 16 * len(encoded)
    offset = directory_size
    entries = []
    payloads = []
    for size, payload in encoded:
        dimension = 0 if size >= 256 else size
        entries.append(
            struct.pack(
                "<BBBBHHII",
                dimension,
                dimension,
                0,
                0,
                1,
                32,
                len(payload),
                offset,
            )
        )
        payloads.append(payload)
        offset += len(payload)

    path.write_bytes(
        struct.pack("<HHH", 0, 1, len(encoded))
        + b"".join(entries)
        + b"".join(payloads)
    )


def make_chat_history(name: str) -> None:
    """用认可的大尺寸母版和专门绘制的小尺寸帧生成正式图标。"""
    png_path = OUT / f"{name}.png"
    master = Image.open(png_path).convert("RGBA")
    frames: dict[int, Image.Image] = {}
    for size in (16, 20, 24, 32):
        frames[size] = chat_history_small(size)
    for size in (48, 64, 128, 256):
        frames[size] = master.resize((size, size), Image.Resampling.LANCZOS)
    write_png_ico(OUT / f"{name}.ico", frames)
    print(f"✓ {name}: PNG 母版 + 像素优化 ICO（16/20/24/32/48/64/128/256）")


def make(base: tuple, bubble_fill, dot_color, name: str) -> None:
    bg = rounded(v_gradient(S, base, tuple(max(0, c - 55) for c in base)), radius=int(S * 0.22))
    d = ImageDraw.Draw(bg)
    # 白色会话气泡 + 三点
    bubble_box = (int(S * 0.30), int(S * 0.32), int(S * 0.72), int(S * 0.60))
    speech_bubble(d, bubble_box, bubble_fill)
    cx = (bubble_box[0] + bubble_box[2]) // 2
    cy = (bubble_box[1] + bubble_box[3]) // 2
    three_dots(d, cx, cy, int(S * 0.018), dot_color, int(S * 0.045))
    bg.save(OUT / f"{name}.png")
    bg.save(OUT / f"{name}.ico", sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
    print(f"✓ {name}: png + ico（16/32/48/256）")


if __name__ == "__main__":
    # A：Windows 经典蓝 + 白色气泡
    make((10, 124, 255), "#ffffff", (10, 124, 255), "icon_A_经典蓝")
    # B：Windows 11 蓝色“会话历史”，小尺寸使用像素对齐专用帧。
    make_chat_history("icon_B_深色蓝")
    # C：青绿色 + 白色气泡
    make((0, 180, 168), "#ffffff", (0, 150, 140), "icon_C_青绿")
