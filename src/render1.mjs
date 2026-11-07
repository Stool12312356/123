/* ============================================================================
   RENDER LAYER — WebGL scene, gridmap scenery, procedural audio
   ========================================================================== */
const bootMsgEl = document.getElementById('bootMsg');
const bootBarEl = document.getElementById('bootBar');
const errEl = document.getElementById('err');
function boot(msg, pct) {
  if (bootMsgEl) bootMsgEl.textContent = msg;
  if (bootBarEl && pct != null) bootBarEl.style.width = pct + '%';
}
function fatal(err) {
  console.error(err);
  const b = document.getElementById('boot');
  if (b) b.classList.remove('gone');
  if (errEl) { errEl.style.display = 'block'; errEl.textContent = 'ENGINE FAULT\n' + (err && err.stack ? err.stack : err); }
  if (bootMsgEl) bootMsgEl.textContent = 'initialization failed — see trace';
}
window.addEventListener('error', (e) => { if (!window.__jbeamReady) fatal(e.error || e.message); });

const DEV = { mobile: /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) };
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const _col = new THREE.Color();

/* ---------------------------------------------------------------- renderer */
boot('creating WebGL context…', 6);
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xb9c4cc, 150, 620);
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 1600);

boot('building sky…', 10);
{
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x415f7c) }, mid: { value: new THREE.Color(0xa8bdcc) }, bot: { value: new THREE.Color(0xe3e6e6) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; uniform vec3 top, mid, bot; void main(){ float h = normalize(vP).y; vec3 c = mix(bot, mid, smoothstep(-0.04, 0.30, h)); c = mix(c, top, smoothstep(0.22, 0.92, h)); gl_FragColor = vec4(c,1.0); }'
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(760, 24, 14), skyMat));
}

scene.add(new THREE.HemisphereLight(0xe8f0f7, 0x585349, 1.0));
const sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
sun.position.set(-42, 66, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(DEV.mobile ? 1024 : 2048, DEV.mobile ? 1024 : 2048);
sun.shadow.camera.left = -54; sun.shadow.camera.right = 54;
sun.shadow.camera.top = 54; sun.shadow.camera.bottom = -54;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 220;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xc2d6ea, 0.42);
fill.position.set(46, 28, -44);
scene.add(fill);

/* --------------------------------------------------------------- textures */
function canvasTexture(size, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat, repeat);
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}
const asphaltTex = canvasTexture(512, (g, s) => {
  g.fillStyle = '#5c6165'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 24000; i++) {
    const v = 42 + Math.random() * 104 | 0;
    g.fillStyle = 'rgba(' + v + ',' + (v + 2) + ',' + (v + 4) + ',' + (0.14 + Math.random() * 0.5) + ')';
    const r = Math.random() * 2.0 + 0.3;
    g.fillRect(Math.random() * s, Math.random() * s, r, r);
  }
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = 'rgba(30,32,35,' + (0.08 + Math.random() * 0.16) + ')';
    g.lineWidth = Math.random() * 1.5;
    g.beginPath();
    let x = Math.random() * s, y = Math.random() * s;
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (Math.random() - 0.5) * 80; y += (Math.random() - 0.5) * 80; g.lineTo(x, y); }
    g.stroke();
  }
}, 44);
const concreteTex = canvasTexture(256, (g, s) => {
  g.fillStyle = '#9d9b95'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 8000; i++) {
    const v = 118 + Math.random() * 80 | 0;
    g.fillStyle = 'rgba(' + v + ',' + v + ',' + (v - 5) + ',' + (0.08 + Math.random() * 0.38) + ')';
    g.fillRect(Math.random() * s, Math.random() * s, Math.random() * 2.6, Math.random() * 2.6);
  }
  g.strokeStyle = 'rgba(74,74,72,.3)'; g.lineWidth = 2;
  g.strokeRect(2, 2, s - 4, s - 4);
}, 2);
const hazardTex = canvasTexture(128, (g, s) => {
  g.fillStyle = '#d8d4c8'; g.fillRect(0, 0, s, s);
  g.strokeStyle = '#c8501a'; g.lineWidth = 16;
  for (let i = -s; i < s * 2; i += 34) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + s, s); g.stroke();
  }
}, 1);

/* ---------------------------------------------------------------- terrain */
boot('tessellating gridmap…', 16);
{
  const g = new THREE.PlaneGeometry(560, 560, 216, 216);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, groundHeight(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: asphaltTex, color: 0xb2b7bb, roughness: 0.93, metalness: 0.03 }));
  ground.receiveShadow = true;
  scene.add(ground);

  const paint = new THREE.MeshStandardMaterial({ color: 0xd6d2c4, roughness: 0.85 });
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.012, 0.9), paint);
    m.position.set(-2.2 + i * 0.6, 0.013, -3.4);
    scene.add(m);
  }
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.012, 0.16), paint);
    m.position.set(0, 0.013, 24 + i * 6);
    scene.add(m);
  }
  /* start gantry */
  const gantry = new THREE.Group();
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.5, roughness: 0.5 });
  for (const z of [-3.4, 3.4]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 4.2, 0.18), beamMat);
    post.position.set(-3.6, 2.1, z);
    post.castShadow = true;
    gantry.add(post);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.34, 7.4), beamMat);
  top.position.set(-3.6, 4.2, 0);
  top.castShadow = true;
  gantry.add(top);
  const banner = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 5.2),
    new THREE.MeshStandardMaterial({ map: hazardTex, color: 0xffffff, roughness: 0.7 }));
  banner.position.set(-3.72, 3.7, 0);
  gantry.add(banner);
  scene.add(gantry);
  /* tyre stacks */
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.95 });
  const tyreGeo = new THREE.TorusGeometry(0.33, 0.12, 6, 14);
  for (let i = 0; i < 18; i++) {
    const t = new THREE.Mesh(tyreGeo, tyreMat);
    t.rotation.x = Math.PI / 2;
    t.position.set(31.5 + (i % 2) * 0.06, 0.13, -13 + (i % 9) * 2.2);
    t.castShadow = true;
    scene.add(t);
  }
  /* distance markers / cones around the bollard */
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xd9581c, roughness: 0.75 });
  for (let i = 0; i < 10; i++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.62, 10), coneMat);
    c.position.set(18 + (i % 5) * 2.2, 0.31, (i < 5 ? -6.5 : 6.5));
    c.castShadow = true;
    scene.add(c);
  }
}

/* ----------------------------------------------------- obstacle meshes ---- */
boot('placing crash obstacles…', 22);
const steelMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.92, roughness: 0.3 });
const concreteMat = new THREE.MeshStandardMaterial({ map: concreteTex, color: 0xb8b5ad, roughness: 0.92, metalness: 0.03 });
const OBSTACLE_MESHES = [];
for (const o of obstacles) {
  let mesh;
  if (o.type === 'cyl') {
    mesh = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r * 1.04, o.h, 20, 1), steelMat);
    mesh.position.set(o.x, o.h / 2, o.z);
    /* hazard band */
    const band = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 1.03, o.r * 1.03, 0.42, 20, 1),
      new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.7 }));
    band.position.y = o.h * 0.5 - 0.5;
    mesh.add(band);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 1.6, o.r * 1.8, 0.09, 16), steelMat);
    base.position.set(o.x, 0.045, o.z);
    base.receiveShadow = true;
    scene.add(base);
  } else {
    mesh = new THREE.Mesh(new THREE.BoxGeometry(o.sx, o.sy, o.sz), concreteMat);
    mesh.position.set(o.x, o.y, o.z);
  }
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  OBSTACLE_MESHES.push(mesh);
}
/* concrete wedge: a real sloped block over the stepped colliders */
{
  const shape = new THREE.Shape();
  shape.moveTo(-1.2, 0); shape.lineTo(1.2, 0); shape.lineTo(1.2, 1.75); shape.lineTo(-1.2, 0.02);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 3.6, bevelEnabled: false });
  g.rotateY(Math.PI / 2);
  const m = new THREE.Mesh(g, concreteMat);
  m.position.set(30.6, 0, -9.0);
  m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
}

/* hydraulic press used for the roof crush scenario */
const slabMesh = new THREE.Mesh(new THREE.BoxGeometry(slab.size.x, slab.size.y, slab.size.z),
  new THREE.MeshStandardMaterial({ map: hazardTex, color: 0xffffff, roughness: 0.8, metalness: 0.1 }));
slabMesh.castShadow = true; slabMesh.receiveShadow = true;
slabMesh.visible = false;
scene.add(slabMesh);
/* press guide rails */
const pressGantry = new THREE.Group();
{
  const railMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, metalness: 0.6, roughness: 0.5 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 9, 0.16), railMat);
    rail.position.set(sx * 1.7, 4.5, sz * 1.65);
    rail.castShadow = true;
    pressGantry.add(rail);
  }
  pressGantry.visible = false;
  scene.add(pressGantry);
}

/* ============================================================ AUDIO ====== */
const Audio = {
  ctx: null, master: null, enabled: true, started: false,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    /* engine: two detuned saws through a lowpass */
    this.engGain = this.ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = this.ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 900; this.engFilter.Q.value = 3.5;
    this.o1 = this.ctx.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = this.ctx.createOscillator(); this.o2.type = 'square';
    this.o3 = this.ctx.createOscillator(); this.o3.type = 'sawtooth';
    const g1 = this.ctx.createGain(); g1.gain.value = 0.5;
    const g2 = this.ctx.createGain(); g2.gain.value = 0.22;
    const g3 = this.ctx.createGain(); g3.gain.value = 0.14;
    this.o1.connect(g1); this.o2.connect(g2); this.o3.connect(g3);
    g1.connect(this.engFilter); g2.connect(this.engFilter); g3.connect(this.engFilter);
    this.engFilter.connect(this.engGain); this.engGain.connect(this.master);
    this.o1.start(); this.o2.start(); this.o3.start();
    /* wind noise */
    const bufSize = 2 * this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
    this.noise = this.ctx.createBufferSource();
    this.noise.buffer = buf; this.noise.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 700; this.windFilter.Q.value = 0.7;
    this.windGain = this.ctx.createGain(); this.windGain.gain.value = 0;
    this.noise.connect(this.windFilter); this.windFilter.connect(this.windGain); this.windGain.connect(this.master);
    this.noise.start();
    this.started = true;
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  engine(rpm, load, speed, alive) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const f = clamp(rpm / 60 * 2.2, 22, 260);
    this.o1.frequency.setTargetAtTime(f, t, 0.04);
    this.o2.frequency.setTargetAtTime(f * 0.5, t, 0.04);
    this.o3.frequency.setTargetAtTime(f * 1.503, t, 0.04);
    this.engFilter.frequency.setTargetAtTime(420 + rpm * 0.16 + load * 700, t, 0.05);
    const vol = alive ? (0.045 + 0.075 * clamp(rpm / 7000, 0, 1) + 0.05 * load) : 0;
    this.engGain.gain.setTargetAtTime(vol, t, 0.08);
    this.windGain.gain.setTargetAtTime(clamp(speed / 60, 0, 1) * 0.055, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(500 + speed * 26, t, 0.2);
  },
  crash(intensity, x, z, listener) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const dist = listener ? Math.hypot(x - listener.x, z - listener.z) : 0;
    const att = clamp(1 - dist / 90, 0, 1);
    const vol = clamp(intensity / 26, 0.05, 1) * att * 0.85;
    if (vol < 0.02) return;
    /* noise burst */
    const src = this.ctx.createBufferSource();
    const len = Math.floor(this.ctx.sampleRate * 0.45);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = Math.pow(1 - i / len, 2.6);
      d[i] = (Math.random() * 2 - 1) * env;
    }
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 240 + Math.random() * 520;
    bp.Q.value = 0.8;
    const g = this.ctx.createGain(); g.gain.value = vol;
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t);
    /* metal ring */
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(120 + Math.random() * 220, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.35);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(vol * 0.35, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(og); og.connect(this.master);
    o.start(t); o.stop(t + 0.42);
  },
  scrape(intensity) {
    if (!this.ctx || !this.enabled || intensity < 0.02) return;
    this.windGain.gain.setTargetAtTime(clamp(intensity, 0, 0.09), this.ctx.currentTime, 0.05);
  },
  toggle() {
    this.enabled = !this.enabled;
    if (this.master) this.master.gain.setTargetAtTime(this.enabled ? 0.5 : 0, this.ctx.currentTime, 0.05);
    return this.enabled;
  }
};
