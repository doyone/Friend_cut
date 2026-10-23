// Draw every kart at the same simulation time. The host remains authoritative;
// this world only replays controls between its snapshots and never mutates them.
import { newCar, stepCar, resolveKartContacts } from './race-core.js';

const STEP = 1 / 60;
const STEP_MS = STEP * 1000;
const REPLAY_MS = 200;
const INPUT_LEASE = 600;
const HISTORY_MS = 2000;
const ANGULAR_SETTLE_MS = 65;
const neutral = () => ({ throttle: 0, steer: 0, brake: false, drift: false });
const angularDifference = (a, b) => Math.atan2(a.hx * b.hy - a.hy * b.hx, a.hx * b.hx + a.hy * b.hy);
const sameInput = (a, b) => a.throttle === b.throttle && a.steer === b.steer && a.brake === b.brake && a.drift === b.drift;
function rotateHeading(car, angle) {
  const c = Math.cos(angle), s = Math.sin(angle), hx = car.hx;
  car.hx = hx * c - car.hy * s;
  car.hy = hx * s + car.hy * c;
  car.h = Math.atan2(car.hy, car.hx);
}
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
  let ownAuthority = null;
  let heldAngularSeq = null;
  let angularCorrection = null;

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

  function controls(id, t) {
    if (t < startAt) return null;
    if (id === me) return ownInputAt(t);
    const input = intents.get(id);
    if (!input || t - input.at > INPUT_LEASE) return null;
    return input;
  }

  function pendingChange(source, at, now) {
    // Receipt acknowledgement can precede the physics step that consumes it.
    const ack = (source.seq || 0) - (source.inputAt > at ? 1 : 0);
    let previous = neutral();
    for (const entry of history) {
      const changed = !sameInput(previous, entry);
      previous = entry;
      if (changed && Number.isSafeInteger(entry.seq) && entry.seq > ack && entry.t <= now) return entry;
    }
    return null;
  }

  function decayAngle(car, correction, dt) {
    const wanted = correction.angle * (1 - Math.exp(-dt * 1000 / ANGULAR_SETTLE_MS));
    const delta = Math.max(-.03, Math.min(.03, wanted));
    rotateHeading(car, -delta);
    correction.angle -= delta;
  }

  function projectOwn(car, from, until, correction) {
    const projected = copy(car);
    const easing = correction ? { ...correction } : null;
    for (let at = from; at < until - .00001;) {
      const dt = Math.min(STEP_MS, until - at) / 1000;
      at += dt * 1000;
      const input = controls(me, at);
      if (!input) { projected.charge = 0; projected.driftHeld = false; }
      stepCar(T, projected, input, dt, at);
      if (easing) decayAngle(projected, easing, dt);
    }
    return projected;
  }

  function preserveAngularProgress(source, old, oldAt, oldCorrection, now) {
    const current = cars.get(me);
    if (!source || !old || !current || phase !== 'race') return;
    const pending = pendingChange(source, snapshotAt, now);
    const safe = oldAt >= snapshotAt - .00001 && oldAt <= physicsAt + .00001 && physicsAt - oldAt <= REPLAY_MS
      && !source.sp && !source.air && !source.fin && !old.sp && !old.air && !old.fin
      && !(current.impactLeft > .001) && !(old.impactLeft > .001)
      && (source.hitAt || 0) <= (ownAuthority?.hitAt || 0)
      && (source.sp || 0) === (ownAuthority?.sp || 0) && (source.air || 0) === (ownAuthority?.air || 0)
      && (source.impactLeft || 0) <= (ownAuthority?.impactLeft || 0) + .03
      && Math.hypot(old.x - current.x, old.y - current.y) < 3;
    if (!safe || pending && now - pending.t > REPLAY_MS) { heldAngularSeq = null; return; }
    const projected = projectOwn(old, oldAt, physicsAt, oldCorrection);
    const difference = angularDifference(current, projected);
    if (projected.sp || projected.air || Math.abs(difference) > .5) { heldAngularSeq = null; return; }
    if (pending) {
      for (const field of ['hx', 'hy', 'yawRate', 'steer', 'steerInput', 'driftSide']) current[field] = projected[field] ?? 0;
      heldAngularSeq = pending.seq;
    } else if (heldAngularSeq !== null || oldCorrection) {
      rotateHeading(current, difference);
      angularCorrection = { angle: difference };
      heldAngularSeq = null;
    } else return;
    current.h = Math.atan2(current.hy, current.hx);
    // Rotation changes the capsule too; the displayed world must still obey
    // contacts rather than protecting local input by drawing through a peer.
    resolveKartContacts(T, roster.map(({ id }) => ({ id, car: cars.get(id) })), STEP);
    if (current.impactLeft > .001) { heldAngularSeq = null; angularCorrection = null; }
  }

  function simulate(at) {
    const entries = [];
    const events = [];
    for (const { id } of roster) {
      const car = cars.get(id);
      if (!car || car.fin) continue;
      const prev = { x: car.x, y: car.y, hx: car.hx, hy: car.hy };
      const input = controls(id, at);
      // An expired control must not turn an old charged drift into a boost.
      if (!input) { car.charge = 0; car.driftHeld = false; }
      const ev = stepCar(T, car, input, STEP, at);
      if (id === me && angularCorrection) {
        if (car.sp || car.air || car.fin || car.impactLeft > .001) angularCorrection = null;
        else {
          decayAngle(car, angularCorrection, STEP);
          if (Math.abs(angularCorrection.angle) < .0001) angularCorrection = null;
        }
      }
      if (id === me) events.push(...ev);
      entries.push({ id, car, prev });
    }
    const impacts = resolveKartContacts(T, entries, STEP);
    if (impacts.some(hit => hit.a === me || hit.b === me)) { heldAngularSeq = null; angularCorrection = null; }
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
    // 'ready'도 돌린다: 초록불(startAt)이 켜지는 순간 방장 신호를 기다리지 않고 바로 출발 (그 전엔 controls가 null이라 그대로 서 있음)
    if (!['ready', 'race'].includes(phase) || !Number.isFinite(physicsAt) || !Number.isFinite(until) || until <= physicsAt) return result;
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
    ownAuthority = null; heldAngularSeq = null; angularCorrection = null;
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
    ownAuthority = copy(state.cars?.[me] || null);
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
    const previousOwn = copy(cars.get(me));
    const previousAt = physicsAt;
    const previousCorrection = angularCorrection;
    angularCorrection = null;
    phase = state.phase;
    startAt = state.startAt || 0;
    snapshotAt = physicsAt = at;
    lastSeq = Math.max(lastSeq, state.cars?.[me]?.seq || 0);
    readCars(state);
    advanceTo(now);
    preserveAngularProgress(state.cars?.[me], previousOwn, previousAt, previousCorrection, now);
    ownAuthority = copy(state.cars?.[me] || null);
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
