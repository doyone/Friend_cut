// Draw every kart at the same simulation time. The host remains authoritative;
// this world only replays controls between its snapshots and never mutates them.
import { newCar, stepCar, resolveKartContacts } from './race-core.js';

const STEP = 1 / 60;
const STEP_MS = STEP * 1000;
const REPLAY_MS = 200;
const INPUT_LEASE = 600;
const HISTORY_MS = 2000;
const neutral = () => ({ throttle: 0, steer: 0, brake: false, drift: false });
const copy = value => Array.isArray(value) ? value.map(copy)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)])) : value;

export function createRacePrediction(T, me) {
  const cars = new Map();
  const intents = new Map();
  let key = null;
  let phase = null;
  let roster = [];
  let startAt = 0;
  let snapshotAt = -Infinity;
  let physicsAt = -Infinity;
  let history = [];
  let lastSeq = 0;

  function roundKey(state) {
    return `${state.run ?? ''}:${state.round ?? 0}`;
  }

  function snapshotTime(state, now) {
    if (Number.isFinite(state.worldAt)) return state.worldAt;
    const times = Object.values(state.cars || {}).map(c => c.t).filter(t => Number.isFinite(t) && t > 0);
    return times.length ? Math.max(...times) : state.phase === 'race' && Number.isFinite(state.startAt) ? state.startAt : now;
  }

  function readIntents(state) {
    intents.clear();
    for (const [id, c] of Object.entries(state.cars || {})) {
      intents.set(id, {
        throttle: Number.isFinite(c.throttle) ? c.throttle : 0,
        steer: Number.isFinite(c.steerIntent) ? c.steerIntent : 0,
        brake: !!c.braking,
        drift: !!c.held,
        at: Number.isFinite(c.inputAt) ? c.inputAt : 0,
        lockUntil: c.lockUntil || 0,
      });
    }
  }

  function readCars(state) {
    const ids = new Set(Object.keys(state.cars || {}));
    for (const id of cars.keys()) if (!ids.has(id)) cars.delete(id);
    for (const [id, source] of Object.entries(state.cars || {})) {
      // Keep the object reference stable while replacing every physics field.
      let car = cars.get(id);
      if (!car) cars.set(id, car = {});
      for (const field of Object.keys(car)) delete car[field];
      Object.assign(car, newCar(T), copy(source));
      if (!Number.isFinite(source.hx) || !Number.isFinite(source.hy)) {
        const h = Number.isFinite(source.h) ? source.h : Math.hypot(car.vx, car.vy) > .01 ? Math.atan2(car.vy, car.vx) : Math.atan2(car.hy, car.hx);
        car.hx = Math.cos(h); car.hy = Math.sin(h);
      }
    }
    roster = (state.roster || Object.keys(state.cars || {}).map(id => ({ id }))).map(p => ({ id: p.id, bot: !!p.bot }));
  }

  function ownInputAt(t) {
    let input = neutral();
    for (const entry of history) {
      if (entry.t > t) break;
      input = entry;
    }
    return input;
  }

  function controls(id, car, t) {
    if (t < Math.max(startAt, car.lockUntil || 0)) return null;
    if (id === me) return ownInputAt(t);
    const input = intents.get(id);
    if (!input || t - input.at > INPUT_LEASE || t < input.lockUntil) return null;
    return input;
  }

  function simulate(at) {
    const entries = [];
    const events = [];
    for (const { id } of roster) {
      const car = cars.get(id);
      if (!car || car.fin) continue;
      const prev = { x: car.x, y: car.y, hx: car.hx, hy: car.hy };
      const input = controls(id, car, at);
      // An expired control must not turn an old charged drift into a boost.
      if (!input) { car.charge = 0; car.driftHeld = false; }
      const ev = stepCar(T, car, input, STEP, at);
      if (id === me) events.push(...ev);
      entries.push({ id, car, prev });
    }
    const impacts = resolveKartContacts(T, entries, STEP);
    for (const { car } of entries) {
      car.t = at;
      car.h = Math.atan2(car.hy, car.hx);
      car.boost = car.boostLeft > 0 ? 1 : 0;
    }
    physicsAt = at;
    return { events, impacts };
  }

  function advanceTo(until) {
    const result = { events: [], impacts: [] };
    if (phase !== 'race' || !Number.isFinite(physicsAt) || !Number.isFinite(until) || until <= physicsAt) return result;
    // A suspended tab catches up at most 200ms, with the whole world moving
    // together. Absolute timestamps also prevent replay + the next local tick
    // from simulating the same interval twice.
    if (until - physicsAt > REPLAY_MS + .001) physicsAt = until - REPLAY_MS;
    while (physicsAt + STEP_MS <= until + .00001) {
      const next = simulate(physicsAt + STEP_MS);
      result.events.push(...next.events);
      result.impacts.push(...next.impacts);
    }
    return result;
  }

  function clear() {
    cars.clear(); intents.clear();
    key = phase = null; roster = [];
    startAt = 0; snapshotAt = physicsAt = -Infinity;
    history = []; lastSeq = 0;
  }

  function reset(state, now) {
    clear();
    key = roundKey(state);
    phase = state.phase;
    startAt = state.startAt || 0;
    snapshotAt = physicsAt = snapshotTime(state, now);
    lastSeq = state.cars?.[me]?.seq || 0;
    readIntents(state);
    readCars(state);
    advanceTo(now);
  }

  function sync(state, now) {
    if (!state || !Number.isFinite(now)) return false;
    if (key !== roundKey(state)) { reset(state, now); return true; }
    const at = snapshotTime(state, now);
    const phaseChanged = phase !== state.phase;
    // Inputs may be acknowledged between fixed physics steps. Refresh their
    // intent without overwriting the already predicted positions.
    if (at >= snapshotAt) readIntents(state);
    if (at < snapshotAt || at === snapshotAt && !phaseChanged) return false;
    phase = state.phase;
    startAt = state.startAt || 0;
    snapshotAt = physicsAt = at;
    lastSeq = Math.max(lastSeq, state.cars?.[me]?.seq || 0);
    readCars(state);
    advanceTo(now);
    return true;
  }

  function recordInput(input, t) {
    if (!input || !Number.isFinite(t) || !Number.isFinite(input.throttle) || input.throttle < 0 || input.throttle > 1 ||
        !Number.isFinite(input.steer) || input.steer < -1 || input.steer > 1 || typeof input.brake !== 'boolean' || typeof input.drift !== 'boolean') return false;
    if (input.seq !== undefined && (!Number.isSafeInteger(input.seq) || input.seq <= lastSeq)) return false;
    if (input.seq !== undefined) lastSeq = input.seq;
    const previousAt = history.at(-1)?.t ?? -Infinity;
    const at = Math.max(previousAt, t);
    history.push({ throttle: input.throttle, steer: input.steer, brake: input.brake, drift: input.drift, t: at, seq: input.seq });
    while (history.length > 1 && history[1].t < at - HISTORY_MS) history.shift();
    return true;
  }

  return {
    sync, reset, recordInput, clear,
    step(dt, t) {
      if (!Number.isFinite(dt) || dt <= 0) return { events: [], impacts: [] };
      return advanceTo(t);
    },
    car: id => cars.get(id),
    get time() { return Number.isFinite(physicsAt) ? physicsAt : null; },
  };
}
