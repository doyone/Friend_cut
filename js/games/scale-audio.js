// 피의 저울 효과음: 내려받는 파일 없이 그 자리에서 만든다. 브라우저 규칙 때문에 첫 키 입력 · 클릭 뒤부터 소리가 난다.
import { store } from '../util.js';

export function createScaleAudio() {
  let enabled = store.get('scale-sound', true);
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

  const thud = (delay = 0, vol = 0.6) => { tone(120, 0.16, vol, 'sine', 50, delay); noise(0.06, vol * 0.4, 800, delay); };
  function thump() {
    tone(68, 0.13, 0.5, 'sine', 40);
    tone(60, 0.12, 0.36, 'sine', 38, 0.17);
  }

  return {
    get enabled() { return enabled; },
    unlock,
    toggle() {
      enabled = !enabled;
      store.set('scale-sound', enabled);
      if (master) master.gain.value = enabled ? 0.4 : 0;
      if (enabled) void unlock();
      return enabled;
    },
    draw() { noise(0.07, 0.25, 4200, 0, 'highpass'); tone(700, 0.05, 0.08, 'triangle', 900, 0.03); },     // 카드 한 장
    hen() { tone(900, 0.06, 0.12, 'square', 1300); tone(1300, 0.08, 0.1, 'square', 800, 0.07); },        // 꼬꼬
    pick() { tone(520, 0.05, 0.12, 'triangle', 700); },                                                   // 카드 고르기
    unpick() { tone(420, 0.05, 0.1, 'triangle', 300); },
    mark() { tone(220, 0.08, 0.16, 'sawtooth', 160); noise(0.05, 0.2, 1200); },                           // 제물로 점찍기
    place() { thud(0, 0.7); },                                                                             // 판에 놓음
    sac() { noise(0.14, 0.5, 2400, 0, 'bandpass'); tone(160, 0.25, 0.4, 'sawtooth', 50, 0.04); },          // 제물: 칼 + 무너짐
    bell() { [1046, 1568, 2093].forEach((f, i) => tone(f, 0.9 - i * 0.2, 0.12 - i * 0.03, 'sine', f * 0.998, 0)); }, // 종
    deny() { tone(180, 0.12, 0.2, 'square', 120); },
    reveal() { thud(0, 0.9); thud(0.14, 0.6); },                                                           // 공개
    hit(big) { noise(big ? 0.24 : 0.14, 0.8, 1400); tone(big ? 110 : 150, big ? 0.26 : 0.16, 0.7, 'triangle', 40); },
    lunge() { noise(0.1, 0.4, 2600, 0, 'bandpass'); },
    die() { tone(260, 0.3, 0.3, 'sawtooth', 70); noise(0.3, 0.4, 900, 0.05); },                            // 생물이 죽음
    bone() { tone(1600, 0.04, 0.08, 'square', 1200); tone(1200, 0.05, 0.06, 'square', 900, 0.05); },      // 뼈 달그락
    direct(n = 1) { for (let i = 0; i < Math.min(n, 6); i++) tone(1900 - i * 90, 0.07, 0.12, 'triangle', 1500, i * 0.06); }, // 이빨이 저울에
    smoke() { noise(0.4, 0.3, 3000, 0, 'highpass'); },
    candle(mine) {                                                                                         // 촛불이 꺼짐
      noise(0.5, 0.6, 1800, 0, 'bandpass');
      tone(mine ? 140 : 220, 0.9, 0.4, 'sawtooth', mine ? 50 : 90, 0.05);
      if (mine) tone(98, 1.2, 0.3, 'square', 40, 0.2);
    },
    out() { tone(420, 0.8, 0.28, 'sawtooth', 60); noise(1.1, 0.6, 1000, 0.1); thud(0.05, 1); },
    move() { noise(0.12, 0.25, 3200, 0, 'bandpass'); },
    tool() { tone(880, 0.08, 0.14, 'triangle', 1320); noise(0.05, 0.2, 4000, 0.02, 'highpass'); },               // 도구
    grow() { [392, 523, 659].forEach((f, i) => tone(f, 0.12, 0.12, 'triangle', f * 1.1, i * 0.07)); },            // 자랐다
    road() { [523, 659, 784].forEach((f, i) => tone(f, 0.5, 0.1, 'sine', f, i * 0.12)); thud(0.05, 0.5); },     // 길목
    burn() { noise(0.7, 0.6, 1600, 0, 'bandpass'); tone(300, 0.6, 0.25, 'sawtooth', 80, 0.05); },              // 모닥불에 탔다
    soul() { tone(220, 1, 0.16, 'sine', 330); tone(277, 1, 0.12, 'sine', 415, 0.15); tone(330, 1.2, 0.1, 'sine', 494, 0.3); }, // 넋패
    moon() { tone(110, 1.2, 0.3, 'sawtooth', 55); tone(165, 1.2, 0.18, 'square', 82, 0.1); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 0.16, 'triangle', f, i * 0.12)); },
    heart(on) { // 두근두근: 내 촛불이 꺼지기 직전
      if (!on) {
        clearInterval(beat);
        beat = null;
      } else if (!beat) {
        thump();
        beat = setInterval(thump, 640);
      }
    },
    dispose() {
      disposed = true;
      clearInterval(beat);
      if (ctx) void ctx.close().catch(() => {});
    },
  };
}
