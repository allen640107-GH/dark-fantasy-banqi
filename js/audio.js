export class AudioManager {
  constructor() {
    this.bgmEnabled = true;
    this.sfxEnabled = true;
    this.sfxMap = {};
    this.voiceMap = {};
    this.currentVoice = null;

    this.bgm = new Audio('assets/audio/sfx/bgm.mp3');
    this.bgm.loop = true;
    this.bgm.volume = 0.28;

    const sfxNames = ['move', 'select', 'flip', 'capture', 'cannon', 'gong'];
    for (const name of sfxNames) {
      this.sfxMap[name] = `assets/audio/sfx/${name}.mp3`;
    }

    const voiceNames = [
      'game_start', 'red_first', 'black_first', 'red_win', 'black_win', 'draw_game', 'soldier_slays_general',
      'r_general', 'r_advisor', 'r_elephant', 'r_chariot', 'r_horse', 'r_cannon', 'r_soldier',
      'b_general', 'b_advisor', 'b_elephant', 'b_chariot', 'b_horse', 'b_cannon', 'b_soldier'
    ];
    for (const name of voiceNames) {
      this.voiceMap[name] = `assets/audio/voice/${name}.mp3`;
    }
  }

  startBgm() {
    if (!this.bgmEnabled) return;
    this.bgm.play().catch(() => {});
  }

  stopBgm() {
    this.bgm.pause();
  }

  toggleBgm() {
    this.bgmEnabled = !this.bgmEnabled;
    if (this.bgmEnabled) {
      this.startBgm();
    } else {
      this.stopBgm();
    }
    return this.bgmEnabled;
  }

  toggleSfx() {
    this.sfxEnabled = !this.sfxEnabled;
    if (!this.sfxEnabled && this.currentVoice) {
      this.currentVoice.pause();
    }
    return this.sfxEnabled;
  }

  playSfx(name, volume = 0.85, pitchJitter = 0.06) {
    if (!this.sfxEnabled) return;
    const src = this.sfxMap[name];
    if (!src) return;
    const a = new Audio(src);
    a.volume = volume;
    if (pitchJitter > 0) {
      a.playbackRate = 1.0 + (Math.random() * 2 - 1) * pitchJitter;
    }
    a.play().catch(() => {});
  }

  playVoice(name, volume = 0.95) {
    if (!this.sfxEnabled) return;
    const src = this.voiceMap[name];
    if (!src) return;
    if (this.currentVoice) {
      this.currentVoice.pause();
      this.currentVoice.currentTime = 0;
    }
    const a = new Audio(src);
    a.volume = volume;
    this.currentVoice = a;
    a.play().catch(() => {});
  }
}
