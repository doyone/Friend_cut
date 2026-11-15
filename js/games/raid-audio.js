// 독박 원정대 효과음: 내려받는 파일 없이 그 자리에서 만든다 (투기장과 같은 방식).
// 브라우저 규칙 때문에 첫 클릭 · 키 입력 뒤부터 소리가 난다. 지하 묘지라 낮고 둔한 소리 위주.
import { store } from '../util.js';

export function createRaidAudio() {
  let enabled = store.get('raid-sound', true);
  let ctx = null;
  let master = null;
  let hiss = null;
  let disposed = false;
  const ok = () => ctx && enabled && !disposed && ctx.state === 'running' && !document.hidden;

  function tone(freq, dur, vol, type = 'sine', end = freq, delay = 0) {
    if (!ok()) return;
    const at = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), at + dur);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(vol, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  function noise(dur, vol, cutoff = 3000, delay = 0, kind = 'lowpass') {
    if (!ok()) return;
    const at = ctx.currentTime + delay;
    if (!hiss) {
      hiss = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = hiss.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = hiss;
    filter.type = kind;
    filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(vol, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.onended = () => { src.disconnect(); filter.disconnect(); gain.disconnect(); };
    src.start(at, Math.random() * 0.5, dur + 0.02);
  }

  async function unlock() {
    if (!enabled || disposed) return;
    try {
      if (!ctx) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        ctx = new Audio();
        master = ctx.createGain();
        master.gain.value = 0.4;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') await ctx.resume();
    } catch { /* 소리가 안 나도 게임은 계속 */ }
  }

  const drum = (delay = 0, vol = 0.7) => { tone(98, 0.26, vol, 'sine', 40, delay); noise(0.09, vol * 0.45, 700, delay); };
  const toll = (f, delay = 0, vol = 0.18) => { tone(f, 1.4, vol, 'sine', f * 0.99, delay); tone(f * 2.76, 0.9, vol * 0.35, 'sine', f * 2.7, delay); }; // 종

  return {
    get enabled() { return enabled; },
    unlock,
    toggle() {
      enabled = !enabled;
      store.set('raid-sound', enabled);
      if (master) master.gain.value = enabled ? 0.4 : 0;
      if (enabled) void unlock();
      return enabled;
    },
    // 고르기
    pick() { tone(520, 0.05, 0.12, 'triangle', 680); },
    ready() { tone(440, 0.08, 0.15, 'triangle', 660); tone(660, 0.12, 0.13, 'triangle', 880, 0.07); },
    deny() { tone(170, 0.13, 0.2, 'square', 110); },
    // 결과 장면
    swing() { noise(0.13, 0.45, 2200, 0, 'bandpass'); },
    hit(big) {
      noise(big ? 0.32 : 0.18, 0.85, 1200);
      tone(big ? 100 : 140, big ? 0.32 : 0.18, 0.75, 'triangle', 34);
      if (big) tone(64, 0.45, 0.6, 'sine', 26, 0.03);
    },
    hurt(big, mine) { // 원정대가 맞음: 내가 맞으면 더 무겁게
      noise(big ? 0.35 : 0.2, mine ? 1 : 0.7, 900);
      tone(mine ? 82 : 120, big ? 0.4 : 0.22, mine ? 0.9 : 0.6, 'sawtooth', 30);
    },
    block() { tone(1150, 0.22, 0.26, 'triangle', 820); tone(1720, 0.16, 0.14, 'sine', 1600); noise(0.05, 0.28, 5000, 0, 'highpass'); },
    heal() { [523, 659, 784].forEach((f, i) => tone(f, 0.22, 0.09, 'sine', f * 1.01, i * 0.06)); },
    brk(frac = 0) { tone(300 + frac * 500, 0.08, 0.16, 'square', 240 + frac * 400); }, // 차단: 찰수록 높게
    groggy() { // 필살기가 끊겼다: 깨지는 소리 + 종
      noise(0.5, 1, 2600, 0, 'bandpass');
      tone(220, 0.5, 0.5, 'sawtooth', 55);
      toll(392, 0.12, 0.2);
    },
    down(mine) { tone(80, 0.6, 0.85, 'sine', 28); noise(0.7, 0.45, 800, 0.08); if (mine) toll(147, 0.3, 0.22); },
    die() { noise(0.16, 0.6, 1600); tone(180, 0.2, 0.3, 'triangle', 60); },
    bleed() { tone(230, 0.1, 0.12, 'triangle', 150); },
    rise() { tone(70, 0.8, 0.4, 'sawtooth', 110); noise(0.6, 0.35, 500, 0.05); }, // 무덤에서 기어 나옴
    dark() { tone(117, 0.7, 0.2, 'sawtooth', 110); tone(124, 0.7, 0.16, 'sawtooth', 116); }, // 어긋난 두 음
    ult() {
      noise(0.8, 1, 800);
      tone(55, 0.9, 0.9, 'sine', 22);
      [196, 233, 294].forEach((f, i) => tone(f, 0.4, 0.15, 'sawtooth', f * 0.7, i * 0.05));
      drum(0, 1);
      drum(0.16, 1);
    },
    charge() { tone(98, 0.8, 0.2, 'sawtooth', 392); tone(147, 0.8, 0.13, 'square', 588, 0.05); }, // 필살기 준비: 차오름
    // 단계
    turn() { drum(0, 0.6); },
    door() { drum(0, 0.9); drum(0.22, 0.6); noise(0.9, 0.25, 400, 0.05); },
    clear() { [392, 494, 587, 784].forEach((f, i) => tone(f, 0.18, 0.14, 'triangle', f, i * 0.1)); },
    whisper() { // 속삭임: 낮게 웅얼거림
      noise(1.4, 0.22, 600, 0, 'bandpass');
      tone(110, 1.3, 0.12, 'sine', 104);
      tone(165, 1.2, 0.08, 'sine', 158, 0.2);
    },
    reveal() { drum(0, 0.8); drum(0.14, 0.6); },
    fall() { // 흑화
      toll(110, 0, 0.3);
      toll(104, 0.9, 0.26);
      tone(55, 2, 0.5, 'sawtooth', 41, 0.2);
      noise(1.6, 0.4, 500, 0.2);
    },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 0.16, 'triangle', f, i * 0.12)); },
    lose() { toll(98, 0, 0.3); tone(196, 1.2, 0.2, 'sawtooth', 98, 0.1); },
    dispose() {
      disposed = true;
      if (ctx) void ctx.close().catch(() => {});
    },
  };
}
