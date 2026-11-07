/* ============================================================================
   GAME / UI LAYER — spawn, camera, input, node grabber, telemetry HUD
   ========================================================================== */
const SPEC_ORDER = ['bastion', 'covet', 'dseries'];
const H = 1 / 840;              // physics step (Hz)
const TIME_SCALES = [1, 0.2, 0.05];
let timeScaleIndex = 0;
let xrayMode = 0;
let camMode = 0;
let accumulator = 0;
let lastFrame = performance.now();
let fpsAvg = 60;
let hudTimer = 0;
const CAR_VIEWS = [];

/* --------------------------------------------------------------- spawn --- */
boot('assembling node/beam lattice…', 32);
function playerSpawnPoint() { return { x: -6, z: 0, rot: 0 }; }

function spawnCar(specId, opts) {
  const car = worldSpawn(specId, opts);
  const view = new CarView(car);
  CAR_VIEWS.push({ car, view });
  car.viewRef = view;
  return car;
}

let player = null;
let rival = null;
function initWorld(specId) {
  const sp = playerSpawnPoint();
  player = spawnCar(specId, { x: sp.x, z: sp.z, rot: sp.rot, name: 'PLAYER' });
  player.spawn = { x: sp.x, z: sp.z, rot: sp.rot };
  player.isPlayer = true;
  player.controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, reverse: false, auto: true };
  camera.position.set(sp.x - 8, 3.2, sp.z + 7);
  camera.lookAt(sp.x, 1, sp.z);
}

function disposeCarView(cv) {
  scene.remove(cv.car.group);
  cv.car.group.traverse(o => {
    if (o.geometry) o.geometry.dispose();
  });
  const i = CAR_VIEWS.indexOf(cv);
  if (i >= 0) CAR_VIEWS.splice(i, 1);
  const j = WORLD.cars.indexOf(cv.car);
  if (j >= 0) WORLD.cars.splice(j, 1);
  const k = CARS.indexOf(cv.car);
  if (k >= 0) CARS.splice(k, 1);
}

function removeRivals() {
  for (const cv of CAR_VIEWS.slice()) if (cv.car !== player) disposeCarView(cv);
  rival = null;
}

function spawnRival() {
  removeRivals();
  const t = player.spec.id === 'bastion' ? 'covet' : 'bastion';
  const f = player.frame.fwd;
  const base = playerSpawnPoint();
  const rx = base.x + 34;
  const rz = base.z + 1.2;
  rival = spawnCar(t, { x: rx, z: rz, rot: Math.PI, name: 'RIVAL' });
  rival.spawn = { x: rx, z: rz, rot: Math.PI };
  rival.controls = { throttle: 1, brake: 0, steer: 0, handbrake: 0, reverse: false, auto: true, ai: true };
  logEvent('SYSTEM', 'RIVAL ' + rival.spec.name + ' SPAWNED — CLOSING AT SPEED', 2);
}

function rebuildPlayerView() {
  const old = CAR_VIEWS.find(c => c.car === player);
  if (old) {
    scene.remove(old.car.group);
    old.car.group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }
  const view = new CarView(player);
  player.viewRef = view;
  if (old) CAR_VIEWS[CAR_VIEWS.indexOf(old)] = { car: player, view };
  else CAR_VIEWS.push({ car: player, view });
  view.setXray(xrayMode);
}

function resetPlayer() {
  if (!player) return;
  removeRivals();
  const sp = player.spawn;
  player.reset(sp.x, sp.z, sp.rot);
  player.controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, reverse: false, auto: true };
  player.damage.peakG = 0;
  player._shownT = 0;
  player.lastBrkEvt = {};
  slab.active = false; slabMesh.visible = false; pressGantry.visible = false;
  releaseGrab();
  rebuildPlayerView();
  updateZonesHUD(true);
  logEvent('SYSTEM', 'VEHICLE RESTORED — JBEAM LATTICE REBUILT', 2);
}

/* -------------------------------------------------------- HUD elements --- */
const el = (id) => document.getElementById(id);
const hud = el('hud'), hudCar = el('hudCar'), hudMode = el('hudMode');
const zoneListEl = el('zoneList'), logEl = el('log');
const zones = [
  { k: 'front', name: 'FRONT CRUMPLE', svg: 'zfFront' },
  { k: 'engine', name: 'ENGINE BAY', svg: 'zfEngine' },
  { k: 'cabin', name: 'CABIN CAGE', svg: 'zfCabin' },
  { k: 'rear', name: 'REAR SECTION', svg: 'zfRear' },
  { k: 'suspF', name: 'FRONT SUSP', svg: 'zfFL', svg2: 'zfFR' },
  { k: 'suspR', name: 'REAR SUSP', svg: 'zfRL', svg2: 'zfRR' }
];
const zoneEls = {};
for (const z of zones) {
  const row = document.createElement('div');
  row.className = 'zrow';
  row.innerHTML = '<span class="zname">' + z.name + '</span><span class="bar"><i></i></span><span class="zval">100%</span>';
  zoneListEl.appendChild(row);
  zoneEls[z.k] = {
    row, fill: row.querySelector('i'), val: row.querySelector('.zval'),
    svg: document.getElementById(z.svg), svg2: z.svg2 ? document.getElementById(z.svg2) : null
  };
}
function zoneColor(v) {
  if (v > 0.8) return '#3ac46a';
  if (v > 0.55) return '#e8c227';
  if (v > 0.3) return '#ff8c1a';
  return '#ff3b30';
}
let logCount = 0;
function logEvent(kind, text, weight) {
  const t = (WORLD.time).toFixed(2).padStart(6, '0');
  const div = document.createElement('div');
  div.className = 'logline ' + (weight >= 2 ? 'bad' : weight >= 1.2 ? 'hot' : 'ok');
  div.innerHTML = '<span class="t">' + t + 's</span><span class="m">' + text + '</span>';
  logEl.insertBefore(div, logEl.firstChild);
  logCount++;
  while (logEl.children.length > 9) logEl.removeChild(logEl.lastChild);
  flash();
}
let flashUntil = 0;
function flash() { flashUntil = performance.now() + 120; }

/* -------------------------------------------------------------- camera --- */
const camState = {
  pos: new THREE.Vector3(-14, 4, 7),
  look: new THREE.Vector3(0, 1, 0),
  orbitTheta: 0.7, orbitPhi: 0.32, dist: 9.5,
  dragging: false, lastX: 0, lastY: 0
};
const CAM_NAMES = ['CHASE', 'ORBIT', 'HOOD', 'ACTION'];

function updateCamera(dt) {
  if (!player) return;
  const f = player.frame;
  const c = player.center;
  const up = _v1.set(f.up.x, f.up.y, f.up.z);
  const fwd = _v2.set(f.fwd.x, f.fwd.y, f.fwd.z);
  const right = _v3.set(f.right.x, f.right.y, f.right.z);
  const k = 1 - Math.pow(0.0016, dt);
  if (camMode === 0) {
    /* chase */
    const desired = _v4.copy(c).addScaledVector(fwd, -7.4).addScaledVector(up, 2.35).addScaledVector(right, 0.0);
    desired.y = Math.max(desired.y, groundHeight(desired.x, desired.z) + 0.9);
    camState.pos.lerp(desired, k);
    const look = _v5.copy(c).addScaledVector(fwd, 3.2).addScaledVector(up, 0.75);
    camState.look.lerp(look, k);
  } else if (camMode === 1) {
    /* orbit around the car, mouse controlled */
    const r = camState.dist;
    const th = camState.orbitTheta, ph = camState.orbitPhi;
    const desired = _v4.set(
      c.x + Math.cos(th) * Math.cos(ph) * r,
      c.y + Math.sin(ph) * r + 0.4,
      c.z + Math.sin(th) * Math.cos(ph) * r
    );
    const gmin = groundHeight(desired.x, desired.z) + 0.7;
    if (desired.y < gmin) desired.y = gmin;
    camState.pos.lerp(desired, 1 - Math.pow(0.0003, dt));
    camState.look.lerp(_v5.copy(c).addScaledVector(up, 0.55), 1 - Math.pow(0.0005, dt));
  } else if (camMode === 2) {
    /* hood / cockpit */
    const desired = _v4.copy(c).addScaledVector(fwd, 0.9).addScaledVector(up, 1.05);
    camState.pos.copy(desired);
    camState.look.copy(c).addScaledVector(fwd, 12).addScaledVector(up, 1.1);
  } else {
    /* trackside action camera */
    const desired = _v4.set(26.5, 1.5, -12.5);
    camState.pos.lerp(desired, 1 - Math.pow(0.02, dt));
    camState.look.lerp(_v5.copy(c).addScaledVector(up, 0.7), 1 - Math.pow(0.01, dt));
  }
  camera.position.copy(camState.pos);
  camera.lookAt(camState.look);
  /* keep shadows around the action */
  sun.position.set(c.x - 42, 66, c.z + 30);
  sun.target.position.set(c.x, 0, c.z);
  sun.target.updateMatrixWorld();
}

/* ------------------------------------------------------ node grabber ----- */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const grabPlane = new THREE.Plane();
const grabRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.22, 0.028, 6, 18),
  new THREE.MeshBasicMaterial({ color: 0xff7a1a, depthTest: false, transparent: true, opacity: 0.95 })
);
grabRing.renderOrder = 20;
grabRing.visible = false;
scene.add(grabRing);
const grabLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
const grabLine = new THREE.Line(grabLineGeo, new THREE.LineDashedMaterial({ color: 0xff8a2a, dashSize: 0.25, gapSize: 0.16, depthTest: false, transparent: true }));
grabLine.renderOrder = 20;
grabLine.visible = false;
scene.add(grabLine);
const grabHintEl = el('grabHint');
let hoverNode = null, grabbedNode = null, grabTarget = new THREE.Vector3();

function pickNode(mx, my) {
  const W = window.innerWidth, Hh = window.innerHeight;
  let best = null, bestD = 26;
  for (const cv of CAR_VIEWS) {
    for (const n of cv.car.nodes) {
      _v1.copy(n.pos).project(camera);
      if (_v1.z > 1) continue;
      const sx = (_v1.x * 0.5 + 0.5) * W;
      const sy = (-_v1.y * 0.5 + 0.5) * Hh;
      const d = Math.hypot(sx - mx, sy - my) * (n.isHub ? 1.6 : 1);
      if (d < bestD) { bestD = d; best = n; }
    }
  }
  return best;
}
function beginGrab(mx, my) {
  const n = pickNode(mx, my);
  if (!n) return;
  grabbedNode = n;
  n.grab = true;
  n.car.grabTarget = grabTarget;
  grabTarget.copy(n.pos);
  camera.getWorldDirection(_v1);
  grabPlane.setFromNormalAndCoplanarPoint(_v1, _v2.copy(n.pos));
  grabPlane.constant = _v1.dot(_v2);
  grabLine.visible = true;
  grabRing.visible = true;
  canvas.classList.add('grabbing');
  logEvent('GRAB', 'NODE #' + n.id + ' (' + zoneLabel(n.zone) + ') ATTACHED TO SPRING', 1.4);
}
function releaseGrab() {
  if (grabbedNode) {
    grabbedNode.grab = false;
    grabbedNode = null;
  }
  grabLine.visible = false;
  grabRing.visible = false;
  canvas.classList.remove('grabbing');
}
function updateGrab(mx, my) {
  const W = window.innerWidth, Hh = window.innerHeight;
  ndc.x = (mx / W) * 2 - 1;
  ndc.y = -(my / Hh) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  if (grabbedNode) {
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(grabPlane, hit)) {
      const d = hit.distanceTo(grabbedNode.pos);
      if (d > 3.4) hit.sub(grabbedNode.pos).multiplyScalar(3.4 / d).add(grabbedNode.pos);
      grabTarget.copy(hit);
      grabbedNode.car.grabTarget = grabTarget;
    }
  }
}

/* ------------------------------------------------------------- input ----- */
const keys = Object.create(null);
const ctrlDown = () => !!(keys.Control || keys.ControlLeft || keys.ControlRight);
const state = { reverseHold: 0, mx: 0, my: 0 };
window.addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') keys.Control = true;
  const k = e.code;
  if (k === 'KeyB') cycleXray();
  if (k === 'KeyT') cycleTimeScale();
  if (k === 'KeyR') resetPlayer();
  if (k === 'KeyC') cycleCamera();
  if (k === 'KeyF') dropPress();
  if (k === 'KeyH') hud.classList.toggle('hidden');
  if (k === 'Digit1') setTimeScale(0);
  if (k === 'Digit2') setTimeScale(1);
  if (k === 'Digit3') setTimeScale(2);
  if (k === 'Space' || k.indexOf('Arrow') === 0) e.preventDefault();
  if (k === 'Space') { /* handbrake */ }
  Audio.init(); Audio.resume();
}, { passive: false });
window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'ControlLeft' || e.code === 'ControlRight') keys.Control = false;
});
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  Audio.init(); Audio.resume();
  canvas.setPointerCapture(e.pointerId);
  state.mx = e.clientX; state.my = e.clientY;
  if (e.button === 0 && (e.ctrlKey || e.metaKey || ctrlDown())) {
    beginGrab(e.clientX, e.clientY);
    if (grabbedNode) { updateGrab(e.clientX, e.clientY); return; }
  }
  camState.dragging = true;
  camState.lastX = e.clientX; camState.lastY = e.clientY;
});
canvas.addEventListener('pointermove', (e) => {
  state.mx = e.clientX; state.my = e.clientY;
  if (grabbedNode) { updateGrab(e.clientX, e.clientY); return; }
  if (e.ctrlKey || ctrlDown()) {
    hoverNode = pickNode(e.clientX, e.clientY);
    if (hoverNode) {
      grabRing.visible = true;
      grabRing.position.copy(hoverNode.pos);
      grabRing.scale.setScalar(hoverNode.isHub ? 1.6 : 1);
      grabHintEl.style.display = 'block';
      grabHintEl.style.left = (e.clientX + 14) + 'px';
      grabHintEl.style.top = (e.clientY + 10) + 'px';
      grabHintEl.textContent = 'NODE #' + hoverNode.id + ' · HOLD TO GRAB';
      canvas.classList.add('grab');
    } else {
      grabRing.visible = false;
      grabHintEl.style.display = 'none';
      canvas.classList.remove('grab');
    }
  } else {
    grabRing.visible = false;
    grabHintEl.style.display = 'none';
    canvas.classList.remove('grab');
  }
  if (camState.dragging) {
    const dx = e.clientX - camState.lastX, dy = e.clientY - camState.lastY;
    camState.lastX = e.clientX; camState.lastY = e.clientY;
    if (camMode !== 1 && (Math.abs(dx) + Math.abs(dy)) > 4) setCamera(1);
    camState.orbitTheta -= dx * 0.006;
    camState.orbitPhi = clamp(camState.orbitPhi + dy * 0.004, -0.12, 1.25);
  }
});
canvas.addEventListener('pointerup', (e) => {
  camState.dragging = false;
  if (grabbedNode) { releaseGrab(); }
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  camState.dist = clamp(camState.dist * (1 + Math.sign(e.deltaY) * 0.09), 3.2, 30);
}, { passive: false });

/* ------------------------------------------------------------ HUD logic -- */
function currentZones(car) {
  const z = car.damage.zones;
  const out = {};
  for (const k of ['front', 'engine', 'cabin', 'rear']) {
    const zz = z[k];
    out[k] = zz && zz.total ? clamp((zz.intact - zz.deform * 0.55) / zz.total, 0, 1) : 1;
  }
  const s = car.damage;
  out.suspF = s.suspTotal ? clamp((s.suspIntact || 0) / s.suspTotal, 0, 1) : 1;
  out.suspR = out.suspF;
  /* rear axle sheared separately */
  let rt = 0, ri = 0;
  for (const w of car.wheels) {
    if (w.front) continue;
    rt++;
    if (!w.detached) ri++;
  }
  out.suspR = rt ? ri / rt : 1;
  let ft = 0, fi = 0;
  for (const w of car.wheels) {
    if (!w.front) continue;
    ft++;
    if (!w.detached) fi++;
  }
  out.suspF = ft ? fi / ft : 1;
  return out;
}

function updateZonesHUD(force) {
  if (!player) return;
  const car = player;
  const zv = currentZones(car);
  for (const z of zones) {
    const v = zv[z.k];
    const e = zoneEls[z.k];
    e.fill.style.transform = 'scaleX(' + v.toFixed(3) + ')';
    e.fill.style.background = zoneColor(v);
    e.val.textContent = Math.round(v * 100) + '%';
    const op = (force ? 0.24 : (0.22 + 0.72 * (1 - v))).toFixed(3);
    if (e.svg) { e.svg.setAttribute('fill', zoneColor(v)); e.svg.setAttribute('opacity', op); }
    if (e.svg2) { e.svg2.setAttribute('fill', zoneColor(v)); e.svg2.setAttribute('opacity', op); }
  }
  hudCar.textContent = car.spec.name + ' · ' + car.spec.paintName;
}

function updateHUD(dt) {
  if (!player) return;
  const car = player;
  updateZonesHUD(false);
  /* telemetry */
  el('tFps').textContent = Math.round(fpsAvg) + ' fps';
  let nodes = 0, beams = 0, dz = 0, bz = 0;
  for (const cv of CAR_VIEWS) {
    nodes += cv.car.nodes.length; beams += cv.car.beams.length;
    dz += cv.car.damage.deformed; bz += cv.car.damage.broken;
  }
  el('tNodes').textContent = nodes + (CAR_VIEWS.length > 1 ? ' / ' + CAR_VIEWS.length + ' cars' : '');
  el('tBeams').textContent = beams;
  el('tDeformed').textContent = dz;
  el('tBroken').textContent = bz;
  el('tG').textContent = car.damage.peakG.toFixed(1) + ' G';
  el('tSpeed').textContent = (car.speed * 3.6).toFixed(0) + ' km/h';
  el('tRpm').textContent = Math.round(car.rpm) + ' rpm · ' + (car.gear || 1) + ' gear';
  el('tScale').textContent = TIME_SCALES[timeScaleIndex].toFixed(2) + 'x';
  el('tSubsteps').textContent = '14 / 840 Hz';
  /* events -> log */
  if (car.events.length) {
    const lastT = car._shownT || -1;
    let pushed = 0;
    for (const ev of car.events) {
      if (ev.t > lastT && pushed < 2) {
        logEvent(ev.kind, ev.text, ev.weight);
        car._shownT = ev.t;
        pushed++;
      }
    }
    if (!car._shownT) car._shownT = car.events[car.events.length - 1].t;
  }
  /* flash overlay */
  const now = performance.now();
  const fl = el('flash');
  if (now < flashUntil) fl.style.opacity = '0.9';
  else fl.style.opacity = String(Math.max(0, parseFloat(fl.style.opacity || '0') - dt * 3));
  /* slow-mo badge */
  el('slowBadge').style.display = TIME_SCALES[timeScaleIndex] < 0.5 ? 'block' : 'none';
  el('slowBadge').textContent = 'SLOW MOTION · ' + TIME_SCALES[timeScaleIndex].toFixed(2) + 'x';
  /* x-ray buttons */
  document.querySelectorAll('[data-xray]').forEach(b => b.classList.toggle('on', +b.dataset.xray === xrayMode));
}

/* ------------------------------------------------------------ actions ---- */
function cycleXray() { setXray((xrayMode + 1) % 3); }
function setXray(m) {
  xrayMode = m;
  for (const cv of CAR_VIEWS) cv.view.setXray(m);
  el('btnXray').classList.toggle('on', m !== 0);
  if (m === 1) logEvent('VIEW', 'JBEAM X-RAY · TRANSPARENT HULL + LATTICE', 0.8);
  if (m === 2) logEvent('VIEW', 'JBEAM X-RAY · SKELETON ONLY', 0.8);
}
function cycleTimeScale() { setTimeScale((timeScaleIndex + 1) % TIME_SCALES.length); }
function setTimeScale(i) {
  timeScaleIndex = clamp(i, 0, TIME_SCALES.length - 1);
  document.querySelectorAll('[data-ts]').forEach(b => b.classList.toggle('on', Math.abs(+b.dataset.ts - TIME_SCALES[timeScaleIndex]) < 1e-6));
  el('tScale').textContent = TIME_SCALES[timeScaleIndex].toFixed(2) + 'x';
}
function setCamera(m) {
  camMode = ((m % CAM_NAMES.length) + CAM_NAMES.length) % CAM_NAMES.length;
  el('btnCam').textContent = 'CAM: ' + CAM_NAMES[camMode];
  if (camMode === 1) {
    camState.orbitTheta = Math.atan2(camState.pos.z - player.center.z, camState.pos.x - player.center.x);
    camState.dist = clamp(camState.pos.distanceTo(_v1.set(player.center.x, player.center.y, player.center.z)), 4, 26);
  }
}
function cycleCamera() { setCamera(camMode + 1); }

function dropPress() {
  if (!player) return;
  const roof = player.stations[Math.floor(player.stations.length / 2)].ring[0].node.pos;
  dropSlabAt(player.center.x, Math.max(1.3, roof.y), player.center.z);
  slabMesh.visible = true;
  pressGantry.visible = true;
  pressGantry.position.set(player.center.x, 0, player.center.z);
  logEvent('SCENARIO', '3 TONNE PRESS RELEASED OVER CABIN', 2);
}

function changeVehicle(specId) {
  if (player && player.spec.id === specId) return;
  const oldCar = player;
  removeRivals();
  releaseGrab();
  const cvOld = CAR_VIEWS.find(c => c.car === oldCar);
  if (cvOld) disposeCarView(cvOld);
  const sp = playerSpawnPoint();
  player = spawnCar(specId, { x: sp.x, z: sp.z, rot: sp.rot, name: 'PLAYER' });
  player.spawn = { x: sp.x, z: sp.z, rot: sp.rot };
  player.isPlayer = true;
  setXray(xrayMode);
  document.querySelectorAll('[data-car]').forEach(b => b.classList.toggle('on', b.dataset.car === specId));
  updateZonesHUD(true);
  logEvent('SYSTEM', player.spec.name + ' LOADED · ' + player.beams.length + ' BEAMS / ' + player.nodes.length + ' NODES', 1.2);
}

/* ------------------------------------------------------------ UI wiring -- */
const carBtns = el('carBtns');
for (const id of SPEC_ORDER) {
  const b = document.createElement('button');
  b.dataset.car = id;
  b.textContent = CAR_SPECS[id].name.replace('BRUCKEL ', '').replace('IBISHU ', '').replace('GAVRIL ', '');
  b.title = CAR_SPECS[id].sub + ' — ' + CAR_SPECS[id].mass + ' kg';
  b.onclick = () => changeVehicle(id);
  carBtns.appendChild(b);
}
let carBtnsBuilt = false;
document.querySelectorAll('[data-ts]').forEach(b => { b.onclick = () => setTimeScale(TIME_SCALES.indexOf(+b.dataset.ts)); });
el('btnDrop').onclick = () => dropPress();
el('btnRival').onclick = () => spawnRival();
el('btnReset').onclick = () => resetPlayer();
el('btnXray').onclick = () => cycleXray();
el('btnCam').onclick = () => cycleCamera();
el('btnAudio').onclick = () => { Audio.init(); Audio.resume(); const on = Audio.toggle(); el('btnAudio').classList.toggle('on', on); el('btnAudio').textContent = on ? 'SOUND' : 'MUTED'; };

/* keep the keyboard focused on driving, not on the last clicked button */
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t && t.tagName === 'BUTTON' && t.blur) t.blur();
});

/* --------------------------------------------------------------- resize -- */
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

/* ------------------------------------------------------------- game loop -- */
function controlsFromKeys(dt) {
  if (!player) return;
  const c = player.controls;
  const fwdKey = keys.KeyW || keys.ArrowUp;
  const backKey = keys.KeyS || keys.ArrowDown;
  c.steer = (keys.KeyA || keys.ArrowLeft ? 1 : 0) + (keys.KeyD || keys.ArrowRight ? -1 : 0);
  c.handbrake = keys.Space ? 1 : 0;
  const spd = player.speed;
  if (fwdKey) { c.throttle = 1; c.brake = 0; c.reverse = false; state.reverseHold = 0; }
  else if (backKey) {
    if (spd > 1.2) { c.throttle = 0; c.brake = 1; c.reverse = false; state.reverseHold = 0; }
    else { state.reverseHold += dt; c.throttle = state.reverseHold > 0.25 ? 1 : 0; c.brake = 0; c.reverse = true; }
  } else { c.throttle = 0; c.brake = 0; c.reverse = false; }
}

function updateAI(dt) {
  if (!rival || !player) return;
  const r = rival;
  /* steer toward the player: heading error in the car frame */
  const dx = player.center.x - r.center.x;
  const dz = player.center.z - r.center.z;
  const fy = r.frame.fwd.x * dx + r.frame.fwd.z * dz;
  const rt = r.frame.right.x * dx + r.frame.right.z * dz;
  const want = clamp(rt / Math.max(2, Math.abs(fy)) * 1.6, -1, 1);
  r.controls.steer = lerp(r.controls.steer || 0, fy > 0 ? want : 0, Math.min(1, dt * 3.2));
  r.controls.throttle = fy > -4 ? 1 : 0.25;
  r.controls.brake = 0;
  if (r.damage.broken > 120) r.controls.throttle = 0;
}

function syncViews(dt) {
  for (const cv of CAR_VIEWS) cv.view.update(dt);
  slabMesh.position.copy(slab.pos);
  slabMesh.visible = slab.active;
}

let booted = false;
function frame(now) {
  const dtRaw = (now - lastFrame) / 1000;
  lastFrame = now;
  const dt = clamp(dtRaw, 0.0005, 0.05);
  fpsAvg = lerp(fpsAvg, 1 / Math.max(0.0005, dtRaw), 0.08);

  controlsFromKeys(dt);
  /* physics */
  const ts = TIME_SCALES[timeScaleIndex];
  accumulator += dt * ts;
  let steps = 0;
  const maxSteps = ts > 0.5 ? 34 : 12;
  while (accumulator >= H && steps < maxSteps) {
    worldStep(H, 1, false);
    accumulator -= H;
    steps++;
  }
  if (steps >= maxSteps) accumulator = Math.min(accumulator, H * 2);
  updateWorldStats(dt);
  updateAI(dt);

  /* grabbing */
  if (grabbedNode) {
    updateGrab(state.mx, state.my);
    grabRing.position.copy(grabbedNode.pos);
    const p = grabLineGeo.attributes.position;
    p.setXYZ(0, grabbedNode.pos.x, grabbedNode.pos.y, grabbedNode.pos.z);
    p.setXYZ(1, grabTarget.x, grabTarget.y, grabTarget.z);
    p.needsUpdate = true;
    grabLine.computeLineDistances();
  } else if (hoverNode) {
    grabRing.position.copy(hoverNode.pos);
  }
  grabRing.quaternion.copy(camera.quaternion);

  syncViews(dt);
  updateCamera(dt);
  updateHUD(dt);

  /* audio */
  if (Audio.ctx && player) {
    Audio.engine(player.rpm, player.throttle * 0.7 + Math.abs(player.steer) * 0.2, player.speed * 3.6, !player.engineDead);
  }
  /* impact sound */
  if (player) {
    let maxImp = 0;
    for (const n of player.nodes) maxImp = Math.max(maxImp, n.contactImpulse);
    for (const cv of CAR_VIEWS) for (const n of cv.car.nodes) maxImp = Math.max(maxImp, n.contactImpulse);
    if (maxImp > 3.4 && Audio.ctx && now - (Audio._lastCrash || 0) > 105) {
      Audio._lastCrash = now;
      Audio.crash(maxImp, player.center.x, player.center.z, { x: camera.position.x, z: camera.position.z });
    }
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);

  if (!booted) {
    booted = true;
    boot('online', 100);
    window.__jbeamReady = true;
    setTimeout(() => {
      el('boot').classList.add('gone');
      hud.classList.remove('hidden');
    }, 260);
  }
}

/* ------------------------------------------------ debug / automation hook */
window.__JBDEBUG = {
  get player() { return player; },
  get rival() { return rival; },
  CAR_VIEWS, WORLD, CAR_SPECS, changeVehicle, spawnRival, resetPlayer, dropPress,
  setXray, setTimeScale, setCamera, cycleXray, cycleTimeScale, cycleCamera,
  scene, camera, renderer, slab, keys, get timeScale() { return TIME_SCALES[timeScaleIndex]; },
  get grabNode() { return grabbedNode; },
  startGrab: beginGrab, releaseGrab
};

/* --------------------------------------------------------------- start --- */
function start() {
  boot('building player vehicle…', 55);
  initWorld('bastion');
  boot('skinning hull vertices…', 78);
  setCamera(0);
  updateZonesHUD(true);
  setXray(0);
  setTimeScale(0);
  document.querySelector('[data-car="bastion"]').classList.add('on');
  logEvent('SYSTEM', 'JBEAM SOLVER ONLINE · 840 Hz · 14 SUBSTEPS/FRAME', 1.4);
  logEvent('SYSTEM', 'BRUCKEL BASTION LOADED · ' + player.beams.length + ' BEAMS / ' + player.nodes.length + ' NODES', 1);
  boot('compiling shaders…', 92);
  lastFrame = performance.now();
  requestAnimationFrame(frame);
  setTimeout(() => { if (!window.__jbeamReady) fatal(new Error('render loop did not start')); }, 9000);
}
setTimeout(() => {
  try { start(); } catch (e) { fatal(e); }
}, 30);
