import asyncio
import os
import math
import struct
import wave
import subprocess
import numpy as np
import edge_tts

BASE_DIR = r"D:\Antigravity_Projects\DarkChess\assets\audio"
VOICE_DIR = os.path.join(BASE_DIR, "voice")
SFX_DIR = os.path.join(BASE_DIR, "sfx")
os.makedirs(VOICE_DIR, exist_ok=True)
os.makedirs(SFX_DIR, exist_ok=True)

# Voice definitions: (filename, text, voice_name, rate, pitch, ffmpeg_filter)
# zh-TW-YunJheNeural (male), zh-TW-HsiaoChenNeural (female), zh-TW-HsiaoYuNeural (female)
VOICE_LINES = [
    # Intro & System announcements
    ("intro_narration", "千年封印已破，烈焰聖殿與冥淵暗影再起爭端。翻開命運之棋，誰能主宰這片暗影戰場！", "zh-TW-YunJheNeural", "-8%", "-12Hz", "aecho=0.8:0.85:45:0.25,bass=g=4"),
    ("game_start", "戰局已開，請翻開第一枚命運之棋！", "zh-TW-YunJheNeural", "-2%", "-6Hz", "aecho=0.8:0.8:30:0.18"),
    ("red_first", "烈焰覺醒，紅方執先！", "zh-TW-YunJheNeural", "+0%", "-4Hz", "aecho=0.8:0.8:25:0.15"),
    ("black_first", "冥淵降臨，黑方執先！", "zh-TW-YunJheNeural", "-8%", "-16Hz", "aecho=0.8:0.85:40:0.28,bass=g=5"),
    ("red_win", "烈焰永燃，紅方大獲全勝！", "zh-TW-YunJheNeural", "-2%", "-4Hz", "aecho=0.8:0.85:45:0.25,bass=g=4"),
    ("black_win", "暗影吞噬一切，黑方奪得勝利！", "zh-TW-YunJheNeural", "-8%", "-16Hz", "aecho=0.8:0.88:50:0.30,bass=g=5"),
    ("draw_game", "雙方勢均力敵，此局判和。", "zh-TW-YunJheNeural", "-4%", "-6Hz", "aecho=0.8:0.8:30:0.18"),
    ("soldier_slays_general", "不可思議！小兵竟斬落大將！", "zh-TW-YunJheNeural", "+4%", "-2Hz", "aecho=0.8:0.85:40:0.25,bass=g=4"),

    # Red Faction (烈焰聖殿) - Heroic, warm, powerful
    ("r_general", "三軍聽令，以烈焰焚盡宵小！", "zh-TW-YunJheNeural", "-6%", "-10Hz", "aecho=0.8:0.85:35:0.22,bass=g=4"),
    ("r_advisor", "紅蓮劍光，誓死護駕！", "zh-TW-HsiaoChenNeural", "+2%", "-2Hz", "aecho=0.8:0.8:25:0.15"),
    ("r_elephant", "炎紋既成，一切盡在掌握。", "zh-TW-YunJheNeural", "-4%", "-4Hz", "aecho=0.8:0.82:30:0.18"),
    ("r_chariot", "重甲突擊，碾碎他們！", "zh-TW-YunJheNeural", "-2%", "-14Hz", "aecho=0.8:0.85:30:0.20,bass=g=6"),
    ("r_horse", "赤焰奔騰，疾如烈風！", "zh-TW-YunJheNeural", "+6%", "+2Hz", "aecho=0.8:0.75:20:0.12"),
    ("r_cannon", "看我炎砲轟擊，隔山打牛！", "zh-TW-YunJheNeural", "+4%", "-6Hz", "aecho=0.8:0.82:35:0.20,bass=g=3"),
    ("r_soldier", "烈焰先鋒，絕不退縮！", "zh-TW-YunJheNeural", "+8%", "+4Hz", "aecho=0.8:0.75:18:0.12"),

    # Black Faction (冥淵暗影) - Dark, cold, resonant echo
    ("b_general", "跪伏於冥淵之下，感受絕望吧！", "zh-TW-YunJheNeural", "-10%", "-18Hz", "aecho=0.8:0.88:55:0.32,bass=g=6"),
    ("b_advisor", "暗影無聲，無人能越雷池一步。", "zh-TW-HsiaoYuNeural", "-4%", "-8Hz", "aecho=0.8:0.85:40:0.25"),
    ("b_elephant", "愚蠢的掙扎，你已落入陷阱。", "zh-TW-YunJheNeural", "-8%", "-12Hz", "aecho=0.8:0.86:45:0.28"),
    ("b_chariot", "黑鐵巨像，踏平一切阻礙！", "zh-TW-YunJheNeural", "-12%", "-20Hz", "aecho=0.8:0.88:45:0.28,bass=g=7"),
    ("b_horse", "幽冥鐵騎，你逃不掉的！", "zh-TW-YunJheNeural", "+0%", "-12Hz", "aecho=0.8:0.84:35:0.22"),
    ("b_cannon", "虛空爆裂，化作灰燼吧！", "zh-TW-YunJheNeural", "-2%", "-14Hz", "aecho=0.8:0.86:45:0.28,bass=g=4"),
    ("b_soldier", "死士無畏，奉主之命！", "zh-TW-YunJheNeural", "+2%", "-10Hz", "aecho=0.8:0.82:30:0.20"),
]

def synth_windows_sapi(text, wav_path, rate_int=0):
    # Escape single quotes for PowerShell
    safe_text = text.replace("'", "''")
    ps = (
        "Add-Type -AssemblyName System.Speech; "
        "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        "$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh-*' } | Select-Object -First 1; "
        "if ($v) { $s.SelectVoice($v.VoiceInfo.Name) }; "
        f"$s.Rate = {rate_int}; "
        f"$s.SetOutputToWaveFile('{wav_path}'); "
        f"$s.Speak('{safe_text}'); "
        "$s.Dispose();"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True)

async def generate_voices():
    use_sapi = False
    for fname, text, voice, rate, pitch, ffilter in VOICE_LINES:
        raw_audio = os.path.join(VOICE_DIR, f"{fname}_raw.mp3")
        raw_wav = os.path.join(VOICE_DIR, f"{fname}_raw.wav")
        out_mp3 = os.path.join(VOICE_DIR, f"{fname}.mp3")
        if os.path.exists(out_mp3) and os.path.getsize(out_mp3) > 2000:
            continue

        src_file = raw_audio
        if not use_sapi:
            try:
                communicate = edge_tts.Communicate(text, voice)
                await communicate.save(raw_audio)
            except Exception:
                use_sapi = True

        if use_sapi:
            rate_int = -1 if rate.startswith("-") else (1 if rate.startswith("+") and rate != "+0%" else 0)
            synth_windows_sapi(text, raw_wav, rate_int)
            src_file = raw_wav

        # Convert pitch hint like "-12Hz" to subtle ffmpeg pitch shift
        pitch_val = int(pitch.replace("Hz", "").replace("+", ""))
        pitch_factor = max(0.82, min(1.14, 1.0 + pitch_val * 0.007))
        pitch_filter = ""
        if abs(pitch_factor - 1.0) > 0.01:
            pitch_filter = f"asetrate=22050*{pitch_factor:.3f},aresample=24000,atempo={1.0/pitch_factor:.3f},"
        cmd = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-i", src_file,
            "-af", f"{pitch_filter}{ffilter},loudnorm=I=-16:TP=-1.5:LRA=11",
            "-b:a", "128k", out_mp3
        ]
        subprocess.run(cmd, check=True)
        for tmp in (raw_audio, raw_wav):
            if os.path.exists(tmp):
                os.remove(tmp)
    print(f"Generated {len(VOICE_LINES)} voice clips (engine={'Windows SAPI' if use_sapi else 'Edge Neural TTS'}).")

def save_wav(path, samples, sr=44100):
    samples = np.clip(samples, -1.0, 1.0)
    data = (samples * 32767).astype(np.int16)
    with wave.open(path, "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(data.tobytes())

def wav_to_mp3(wav_path, mp3_path, af="loudnorm=I=-14:TP=-1.5"):
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", wav_path, "-af", af, "-b:a", "160k", mp3_path
    ], check=True)
    os.remove(wav_path)

def generate_sfx():
    sr = 44100
    rng = np.random.default_rng(42)

    # 1. Realistic carved hardwood / stone piece placement clack
    def make_clack(dur=0.28, f1=420, f2=1180, f3=2650, thud=110, crisp=0.45):
        t = np.linspace(0, dur, int(sr * dur), endpoint=False)
        # Initial sharp wood impact transient
        noise = rng.normal(0, 1, len(t))
        transient = noise * np.exp(-t * 140) * crisp
        # Wood body resonances (mahogany + obsidian board resonance)
        body = (
            0.55 * np.sin(2 * np.pi * f1 * t) * np.exp(-t * 32) +
            0.35 * np.sin(2 * np.pi * f2 * t) * np.exp(-t * 58) +
            0.20 * np.sin(2 * np.pi * f3 * t) * np.exp(-t * 95) +
            0.50 * np.sin(2 * np.pi * thud * t) * np.exp(-t * 22)
        )
        # Subtle micro-bounce 18ms later
        bounce_idx = int(0.018 * sr)
        sig = transient + body
        if bounce_idx < len(sig):
            sig[bounce_idx:] += 0.22 * sig[:-bounce_idx] * np.exp(-t[:-bounce_idx] * 25)
        return sig / (np.max(np.abs(sig)) + 1e-6) * 0.9

    # Move SFX
    wav = os.path.join(SFX_DIR, "move.wav")
    save_wav(wav, make_clack(0.25, 440, 1250, 2800, 105, 0.4))
    wav_to_mp3(wav, os.path.join(SFX_DIR, "move.mp3"), "aecho=0.8:0.7:18:0.18,loudnorm=I=-14")

    # Select SFX (subtle stone/metal tick)
    wav = os.path.join(SFX_DIR, "select.wav")
    t = np.linspace(0, 0.12, int(sr * 0.12), endpoint=False)
    sel = (
        0.5 * np.sin(2 * np.pi * 880 * t) * np.exp(-t * 65) +
        0.3 * np.sin(2 * np.pi * 1760 * t) * np.exp(-t * 90) +
        0.15 * rng.normal(0, 1, len(t)) * np.exp(-t * 180)
    )
    save_wav(wav, sel / (np.max(np.abs(sel)) + 1e-6) * 0.7)
    wav_to_mp3(wav, os.path.join(SFX_DIR, "select.mp3"), "loudnorm=I=-18")

    # Flip SFX (wood snap + mystical shimmer chime)
    wav = os.path.join(SFX_DIR, "flip.wav")
    dur = 0.55
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    clack = make_clack(dur, 520, 1420, 3100, 130, 0.5)
    shimmer = (
        0.22 * np.sin(2 * np.pi * 659.25 * t) * np.exp(-t * 7) +
        0.18 * np.sin(2 * np.pi * 987.77 * t) * np.exp(-t * 8.5) +
        0.14 * np.sin(2 * np.pi * 1318.5 * t) * np.exp(-t * 10)
    ) * (1 - np.exp(-t * 45))
    sig = 0.8 * clack + 0.5 * shimmer
    save_wav(wav, sig / (np.max(np.abs(sig)) + 1e-6) * 0.9)
    wav_to_mp3(wav, os.path.join(SFX_DIR, "flip.mp3"), "aecho=0.8:0.8:35:0.25,loudnorm=I=-14")

    # Capture SFX (heavy wood slam + metallic sword ring)
    wav = os.path.join(SFX_DIR, "capture.wav")
    dur = 0.65
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    slam = make_clack(dur, 310, 890, 2100, 72, 0.65)
    blade = (
        0.30 * np.sin(2 * np.pi * 1480 * t) * np.exp(-t * 9) +
        0.25 * np.sin(2 * np.pi * 2217 * t) * np.exp(-t * 11) +
        0.18 * np.sin(2 * np.pi * 3136 * t) * np.exp(-t * 14) +
        0.35 * rng.normal(0, 1, len(t)) * np.exp(-t * 35)
    )
    sub_boom = 0.65 * np.sin(2 * np.pi * (85 * np.exp(-t * 3.5)) * t) * np.exp(-t * 6)
    sig = 0.85 * slam + 0.55 * blade + 0.7 * sub_boom
    save_wav(wav, sig / (np.max(np.abs(sig)) + 1e-6) * 0.95)
    wav_to_mp3(wav, os.path.join(SFX_DIR, "capture.mp3"), "aecho=0.8:0.82:40:0.28,bass=g=4,loudnorm=I=-12")

    # Cannon Explosion SFX (fiery whoosh + deep arcane blast)
    wav = os.path.join(SFX_DIR, "cannon.wav")
    dur = 0.95
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    noise = rng.normal(0, 1, len(t))
    # Low-pass filtered explosion rumble via cumulative moving average
    kernel = np.ones(45) / 45.0
    rumble = np.convolve(noise, kernel, mode="same") * np.exp(-t * 3.2) * 3.5
    crack = noise * np.exp(-t * 28) * 0.75
    boom = np.sin(2 * np.pi * (95 * np.exp(-t * 2.8)) * t) * np.exp(-t * 4.5) * 0.9
    sig = rumble + crack + boom
    save_wav(wav, sig / (np.max(np.abs(sig)) + 1e-6) * 0.95)
    wav_to_mp3(wav, os.path.join(SFX_DIR, "cannon.mp3"), "aecho=0.8:0.85:55:0.35,bass=g=6,loudnorm=I=-11")

    # Victory / Epic Gong SFX
    wav = os.path.join(SFX_DIR, "gong.wav")
    dur = 2.8
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    freqs = [110, 164.8, 220, 277.2, 329.6, 440, 587.3, 830.6]
    gong = np.zeros_like(t)
    for i, f in enumerate(freqs):
        decay = 0.9 + i * 0.45
        gong += (1.0 / (i + 1)) * np.sin(2 * np.pi * f * t + 0.4 * np.sin(2 * np.pi * 2.5 * t)) * np.exp(-t * decay)
    gong += 0.25 * rng.normal(0, 1, len(t)) * np.exp(-t * 18)
    save_wav(wav, gong / (np.max(np.abs(gong)) + 1e-6) * 0.92)
    wav_to_mp3(wav, os.path.join(SFX_DIR, "gong.mp3"), "aecho=0.8:0.9:70:0.4,bass=g=4,loudnorm=I=-13")

    # Dark Fantasy Ambient BGM Loop (16 seconds seamless atmospheric pad + subtle war drums)
    wav = os.path.join(SFX_DIR, "bgm.wav")
    dur = 16.0
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    # D minor dark orchestral drone (D2, A2, D3, F3, A3) with slow LFO breathing
    lfo1 = 0.5 + 0.5 * np.sin(2 * np.pi * (1.0 / 16.0) * t)
    lfo2 = 0.5 + 0.5 * np.sin(2 * np.pi * (2.0 / 16.0) * t + 1.2)
    pad = (
        0.35 * np.sin(2 * np.pi * 73.42 * t) +
        0.22 * np.sin(2 * np.pi * 110.00 * t) * (0.7 + 0.3 * lfo1) +
        0.18 * np.sin(2 * np.pi * 146.83 * t) * (0.6 + 0.4 * lfo2) +
        0.12 * np.sin(2 * np.pi * 174.61 * t) * lfo1 +
        0.10 * np.sin(2 * np.pi * 220.00 * t) * lfo2 +
        0.06 * np.sin(2 * np.pi * 293.66 * t) * (1 - lfo1)
    )
    # Subtle distant war-drum heartbeat every 2 seconds
    drums = np.zeros_like(t)
    for beat_t in [0.0, 2.0, 4.0, 6.0, 8.0, 10.0, 12.0, 14.0]:
        idx = int(beat_t * sr)
        blen = int(0.45 * sr)
        if idx + blen < len(t):
            bt = np.linspace(0, 0.45, blen, endpoint=False)
            drums[idx:idx+blen] += 0.32 * np.sin(2 * np.pi * (62 * np.exp(-bt * 4)) * bt) * np.exp(-bt * 7)
    bgm = 0.65 * pad + 0.5 * drums
    # Crossfade edges for seamless loop
    fade = int(0.5 * sr)
    bgm[:fade] *= np.linspace(0.5, 1.0, fade)
    bgm[-fade:] *= np.linspace(1.0, 0.5, fade)
    save_wav(wav, bgm / (np.max(np.abs(bgm)) + 1e-6) * 0.65)
    wav_to_mp3(wav, os.path.join(SFX_DIR, "bgm.mp3"), "aecho=0.8:0.88:80:0.35,loudnorm=I=-22")
    print("Generated all SFX and ambient BGM.")

if __name__ == "__main__":
    asyncio.run(generate_voices())
    generate_sfx()
