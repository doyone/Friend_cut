// 주사위 합 효과음: 파일 없이 그 자리에서 만든다. 첫 키 입력·클릭 뒤부터 소리가 난다.
import { store } from '../util.js';

const PENTA = [523, 587, 659, 784, 880, 1047, 1175, 1319, 1568, 1760]; // 도 레 미 솔 라, 두 옥타브
const semi = (n) => Math.pow(2, n / 12);

export function createDiceAudio() {
  let enabled = store.get('dice-sound', true);
  let ctx = null;
  let master = null;   // 0.4 → 압축기 → 스피커
  let fx = null;       // 보통 소리 (duck 걸림)
  let focus = null;    // 심장 · 느린 구르기처럼 duck 때도 들려야 하는 소리
  let bedBus = null;   // 바탕음 (duck 걸림)
  let hiss = null;     // 잡음 버퍼 (한 번만)
  let bed = null;      // 바탕음 노드 한 벌
  let bedLevel = 0;
  let ducked = false;
  let heartOn = false;
  let heartRate = 1;
  let beat = null;
  let disposed = false;
  let route = null;    // 잠깐 다른 줄로 보낼 때
  const ok = () => ctx && enabled && !disposed && ctx.state === 'running' && !document.hidden;
  const out = () => route || fx;

  // 값을 dur초에 걸쳐 부드럽게 옮긴다
  function glide(param, value, dur) {
    const now = ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + dur);
  }

  function tone(freq, dur, vol, type = 'sine', end = freq, delay = 0) {
    if (!ok()) return;
    const at = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), at + dur);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain);
    gain.connect(out());
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  // o: { delay, kind, to(끝 주파수), q, swell(가운데서 제일 크게) }
  function noise(dur, vol, cutoff = 3000, o = {}) {
    if (!ok()) return;
    const at = ctx.currentTime + (o.delay || 0);
    if (!hiss) {
      hiss = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = hiss.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = hiss;
    src.loop = dur > 0.9;
    filter.type = o.kind || 'lowpass';
    filter.frequency.setValueAtTime(cutoff, at);
    if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, at + dur);
    if (o.q) filter.Q.value = o.q;
    const v = Math.max(0.0001, vol);
    if (o.swell) {
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(v, at + dur * o.swell);
    } else {
      gain.gain.setValueAtTime(v, at);
    }
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(out());
    src.onended = () => { src.disconnect(); filter.disconnect(); gain.disconnect(); };
    src.start(at, src.loop ? 0 : Math.random() * 0.5);
    src.stop(at + dur + 0.02);
  }

  const via = (bus, fn) => { route = bus; try { fn(); } finally { route = null; } };

  async function unlock() {
    if (!enabled || disposed) return;
    try {
      if (!ctx) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        ctx = new Audio();
        const comp = ctx.createDynamicsCompressor();
        master = ctx.createGain();
        master.gain.value = 0.4;
        master.connect(comp);
        comp.connect(ctx.destination);
        fx = ctx.createGain();
        focus = ctx.createGain();
        bedBus = ctx.createGain();
        fx.connect(master);
        focus.connect(master);
        bedBus.connect(master);
      }
      if (ctx.state === 'suspended' && !document.hidden) await ctx.resume();
      if (heartOn) startBeat();
    } catch { /* 소리가 안 나도 게임은 계속 */ }
  }

  // 바탕음: 살짝 어긋난 톱니파 둘 → lowpass → 느린 맥박 → 음량
  function makeBed() {
    const a = ctx.createOscillator();
    const b = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const pulse = ctx.createGain();
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    const vol = ctx.createGain();
    a.type = 'sawtooth';
    b.type = 'sawtooth';
    a.frequency.value = 55;
    b.frequency.value = 55;
    a.detune.value = -8;
    b.detune.value = 8;
    filter.type = 'lowpass';
    filter.frequency.value = 220;
    filter.Q.value = 4;
    pulse.gain.value = 0.7;
    lfo.frequency.value = 0.6;
    depth.gain.value = 0.3;
    vol.gain.value = 0;
    a.connect(filter);
    b.connect(filter);
    filter.connect(pulse);
    lfo.connect(depth);
    depth.connect(pulse.gain);
    pulse.connect(vol);
    vol.connect(bedBus);
    a.start();
    b.start();
    lfo.start();
    bed = { a, b, filter, lfo, vol, nodes: [a, b, filter, pulse, lfo, depth, vol] };
  }

  function thump() {
    if (!ok()) return;
    via(focus, () => {
      tone(60, 0.12, 0.6, 'sine', 44);
      tone(60, 0.12, 0.45, 'sine', 42, 0.18);
    });
  }

  function startBeat() {
    clearInterval(beat);
    beat = null;
    if (!heartOn || !enabled || disposed || document.hidden) return;
    thump();
    beat = setInterval(thump, 1000 / (1.6 * heartRate));
  }

  function stopBeat() {
    clearInterval(beat);
    beat = null;
  }

  // 탭을 가리면 반복 · 바탕음을 멈추고, 돌아오면 다시
  function onVisible() {
    if (!ctx || disposed) return;
    if (document.hidden) {
      stopBeat();
      void ctx.suspend().catch(() => {});
    } else if (enabled) {
      void ctx.resume().then(() => { if (heartOn) startBeat(); }).catch(() => {});
    }
  }
  document.addEventListener('visibilitychange', onVisible);

  // 북: 합이 클수록 반음씩 높게
  const drumHit = (f, delay = 0, vol = 0.7) => { tone(f, 0.26, vol, 'sine', f * 0.41, delay); noise(0.09, vol * 0.45, 700, { delay }); };

  // 함성: 800 Hz 언저리 잡음이 커졌다 줄어듦
  const crowd = (dur, vol, delay = 0) => {
    noise(dur, vol, 800, { kind: 'bandpass', q: 0.8, swell: 0.35, delay });
    noise(dur * 0.9, vol * 0.5, 1400, { kind: 'bandpass', q: 1.2, swell: 0.4, delay: delay + 0.05 });
  };

  return {
    get enabled() { return enabled; },
    unlock,
    toggle() {
      enabled = !enabled;
      store.set('dice-sound', enabled);
      if (master) master.gain.value = enabled ? 0.4 : 0;
      if (enabled) void unlock();
      else stopBeat();
      return enabled;
    },

    // ── 바탕 ──
    bed(level = 0) {
      const lv = Math.max(0, Math.min(1, Number(level) || 0));
      if (lv === bedLevel && (bed || lv === 0)) return;
      bedLevel = lv;
      if (!ctx || disposed) return;
      if (!bed) {
        if (lv === 0) return;
        makeBed();
      }
      const f = 55 * semi(Math.round(lv * 7)); // 반음씩 오름
      glide(bed.a.frequency, f, 0.3);
      glide(bed.b.frequency, f, 0.3);
      glide(bed.filter.frequency, 220 + lv * 1800, 0.3);
      glide(bed.lfo.frequency, 0.6 + lv * 2.6, 0.3);
      glide(bed.vol.gain, lv * 0.32, 0.3);
    },
    heart(on, rate = 1) {
      heartOn = !!on;
      if (!heartOn) { stopBeat(); return; }
      const r = Math.max(0.3, Number(rate) || 1);
      if (beat && r === heartRate) return;
      heartRate = r;
      startBeat();
    },
    duck(on) {
      ducked = !!on;
      if (!ctx || disposed) return;
      glide(fx.gain, ducked ? 0.18 : 1, 0.15);
      glide(bedBus.gain, ducked ? 0.12 : 1, 0.15);
    },

    // ── 대면 · 내기 ──
    whoosh() { noise(0.35, 0.5, 400, { kind: 'bandpass', to: 2400, q: 1.5, swell: 0.6 }); },
    slam() {
      noise(0.08, 0.6, 1200);
      tone(120, 0.18, 0.7, 'triangle', 50);
      tone(1100, 0.05, 0.12, 'square', 600);
    },
    chip(n = 1) {
      const k = Math.max(1, Math.min(8, n | 0));
      for (let i = 0; i < k; i++) {
        const d = i * 0.07;
        tone(2600 + Math.random() * 900, 0.06, 0.16, 'sine', 2400, d);
        tone(3900, 0.04, 0.06, 'sine', 3700, d + 0.01);
      }
    },
    tick() { tone(1500, 0.02, 0.08, 'square', 1100); },
    betLock() {
      noise(0.04, 0.4, 2500, { kind: 'highpass' });
      tone(880, 0.06, 0.18, 'square', 660);
      [523, 784, 1047].forEach((f, i) => tone(f, 0.12, 0.14, 'triangle', f, 0.06 + i * 0.05));
    },
    count(n = 3) { // 3 · 2 · 1, 1이 제일 날카롭게
      const f = { 3: 660, 2: 880, 1: 1320 }[n] || 660;
      tone(f, n === 1 ? 0.14 : 0.08, n === 1 ? 0.26 : 0.16, 'square', f);
      if (n === 1) noise(0.05, 0.25, 4000, { kind: 'highpass' });
    },

    // ── 합 ──
    drum(no = 1) {
      const f = 98 * semi(Math.max(0, no - 1));
      drumHit(f, 0, 0.8);
      if (no >= 3) drumHit(f, 0.16, 0.65);
    },
    roll(n = 1) { // 달그락
      const k = Math.max(1, Math.min(4, n | 0));
      for (let d = 0; d < k; d++) {
        const hits = 5 + Math.floor(Math.random() * 3);
        let t = Math.random() * 0.05;
        for (let i = 0; i < hits; i++) {
          noise(0.02, 0.22, 2000 + Math.random() * 2000, { kind: 'bandpass', q: 3, delay: t });
          t += 0.03 + Math.random() * 0.07;
        }
      }
    },
    land(v = 1, max = 6, i = 0) { // 톡 + 눈 높이만큼 오르는 음
      const run = () => {
        const r = max > 1 ? (v - 1) / (max - 1) : 1;
        const f = PENTA[Math.round(Math.max(0, Math.min(1, r)) * (PENTA.length - 1))];
        const lift = 1 + 0.06 * Math.min(4, i);
        tone(120, 0.05, 0.3 * lift, 'sine', 80);
        tone(f, 0.08, 0.1 * lift, 'triangle', f);
      };
      if (ducked) via(focus, run); else run(); // 결정적 주사위는 duck 중에도 또렷하게
    },
    maxFace() {
      [1047, 1319, 1568].forEach((f, i) => tone(f, 0.3, 0.12, 'sine', f, i * 0.04));
      noise(0.12, 0.16, 8000, { kind: 'highpass', delay: 0.05 });
    },
    minFace() { tone(90, 0.15, 0.4, 'triangle', 60); },
    explode(k = 1) {
      noise(0.1, 0.6, 1800);
      const f = 300 * Math.pow(1.25, Math.max(0, k - 1));
      tone(f, 0.18, 0.25, 'sine', f * 1.6);
      tone(f * 1.5, 0.12, 0.1, 'triangle', f * 2.2, 0.05);
    },
    flame() {
      noise(0.25, 0.4, 300, { to: 3000 });
      tone(220, 0.3, 0.14, 'sawtooth', 880);
    },
    fizzle() {
      tone(440, 0.4, 0.2, 'sine', 110);
      noise(0.3, 0.15, 1200, { kind: 'highpass', swell: 0.2 });
    },
    lead() {
      noise(0.12, 0.3, 900, { kind: 'bandpass', to: 3200, q: 2 });
      tone(660, 0.08, 0.1, 'triangle', 990, 0.04);
    },
    slow() { // 결정적 주사위: 낮게 끄는 소리
      via(focus, () => {
        tone(110, 0.6, 0.22, 'sawtooth', 55);
        tone(82, 0.6, 0.25, 'sine', 41);
        noise(0.6, 0.15, 500, { to: 150 });
      });
    },
    clash(no = 1, margin = 3) { // 챙! 차이가 작을수록 크고 길게
      const k = margin <= 1 ? 1 : margin <= 2 ? 0.85 : margin <= 4 ? 0.65 : 0.5;
      const f = 660 * semi(Math.max(0, no - 1));
      const dur = 0.35 + 0.55 * k;
      noise(0.08, 0.7 * k + 0.2, 2000, { kind: 'highpass' });
      tone(f, dur, 0.32 * k, 'sine', f * 0.99);
      tone(f * 2.76, dur * 0.8, 0.16 * k, 'sine', f * 2.74);
      tone(f * 5.4, dur * 0.55, 0.08 * k, 'sine', f * 5.36);
      tone(140, 0.2, 0.5 * k, 'triangle', 55);
    },
    shatter() { // 유리 깨짐 + 쿵
      noise(0.15, 0.6, 3000, { kind: 'bandpass', q: 1.2 });
      for (let i = 0; i < 6; i++) {
        const f = 2000 + Math.random() * 4000;
        tone(f, 0.03, 0.12, 'square', f * 0.8, 0.01 + Math.random() * 0.14);
      }
      tone(70, 0.3, 0.8, 'sine', 35);
    },
    ember() { // 낮게 타닥
      for (let i = 0; i < 5; i++) noise(0.025, 0.25, 700, { delay: i * 0.06 + Math.random() * 0.03 });
      tone(80, 0.25, 0.15, 'sine', 60);
    },
    tie(streak = 1) { // 두 음이 맞물려 떨림
      const s = Math.max(1, Math.min(5, streak | 0));
      const up = semi(s - 1);
      const dur = Math.min(1, 0.4 + 0.15 * (s - 1));
      tone(1200 * up, dur, 0.08, 'square', 1200 * up);
      tone(1230 * up, dur, 0.08, 'square', 1230 * up);
      noise(0.06, 0.3, 3000, { kind: 'highpass' });
    },
    near() { // 아까운 하강 두 음
      tone(659, 0.12, 0.16, 'triangle', 622);
      tone(523, 0.22, 0.16, 'triangle', 466, 0.13);
    },
    swing(delta = 0) { // 승률이 그 방향으로 휙
      const d = Math.max(-1, Math.min(1, Number(delta) || 0));
      const up = d >= 0;
      const amt = 0.4 + Math.abs(d) * 0.6;
      noise(0.3, 0.35 * amt, up ? 500 : 3000, { kind: 'bandpass', to: up ? 3000 : 500, q: 2, swell: 0.5 });
      tone(up ? 330 : 660, 0.25, 0.1 * amt, 'triangle', up ? 660 : 330);
    },
    slice() { // 일섬: 날카롭게 베고 지나감
      noise(0.2, 0.5, 2500, { kind: 'highpass', to: 9000, swell: 0.25 });
      tone(1800, 0.14, 0.08, 'sawtooth', 5200);
    },
    quake() { // 내리찍기 충격파: 땅이 울림
      tone(55, 0.5, 0.9, 'sine', 30);
      noise(0.35, 0.6, 320, { to: 80 });
      tone(110, 0.25, 0.4, 'triangle', 45, 0.02);
    },
    thud() { // 어림없다: 둔하게 툭
      tone(72, 0.2, 0.6, 'triangle', 45);
      noise(0.08, 0.3, 260);
    },

    // ── 끝 ──
    win() {
      for (let i = 0; i < 4; i++) drumHit(110, i * 0.09, 0.6);
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 0.15, 'triangle', f, 0.36 + i * 0.1));
    },
    comeback() {
      crowd(1.2, 0.5);
      tone(220, 0.7, 0.14, 'sawtooth', 660);
      [587, 740, 880, 1175].forEach((f, i) => tone(f, 0.25, 0.15, 'triangle', f, 0.4 + i * 0.1));
    },
    miracle() { // 제일 크고 김 (2초 안)
      crowd(1.9, 0.7);
      drumHit(98, 0, 0.9);
      drumHit(98, 0.12, 0.8);
      [392, 523, 659, 784].forEach((f, i) => tone(f, 0.18, 0.18, 'square', f, 0.15 + i * 0.12));
      [523, 659, 784, 1047].forEach((f) => tone(f, 1.1, 0.12, 'sawtooth', f * 1.005, 0.7));
      [1568, 2093, 2637, 3136].forEach((f, i) => tone(f, 0.15, 0.08, 'sine', f, 0.8 + i * 0.08));
      noise(0.4, 0.2, 7000, { kind: 'highpass', delay: 0.75 });
    },
    hit(k = 1, crit = false) {
      const f = 140 * semi(Math.max(0, k - 1));
      noise(0.12, crit ? 0.9 : 0.6, crit ? 2200 : 1400);
      tone(f, crit ? 0.28 : 0.18, crit ? 0.8 : 0.55, 'triangle', f * 0.35);
      if (crit) {
        noise(0.15, 0.4, 5000, { kind: 'highpass' });
        tone(2400, 0.25, 0.1, 'square', 2300);
        tone(70, 0.35, 0.6, 'sine', 30, 0.02);
      }
    },
    coins(n = 5) {
      const k = Math.max(1, Math.min(20, n | 0));
      for (let i = 0; i < k; i++) tone(2000 + Math.random() * 3000, 0.05, 0.1, 'sine', 1900 + Math.random() * 2500, i * 0.04);
      noise(0.18, 0.35, 1500, { kind: 'highpass', delay: k * 0.04 });
    },
    cheer(level = 0.5) {
      const lv = Math.max(0.1, Math.min(1, Number(level) || 0.5));
      crowd(0.8 * (0.6 + lv * 0.6), 0.25 + lv * 0.45);
    },
    gasp() { noise(0.28, 0.3, 1200, { kind: 'highpass', to: 3500, swell: 0.85 }); },
    jackpot() {
      [1047, 1319, 1568, 2093].forEach((f, i) => tone(f, 0.45, 0.16, 'triangle', f, i * 0.07));
      tone(2093, 0.8, 0.12, 'sine', 2093, 0.3);
      for (let i = 0; i < 14; i++) tone(2500 + Math.random() * 2500, 0.05, 0.08, 'sine', 2600, 0.3 + i * 0.04);
      crowd(1.1, 0.4, 0.1);
    },
    lose() { // 짧은 하강, 우울하지 않게
      tone(659, 0.1, 0.14, 'triangle', 622);
      tone(494, 0.18, 0.14, 'triangle', 440, 0.11);
    },

    dispose() {
      disposed = true;
      heartOn = false;
      stopBeat();
      document.removeEventListener('visibilitychange', onVisible);
      if (bed) {
        for (const n of bed.nodes) { try { if (n.stop) n.stop(); } catch { /* 이미 멈춤 */ } n.disconnect(); }
        bed = null;
      }
      if (ctx) void ctx.close().catch(() => {});
    },
  };
}
