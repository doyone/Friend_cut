// Small synthesized score/effects. No downloads; starts only after a user gesture.
import { store } from '../util.js';

export function createBumperAudio() {
  let enabled = store.get('bumper-sound', true), ctx, master, timer, disposed = false;
  let active = false, duel = false, nextBeat = 0, beat = 0, lastImpact = -1;
  function tone(freq, duration, volume, type = 'sine', end = freq, at = ctx?.currentTime) {
    if (!ctx || !enabled || disposed || ctx.state !== 'running' || document.hidden) return;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), at + duration);
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + .008);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    osc.connect(gain); gain.connect(master);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    osc.start(at); osc.stop(at + duration + .02);
  }
  function music() {
    if (!active || !ctx || ctx.state !== 'running' || !enabled || document.hidden) { nextBeat = 0; return; }
    const now = ctx.currentTime;
    if (!nextBeat || nextBeat < now - .2) nextBeat = now + .03;
    if (nextBeat > now + .12) return;
    const melody = duel ? [110, 165, 146.83, 164.81, 110, 220, 164.81, 146.83] : [110, 0, 130.81, 0, 146.83, 0, 130.81, 0];
    const note = melody[beat % melody.length];
    tone(100, .13, .10, 'sine', 35, nextBeat);
    if (note) tone(note, .16, .035, 'triangle', note, nextBeat);
    if (duel && beat % 2) tone(880, .04, .018, 'triangle', 330, nextBeat);
    beat++; nextBeat += 60 / (duel ? 144 : 96);
  }
  async function unlock() {
    if (!enabled || disposed) return;
    try {
      if (!ctx) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return;
        ctx = new Audio(); master = ctx.createGain(); master.gain.value = .42; master.connect(ctx.destination);
        timer = setInterval(music, 75);
      }
      if (ctx.state === 'suspended') await ctx.resume();
    } catch { /* Browser audio restrictions must never interrupt the game. */ }
  }
  return {
    get enabled() { return enabled; },
    unlock,
    toggle() {
      enabled = !enabled; store.set('bumper-sound', enabled);
      if (master) master.gain.value = enabled ? .42 : 0;
      if (enabled) void unlock();
      return enabled;
    },
    mode(playing, isDuel) {
      if (duel !== !!isDuel || active !== !!playing) nextBeat = 0;
      active = !!playing; duel = !!isDuel;
    },
    impact(clash, personal) {
      if (!ctx || ctx.currentTime - lastImpact < .10) return;
      lastImpact = ctx.currentTime;
      tone(clash ? 145 : 100, clash ? .32 : .18, personal ? .8 : .26, 'triangle', 28);
      tone(clash ? 580 : 310, .07, personal ? .13 : .05, 'square', 80);
    },
    ready() { tone(660, .10, .09, 'triangle', 990); },
    skid() { tone(1150, .24, .05, 'triangle', 880); },
    rumble() { tone(75, .07, .05, 'square', 60); },
    duel() {
      if (!ctx) return;
      for (let i = 0; i < 3; i++) tone([220, 330, 440][i], .14, .13, 'triangle', [220, 330, 440][i], ctx.currentTime + i * .12);
    },
    dispose() { disposed = true; clearInterval(timer); if (ctx) void ctx.close().catch(() => {}); },
  };
}
