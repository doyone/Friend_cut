// 투기장 효과음: 내려받는 파일 없이 그 자리에서 만든다. 브라우저 규칙 때문에 첫 키 입력·클릭 뒤부터 소리가 난다.
import { store } from '../util.js';

export function createArenaAudio() {
  let enabled = store.get('arena-sound', true);
  let ctx = null;
  let master = null;
  let hiss = null;
  let beat = null;
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

  const drum = (delay = 0, vol = 0.7) => { tone(110, 0.22, vol, 'sine', 45, delay); noise(0.08, vol * 0.5, 900, delay); };
  function thump() {
    tone(72, 0.13, 0.55, 'sine', 42);
    tone(64, 0.12, 0.4, 'sine', 40, 0.17);
  }

  return {
    get enabled() { return enabled; },
    unlock,
    toggle() {
      enabled = !enabled;
      store.set('arena-sound', enabled);
      if (master) master.gain.value = enabled ? 0.4 : 0;
      if (enabled) void unlock();
      return enabled;
    },
    round() { drum(0); drum(0.18, 0.5); },                           // 새 턴: 북
    load() { tone(520, 0.05, 0.14, 'triangle', 700); noise(0.03, 0.2, 3500, 0, 'highpass'); }, // 카드 장전
    unload() { tone(420, 0.05, 0.1, 'triangle', 300); },
    aim() { tone(880, 0.03, 0.1, 'square', 660); },
    ready() { tone(660, 0.07, 0.16, 'triangle', 990); tone(990, 0.1, 0.14, 'triangle', 1320, 0.07); },
    deny() { tone(180, 0.12, 0.2, 'square', 120); },
    reveal(mine) {                                                    // 공개: 내가 맞으면 더 불길하게
      drum(0, 0.9); drum(0.12, 0.7); drum(0.24, 0.9);
      if (mine) { tone(196, 0.5, 0.22, 'sawtooth', 98, 0.2); tone(147, 0.6, 0.18, 'square', 73, 0.26); }
    },
    swing() { noise(0.12, 0.5, 2600, 0, 'bandpass'); },              // 휘두름
    hit(big) {                                                        // 맞음
      noise(big ? 0.3 : 0.18, 0.9, 1400);
      tone(big ? 110 : 150, big ? 0.3 : 0.18, 0.8, 'triangle', 36);
      if (big) tone(70, 0.4, 0.6, 'sine', 28, 0.03);
    },
    block() { tone(1250, 0.25, 0.3, 'triangle', 900); tone(1870, 0.18, 0.16, 'sine', 1700); noise(0.05, 0.3, 5000, 0, 'highpass'); },
    dodge() { noise(0.18, 0.35, 5000, 0, 'highpass'); tone(900, 0.12, 0.1, 'sine', 1800); },
    reflect() { tone(1400, 0.16, 0.25, 'sine', 2600); tone(2100, 0.2, 0.15, 'sine', 3200, 0.07); },
    cancel() { tone(300, 0.2, 0.14, 'triangle', 140); },
    down() {                                                          // 쓰러짐: 쿵 + 관중 함성
      tone(90, 0.5, 0.9, 'sine', 30);
      noise(0.9, 0.5, 1100, 0.1);
      noise(0.7, 0.3, 2400, 0.25, 'bandpass');
    },
    out() { tone(420, 0.8, 0.28, 'sawtooth', 60); noise(1.2, 0.6, 1000, 0.15); drum(0.05, 1); },
    bleed() { tone(240, 0.1, 0.12, 'triangle', 160); },
    pick(tier = 1) {
      const top = [784, 784, 988, 1319][tier] || 784;
      [523, 659, top].forEach((f, i) => tone(f, 0.12, 0.14, 'triangle', f, i * 0.09));
      if (tier === 3) [1568, 2093, 2637].forEach((f, i) => tone(f, 0.1, 0.08, 'sine', f, 0.32 + i * 0.06));
    },
    rage() { tone(196, 0.5, 0.25, 'sawtooth', 98); tone(147, 0.6, 0.2, 'square', 73, 0.12); drum(0, 1); },
    charge() { // 필살기 준비: 차오르는 소리
      tone(110, 0.7, 0.2, 'sawtooth', 660);
      tone(165, 0.7, 0.14, 'square', 990, 0.05);
    },
    ult() { // 필살기 발동
      noise(0.7, 1, 900);
      tone(60, 0.8, 0.9, 'sine', 24);
      [392, 523, 784, 1047].forEach((f, i) => tone(f, 0.3, 0.16, 'sawtooth', f * 1.5, i * 0.05));
      drum(0, 1);
      drum(0.14, 1);
    },
    roar() { // 야수
      tone(140, 0.7, 0.5, 'sawtooth', 48);
      noise(0.6, 0.5, 700, 0.03);
      tone(90, 0.6, 0.4, 'square', 40, 0.1);
    },
    tick(k = 0) { tone(1300 - k * 500, 0.03, 0.12, 'square', 900 - k * 300); }, // 룰렛판이 한 칸 넘어갈 때
    whim() { [392, 523, 659].forEach((f, i) => tone(f, 0.18, 0.16, 'sawtooth', f * 1.2, i * 0.08)); drum(0.1, 0.9); },
    zap() { tone(1800, 0.14, 0.22, 'sawtooth', 240); noise(0.12, 0.5, 6000, 0, 'highpass'); },   // 번개
    boom() { noise(0.5, 1, 700); tone(80, 0.5, 0.9, 'sine', 26); },                              // 화약통
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 0.16, 'triangle', f, i * 0.12)); },
    heart(on) { // 두근두근 (내가 맞을 걸 보고 막는 동안 · 결투)
      if (!on) {
        clearInterval(beat);
        beat = null;
      } else if (!beat) {
        thump();
        beat = setInterval(thump, 620);
      }
    },
    dispose() {
      disposed = true;
      clearInterval(beat);
      if (ctx) void ctx.close().catch(() => {});
    },
  };
}
