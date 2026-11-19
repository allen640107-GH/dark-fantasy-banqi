import asyncio
import os
import subprocess
import edge_tts

BASE_DIR = r"D:\Antigravity_Projects\DarkChess\assets\audio"
VOICE_DIR = os.path.join(BASE_DIR, "voice")
SFX_DIR = os.path.join(BASE_DIR, "sfx")
VIDEO_DIR = r"D:\Antigravity_Projects\DarkChess\assets\video"
os.makedirs(VOICE_DIR, exist_ok=True)

# Dramatic, emotionally expressive Microsoft Neural Voice Cast!
# (filename, expressive_text, neural_voice, rate, pitch_factor, studio_ffmpeg_filter)
VOICE_LINES = [
    # Cinematic Narrator & System Announcements (zh-CN-YunjianNeural = epic game-trailer male voice)
    ("intro_narration", "千年封印，已然破碎！烈焰聖殿與冥淵暗影，再起宿命之戰。翻開命運之棋……誰，能主宰這片暗影戰場！", "zh-CN-YunjianNeural", "-6%", 0.96, "aecho=0.8:0.85:38:0.22,bass=g=3,treble=g=2"),
    ("game_start", "戰鼓已響！請翻開第一枚，命運之棋！", "zh-CN-YunjianNeural", "-2%", 0.98, "aecho=0.8:0.8:28:0.16,bass=g=2"),
    ("red_first", "烈焰覺醒！紅方，執先！", "zh-CN-YunjianNeural", "+2%", 1.00, "aecho=0.8:0.8:25:0.15,bass=g=2"),
    ("black_first", "冥淵降臨……黑方，執先！", "zh-CN-YunjianNeural", "-8%", 0.92, "aecho=0.8:0.86:42:0.24,bass=g=4"),
    ("red_win", "烈焰永燃！紅方，大獲全勝！", "zh-CN-YunjianNeural", "+0%", 1.00, "aecho=0.8:0.85:40:0.22,bass=g=3"),
    ("black_win", "暗影吞噬一切……黑方，奪得勝利！", "zh-CN-YunjianNeural", "-8%", 0.92, "aecho=0.8:0.88:48:0.26,bass=g=4"),
    ("draw_game", "雙方勢均力敵，此局……判和。", "zh-CN-YunyangNeural", "-4%", 1.00, "aecho=0.8:0.8:28:0.15"),
    ("soldier_slays_general", "不可思議！區區小兵，竟斬落敵方大將！", "zh-CN-YunxiNeural", "+6%", 1.02, "aecho=0.8:0.84:32:0.18,treble=g=2"),

    # Red Faction (烈焰聖殿) - Heroic, passionate, commanding
    ("r_general", "三軍聽令！以烈焰，焚盡一切宵小！", "zh-CN-YunjianNeural", "-4%", 0.97, "aecho=0.8:0.84:34:0.20,bass=g=3"),
    ("r_advisor", "紅蓮劍光，誓死護駕！", "zh-TW-HsiaoChenNeural", "+4%", 1.00, "aecho=0.8:0.78:22:0.14,treble=g=2"),
    ("r_elephant", "炎紋既成，戰局……盡在掌握之中。", "zh-CN-YunyangNeural", "-4%", 1.00, "aecho=0.8:0.82:28:0.16"),
    ("r_chariot", "重甲突擊！給我碾碎他們！", "zh-CN-YunjianNeural", "+0%", 0.93, "aecho=0.8:0.84:30:0.18,bass=g=5"),
    ("r_horse", "赤焰奔騰，疾如烈風！", "zh-CN-YunxiNeural", "+8%", 1.02, "aecho=0.8:0.76:20:0.12"),
    ("r_cannon", "哈哈！看我炎砲轟擊，隔山打牛！", "zh-TW-YunJheNeural", "+4%", 0.98, "aecho=0.8:0.82:30:0.18,bass=g=2"),
    ("r_soldier", "烈焰先鋒，絕不退縮！", "zh-CN-YunxiNeural", "+10%", 1.04, "aecho=0.8:0.75:18:0.12"),

    # Black Faction (冥淵暗影) - Dark, cold, menacing, resonant
    ("b_general", "跪伏於冥淵之下……感受絕望吧！", "zh-CN-YunjianNeural", "-10%", 0.90, "aecho=0.8:0.88:50:0.28,bass=g=5"),
    ("b_advisor", "暗影無聲……無人能越雷池一步。", "zh-TW-HsiaoYuNeural", "-4%", 0.97, "aecho=0.8:0.84:36:0.22"),
    ("b_elephant", "愚蠢的掙扎……你已落入陷阱。", "zh-CN-YunyangNeural", "-8%", 0.95, "aecho=0.8:0.85:40:0.24,bass=g=2"),
    ("b_chariot", "黑鐵巨像！踏平一切阻礙！", "zh-CN-YunjianNeural", "-10%", 0.89, "aecho=0.8:0.88:42:0.26,bass=g=6"),
    ("b_horse", "幽冥鐵騎，你逃不掉的！", "zh-TW-YunJheNeural", "+0%", 0.94, "aecho=0.8:0.82:32:0.18,bass=g=2"),
    ("b_cannon", "虛空爆裂！化作灰燼吧！", "zh-CN-YunxiNeural", "+2%", 0.94, "aecho=0.8:0.86:40:0.24,bass=g=3"),
    ("b_soldier", "死士無畏，奉主之命！", "zh-TW-YunJheNeural", "+4%", 0.96, "aecho=0.8:0.80:26:0.16"),
]

async def generate_voices():
    for fname, text, voice, rate, pitch_factor, ffilter in VOICE_LINES:
        raw_mp3 = os.path.join(VOICE_DIR, f"{fname}_raw.mp3")
        out_mp3 = os.path.join(VOICE_DIR, f"{fname}.mp3")
        clean_text = text.replace("……", "，")

        # Try with rate, then without rate, then fallback to verified zh-CN-YunjianNeural
        saved = False
        attempts = [
            (voice, rate),
            (voice, None),
            ("zh-CN-YunjianNeural", None),
        ]
        for v_try, r_try in attempts:
            try:
                comm = edge_tts.Communicate(clean_text, v_try, rate=r_try) if r_try else edge_tts.Communicate(clean_text, v_try)
                await comm.save(raw_mp3)
                saved = True
                break
            except Exception:
                await asyncio.sleep(0.4)
        if not saved:
            raise RuntimeError(f"Failed neural TTS for {fname}")

        pitch_filter = ""
        if abs(pitch_factor - 1.0) > 0.005:
            pitch_filter = f"asetrate=24000*{pitch_factor:.3f},aresample=24000,atempo={1.0/pitch_factor:.3f},"

        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", raw_mp3,
            "-af", f"{pitch_filter}{ffilter},acompressor=threshold=-18dB:ratio=3:attack=5:release=60,loudnorm=I=-15:TP=-1.2:LRA=11",
            "-b:a", "160k", out_mp3
        ]
        subprocess.run(cmd, check=True)
        os.remove(raw_mp3)
        await asyncio.sleep(0.15)
    print(f"Upgraded all {len(VOICE_LINES)} voice clips to Expressive Neural TTS!")

def remux_intro_video():
    # Re-mux existing intro video's video track with the upgraded neural intro narration!
    intro_mp4 = os.path.join(VIDEO_DIR, "intro.mp4")
    tmp_mp4 = os.path.join(VIDEO_DIR, "intro_upgraded.mp4")
    narration = os.path.join(VOICE_DIR, "intro_narration.mp3")
    gong = os.path.join(SFX_DIR, "gong.mp3")
    bgm = os.path.join(SFX_DIR, "bgm.mp3")
    if not os.path.exists(intro_mp4):
        return
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", intro_mp4,
        "-i", narration,
        "-i", gong,
        "-i", bgm,
        "-filter_complex",
        "[1:a]adelay=350|350,volume=1.22[v1];"
        "[2:a]adelay=5800|5800,volume=0.52[v2];"
        "[3:a]atrim=0:9.5,afade=t=in:st=0:d=0.6,afade=t=out:st=8.3:d=1.2,volume=0.42[v3];"
        "[v1][v2][v3]amix=inputs=3:duration=first:normalize=0[aout]",
        "-map", "0:v", "-map", "[aout]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest",
        tmp_mp4
    ], check=True)
    os.replace(tmp_mp4, intro_mp4)
    print("Re-muxed intro.mp4 with expressive neural narration!")

if __name__ == "__main__":
    test_f = r"D:\Antigravity_Projects\DarkChess\scripts\test_neural.mp3"
    if os.path.exists(test_f):
        os.remove(test_f)
    asyncio.run(generate_voices())
    remux_intro_video()
