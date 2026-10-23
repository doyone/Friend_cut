import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrack, newCar, stepCar, locate, pointAt, drive, SURF, LAPS } from '../js/games/race-core.js';
import game, { useKartMaps } from '../js/games/race.js';
// 이 파일은 예전 와이드 8자 트랙 좌표로 시험한다 (게임은 원래 경기마다 다른 맵)
useKartMaps(['wide']);

const T = buildTrack();

test('트랙: 한 바퀴 약 600m, 지름길 다리가 눈길보다 짧고, 8자 교차에서 다른 층을 잡지 않음', () => {
  assert.ok(T.main.len > 550 && T.main.len < 750, `한 바퀴 ${T.main.len}`);
  assert.ok(T.branch.len < T.branch.to - T.branch.from);
  // 출발 직선(아래층)의 교차점에서 찾으면 아래층, 고가 다리(위층)에서 찾으면 위층
  const under = T.main.pts.find(p => p.sec === 0 && Math.hypot(p.x - T.cross.x, p.y - T.cross.y) < 1.2);
  const over = T.main.pts.find(p => p.sec === 4 && Math.hypot(p.x - T.cross.x, p.y - T.cross.y) < 1.2);
  assert.ok(under && over);
  const i0 = T.main.pts.indexOf(under);
  const i1 = T.main.pts.indexOf(over);
  assert.equal(T.main.pts[locate(T, { path: 'main', seg: i0 }, T.cross.x, T.cross.y).seg].sec, 0);
  assert.equal(T.main.pts[locate(T, { path: 'main', seg: i1 }, T.cross.x, T.cross.y).seg].layer, 1);
});

test('물리: 길 밖(물)으로 나가면 풍덩, 1.2초 뒤 다시 섬', () => {
  const car = newCar(T);
  const p = pointAt(T.main, 60);
  Object.assign(car, { x: p.x, y: p.y, seg: p.i, s: 60, ms: 60 });
  let t = 0;
  let ev = [];
  for (let i = 0; i < 120 && !ev.includes('splash'); i++) {
    t += 1000 / 60;
    ev = stepCar(T, car, { x: -p.ty, y: p.tx }, 1 / 60, t); // 옆으로 계속
  }
  assert.ok(ev.includes('splash'));
  let back = [];
  for (let i = 0; i < 90 && !back.includes('respawn'); i++) {
    t += 1000 / 60;
    back = stepCar(T, car, null, 1 / 60, t);
  }
  assert.ok(back.includes('respawn'));
  assert.ok(Math.abs(locate(T, car, car.x, car.y).lat) < 0.5, '가운데 선에서 다시 섬');
});

test('물리: 점프대는 빠르면 건너고 느리면 빠짐', () => {
  for (const [speed, want] of [[18, 'land'], [8, 'splash']]) {
    const car = newCar(T);
    const p = pointAt(T.main, T.jump.ramp - 6);
    Object.assign(car, { x: p.x, y: p.y, seg: p.i, s: p.s, ms: p.s, vx: p.tx * speed, vy: p.ty * speed });
    const seen = [];
    let t = 0;
    for (let i = 0; i < 120; i++) {
      t += 1000 / 60;
      // 빠른 차는 앞으로 계속 밀고, 느린 차는 손 떼고 굴러감
      seen.push(...stepCar(T, car, speed > 12 && !car.air ? { x: p.tx, y: p.ty } : null, 1 / 60, t));
      if (seen.includes(want)) break;
    }
    assert.ok(seen.includes(want), `${speed}m/s → ${seen.join(',')}`);
  }
});

test('조향: 빠를 때 확 꺾으면 바깥으로 밀리고 꼬리가 빠짐, 느리면 그냥 꺾임, 반대 방향은 몸통 그대로 브레이크', () => {
  // 오른쪽(+x)으로 달리다가 아래(+y)를 1초 누름
  const turn = speed => {
    const car = { vx: speed, vy: 0, hx: 1, hy: 0, dr: 0 };
    let x = 0;
    let drift = false;
    let over = 0;
    for (let i = 0; i < 60; i++) {
      drive(car, { x: 0, y: 1 }, SURF.ice, 1 / 60);
      x += car.vx / 60;
      drift ||= !!car.dr;
      over = Math.max(over, Math.atan2(car.hy, car.hx) - Math.PI / 2);
    }
    return { x, drift, over };
  };
  const fast = turn(21);
  const slow = turn(10);
  assert.ok(fast.drift && fast.over > 0.1, `빠르면 몸통이 누른 방향보다 더 돈다 (${fast.over})`);
  assert.ok(!slow.drift && slow.over < 0.02);
  assert.ok(fast.x > slow.x * 1.5, `빠르면 원래 가던 쪽으로 더 밀림 ${fast.x} vs ${slow.x}`);
  const car = { vx: 20, vy: 0, hx: 1, hy: 0, dr: 0 };
  for (let i = 0; i < 20; i++) drive(car, { x: -1, y: 0 }, SURF.ice, 1 / 60);
  assert.ok(car.vx > 0 && car.vx < 10, `브레이크 ${car.vx}`);
  assert.equal(car.hx, 1);
});

function race(n, humans = 0) {
  let now = 10000;
  const roster = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `봇${i}`, bot: i >= humans }));
  const ctx = { roster, secret: {}, now: () => now, isOnline: () => true, nameOf: id => id, announce() {}, kill() {} };
  ctx.state = { ...game.setup(ctx), roster };
  return { ctx, step(ms = 100) { now += ms; game.tick(ctx); }, now: () => now };
}

test('봇끼리 3경기: 매번 출발선을 초기화하고 합산 점수로 등수', () => {
  const r = race(4);
  while (!r.ctx.state.over && r.now() < 10000 + 400000) r.step();
  const S = r.ctx.state;
  assert.ok(S.over);
  const fins = S.order.map(id => S.cars[id].fin).filter(Boolean);
  assert.ok(fins.length >= 1);
  assert.equal(S.round, 3);
  assert.equal(S.roundResults.length, 3);
  assert.deepEqual(S.order.map(id => S.points[id]), S.order.map(id => S.points[id]).sort((a,b) => b-a));
  assert.ok(fins[0] > 18000 && fins[0] < 45000, `1등 ${fins[0]}ms`);
  assert.ok(S.titles[S.order[0]].some(t => t.startsWith('🏁 우승')));
  for (const id of S.order.filter(x => S.cars[x].fin)) assert.equal(S.cars[id].lap, LAPS);
});

test('체크포인트: 결승선만 왕복하면 완주할 수 없고 코스 전체를 지나야 한다', () => {
  const track = buildTrack(true);
  const r = race(2, 2);
  while (r.ctx.state.phase !== 'race') r.step(50);
  const S = r.ctx.state;
  const c = S.cars.p0;
  // Move the other kart away. Fixture changes the authoritative host state, never client position messages.
  const away = pointAt(track.main, 100);
  Object.assign(S.cars.p1, {x:away.x,y:away.y,seg:away.i,s:away.s,ms:away.s});
  const position = s => {
    const p = pointAt(track.main,s);
    Object.assign(c,{x:p.x,y:p.y,seg:p.i,s:p.s,ms:p.s,vx:p.tx*20,vy:p.ty*20,hx:p.tx,hy:p.ty});
  };
  position(track.main.len-.1);
  r.step(50);
  assert.equal(c.lap,0,'crossing only the finish line is insufficient');
  assert.equal(c.fin,undefined);
  for(let i=1;i<track.secStart.length;i++) {
    position(track.secStart[i]-.1);
    r.step(50);
    assert.equal(c.cp,i,`checkpoint ${i}`);
  }
  position(track.main.len-.1);
  r.step(50);
  assert.equal(c.lap,1);
  assert.ok(c.fin>0);
});


test('체크포인트 바로 앞(0.01m 반올림 안)에서 멈춘 걸음 뒤에도 통과를 놓치지 않는다', () => {
  const track = buildTrack(true);
  const r2 = v => Math.round(v * 100) / 100;
  // 저장값(0.01m 반올림)이 체크포인트를 넘어서는데 실제로는 아직 못 지난 자리가 있는 체크포인트
  const i = track.secStart.findIndex((s, k) => k > 0 && r2(s - 0.001) >= s);
  assert.ok(i > 0, 'the legacy track has such a checkpoint');
  const r = race(2, 2);
  while (r.ctx.state.phase !== 'race') r.step(50);
  const S = r.ctx.state;
  const c = S.cars.p0;
  const away = pointAt(track.main, 100 + track.secStart[i]);
  Object.assign(S.cars.p1, { x: away.x, y: away.y, seg: away.i, s: away.s, ms: away.s });
  const place = (s, v) => {
    const p = pointAt(track.main, s);
    Object.assign(c, { x: p.x, y: p.y, seg: p.i, s: p.s, vx: p.tx * v, vy: p.ty * v, hx: p.tx, hy: p.ty });
  };
  Object.assign(c, { cp: i - 1, ms: r2(track.secStart[i] - 2) });
  place(track.secStart[i] - 0.001, 0);
  r.step(50);
  place(track.secStart[i] + 0.5, 0);
  r.step(50);
  assert.equal(c.cp, i);
});

test('카트 서킷은 확장된 본선과 아스팔트 지름길이 있고 위험 장치가 없다', () => {
  const track = buildTrack(true);
  assert.ok(track.main.len > 500 && track.main.len < 650);
  assert.ok(track.main.pts.every(p => p.walls === 'both' && p.surface === 'asphalt'));
  assert.ok(track.branch.pts.every(p => p.walls === 'both' && p.surface === 'asphalt'));
  assert.ok(track.branch.len < track.branch.to - track.branch.from);
  assert.equal(track.gates.length + track.oil.length + track.boosts.length, 0);
});

test('드리프트: 직선 유지로는 충전 안 되고, 코너 충전 후 놓으면 부스트', () => {
  const car = { vx: 18, vy: 0, hx: 1, hy: 0, dr: 0 };
  for (let i=0;i<120;i++) drive(car, {throttle:1,steer:0,brake:false,drift:true}, SURF.asphalt, 1/60);
  assert.equal(car.charge, 0);
  let maxCharge = 0;
  for (let i=0;i<150;i++) {
    drive(car, {throttle:1,steer:.65,brake:false,drift:true}, SURF.asphalt, 1/60);
    maxCharge = Math.max(maxCharge,car.charge);
  }
  assert.ok(maxCharge >= 1.15, `charge ${maxCharge}`);
  drive(car, {throttle:1,steer:0,brake:false,drift:false}, SURF.asphalt, 1/60);
  assert.ok(car.boostLeft > 1);
  assert.equal(car.charge, 0);
  for(let i=0;i<15;i++) drive(car,{throttle:1,steer:0,brake:false,drift:false},SURF.asphalt,1/60);
  assert.ok(Math.hypot(car.vx,car.vy)>23);
});

test('이전 라운드 입력은 무시하고 45초 제한으로 잠수해도 세 경기가 끝난다', () => {
  const r = race(2,2);
  while(r.ctx.state.phase !== 'race') r.step();
  const S=r.ctx.state;
  const c=S.cars.p0;
  assert.equal(game.onInput(r.ctx,{pid:'p0',type:'drive',data:{round:0,seq:1,throttle:1,steer:0,brake:false,drift:false}}),false);
  while(!S.over && r.now()<200000) r.step(1000);
  assert.equal(S.over,true);
  assert.equal(S.roundResults.length,3);
  assert.equal(S.points.p0,0);
});
