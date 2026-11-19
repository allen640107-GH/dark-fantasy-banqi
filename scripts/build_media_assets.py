import os
import math
import subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

PORTRAIT_DIR = r"D:\Antigravity_Projects\DarkChess\assets\portraits"
VIDEO_DIR = r"D:\Antigravity_Projects\DarkChess\assets\video"
AUDIO_DIR = r"D:\Antigravity_Projects\DarkChess\assets\audio"

RED_SRC = r"C:\Users\User\.gemini\antigravity\brain\aeb0462c-cd12-493a-a96a-750ac658f632\red_sheet_1795071955147.jpg"
BLACK_SRC = r"C:\Users\User\.gemini\antigravity\brain\aeb0462c-cd12-493a-a96a-750ac658f632\black_sheet_1795071956726.jpg"

RED_NAMES = [
    "r_general", "r_advisor", "r_elephant", "r_chariot",
    "r_horse", "r_cannon", "r_soldier", "r_emblem"
]
BLACK_NAMES = [
    "b_general", "b_advisor", "b_elephant", "b_chariot",
    "b_horse", "b_cannon", "b_soldier", "b_emblem"
]

def crop_sheet(src_path, names):
    img = Image.open(src_path).convert("RGB")
    w, h = img.size
    cw, ch = w / 4.0, h / 2.0
    pad_x = int(cw * 0.025)
    pad_y = int(ch * 0.025)
    for idx, name in enumerate(names):
        col = idx % 4
        row = idx // 4
        x0 = int(col * cw) + pad_x
        y0 = int(row * ch) + pad_y
        x1 = int((col + 1) * cw) - pad_x
        y1 = int((row + 1) * ch) - pad_y
        cell = img.crop((x0, y0, x1, y1))
        # Center-crop to square
        sw, sh = cell.size
        side = min(sw, sh)
        left = (sw - side) // 2
        top = (sh - side) // 2
        sq = cell.crop((left, top, left + side, top + side)).resize((512, 512), Image.Resampling.LANCZOS)
        sq.save(os.path.join(PORTRAIT_DIR, f"{name}.png"), quality=95)
    print(f"Cropped {len(names)} portraits from {os.path.basename(src_path)}")

def find_chinese_font(size):
    candidates = [
        r"C:\Windows\Fonts\kaiu.ttf",       # DFKai-SB (標楷體) - epic traditional feel
        r"C:\Windows\Fonts\msjhbd.ttc",     # Microsoft JhengHei Bold
        r"C:\Windows\Fonts\mingliub.ttc",
        r"C:\Windows\Fonts\msjh.ttc",
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    return ImageFont.load_default()

def build_intro_video():
    # Generate a cinematic 9.5-second 1280x720 30fps dark fantasy intro video
    W, H, FPS = 1280, 720, 30
    DUR = 9.5
    TOTAL_FRAMES = int(DUR * FPS)

    r_gen = Image.open(os.path.join(PORTRAIT_DIR, "r_general.png")).convert("RGBA")
    b_gen = Image.open(os.path.join(PORTRAIT_DIR, "b_general.png")).convert("RGBA")
    r_emb = Image.open(os.path.join(PORTRAIT_DIR, "r_emblem.png")).convert("RGBA")
    b_emb = Image.open(os.path.join(PORTRAIT_DIR, "b_emblem.png")).convert("RGBA")
    r_adv = Image.open(os.path.join(PORTRAIT_DIR, "r_advisor.png")).convert("RGBA")
    b_adv = Image.open(os.path.join(PORTRAIT_DIR, "b_advisor.png")).convert("RGBA")

    title_font = find_chinese_font(92)
    sub_font = find_chinese_font(34)
    small_font = find_chinese_font(26)

    # Pre-generate deterministic floating ember & wisp particles
    rng = np.random.default_rng(2026)
    num_p = 75
    px = rng.uniform(0, W, num_p)
    py = rng.uniform(0, H, num_p)
    pvx = rng.uniform(-18, 18, num_p)
    pvy = rng.uniform(-70, -25, num_p)
    psize = rng.uniform(2.0, 5.5, num_p)
    pcol = [(255, 140, 40) if x < W * 0.5 else (90, 210, 255) for x in px]

    raw_video = os.path.join(VIDEO_DIR, "intro_silent.mp4")
    final_video = os.path.join(VIDEO_DIR, "intro.mp4")

    proc = subprocess.Popen([
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "rawvideo", "-vcodec", "rawvideo",
        "-s", f"{W}x{H}", "-pix_fmt", "rgb24", "-r", str(FPS),
        "-i", "-",
        "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p",
        raw_video
    ], stdin=subprocess.PIPE)

    # Create radial vignette mask once
    yy, xx = np.mgrid[0:H, 0:W]
    nx = (xx - W / 2) / (W / 2)
    ny = (yy - H / 2) / (H / 2)
    vignette = np.clip(1.0 - 0.55 * (nx * nx + ny * ny), 0.18, 1.0)

    for f in range(TOTAL_FRAMES):
        t = f / FPS
        canvas = Image.new("RGBA", (W, H), (8, 7, 12, 255))

        # Scene 1 (0.0 - 3.2s): Emblems awaken from darkness
        if t < 3.4:
            alpha = min(1.0, t / 1.0) * (1.0 if t < 2.6 else max(0.0, (3.4 - t) / 0.8))
            scale = 1.0 + 0.08 * (t / 3.4)
            sz = int(340 * scale)
            re = r_emb.resize((sz, sz), Image.Resampling.BILINEAR)
            be = b_emb.resize((sz, sz), Image.Resampling.BILINEAR)
            # Soft blend
            re.putalpha(int(235 * alpha))
            be.putalpha(int(235 * alpha))
            canvas.alpha_composite(re, (int(W * 0.27 - sz / 2), int(H * 0.5 - sz / 2)))
            canvas.alpha_composite(be, (int(W * 0.73 - sz / 2), int(H * 0.5 - sz / 2)))

            draw = ImageDraw.Draw(canvas)
            if alpha > 0.1:
                c_gold = (245, 200, 120, int(240 * alpha))
                c_cyan = (140, 225, 255, int(240 * alpha))
                draw.text((W * 0.27, H * 0.83), "烈焰聖殿", font=sub_font, fill=c_gold, anchor="mm")
                draw.text((W * 0.73, H * 0.83), "冥淵暗影", font=sub_font, fill=c_cyan, anchor="mm")

        # Scene 2 (2.8 - 6.4s): Heroes face-off split screen with Ken Burns zoom
        if 2.8 <= t < 6.5:
            lt = t - 2.8
            alpha = min(1.0, lt / 0.7) * (1.0 if lt < 2.9 else max(0.0, (3.7 - lt) / 0.8))
            zoom = 1.04 + 0.12 * (lt / 3.7)
            pw = int(580 * zoom)
            ph = int(580 * zoom)
            rg = r_gen.resize((pw, ph), Image.Resampling.BILINEAR)
            bg = b_gen.resize((pw, ph), Image.Resampling.BILINEAR)
            # Crop left & right halves cleanly
            rg_crop = rg.crop((int((pw - 640) / 2), int((ph - 640) / 2), int((pw + 640) / 2), int((ph + 640) / 2)))
            bg_crop = bg.crop((int((pw - 640) / 2), int((ph - 640) / 2), int((pw + 640) / 2), int((ph + 640) / 2)))
            rg_crop.putalpha(int(240 * alpha))
            bg_crop.putalpha(int(240 * alpha))
            canvas.alpha_composite(rg_crop, (0, 40))
            canvas.alpha_composite(bg_crop, (640, 40))

            # Glowing center lightning/flame clash divider
            draw = ImageDraw.Draw(canvas)
            glow_a = int(220 * alpha)
            for dx in range(-18, 19, 3):
                a = max(0, int(glow_a * (1.0 - abs(dx) / 20.0)))
                col = (255, 190, 90, a) if dx < 0 else (110, 220, 255, a)
                draw.line([(640 + dx, 0), (640 + dx, H)], fill=col, width=3)
            draw.line([(640, 0), (640, H)], fill=(255, 250, 235, glow_a), width=4)

        # Scene 3 (5.8 - 9.5s): Epic Title Reveal over dark atmospheric clash
        if t >= 5.8:
            lt = t - 5.8
            alpha = min(1.0, lt / 0.8) * (1.0 if t < 8.6 else max(0.0, (9.5 - t) / 0.9))
            # Subtle background portraits dimmed behind title
            bg_a = int(95 * alpha)
            r_bg = r_adv.resize((520, 520), Image.Resampling.BILINEAR)
            b_bg = b_adv.resize((520, 520), Image.Resampling.BILINEAR)
            r_bg.putalpha(bg_a)
            b_bg.putalpha(bg_a)
            canvas.alpha_composite(r_bg, (60, 100))
            canvas.alpha_composite(b_bg, (W - 580, 100))

            draw = ImageDraw.Draw(canvas)
            # Ornamental gold lines
            line_w = int(380 * min(1.0, lt / 0.9))
            draw.line([(W // 2 - line_w, H // 2 - 86), (W // 2 + line_w, H // 2 - 86)], fill=(230, 175, 85, int(200 * alpha)), width=2)
            draw.line([(W // 2 - line_w, H // 2 + 86), (W // 2 + line_w, H // 2 + 86)], fill=(230, 175, 85, int(200 * alpha)), width=2)

            # Title drop shadow + gold text
            draw.text((W // 2 + 4, H // 2 - 14), "暗影奇譚・魔幻暗棋", font=title_font, fill=(0, 0, 0, int(230 * alpha)), anchor="mm")
            draw.text((W // 2, H // 2 - 18), "暗影奇譚・魔幻暗棋", font=title_font, fill=(255, 215, 130, int(255 * alpha)), anchor="mm")
            draw.text((W // 2, H // 2 + 52), "DARK FANTASY BANQI  •  烈焰與冥淵之戰", font=small_font, fill=(200, 215, 235, int(230 * alpha)), anchor="mm")

        # Draw floating embers & arcane wisps across all frames
        p_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        p_draw = ImageDraw.Draw(p_layer)
        fade_all = min(1.0, t / 0.5) * (1.0 if t < 8.8 else max(0.0, (9.5 - t) / 0.7))
        for i in range(num_p):
            x = (px[i] + pvx[i] * t + 12 * math.sin(t * 2.2 + i)) % W
            y = (py[i] + pvy[i] * t) % H
            r = psize[i]
            pa = int((130 + 90 * math.sin(t * 4.5 + i)) * fade_all)
            c = pcol[i] + (max(0, min(255, pa)),)
            p_draw.ellipse((x - r, y - r, x + r, y + r), fill=c)
        canvas.alpha_composite(p_layer)

        # Apply vignette & convert to RGB24
        arr = np.asarray(canvas.convert("RGB"), dtype=np.float32)
        arr *= vignette[:, :, None]
        proc.stdin.write(np.clip(arr, 0, 255).astype(np.uint8).tobytes())

    proc.stdin.close()
    proc.wait()

    # Mux with intro narration + gong + ambient BGM
    narration = os.path.join(AUDIO_DIR, "voice", "intro_narration.mp3")
    gong = os.path.join(AUDIO_DIR, "sfx", "gong.mp3")
    bgm = os.path.join(AUDIO_DIR, "sfx", "bgm.mp3")

    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", raw_video,
        "-i", narration,
        "-i", gong,
        "-i", bgm,
        "-filter_complex",
        "[1:a]adelay=450|450,volume=1.15[v1];"
        "[2:a]adelay=5800|5800,volume=0.55[v2];"
        "[3:a]atrim=0:9.5,afade=t=in:st=0:d=0.6,afade=t=out:st=8.3:d=1.2,volume=0.45[v3];"
        "[v1][v2][v3]amix=inputs=3:duration=first:normalize=0[aout]",
        "-map", "0:v", "-map", "[aout]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest",
        final_video
    ], check=True)
    os.remove(raw_video)
    print("Built cinematic intro video:", final_video)

if __name__ == "__main__":
    crop_sheet(RED_SRC, RED_NAMES)
    crop_sheet(BLACK_SRC, BLACK_NAMES)
    build_intro_video()
