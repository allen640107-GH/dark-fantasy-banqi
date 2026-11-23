import os
import shutil
import subprocess
from PIL import Image, ImageDraw, ImageFont

SRC_TMP = r"C:\Users\User\Downloads\50180f8f-5f77-43a1-a962-a7f0f154c5c5.tmp"
VIDEO_DIR = r"D:\Antigravity_Projects\DarkChess\assets\video"
AUDIO_DIR = r"D:\Antigravity_Projects\DarkChess\assets\audio"
RAW_MP4 = os.path.join(VIDEO_DIR, "flow_raw.mp4")
TITLE_PNG = os.path.join(VIDEO_DIR, "title_overlay.png")
OUT_MP4 = os.path.join(VIDEO_DIR, "intro.mp4")

# Locate file (in case Chrome finished renaming .tmp to .mp4)
if os.path.exists(SRC_TMP):
    shutil.copy2(SRC_TMP, RAW_MP4)
else:
    # Fallback: newest mp4 in Downloads
    dl = os.path.join(os.environ["USERPROFILE"], "Downloads")
    mp4s = [os.path.join(dl, f) for f in os.listdir(dl) if f.lower().endswith(".mp4")]
    mp4s.sort(key=os.path.getmtime, reverse=True)
    shutil.copy2(mp4s[0], RAW_MP4)

# Probe resolution, duration, and whether it has an audio stream
probe = subprocess.check_output([
    "ffprobe", "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,width,height",
    "-of", "default=noprint_wrappers=1", RAW_MP4
], text=True)
print("PROBED FLOW VIDEO:\n" + probe)

w, h = 1280, 720
dur = 8.0
has_audio = False
for line in probe.splitlines():
    if line.startswith("width="): w = int(line.split("=")[1])
    elif line.startswith("height="): h = int(line.split("=")[1])
    elif line.startswith("duration="):
        try: dur = float(line.split("=")[1])
        except ValueError: pass
    elif line.strip() == "codec_type=audio":
        has_audio = True

# Build crisp transparent golden cinematic title overlay PNG matching exact video dimensions
def find_font(size):
    for p in [r"C:\Windows\Fonts\kaiu.ttf", r"C:\Windows\Fonts\msjhbd.ttc", r"C:\Windows\Fonts\msjh.ttc"]:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

ov = Image.new("RGBA", (w, h), (0, 0, 0, 0))
draw = ImageDraw.Draw(ov)

# Soft dark cinematic gradient band behind title so golden text pops cleanly over live-action footage
for y in range(int(h * 0.56), h):
    p = (y - h * 0.56) / (h * 0.44)
    a = int(175 * min(1.0, p * 1.35))
    draw.line([(0, y), (w, y)], fill=(6, 5, 10, a))

title_font = find_font(int(h * 0.115))
sub_font = find_font(int(h * 0.036))

cy = int(h * 0.77)
line_w = int(w * 0.30)
draw.line([(w // 2 - line_w, cy - int(h * 0.095)), (w // 2 + line_w, cy - int(h * 0.095))], fill=(235, 185, 95, 210), width=2)
draw.line([(w // 2 - line_w, cy + int(h * 0.105)), (w // 2 + line_w, cy + int(h * 0.105))], fill=(235, 185, 95, 210), width=2)

# Drop shadow + metallic gold title
draw.text((w // 2 + 4, cy - int(h * 0.015) + 4), "暗影奇譚・魔幻暗棋", font=title_font, fill=(0, 0, 0, 235), anchor="mm")
draw.text((w // 2, cy - int(h * 0.015)), "暗影奇譚・魔幻暗棋", font=title_font, fill=(255, 218, 132, 255), anchor="mm")
draw.text((w // 2, cy + int(h * 0.068)), "DARK FANTASY BANQI  •  烈焰與冥淵之戰", font=sub_font, fill=(218, 230, 245, 235), anchor="mm")
ov.save(TITLE_PNG)

narration = os.path.join(AUDIO_DIR, "voice", "intro_narration.mp3")
gong = os.path.join(AUDIO_DIR, "sfx", "gong.mp3")
bgm = os.path.join(AUDIO_DIR, "sfx", "bgm.mp3")

title_start = max(3.5, dur - 2.9)
fade_out_st = max(5.0, dur - 0.85)
gong_ms = int(title_start * 1000)

# Compose live-action video + subtle title fade-in + cinematic letterbox + fade-in/out + audio mix
v_filter = (
    f"[0:v]fade=t=in:st=0:d=0.45,fade=t=out:st={fade_out_st:.2f}:d=0.85[base];"
    f"[1:v]format=rgba,fade=t=in:st={title_start:.2f}:d=0.65:alpha=1,fade=t=out:st={fade_out_st:.2f}:d=0.8:alpha=1[ttl];"
    f"[base][ttl]overlay=0:0:shortest=1[vout]"
)

if has_audio:
    a_filter = (
        f"[0:a]volume=0.72,afade=t=out:st={fade_out_st:.2f}:d=0.85[orig];"
        f"[2:a]atempo=1.18,adelay=200|200,volume=1.12[nar];"
        f"[3:a]adelay={gong_ms}|{gong_ms},volume=0.48[gng];"
        f"[4:a]atrim=0:{dur:.2f},afade=t=in:st=0:d=0.5,afade=t=out:st={fade_out_st:.2f}:d=0.85,volume=0.32[bg];"
        f"[orig][nar][gng][bg]amix=inputs=4:duration=first:normalize=0[aout]"
    )
else:
    a_filter = (
        f"[2:a]atempo=1.18,adelay=200|200,volume=1.18[nar];"
        f"[3:a]adelay={gong_ms}|{gong_ms},volume=0.55[gng];"
        f"[4:a]atrim=0:{dur:.2f},afade=t=in:st=0:d=0.5,afade=t=out:st={fade_out_st:.2f}:d=0.85,volume=0.42[bg];"
        f"[nar][gng][bg]amix=inputs=3:duration=first:normalize=0[aout]"
    )

subprocess.run([
    "ffmpeg", "-y", "-loglevel", "error",
    "-i", RAW_MP4,
    "-loop", "1", "-t", f"{dur:.2f}", "-i", TITLE_PNG,
    "-i", narration,
    "-i", gong,
    "-i", bgm,
    "-filter_complex", f"{v_filter};{a_filter}",
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart", "-shortest",
    OUT_MP4
], check=True)

for tmp in (RAW_MP4, TITLE_PNG):
    if os.path.exists(tmp):
        os.remove(tmp)

sz = os.path.getsize(OUT_MP4) / (1024 * 1024)
print(f"SUCCESS! Final live-action intro saved to {OUT_MP4} ({sz:.2f} MB)")
