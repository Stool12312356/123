import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { DayTime, QualitySettings, Weather, WorldSpec } from '../shared/types';
import { clamp, lerp } from '../shared/mathx';

export interface SkyPalette { top: THREE.Color; horizon: THREE.Color; sun: THREE.Color; fog: THREE.Color; sunPos: THREE.Vector3; ambient: number; exposure: number }
export function skyPalette(time: DayTime, weather: Weather): SkyPalette {
  const base: Record<DayTime, SkyPalette> = {
    dawn: { top: new THREE.Color('#5b7396'), horizon: new THREE.Color('#e0a277'), sun: new THREE.Color('#ffcfa0'), fog: new THREE.Color('#c9b6ab'), sunPos: new THREE.Vector3(0.6, 0.16, 0.7), ambient: 0.55, exposure: 1.05 },
    day: { top: new THREE.Color('#7fa6cc'), horizon: new THREE.Color('#cfd9de'), sun: new THREE.Color('#fff6e0'), fog: new THREE.Color('#c6cdd2'), sunPos: new THREE.Vector3(0.45, 0.85, 0.3), ambient: 0.8, exposure: 1.0 },
    dusk: { top: new THREE.Color('#4c5a7c'), horizon: new THREE.Color('#d78058'), sun: new THREE.Color('#ff9a5e'), fog: new THREE.Color('#9e8a83'), sunPos: new THREE.Vector3(-0.7, 0.13, 0.5), ambient: 0.45, exposure: 1.1 },
    night: { top: new THREE.Color('#0a1424'), horizon: new THREE.Color('#28384c'), sun: new THREE.Color('#8fa8c8'), fog: new THREE.Color('#18222e'), sunPos: new THREE.Vector3(-0.3, 0.35, 0.8), ambient: 0.22, exposure: 1.35 }
  };
  const p = { ...base[time] };
  if (weather === 'fog') { p.fog = p.fog.clone().lerp(new THREE.Color('#aab0b2'), 0.5); p.ambient *= 0.9; }
  if (weather === 'rain') { p.top = p.top.clone().lerp(new THREE.Color('#58636d'), 0.55); p.horizon = p.horizon.clone().lerp(new THREE.Color('#818b92'), 0.55); p.fog = new THREE.Color('#79838a'); p.ambient *= 1.05; }
  if (weather === 'snow') { p.top = new THREE.Color('#a8b7c4'); p.horizon = new THREE.Color('#e2e8ec'); p.fog = new THREE.Color('#d7dee3'); p.sun = new THREE.Color('#eef4ff'); p.ambient = 1.15; p.exposure = 0.95; }
  return p;
}

const MotionBlurShader = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0.35 }, center: { value: new THREE.Vector2(0.5, 0.5) }, aspect: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float amount; uniform vec2 center; varying vec2 vUv;
    void main(){ vec4 sum = vec4(0.0); vec2 dir = (vUv - center) * amount * 0.06;
      sum += texture2D(tDiffuse, vUv) * 0.4;
      sum += texture2D(tDiffuse, vUv - dir) * 0.25;
      sum += texture2D(tDiffuse, vUv - dir * 2.0) * 0.2;
      sum += texture2D(tDiffuse, vUv - dir * 3.0) * 0.15;
      gl_FragColor = sum; }`
};

export class RenderCore {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  composer!: EffectComposer;
  bloom!: UnrealBloomPass;
  ssao!: SSAOPass;
  motion!: ShaderPass;
  sun!: THREE.DirectionalLight;
  cascades: THREE.DirectionalLight[] = [];
  hemi!: THREE.HemisphereLight;
  sky!: THREE.Mesh;
  terrain!: THREE.Mesh;
  terrainGeo!: THREE.BufferGeometry;
  water: THREE.Mesh | null = null;
  quality: QualitySettings;
  palette: SkyPalette = skyPalette('day', 'clear');
  fps = 0; frames = 0; lastFps = performance.now();
  frameTimes: number[] = [];
  autoScale = 1;
  contextLost = false;
  canvas: HTMLCanvasElement;
  onContextLost?: () => void;
  debrisInstances: THREE.InstancedMesh | null = null;
  weatherParticles: THREE.Points | null = null;
  private craters: { x: number; z: number; r: number; depth: number }[] = [];
  rainVel: Float32Array | null = null;

  constructor(canvas: HTMLCanvasElement, quality: QualitySettings) {
    this.canvas = canvas;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.shadows > 0, powerPreference: 'high-performance', stencil: false, logarithmicDepthBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * quality.resolution);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = quality.shadows > 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(quality.fov, window.innerWidth / window.innerHeight, 0.1, 4000);
    this.camera.position.set(0, 3, 8);
    this.scene.fog = new THREE.Fog(0xc6cdd2, 180, quality.drawDistance);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.contextLost = true; this.onContextLost?.(); });
    canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false; });
    this.buildLights();
    this.buildSky();
    this.buildComposer();
    // the menu renders before the first match, so the sky/lighting must be valid from frame 1
    // (applyTimeOfDay also builds the weather particle system for the preset)
    this.applyTimeOfDay('day', 'clear');
    window.addEventListener('resize', () => this.resize());
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xbcd6f0, 0x4a4034, 0.85);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4dd, 2.1);
    this.sun.castShadow = this.quality.shadows > 0;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -90; this.sun.shadow.camera.right = 90;
    this.sun.shadow.camera.top = 90; this.sun.shadow.camera.bottom = -90;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 500;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    // two coarse cascades for the big map beyond the tight cascade
    for (let i = 0; i < 2; i++) {
      const l = new THREE.DirectionalLight(0xfff4dd, 0.55);
      const size = i === 0 ? 260 : 620;
      l.castShadow = false;
      l.shadow.camera.left = -size; l.shadow.camera.right = size; l.shadow.camera.top = size; l.shadow.camera.bottom = -size;
      l.shadow.mapSize.set(1024, 1024);
      this.cascades.push(l);
      this.scene.add(l); this.scene.add(l.target);
    }
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(3200, 32, 16);
    const mat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color() }, weatherMix: { value: 0 } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform float weatherMix; varying vec3 vDir;
        void main(){ float h = clamp(vDir.y * 1.4 + 0.12, 0.0, 1.0);
          vec3 col = mix(horizon, top, pow(h, 0.75));
          float sun = pow(max(dot(normalize(vDir), normalize(sunDir)), 0.0), 220.0);
          float glow = pow(max(dot(normalize(vDir), normalize(sunDir)), 0.0), 6.0) * 0.28;
          col += sunColor * (sun * 2.2 + glow * weatherMix);
          gl_FragColor = vec4(col, 1.0); }`,
      side: THREE.BackSide, depthWrite: false, fog: false
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  applyTimeOfDay(time: DayTime, weather: Weather) {
    this.palette = skyPalette(time, weather);
    const p = this.palette;
    this.sun.color.copy(p.sun);
    this.sun.intensity = time === 'night' ? 0.35 : weather === 'snow' ? 1.7 : 2.1;
    this.sun.position.copy(p.sunPos).multiplyScalar(160);
    this.hemi.intensity = p.ambient;
    this.hemi.color.copy(p.top).lerp(new THREE.Color(0xffffff), 0.4);
    (this.scene.fog as THREE.Fog).color.copy(p.fog);
    (this.scene.fog as THREE.Fog).near = weather === 'fog' ? 30 : 180;
    (this.scene.fog as THREE.Fog).far = weather === 'fog' ? 420 : weather === 'rain' ? 700 : this.quality.drawDistance;
    this.renderer.toneMappingExposure = p.exposure;
    this.renderer.setClearColor(p.fog);
    const skyMat = this.sky.material as THREE.ShaderMaterial;
    skyMat.uniforms.top.value.copy(p.top);
    skyMat.uniforms.horizon.value.copy(p.horizon);
    skyMat.uniforms.sunDir.value.copy(p.sunPos);
    skyMat.uniforms.sunColor.value.copy(p.sun);
    skyMat.uniforms.weatherMix.value = weather === 'clear' ? 1 : 0.15;
    this.buildWeather(weather);
  }

  buildWeather(weather: Weather) {
    if (this.weatherParticles) { this.scene.remove(this.weatherParticles); this.weatherParticles.geometry.dispose(); this.weatherParticles = null; }
    if (weather === 'clear') return;
    const count = Math.round(3000 * clamp(this.quality.particles, 0.2, 2));
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 160;
      pos[i * 3 + 1] = Math.random() * 60;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 160;
    }
    this.rainVel = new Float32Array(count);
    for (let i = 0; i < count; i++) this.rainVel[i] = 0.5 + Math.random();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: weather === 'snow' ? 0xffffff : 0xa9c2d6, size: weather === 'snow' ? 0.42 : 0.12, transparent: true, opacity: weather === 'snow' ? 0.85 : 0.5, depthWrite: false, sizeAttenuation: true });
    this.weatherParticles = new THREE.Points(geo, mat);
    this.weatherParticles.frustumCulled = false;
    this.scene.add(this.weatherParticles);
  }

  buildComposer() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.quality.ssao) {
      this.ssao = new SSAOPass(this.scene, this.camera, window.innerWidth, window.innerHeight);
      this.ssao.kernelRadius = 8; this.ssao.minDistance = 0.002; this.ssao.maxDistance = 0.15;
      this.composer.addPass(this.ssao);
    }
    if (this.quality.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.42, 0.7, 0.82);
      this.composer.addPass(this.bloom);
    }
    this.motion = new ShaderPass(MotionBlurShader);
    this.motion.enabled = this.quality.motionBlur;
    this.composer.addPass(this.motion);
    this.composer.addPass(new OutputPass());
  }

  private staticTerrain: THREE.Object3D[] = [];

  buildTerrain(spec: WorldSpec) {
    // a new match rebuilds the terrain: release the previous terrain / road ribbons / water
    for (const o of this.staticTerrain) {
      this.scene.remove(o);
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const m = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(m)) m.forEach(x => x.dispose()); else m?.dispose?.();
    }
    this.staticTerrain = [];
    this.craters = [];
    this.terrainGeo?.dispose?.();
    this.terrain = undefined as unknown as THREE.Mesh;
    this.water = null;
    const n = spec.res;
    const geo = new THREE.PlaneGeometry(spec.size, spec.size, n, n);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const idx = (i: number) => spec.heights[i];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const vi = j * (n + 1) + i;
      const x = pos.getX(vi), z = pos.getZ(vi);
      const h = idx(vi);
      pos.setY(vi, h);
      const urban = spec.urban.some(u => (u.x - x) ** 2 + (u.z - z) ** 2 < u.r * u.r);
      const wet = spec.water ? clamp((spec.water.level + 2 - h) / 4, 0, 1) : 0;
      let c: THREE.Color;
      if (spec.weather === 'snow') c = new THREE.Color('#dfe6ea').lerp(new THREE.Color('#b9c2c8'), Math.random() * 0.25);
      else if (wet > 0.15) c = new THREE.Color('#5c5b4c').lerp(new THREE.Color('#7a7358'), Math.random() * 0.3);
      else if (urban) c = new THREE.Color('#6d6a60').lerp(new THREE.Color('#5d5a52'), Math.random() * 0.45);
      else c = new THREE.Color('#6b6d4e').lerp(new THREE.Color('#82805a'), Math.random() * 0.5);
      const slope = Math.abs(idx(Math.min(vi + 1, vi)) - h) + Math.abs(idx(Math.min(vi + n + 1, vi)) - h);
      if (slope > 1.4) c.lerp(new THREE.Color('#57503f'), 0.4);
      colors[vi * 3] = c.r; colors[vi * 3 + 1] = c.g; colors[vi * 3 + 2] = c.b;
    }
    pos.needsUpdate = true;
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02, flatShading: false });
    this.terrain = new THREE.Mesh(geo, mat);
    this.terrain.receiveShadow = true;
    this.terrain.name = 'terrain';
    this.scene.add(this.terrain);
    this.staticTerrain.push(this.terrain);
    this.terrainGeo = geo;
    // roads as subtle decals (cheap ribbons of slightly darker ground)
    const roadMat = new THREE.MeshStandardMaterial({ color: spec.weather === 'snow' ? 0x9aa3a8 : 0x4b4a46, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const points: THREE.Vector3[] = [];
    for (const road of spec.roads) for (const p of road) points.push(new THREE.Vector3(p.x, 0, p.z));
    if (points.length) {
      const inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2), roadMat, points.length);
      const m = new THREE.Matrix4();
      points.forEach((p, i) => {
        const y = this.sampleHeight(spec, p.x, p.z) + 0.05;
        m.makeTranslation(p.x, y, p.z);
        inst.setMatrixAt(i, m);
      });
      inst.receiveShadow = true;
      inst.frustumCulled = false;
      this.scene.add(inst);
      this.staticTerrain.push(inst);
    }
    if (spec.water) this.buildWater(spec);
  }

  sampleHeight(spec: WorldSpec, x: number, z: number) {
    const n = spec.res, cell = spec.size / n;
    const fx = clamp((x + spec.size / 2) / cell, 0, n - 1e-6), fz = clamp((z + spec.size / 2) / cell, 0, n - 1e-6);
    const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
    const H = (i: number, j: number) => spec.heights[Math.min(n, Math.max(0, j)) * (n + 1) + Math.min(n, Math.max(0, i))];
    return lerp(lerp(H(ix, iz), H(ix + 1, iz), tx), lerp(H(ix, iz + 1), H(ix + 1, iz + 1), tx), tz);
  }

  buildWater(spec: WorldSpec) {
    const w = spec.water!;
    const geo = new THREE.PlaneGeometry(w.rx * 2.4, w.rz * 2.4, 96, 96);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, colorA: { value: new THREE.Color('#20313a') }, colorB: { value: new THREE.Color('#4a6b72') }, sunDir: { value: new THREE.Vector3(0, 1, 0) } },
      vertexShader: `uniform float time; varying vec3 vPos; varying float vWave;
        float gerstner(vec2 p, vec2 dir, float steep, float waveLen, float speed, float t){ float k = 6.28318 / waveLen; float f = k * dot(dir, p) - speed * t; return steep * sin(f); }
        void main(){ vec3 p = position; float w1 = gerstner(p.xz, normalize(vec2(1.0,0.3)), 0.12, 34.0, 1.4, time);
          float w2 = gerstner(p.xz, normalize(vec2(-0.4,1.0)), 0.09, 19.0, 1.9, time);
          float w3 = gerstner(p.xz, normalize(vec2(0.7,-0.8)), 0.06, 9.0, 2.6, time);
          p.y += w1 + w2 + w3; vWave = w1 + w2 + w3; vPos = p; gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }`,
      fragmentShader: `uniform vec3 colorA; uniform vec3 colorB; uniform float time; uniform vec3 sunDir; varying vec3 vPos; varying float vWave;
        void main(){ float diff = clamp(vWave * 3.0 + 0.45, 0.0, 1.0); vec3 col = mix(colorA, colorB, diff);
          float spec = pow(max(vWave * 1.4 + 0.2, 0.0), 5.0);
          col += vec3(0.55,0.62,0.6) * spec * 0.6;
          gl_FragColor = vec4(col, 0.9); }`,
      transparent: true, side: THREE.DoubleSide
    });
    this.water = new THREE.Mesh(geo, mat);
    this.water.rotation.y = w.rotation;
    this.water.position.set(w.cx, w.level, w.cz);
    this.water.receiveShadow = false;
    this.water.name = 'water';
    this.scene.add(this.water);
    this.staticTerrain.push(this.water);
  }

  addCrater(crater: { x: number; z: number; r: number; depth: number }, spec: WorldSpec) {
    this.craters.push(crater);
    const pos = this.terrainGeo.attributes.position as THREE.BufferAttribute;
    const n = spec.res, cell = spec.size / n;
    const half = spec.size / 2;
    const xs = Math.max(0, Math.floor((crater.x - crater.r + half) / cell)), xe = Math.min(n, Math.ceil((crater.x + crater.r + half) / cell));
    const zs = Math.max(0, Math.floor((crater.z - crater.r + half) / cell)), ze = Math.min(n, Math.ceil((crater.z + crater.r + half) / cell));
    for (let j = zs; j <= ze; j++) for (let i = xs; i <= xe; i++) {
      const vi = j * (n + 1) + i;
      const x = pos.getX(vi), z = pos.getZ(vi);
      const d = Math.hypot(x - crater.x, z - crater.z);
      if (d > crater.r) continue;
      pos.setY(vi, pos.getY(vi) - crater.depth * Math.pow(1 - d / crater.r, 1.7));
    }
    pos.needsUpdate = true;
    this.terrainGeo.computeVertexNormals();
    this.terrainGeo.attributes.position.needsUpdate = true;
  }

  setQuality(q: QualitySettings) {
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * q.resolution);
    this.renderer.shadowMap.enabled = q.shadows > 0;
    this.sun.castShadow = q.shadows > 0;
    this.sun.shadow.mapSize.set(q.shadows >= 2 ? 2048 : 1024, q.shadows >= 2 ? 2048 : 1024);
    if (this.bloom) this.bloom.enabled = q.bloom;
    if (this.ssao) this.ssao.enabled = q.ssao;
    if (this.motion) this.motion.enabled = q.motionBlur;
    this.camera.fov = q.fov;
    this.camera.updateProjectionMatrix();
    (this.scene.fog as THREE.Fog).far = q.drawDistance;
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    if (this.motion) this.motion.uniforms.aspect.value = w / h;
  }

  /** auto quality: lowers resolution/shadows when the frame budget is exceeded */
  autoQuality(dt: number) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    this.frames++;
    const now = performance.now();
    if (now - this.lastFps > 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.lastFps));
      this.frames = 0; this.lastFps = now;
    }
    if (!this.quality.auto) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / Math.max(1, this.frameTimes.length);
    if (avg > 0.028 && this.autoScale > 0.55) { this.autoScale -= 0.05; this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.quality.resolution * this.autoScale); }
    else if (avg < 0.0135 && this.autoScale < 1) { this.autoScale += 0.02; this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.quality.resolution * this.autoScale); }
  }

  render(dt: number, camera: THREE.Camera, overlay?: { scene: THREE.Scene; camera: THREE.Camera }) {
    if (this.contextLost) return;
    if (this.sky) this.sky.position.copy(camera.position);
    this.sun.target.position.set(camera.position.x, 0, camera.position.z);
    this.sun.position.set(camera.position.x + this.palette.sunPos.x * 180, this.palette.sunPos.y * 220, camera.position.z + this.palette.sunPos.z * 180);
    for (const c of this.cascades) { c.target.position.set(camera.position.x, 0, camera.position.z); c.position.copy(this.sun.position); }
    if (this.water) (this.water.material as THREE.ShaderMaterial).uniforms.time.value += dt;
    if (this.weatherParticles) {
      const p = this.weatherParticles.geometry.attributes.position as THREE.BufferAttribute;
      const arr = p.array as Float32Array;
      const snow = this.quality.particles > 0 && this.rainVel != null;
      for (let i = 0; i < p.count; i++) {
        arr[i * 3 + 1] -= (snow ? 4 : 32) * (this.rainVel?.[i] ?? 1) * dt;
        if (snow) arr[i * 3] += Math.sin(performance.now() / 900 + i) * dt * 1.5;
        if (arr[i * 3 + 1] < 0) { arr[i * 3 + 1] = 55; arr[i * 3] = camera.position.x + (Math.random() - 0.5) * 140; arr[i * 3 + 2] = camera.position.z + (Math.random() - 0.5) * 140; }
        else {
          if (Math.abs(arr[i * 3] - camera.position.x) > 90) arr[i * 3] = camera.position.x + (Math.random() - 0.5) * 140;
          if (Math.abs(arr[i * 3 + 2] - camera.position.z) > 90) arr[i * 3 + 2] = camera.position.z + (Math.random() - 0.5) * 140;
        }
      }
      p.needsUpdate = true;
    }
    if (this.quality.ssao || this.quality.bloom || this.quality.motionBlur) this.composer.render(dt);
    else this.renderer.render(this.scene, camera);
    if (overlay) {
      // first-person viewmodel pass into the same target (composer read/write buffer),
      // with a cleared depth buffer so the weapon never clips into world geometry.
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      const target = this.composer ? this.composer.readBuffer : null;
      this.renderer.setRenderTarget(target);
      this.renderer.render(overlay.scene, overlay.camera);
      this.renderer.setRenderTarget(null);
      this.renderer.autoClear = true;
    }
  }

  dispose() {
    this.scene.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const m = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(m)) m.forEach(mm => mm.dispose()); else m?.dispose?.();
    });
    this.renderer.dispose();
    this.composer?.passes.forEach(p => p.dispose?.());
  }
}
