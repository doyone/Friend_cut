// 독박 룰렛 효과음: 내려받는 파일 없이 그 자리에서 만든다. 브라우저 규칙 때문에 첫 키 입력·클릭 뒤부터 소리가 난다.
import { store } from '../util.js';

export function createRouletteAudio() {
  let enabled = store.get('roulette-sound', true);
  let ctx = null;
  let master = null;
  let hiss = null;      // 잡음(총소리·철컥용)
  let beat = null;      // 심장 소리 타이머
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

  function thump() {
    tone(72, 0.13, 0.55, 'sine', 42);
    tone(64, 0.12, 0.4, 'sine', 40, 0.17);
  }

  return {
    get enabled() { return enabled; },
    unlock,
    toggle() {
      enabled = !enabled;
      store.set('roulette-sound', enabled);
      if (master) master.gain.value = enabled ? 0.4 : 0;
      if (enabled) void unlock();
      return enabled;
    },
    cock() { // 철컥
      noise(0.04, 0.5, 2500, 0, 'highpass');
      tone(1500, 0.03, 0.2, 'square', 700);
      noise(0.05, 0.6, 1800, 0.11, 'highpass');
      tone(900, 0.04, 0.25, 'square', 400, 0.11);
    },
    bang(big) { // 탕!
      noise(big ? 0.55 : 0.4, 1, 1700);
      noise(0.12, 0.7, 6000);
      tone(150, 0.35, 0.9, 'triangle', 32);
      if (big) tone(90, 0.5, 0.7, 'sine', 28, 0.03);
    },
    click() { // 틱 (공포탄)
      tone(2200, 0.03, 0.25, 'square', 1300);
      noise(0.03, 0.25, 4000, 0, 'highpass');
    },
    clang() { // 방패
      tone(1250, 0.28, 0.3, 'triangle', 940);
      tone(1870, 0.22, 0.18, 'sine', 1800);
    },
    ping() { // 거울
      tone(1400, 0.16, 0.25, 'sine', 2600);
      tone(2100, 0.2, 0.15, 'sine', 3200, 0.07);
    },
    card() { tone(660, 0.07, 0.16, 'triangle', 1040); },
    turn() { tone(520, 0.08, 0.14, 'triangle', 780); tone(780, 0.1, 0.14, 'triangle', 1040, 0.09); },
    alarm() { tone(880, 0.09, 0.2, 'square', 880); tone(880, 0.09, 0.2, 'square', 880, 0.16); },
    aimed() { tone(330, 0.07, 0.16, 'square', 262); tone(262, 0.1, 0.16, 'square', 196, 0.08); }, // 총구가 나에게 왔다 (어…)
    // ✨ 증강: 등급이 높을수록 높고 반짝이게 · 공개
    pick(tier = 1) {
      const top = [784, 988, 1319][tier - 1] || 784;
      [523, 659, top].forEach((f, i) => tone(f, 0.12, 0.14, 'triangle', f, i * 0.09));
      if (tier === 3) [1568, 2093, 2637].forEach((f, i) => tone(f, 0.1, 0.08, 'sine', f, 0.32 + i * 0.06));
    },
    reveal() { tone(660, 0.1, 0.14, 'triangle', 990); tone(990, 0.16, 0.14, 'triangle', 1320, 0.1); },
    // 🎰 운명 카드: 시작 · 칸이 바늘을 지날 때 딸깍(느려질수록 낮게) · 멈춤
    fate() { [392, 523, 659].forEach((f, i) => tone(f, 0.08, 0.12, 'triangle', f * 1.5, i * 0.05)); },
    tick(k = 0) { tone(1800 - k * 700, 0.02, 0.12, 'square', 1100); },
    land() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 0.14, 'triangle', f, i * 0.06));
      noise(0.2, 0.15, 5000, 0, 'highpass');
    },
    reward() { [784, 1047].forEach((f, i) => tone(f, 0.12, 0.15, 'triangle', f, i * 0.08)); },
    revive() { tone(330, 0.5, 0.18, 'sine', 990); tone(495, 0.5, 0.12, 'triangle', 1485, 0.05); },
    final() { tone(196, 0.5, 0.25, 'sawtooth', 98); tone(147, 0.6, 0.2, 'square', 73, 0.12); },
    load() { for (let i = 0; i < 4; i++) { tone(1100 - i * 90, 0.03, 0.16, 'square', 600, i * 0.09); noise(0.03, 0.2, 3000, i * 0.09, 'highpass'); } },
    dead() { tone(420, 0.7, 0.28, 'sawtooth', 70); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 0.16, 'triangle', f, i * 0.12)); },
    heart(on) { // 두근두근 (결과를 기다리는 동안)
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
