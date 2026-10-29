'use strict';
/* Neural Lab v67 — Terrarium core headless tests (node). */
const T = require('/home/hatch/workspace/neural-lab/www/terrarium-core.js');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }

/* ---------- substrate probe ---------- */
console.log('— substrate probe —');
const phoneEnv = { navigator: { hardwareConcurrency: 8, deviceMemory: 4 }, opsPerSec: 3.2e7, performanceMemory: null };
const pPhone = T.probeSubstrate(phoneEnv);
ok('phone probe returns ceiling in sane range', pPhone.ceilingParams >= 12000 && pPhone.ceilingParams <= 2000000, 'ceiling=' + pPhone.ceilingParams);
ok('phone profile labeled', typeof pPhone.profile === 'string' && pPhone.profile.length > 3);
const deskEnv = { navigator: { hardwareConcurrency: 16, deviceMemory: 16 }, opsPerSec: 2.4e8, performanceMemory: null };
const pDesk = T.probeSubstrate(deskEnv);
ok('stronger host gets bigger ceiling (substrate-aware)', pDesk.ceilingParams > pPhone.ceilingParams, pPhone.ceilingParams + ' vs ' + pDesk.ceilingParams);
const weakEnv = { navigator: { hardwareConcurrency: 2 }, opsPerSec: 6e6, performanceMemory: null };
const pWeak = T.probeSubstrate(weakEnv);
ok('weak host gets smaller ceiling', pWeak.ceilingParams < pPhone.ceilingParams, pWeak.ceilingParams + '');
ok('caps derived', pPhone.ghostCap >= 4 && pPhone.moleculeCap >= 8);

/* ---------- GrowMLP + Net2Net ---------- */
console.log('— growable MLP / Net2Net —');
const rng = T.mulberry32(42);
const net = new T.GrowMLP([24, 16, 16, 8], rng);
const x = Array.from({ length: 24 }, (_, i) => Math.sin(i * 0.7));
const out0 = net.forward(x).slice();
const pc0 = net.paramCount();
ok('param count positive', pc0 > 500, 'pc=' + pc0);
net.growLayer(0, 4);
const pc1 = net.paramCount();
const out1 = net.forward(x);
let maxDiff = 0;
for (let i = 0; i < out0.length; i++) maxDiff = Math.max(maxDiff, Math.abs(out0[i] - out1[i]));
ok('growth adds params', pc1 > pc0, pc0 + '→' + pc1);
ok('Net2Net growth PRESERVES function (max |Δout| < 1e-9)', maxDiff < 1e-9, 'maxDiff=' + maxDiff);
ok('sizes updated', net.sizes[1] === 20, 'sizes=' + net.sizes.join(','));
net.growLayer(1, 6);
const out2 = net.forward(x);
let md2 = 0; for (let i = 0; i < out0.length; i++) md2 = Math.max(md2, Math.abs(out0[i] - out2[i]));
ok('second-layer growth also preserves function', md2 < 1e-9, 'maxDiff=' + md2);
const wBefore = net.W[2][0][0];
net.reinforce(x, 3, 1.0, 0.05);
ok('reinforce changes weights (learning is real)', net.W[2][0][0] !== wBefore);

/* ---------- trinity brain: ghosts / molecules / black hole ---------- */
console.log('— trinity brain lifecycle —');
function freshBrain(capOverrides) {
  const b = new T.TrinityBrain({
    rng: T.mulberry32(7),
    probeEnv: phoneEnv
  });
  if (capOverrides) { if (capOverrides.ghostCap) b.ghostCap = capOverrides.ghostCap; if (capOverrides.moleculeCap) b.moleculeCap = capOverrides.moleculeCap; }
  return b;
}
const snap = { energy: 80, charge: 50, dayPhase: 0.3, orbDist: 5, orbBear: 0.4, foodDist: 8, foodBear: -0.5, novelty: 0.7, inSludge: false, inCurrent: false, centerDist: 3, heading: 0.2, speedFactor: 1, gravityPull: 0, gravityBear: 0, arenaR: 16 };
{
  const b = freshBrain();
  const perc = b.sense(snap);
  ok('sense vector is 24-dim, finite', perc.length === 24 && perc.every(isFinite));
  const dec = b.decide(perc);
  ok('decide returns a valid action', dec.action >= 0 && dec.action < T.ACTIONS.length && typeof dec.name === 'string');
  // failed run → ghost sealed with checksum
  b.learn({ success: false, reward: -0.55, objective: dec.name, percept: perc, action: dec.action, ox: 3, oz: -2, why: 'stuck' });
  ok('failed run seals a ghost', b.ghosts.length === 1, 'ghosts=' + b.ghosts.length);
  ok('ghost has 8-hex checksum seal', /^[0-9a-f]{8}$/.test(b.ghosts[0].seal), b.ghosts[0].seal);
  ok('ghost carries empty judgment fields (judge hook inert without MetaJudge)', b.ghosts[0].judgment === null && b.ghosts[0].judgedBy === null);
  const evs = b.drainEvents();
  ok('ghost event emitted', evs.some(e => e.kind === 'ghost'));
  ok('no judge event in Node (MetaJudge absent — seal never blocks)', !evs.some(e => e.kind === 'judge'));
  // fail the SAME objective again (an appeal) → older ghost breaks into molecules
  const perc2 = b.sense(snap);
  const g0 = b.ghosts[0];
  b.currentGhostAppeal = 0;
  b.learn({ success: false, reward: -0.55, objective: g0.objective, percept: perc2, action: dec.action, ox: 3, oz: -2, why: 'stuck again', appealOf: 0 });
  ok('failed appeal breaks ghost into molecules', g0.status === 'broken' && b.molecules.length >= 3, 'molecules=' + b.molecules.length);
  const bias = b.moleculeBias();
  ok('molecules produce an action bias vector', bias.length === 8 && bias.some(v => v !== 0));
}
{
  // black hole: overflow merges into gravity
  const b = freshBrain({ ghostCap: 3, moleculeCap: 6 });
  for (let i = 0; i < 8; i++) {
    const perc = b.sense(snap);
    b.learn({ success: false, reward: -0.5, objective: 'explore', percept: perc, action: 2, ox: 5, oz: 5, why: 'timeout' });
  }
  ok('ghost archive capped by budget', b.ghosts.length <= 3, 'ghosts=' + b.ghosts.length);
  ok('overflow became black-hole gravity', b.gravity.length >= 1, 'gravity=' + b.gravity.length);
  const st = b.status();
  ok('status reports params ≤ ceiling', st.params <= st.ceiling, st.params + '/' + st.ceiling);
}
{
  // growth: hammer plateau signals until auto-expansion fires (or ceiling)
  const b = freshBrain();
  const pcStart = b.status().params;
  let grew = false;
  for (let ep = 0; ep < 400 && !grew; ep++) {
    const perc = b.sense(snap);
    // flat returns → plateau detector should fire after windows fill
    b.learn({ success: true, reward: 0.5, objective: 'explore', percept: perc, action: 2, ox: 0, oz: 0 });
    if (b.status().params > pcStart) grew = true;
  }
  ok('plateau triggers auto-expansion growth', grew, 'params ' + pcStart + ' → ' + b.status().params);
  ok('growth events counted', b.growthEvents >= 1);
  ok('growth never exceeds ceiling', b.status().params <= b.status().ceiling, 'params=' + b.status().params + ' ceiling=' + b.status().ceiling);
}

/* ---------- world sim ---------- */
console.log('— terrarium world —');
{
  const brain = freshBrain();
  const world = new T.TerWorld({ brain, rng: T.mulberry32(99) });
  ok('default world has props of many kinds', world.props.length >= 30 && new Set(world.props.map(p => p.kind)).size >= 7);
  let sawMove = false, sawOutcome = false;
  for (let t = 0; t < 3000; t++) {
    world.tick(0.1);
    if (world.bot.moving) sawMove = true;
    if (brain.episodes > 0) sawOutcome = true;
    if (sawMove && sawOutcome && t > 400) break;
  }
  ok('bot moves on its own initiative', sawMove);
  ok('episodes complete (brain learns from outcomes)', sawOutcome, 'episodes=' + brain.episodes);
  ok('bot stays inside the dish', Math.hypot(world.bot.x, world.bot.z) <= T.WORLD_R);
  ok('energy/charge stay in 0..100', world.bot.energy >= 0 && world.bot.energy <= 100 && world.bot.charge >= 0 && world.bot.charge <= 100);
  ok('day phase advances', world.dayPhase !== 0.32);
  const zn = world.zoneAt(6.5, -5.5);
  ok('sludge zone detected', zn.sludge === true);
}

/* ---------- v68: sandbox physics pass ---------- */
console.log('— v68 sandbox physics —');
{
  const brain = freshBrain();
  const world = new T.TerWorld({ brain, rng: T.mulberry32(1234), props: [] });
  // throwable: falls under gravity
  const t = world.spawnThrowable(0, 5, 0, 0, 0, 0);
  const y0 = t.y;
  world.stepThrowables(0.5);
  ok('throwable falls under gravity', t.y < y0, 'y ' + y0.toFixed(2) + '→' + t.y.toFixed(2));
  // throwable: bounces off terrain
  let bounced = false;
  for (let i = 0; i < 400; i++) { world.stepThrowables(0.05); if (t.bounces > 0) { bounced = true; break; } }
  ok('throwable bounces on terrain', bounced, 'bounces=' + t.bounces);
  ok('bounce event counter fires', t.evBounce > 0);
  // throwable: comes to rest and stops consuming sim
  for (let i = 0; i < 2000 && !t.rest; i++) world.stepThrowables(0.05);
  ok('throwable settles to rest', t.rest === true);
  ok('resting throwable has zero velocity', t.vx === 0 && t.vy === 0 && t.vz === 0);
  // throwable: stays inside the dish after a hard wallward throw
  const w2 = new T.TerWorld({ brain: freshBrain(), rng: T.mulberry32(5), props: [] });
  const tw = w2.spawnThrowable(0, 2, 0, 30, 2, 0);
  for (let i = 0; i < 600; i++) w2.stepThrowables(0.05);
  ok('wall bounce keeps throwable in the dish', Math.hypot(tw.x, tw.z) <= T.WORLD_R, 'r=' + Math.hypot(tw.x, tw.z).toFixed(2));
  // bot↔prop collision: bot gets pushed out of a tree's radius
  const w3 = new T.TerWorld({ brain: freshBrain(), rng: T.mulberry32(9), props: [{ id: 'px', kind: 'tree', x: 2, z: 0, scale: 1 }] });
  w3.bot.x = 2; w3.bot.z = 0; // dead center of the tree
  const pushed = w3.resolvePropCollision();
  const dAfter = Math.hypot(w3.bot.x - 2, w3.bot.z - 0);
  ok('bot pushed out of prop radius', pushed && dAfter >= T.PROP_RADIUS.tree + 0.32 - 1e-9, 'd=' + dAfter.toFixed(3));
  // zones stay walkable
  const w4 = new T.TerWorld({ brain: freshBrain(), rng: T.mulberry32(11), props: [{ id: 'pz', kind: 'zone-sludge', x: 1, z: 1, radius: 3 }] });
  w4.bot.x = 1; w4.bot.z = 1;
  ok('zones have no collision', w4.resolvePropCollision() === false);
  ok('throw kind registered in mod menu', !!(T.MOD_KINDS['throw'] && T.MOD_KINDS['throw'].emoji === '🪀'));
  // full-tick integration: 60s of sim never lets the bot visibly clip a prop.
  // (The 0.32 collision shell is conservative — the visual body is 0.21 —
  //  so penetration <= 0.12 stays invisible even in rare wedged layouts
  //  where two exclusion zones overlap and no position satisfies both.)
  const w5 = new T.TerWorld({ brain: freshBrain(), rng: T.mulberry32(77) });
  let violated = false;
  for (let i = 0; i < 600; i++) {
    w5.tick(0.1);
    for (const p of w5.props) {
      const pr = (T.PROP_RADIUS[p.kind] || 0) * (p.scale || 1);
      if (pr > 0 && Math.hypot(w5.bot.x - p.x, w5.bot.z - p.z) < pr + 0.20) { violated = true; break; }
    }
    if (violated) break;
  }
  ok('bot never visibly clips a solid prop over 60s', !violated);
}

/* ---------- mod store ---------- */
console.log('— mod store —');
{
  const backing = {};
  const storage = { getItem: k => (k in backing ? backing[k] : null), setItem: (k, v) => { backing[k] = v; } };
  const store = T.createModStore(storage);
  const rng = T.mulberry32(5);
  const props = T.defaultProps(rng);
  const n0 = props.length;
  const p = store.spawn(props, 'crystal', 2.5, -3.5, rng);
  ok('spawn adds a prop', props.length === n0 + 1 && p && p.kind === 'crystal' && p.x === 2.5);
  ok('spawn rejects unknown kind', store.spawn(props, 'ufo', 0, 0, rng) === null && props.length === n0 + 1);
  ok('move repositions', store.move(props, p.id, 4, 4) && props.find(q => q.id === p.id).x === 4);
  store.save(props);
  const loaded = store.load(T.defaultProps(rng));
  ok('layout persists through storage roundtrip', loaded.length === n0 + 1 && loaded.some(q => q.id === p.id && q.kind === 'crystal'));
  ok('remove deletes', store.remove(props, p.id) && props.length === n0);
  ok('remove of missing id returns false', store.remove(props, 'nope') === false);
  const z = store.spawn(props, 'zone-current', 0, 0, rng);
  ok('spawned zone carries radius+flow', !!z.radius && typeof z.flow === 'number');
}

/* ---------- gamepad mapping ---------- */
console.log('— gamepad mapping —');
{
  function mockPad(axes, pressedIdx) {
    const buttons = [];
    for (let i = 0; i < 17; i++) buttons.push({ pressed: pressedIdx.includes(i), value: pressedIdx.includes(i) ? 1 : 0 });
    return { connected: true, axes, buttons };
  }
  const st = { prev: [] };
  let m = T.mapPad(mockPad([0, 0, 0.9, 0], []), st);
  ok('right stick maps to orbit', m.orbit.x === 0.9 && m.pan.x === 0);
  ok('deadzone kills tiny drift', T.mapPad(mockPad([0.05, 0, 0, 0], []), { prev: [] }).pan.x === 0);
  m = T.mapPad(mockPad([0, 0, 0, 0], [3]), st);
  ok('Y button edge → mod intent', m.justPressed.mod === true);
  m = T.mapPad(mockPad([0, 0, 0, 0], [3]), st);
  ok('held Y does not re-fire mod intent', m.justPressed.mod === false);
  m = T.mapPad(mockPad([0, 0, 0, 0], [0]), st);
  ok('A button edge → interact intent', m.justPressed.interact === true);
  m = T.mapPad(mockPad([-0.8, 0.5, 0, 0], []), st);
  ok('left stick maps to camera pan', m.pan.x === -0.8 && m.pan.y === 0.5);
}

/* ---------- v69: physics pass ---------- */
console.log('— v69 physics —');
function manualRun(world, name, tx, tz) {
  const b = world.bot;
  const snap = world.snapshot();
  world.run = { name, action: 2, tx, tz, goalText: 'test', tLeft: 60,
    lastDist: Math.hypot(tx - b.x, tz - b.z), stuckT: 0,
    percept: world.brain.sense(snap), appealOf: -1, restT: 0 };
}
{
  // locomotion ramp: speed builds gradually, then reaches cruise
  const w = new T.TerWorld({ brain: freshBrain(), rng: T.mulberry32(31), props: [] });
  w.bot.x = 0; w.bot.z = 2; w.bot.heading = Math.PI / 2;
  manualRun(w, 'explore', 13, 2);
  let early = 0;
  for (let i = 0; i < 5; i++) { w.tick(0.05); early = w.bot.speed; }
  ok('locomotion ramps: not at full speed after 0.25s', early > 0.05 && early < T.PHYS.maxSpeed * 0.75, 'speed=' + early.toFixed(2));
  for (let i = 0; i < 60; i++) w.tick(0.05);
  ok('locomotion reaches cruise speed', w.bot.speed > T.PHYS.maxSpeed * 0.85, 'speed=' + w.bot.speed.toFixed(2));
  ok('bot velocity vector is exposed and consistent', approx(Math.hypot(w.bot.vx, w.bot.vz), w.bot.speed, 1e-6));
}
{
  // no heading snap: turn rate is capped
  const w = new T.TerWorld({ brain: freshBrain(), rng: T.mulberry32(32), props: [] });
  w.bot.x = 0; w.bot.z = 0; w.bot.heading = 0;
  manualRun(w, 'explore', 0, -12); // target directly behind
  let maxTurn = 0, prev = w.bot.heading;
  for (let i = 0; i < 40; i++) { w.tick(0.05); maxTurn = Math.max(maxTurn, Math.abs(w.bot.heading - prev)); prev = w.bot.heading; }
  ok('heading never snaps (per-tick turn ≤ rate·dt)', maxTurn <= T.PHYS.turnRate * 0.05 + 1e-9, 'maxTurn=' + maxTurn.toFixed(3));
}
{
  // collide-and-slide: bot glances off a tree and keeps going
  const w = new T.TerWorld({ brain: freshBrain(), rng: T.mulberry32(33),
    props: [{ id: 't1', kind: 'tree', x: 3, z: 0.55, scale: 1 }] });
  w.bot.x = 0; w.bot.z = 0; w.bot.heading = Math.PI / 2;
  manualRun(w, 'explore', 10, 0);
  let minD = 1e9, speedNear = 0;
  for (let i = 0; i < 160; i++) {
    w.tick(0.05);
    minD = Math.min(minD, Math.hypot(w.bot.x - 3, w.bot.z - 0.55));
    if (w.bot.x > 2.2 && w.bot.x < 3.8) speedNear = Math.max(speedNear, w.bot.speed);
  }
  ok('slide: bot never enters the tree body', minD >= T.PROP_RADIUS.tree + 0.19, 'minD=' + minD.toFixed(2));
  ok('slide: bot kept moving while in contact', speedNear > 0.5, 'speedNear=' + speedNear.toFixed(2));
  ok('slide: bot got past the tree', w.bot.x > 4.2, 'x=' + w.bot.x.toFixed(2));
}
{
  // light-prop push with momentum, then friction wins
  const orb = { id: 'o1', kind: 'orb', x: 2, z: 0, scale: 1 };
  const w = new T.TerWorld({ brain: freshBrain(), rng: T.mulberry32(34), props: [orb] });
  w.bot.x = 1.1; w.bot.z = 0; w.bot.heading = Math.PI / 2;
  manualRun(w, 'explore', 9, 0);
  for (let i = 0; i < 40; i++) w.tick(0.05);
  ok('push: bot shoved the orb forward', orb.x > 2.2, 'orb.x=' + orb.x.toFixed(2));
  w.bot.x = -13; w.bot.z = -13; // park the bot far away
  for (let i = 0; i < 80; i++) w.stepProps(0.05);
  ok('push: orb friction brings it to a stop', Math.hypot(orb.vx || 0, orb.vz || 0) < 0.05, 'v=' + Math.hypot(orb.vx || 0, orb.vz || 0).toFixed(3));
  ok('push: orb stayed in the dish', Math.hypot(orb.x, orb.z) < T.WORLD_R);
}
{
  // gravity: props creep toward a well, speed capped; far props untouched
  const brain = freshBrain();
  brain.gravity.push({ x: 0, z: 0, strength: 2.5 });
  const food = { id: 'f1', kind: 'food', x: 3, z: 0, scale: 1 };
  const far = { id: 'f2', kind: 'food', x: 12, z: 0, scale: 1 };
  const w = new T.TerWorld({ brain, rng: T.mulberry32(35), props: [food, far] });
  let maxV = 0;
  for (let i = 0; i < 240; i++) { w.stepProps(0.05); maxV = Math.max(maxV, Math.hypot(food.vx || 0, food.vz || 0)); }
  ok('gravity: loose prop crept toward the well', Math.hypot(food.x, food.z) < 1.7, 'd=' + Math.hypot(food.x, food.z).toFixed(2));
  ok('gravity: prop speed stayed capped', maxV <= T.PHYS.gravPropMaxV + 1e-9, 'maxV=' + maxV.toFixed(2));
  ok('gravity: prop beyond range untouched', far.x === 12 && far.z === 0);
  // gravity: the bot is tugged but never trapped
  const w2 = new T.TerWorld({ brain, rng: T.mulberry32(36), props: [] });
  w2.bot.x = 1.2; w2.bot.z = 0; w2.bot.heading = -Math.PI / 2;
  manualRun(w2, 'explore', -10, 0);
  let botMax = 0;
  for (let i = 0; i < 80; i++) { w2.tick(0.05); botMax = Math.max(botMax, w2.bot.speed); }
  ok('gravity: bot escapes the well (never trapped)', w2.bot.x < -2, 'x=' + w2.bot.x.toFixed(2));
  ok('gravity: bot never slingshots past cruise', botMax <= T.PHYS.maxSpeed * 1.2, 'max=' + botMax.toFixed(2));
}
{
  // pond: thrown orb splashes and FLOATS on the water line
  const w = new T.TerWorld({ brain: freshBrain(), rng: T.mulberry32(37), props: [] });
  const t = w.spawnThrowable(T.POND.x, 3.0, T.POND.z, 0.3, 0, 0.2);
  let steps = 0;
  while (!t.rest && steps < 1200) { w.stepThrowables(0.05); steps++; }
  ok('pond: orb came to rest', t.rest === true, 'steps=' + steps);
  ok('pond: orb is floating, not sunk', t.floating === true);
  ok('pond: splash event fired on entry', t.evSplash >= 1, 'evSplash=' + t.evSplash);
  ok('pond: floats at the water line', approx(t.y, T.PHYS.floatY, 0.09), 'y=' + t.y.toFixed(2) + ' floatY=' + T.PHYS.floatY.toFixed(2));
  ok('pond: floats well above the dipped floor', t.y > T.groundVis(T.POND.x, T.POND.z) + 0.3, 'floorY=' + T.groundVis(T.POND.x, T.POND.z).toFixed(2));
}
{
  // throw v2: rolling spin tracks speed, knock transfers momentum
  const w = new T.TerWorld({ brain: freshBrain(), rng: T.mulberry32(38), props: [] });
  const t = w.spawnThrowable(8, T.groundH(8, -8) + 0.2, -8, 4.5, 0, 0);
  let spinOk = false;
  for (let i = 0; i < 120; i++) {
    w.stepThrowables(0.03);
    const sp = Math.hypot(t.vx, t.vz);
    if (t.vy === 0 && sp > 1) { if (Math.abs(t.spin - sp / T.PHYS.ballRadius) < sp / T.PHYS.ballRadius * 0.4 + 0.5) spinOk = true; break; }
  }
  ok('throw v2: rolling spin tracks ground speed', spinOk, 'spin=' + t.spin.toFixed(1));
  const orb = { id: 'o9', kind: 'orb', x: 0, z: 4, scale: 1 };
  const w2 = new T.TerWorld({ brain: freshBrain(), rng: T.mulberry32(39), props: [orb] });
  const t2 = w2.spawnThrowable(0, T.groundH(0, 1) + 1.2, 1, 0, 3, 5);
  for (let i = 0; i < 90; i++) { w2.stepThrowables(0.02); w2.stepProps(0.02); }
  ok('throw v2: flying orb knocks a light prop', orb.z > 4.15, 'orb.z=' + orb.z.toFixed(2));
}
{
  // zones: sludge drag caps cruise; current nudges a resting bot
  const sludge = { id: 'z1', kind: 'zone-sludge', x: 0, z: 0, radius: 4 };
  const w = new T.TerWorld({ brain: freshBrain(), rng: T.mulberry32(40), props: [sludge] });
  w.bot.x = -3; w.bot.z = 0; w.bot.heading = Math.PI / 2;
  manualRun(w, 'explore', 3.5, 0);
  let mudMax = 0;
  for (let i = 0; i < 60; i++) { w.tick(0.05); mudMax = Math.max(mudMax, w.bot.speed); }
  ok('sludge: drag holds bot well under cruise', mudMax < T.PHYS.maxSpeed * 0.62, 'mudMax=' + mudMax.toFixed(2));
  const cur = { id: 'z2', kind: 'zone-current', x: 0, z: 0, radius: 4, flow: 0 };
  const w2 = new T.TerWorld({ brain: freshBrain(), rng: T.mulberry32(41), props: [cur] });
  w2.bot.x = 0; w2.bot.z = 0;
  manualRun(w2, 'rest', 0, 0);
  const x0 = w2.bot.x;
  for (let i = 0; i < 30; i++) w2.tick(0.05);
  ok('current: resting bot gets nudged along the flow', Math.abs(w2.bot.x - x0) > 0.3, 'dx=' + (w2.bot.x - x0).toFixed(2));
  ok('slope tilt is computed and bounded', isFinite(w.bot.tiltP) && Math.abs(w.bot.tiltP) <= 0.31 && Math.abs(w.bot.tiltR) <= 0.31);
}

/* ---------- v81: Meta judge — FRAG parsing + judge fragment ---------- */
console.log('— v81 judge fragment —');
const MJ = require('/home/hatch/workspace/neural-lab/www/meta-judge.js').MetaJudge;
ok('meta-judge module loads in node', !!MJ && typeof MJ.parseFrag === 'function' && typeof MJ.judgeReview === 'function');
const pf = MJ.parseFrag('It looped on the same cell until the timeout. FRAG:6:3');
ok('parseFrag reads action + severity', !!pf && pf.action === 6 && pf.severity === 3, JSON.stringify(pf));
ok('parseFrag null when tail absent', MJ.parseFrag('just a sentence, no tail') === null);
ok('parseFrag rejects out-of-range action', MJ.parseFrag('FRAG:9:2') === null);
ok('parseFrag rejects out-of-range severity', MJ.parseFrag('FRAG:2:7') === null);
const stripped = MJ.stripFrag('Lesson learned the hard way. FRAG:6:3');
ok('stripFrag removes the tail, keeps the sentence', stripped.indexOf('FRAG') < 0 && stripped.indexOf('Lesson learned') === 0, stripped);
{
  const b = freshBrain();
  const perc = b.sense(snap);
  const dec = b.decide(perc);
  b.learn({ success: false, reward: -0.55, objective: dec.name, percept: perc, action: dec.action, ox: 3, oz: -2, why: 'stuck' });
  const g = b.ghosts[b.ghosts.length - 1];
  ok('setup: ghost sealed for judge fragment', !!g && g.status === 'sealed');
  const before = b.molecules.length;
  const mol = b.addJudgeFragment(g, 6, 3);
  ok('judge fragment minted into the molecule pool', !!mol && b.molecules.length === before + 1);
  ok('judge fragment tagged with source + ghost seal', mol.src === 'judge' && mol.seal === g.seal);
  ok('severity 3 → mass 0.9 (same ladder as ghost fragments)', approx(mol.mass, 0.9, 1e-9), 'mass=' + mol.mass);
  let bi = 0; for (let a = 1; a < mol.bias.length; a++) if (mol.bias[a] < mol.bias[bi]) bi = a;
  ok('judge fragment leans hardest away from the blamed action', bi === 6 && mol.bias[6] < -0.7, 'bias[6]=' + mol.bias[6]);
  ok('one fragment per ghost — second mint refused at the core', b.addJudgeFragment(g, 2, 1) === null && b.molecules.length === before + 1);
  // a fresh sealed ghost: bad indices refuse WITHOUT consuming its one mint
  const perc2 = b.sense(snap);
  const dec2 = b.decide(perc2);
  b.learn({ success: false, reward: -0.55, objective: dec2.name, percept: perc2, action: dec2.action, ox: 4, oz: 4, why: 'stuck 2' });
  const g2 = b.ghosts[b.ghosts.length - 1];
  ok('second ghost sealed', !!g2 && g2 !== g && g2.status === 'sealed');
  ok('bad action index rejected (no fragment)', b.addJudgeFragment(g2, 9, 2) === null && b.addJudgeFragment(g2, -1, 2) === null);
  const mol1 = b.addJudgeFragment(g2, 2, 1);
  ok('severity 1 → mass 0.5 (refusals did not consume the mint)', !!mol1 && approx(mol1.mass, 0.5, 1e-9), 'mass=' + (mol1 && mol1.mass));
  // a third ghost, redeemed before any verdict lands → no fragment
  const perc3 = b.sense(snap);
  const dec3 = b.decide(perc3);
  b.learn({ success: false, reward: -0.55, objective: dec3.name, percept: perc3, action: dec3.action, ox: 5, oz: 5, why: 'stuck 3' });
  const g3 = b.ghosts[b.ghosts.length - 1];
  g3.status = 'redeemed';
  ok('no fragment once the ghost is redeemed', b.addJudgeFragment(g3, 0, 2) === null);
  ok('brain still decides with judge fragments live', typeof b.decide(b.sense(snap)).action === 'number');
}
{
  const b = freshBrain({ moleculeCap: 8 });
  while (b.molecules.length < b.moleculeCap) b.molecules.push({ bias: Array(8).fill(0), mass: 0.5, ox: 9, oz: 9 });
  const wells0 = b.gravity.length;
  const perc = b.sense(snap);
  const dec = b.decide(perc);
  b.learn({ success: false, reward: -0.55, objective: dec.name, percept: perc, action: dec.action, ox: 1, oz: 1, why: 'cap test' });
  const g = b.ghosts[b.ghosts.length - 1];
  const mol = b.addJudgeFragment(g, 4, 2);
  ok('judge fragment respects the molecule cap — overflow collapses to gravity', !!mol && b.molecules.length <= b.moleculeCap && b.gravity.length > wells0,
    'mols=' + b.molecules.length + ' wells ' + wells0 + '→' + b.gravity.length);
}

/* ---------- v82: round-2 review fixes — ceiling guard + state accounting ---------- */
console.log('— v82 review fixes —');
{
  const b = freshBrain();
  const pc = b.net.paramCount();
  // stage perfect plateau conditions, then set a ceiling one step cannot fit under
  b.returns = Array(24).fill(0.5);
  b.episodesSinceGrowth = 99;
  b.ceiling = pc + 10;
  b._maybeGrow();
  ok('growth step that would cross the ceiling is refused (hard bound)', b.net.paramCount() === pc, 'params=' + b.net.paramCount() + ' ceiling=' + b.ceiling);
  b.ceiling = 2000000;
  b.episodesSinceGrowth = 99;
  b._maybeGrow();
  ok('growth proceeds when the step fits under the ceiling', b.net.paramCount() > pc, 'params=' + b.net.paramCount());
}
{
  // learned-state accounting at full caps — the <10 KB claim is the CHIP record model
  const chipBytes = 28 * 304 + 56 * 24 + 16 * 6;
  ok('chip record model at full caps = ' + chipBytes + 'B (< 10 KB)', chipBytes < 10240);
  const b = freshBrain({ ghostCap: 28, moleculeCap: 56 });
  for (let i = 0; i < 28; i++) {
    const perc = b.sense(snap);
    const dec = b.decide(perc);
    b.learn({ success: false, reward: -0.55, objective: dec.name, percept: perc, action: dec.action, ox: 3, oz: -2, why: 'fill' });
    const g = b.ghosts[b.ghosts.length - 1];
    g.acts = Array(40).fill('10,10:7');
    g.judgment = 'x'.repeat(240);
    g.judgedBy = 'meta-spark';
  }
  const rb = () => -0.7834521098;
  while (b.molecules.length < 56) b.molecules.push({ bias: Array(8).fill(rb()), mass: 0.9, ox: 9.123, oz: 9.456 });
  while (b.gravity.length < 16) b.gravity.push({ x: 1.111, z: 1.222, strength: 2.5 });
  const appBytes = JSON.stringify({ ghosts: b.ghosts, molecules: b.molecules, gravity: b.gravity }).length;
  ok('app JSON learned state at full caps = ' + appBytes + 'B (< 35 KB worst case; weights accounted separately: 808 × 2B Q8.8 = 1,616B)', appBytes < 35840, appBytes + 'B');
}

/* ---------- v83: judge transport — retry-on-empty, clean failure lines ---------- */
console.log('— v83 judge transport —');
const MJMOD = require('/home/hatch/workspace/neural-lab/www/meta-judge.js');
MJMOD.localStorage = { getItem: () => 'test-key' };
function fakeBrain() {
  return { events: [], thoughts: [], minted: null, ghosts: [], ghostCap: 9, episodes: 3,
    think(s) { this.thoughts.push(s); },
    addJudgeFragment(g, a, s) { this.minted = { action: a, severity: s }; return {}; },
    status() { return { ghosts: 1, molecules: 0, gravity: 0, episodes: 3, params: 808, ceiling: 52000 }; } };
}
function bridgeReply(content, finish) {
  return 'HTTP 200\n' + JSON.stringify({ choices: [{ message: { content: content }, finish_reason: finish }] });
}
{
  // reasoning ate the budget (length/null) → retry at 3072 → verdict lands
  const bodies = [];
  global.NB = { metaJudgePost(key, body) {
    bodies.push(JSON.parse(body));
    return bodies.length === 1 ? bridgeReply(null, 'length')
                                : bridgeReply('It looped on inspect until the timeout.\nFRAG:5:2', 'stop');
  } };
  const b = fakeBrain();
  const g = { seal: 'deadbeef', acts: [], judgment: null, judgedBy: null };
  MJ.judgeGhost(b, g, { objective: 'inspect', why: 'timeout', action: 5 });
  ok('empty reply retried once at escalated budget (1024 → 3072)', bodies.length === 2 && bodies[1].max_tokens === 3072,
     'calls=' + bodies.length + ' mt2=' + (bodies[1] && bodies[1].max_tokens));
  ok('retried verdict lands on the ghost', g.judgment === 'It looped on inspect until the timeout.', g.judgment);
  ok('retried verdict still mints its fragment', !!b.minted && b.minted.action === 5 && b.minted.severity === 2, JSON.stringify(b.minted));
  const allText = b.thoughts.join(' ') + b.events.map(e => e.msg).join(' ');
  ok('no raw API dumps in the log lines', allText.indexOf('chatcmpl') < 0 && allText.indexOf('raw:') < 0);
}
{
  // both attempts empty → clean failure, seal unaffected
  let calls = 0;
  global.NB = { metaJudgePost() { calls++; return bridgeReply(null, 'length'); } };
  const b = fakeBrain();
  const g = { seal: 'cafef00d', acts: [], judgment: null, judgedBy: null };
  MJ.judgeGhost(b, g, { objective: 'rest', why: 'stuck', action: 4 });
  ok('double-empty: judgment unset, failure line is clean + mentions the retry',
     g.judgment === null && calls === 2 && b.thoughts.some(t => t.indexOf('empty reply') >= 0 && t.indexOf('retried at a larger budget') >= 0),
     b.thoughts.join(' | '));
}
{
  // first-try success → exactly one call
  let calls = 0;
  global.NB = { metaJudgePost() { calls++; return bridgeReply('Clean verdict.\nFRAG:1:3', 'stop'); } };
  const b = fakeBrain();
  const g = { seal: '0badf00d', acts: [], judgment: null, judgedBy: null };
  MJ.judgeGhost(b, g, { objective: 'seek food', why: 'timeout', action: 1 });
  ok('first-try success: one call, verdict + fragment', calls === 1 && g.judgment === 'Clean verdict.' && !!b.minted && b.minted.severity === 3);
}
{
  // Judge's Review rides the same transport: empty → retry → paragraph stored
  let calls = 0;
  global.NB = { metaJudgePost() { calls++; return calls === 1 ? bridgeReply(null, 'length') : bridgeReply('A paragraph review of the ghosts.', 'stop'); } };
  const b = fakeBrain();
  b.ghosts = [{ seal: 'abc123', objective: 'inspect', status: 'sealed', judgment: 'x' }];
  let doneText = null;
  MJ.judgeReview(b, t => { doneText = t; });
  ok('review retries on empty and stores the paragraph', calls === 2 && !!b.lastJudgeReview && b.lastJudgeReview.text === 'A paragraph review of the ghosts.' && doneText === b.lastJudgeReview.text,
     'calls=' + calls);
}
const v83async = (async () => {
  // fetch fallback path (no NB): verdict lands, fragment mints
  delete global.NB;
  global.fetch = () => Promise.resolve({ ok: true, status: 200,
    json: () => Promise.resolve({ choices: [{ message: { content: 'Fetch verdict.\nFRAG:1:1' }, finish_reason: 'stop' }] }) });
  const b = fakeBrain();
  const g = { seal: 'feedface', acts: [], judgment: null, judgedBy: null };
  MJ.judgeGhost(b, g, { objective: 'seek food', why: 'timeout', action: 1 });
  await new Promise(r => setTimeout(r, 30));
  ok('fetch fallback: verdict lands + fragment mints', g.judgment === 'Fetch verdict.' && !!b.minted && b.minted.action === 1,
     'judgment=' + g.judgment);
  delete global.fetch;
})();

v83async.then(() => {
  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
