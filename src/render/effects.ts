import * as THREE from 'three';
import type { GameEvent, Vec3, Weather } from '../shared/types';
import { clamp, mulberry32 } from '../shared/mathx';

interface Particle { life: number; maxLife: number; pos: THREE.Vector3; vel: THREE.Vector3; size: number; color: THREE.Color; kind: 'dust' | 'fire' | 'smoke' | 'spark' | 'tracer' | 'blood' | 'chip'; gravity: number; drag: number }
type SpawnOpts = { pos: Vec3; vel?: Vec3; life?: number; size?: number; color?: THREE.Color; kind?: Particle['kind']; gravity?: number; drag?: number };
interface Decal { mesh: THREE.Mesh; born: number; life: number }
interface CameraShake { amp: number; t: number }

const SPRITE = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();

function chipTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3a3630';
  ctx.beginPath();
  ctx.moveTo(16, 1); ctx.lineTo(30, 9); ctx.lineTo(26, 29); ctx.lineTo(7, 30); ctx.lineTo(2, 12);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#6d675c'; ctx.fillRect(8, 8, 8, 6);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

export class Effects {
  scene: THREE.Scene;
  points: THREE.Points;
  geo: THREE.BufferGeometry;
  particles: Particle[] = [];
  max: number;
  decals: Decal[] = [];
  maxDecals = 220;
  chips: THREE.Points;
  chipData: { pos: THREE.Vector3; vel: THREE.Vector3; life: number; size: number }[] = [];
  maxChips = 900;
  shakes: CameraShake[] = [];
  tracers: { mesh: THREE.Mesh; life: number }[] = [];
  tracerPool: THREE.Mesh[] = [];
  dustClouds: { mesh: THREE.Sprite; life: number; maxLife: number; radius: number }[] = [];
  rng = mulberry32(991);
  quality = 1;
  explosionsLight: THREE.PointLight[] = [];
  private chipGeo: THREE.BufferGeometry;
  private chipMat: THREE.PointsMaterial;
  private dustTex: THREE.Texture;

  constructor(scene: THREE.Scene, quality = 1) {
    this.scene = scene;
    this.quality = quality;
    this.max = Math.round(4200 * quality);
    this.geo = new THREE.BufferGeometry();
    const pos = new Float32Array(this.max * 3);
    const color = new Float32Array(this.max * 3);
    const size = new Float32Array(this.max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('pcolor', new THREE.BufferAttribute(color, 3));
    this.geo.setAttribute('psize', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: SPRITE }, pixelRatio: { value: Math.min(2, window.devicePixelRatio) } },
      vertexShader: `attribute vec3 pcolor; attribute float psize; varying vec3 vColor; uniform float pixelRatio;
        void main(){ vColor = pcolor; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = psize * pixelRatio * 320.0 / max(-mv.z, 1.0);
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; varying vec3 vColor;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); if (t.a < 0.02) discard; gl_FragColor = vec4(vColor, t.a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    // concrete chips use normal blending (opaque-looking debris sparks)
    this.chipGeo = new THREE.BufferGeometry();
    const cpos = new Float32Array(this.maxChips * 3);
    this.chipGeo.setAttribute('position', new THREE.BufferAttribute(cpos, 3));
    this.chipMat = new THREE.PointsMaterial({ size: 0.22, map: chipTexture(), transparent: true, depthWrite: false, alphaTest: 0.2, color: 0x9c958a });
    this.chips = new THREE.Points(this.chipGeo, this.chipMat);
    this.chips.frustumCulled = false;
    scene.add(this.chips);
    this.dustTex = SPRITE;
    // pooled tracers
    const tgeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 4, 1, true);
    tgeo.rotateX(Math.PI / 2);
    const tmat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 90; i++) {
      const m = new THREE.Mesh(tgeo, tmat);
      m.visible = false; m.frustumCulled = false;
      scene.add(m);
      this.tracerPool.push(m);
    }
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffa347, 0, 60, 2);
      scene.add(l);
      this.explosionsLight.push(l);
    }
  }

  spawn(p: SpawnOpts) {
    if (this.particles.length >= this.max) this.particles.shift();
    this.particles.push({
      life: p.life ?? 1, maxLife: p.life ?? 1, pos: new THREE.Vector3(...p.pos),
      vel: new THREE.Vector3(...(p.vel ?? [0, 1, 0])), size: p.size ?? 1,
      color: p.color ?? new THREE.Color(1, 1, 1), kind: p.kind ?? 'dust', gravity: p.gravity ?? -1.4, drag: p.drag ?? 0.6
    });
  }

  explosion(pos: Vec3, radius: number, kind = 'shell') {
    const light = this.explosionsLight.find(l => l.intensity <= 0.1) ?? this.explosionsLight[0];
    light.position.set(...pos); light.intensity = 900 + radius * 60; light.distance = radius * 6;
    const n = Math.round((26 + radius * 8) * this.quality);
    for (let i = 0; i < n; i++) {
      const dir = new THREE.Vector3(this.rng() - 0.5, this.rng() * 0.9, this.rng() - 0.5).normalize();
      const speed = 6 + this.rng() * radius * 1.8;
      this.spawn({
        pos: [pos[0] + dir.x, pos[1] + dir.y, pos[2] + dir.z], vel: [dir.x * speed, dir.y * speed + 4, dir.z * speed],
        life: 0.5 + this.rng() * 1.1, size: 1.4 + this.rng() * radius * 0.35,
        color: new THREE.Color().setHSL(0.07 + this.rng() * 0.04, 1, 0.55), kind: 'fire', gravity: 3, drag: 2.2
      });
    }
    for (let i = 0; i < n * 0.7; i++) {
      const dir = new THREE.Vector3(this.rng() - 0.5, this.rng() * 0.6 + 0.1, this.rng() - 0.5).normalize();
      this.spawn({
        pos: [pos[0] + dir.x * 2, pos[1] + 1, pos[2] + dir.z * 2], vel: [dir.x * 4, 2 + this.rng() * 3, dir.z * 4],
        life: 1.6 + this.rng() * 2.4, size: radius * 0.5 + this.rng() * 2, color: new THREE.Color(0.28, 0.26, 0.24),
        kind: 'smoke', gravity: 0.6, drag: 0.9
      });
    }
    for (let i = 0; i < n * 0.8; i++) {
      const dir = new THREE.Vector3(this.rng() - 0.5, this.rng() * 0.8, this.rng() - 0.5).normalize();
      this.spawn({ pos: [...pos], vel: [dir.x * 22, dir.y * 18 + 4, dir.z * 22], life: 0.5 + this.rng(), size: 0.35, color: new THREE.Color(1, 0.8, 0.4), kind: 'spark', gravity: -9, drag: 0.2 });
    }
    this.spawnDustCloud(pos, radius * 1.3, 2.4);
    this.addShake(clamp(radius / 10, 0.15, 1.3), 0.65);
  }

  spawnDustCloud(pos: Vec3, radius: number, life: number) {
    const mat = new THREE.SpriteMaterial({ map: this.dustTex, color: 0x8f887c, transparent: true, opacity: 0.62, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(...pos);
    sprite.scale.setScalar(radius);
    this.scene.add(sprite);
    this.dustClouds.push({ mesh: sprite, life, maxLife: life, radius });
  }

  impact(pos: Vec3, normal: Vec3, material: string) {
    const matColor = material === 'metal' ? new THREE.Color(1, 0.85, 0.5) : material === 'wood' ? new THREE.Color(0.55, 0.42, 0.26) : material === 'flesh' ? new THREE.Color(0.55, 0.05, 0.05) : new THREE.Color(0.72, 0.68, 0.6);
    const n = matColor.r > 0.9 ? 8 : Math.round(5 * this.quality);
    for (let i = 0; i < n; i++) {
      this.spawn({
        pos: [pos[0] + normal[0] * 0.1, pos[1] + normal[1] * 0.1, pos[2] + normal[2] * 0.1],
        vel: [normal[0] * 3 + (this.rng() - 0.5) * 4, normal[1] * 3 + this.rng() * 3, normal[2] * 3 + (this.rng() - 0.5) * 4],
        life: 0.25 + this.rng() * 0.6, size: 0.35 + this.rng() * 0.7, color: matColor, kind: 'dust', gravity: -5, drag: 1.5
      });
    }
    if (matColor.r > 0.9) {
      for (let i = 0; i < 4; i++) this.spawn({ pos: [...pos], vel: [(this.rng() - 0.5) * 12, this.rng() * 8, (this.rng() - 0.5) * 12], life: 0.25, size: 0.18, color: new THREE.Color(1, 0.75, 0.3), kind: 'spark', gravity: -12, drag: 0.5 });
    } else if (this.chipData.length < this.maxChips) {
      for (let i = 0; i < 3; i++) this.chipData.push({
        pos: new THREE.Vector3(...pos), vel: new THREE.Vector3(normal[0] * 3 + (this.rng() - 0.5) * 5, normal[1] * 3 + this.rng() * 5, normal[2] * 3 + (this.rng() - 0.5) * 5),
        life: 0.4 + this.rng() * 0.5, size: 0.6 + this.rng() * 0.9
      });
    }
    this.addDecal(pos, normal, material, 0.35 + this.rng() * 0.35);
  }

  addDecal(pos: Vec3, normal: Vec3, material: string, size: number) {
    if (this.decals.length > this.maxDecals) {
      const d = this.decals.shift();
      if (d) { this.scene.remove(d.mesh); d.mesh.geometry.dispose(); (d.mesh.material as THREE.Material).dispose(); }
    }
    const geo = new THREE.CircleGeometry(size, 7);
    const isMetal = material === 'metal' || material === 'armor';
    const mat = new THREE.MeshBasicMaterial({
      color: isMetal ? 0x1a1a1a : material === 'flesh' ? 0x5a0b0b : 0x2a2823, transparent: true, opacity: isMetal ? 0.85 : 0.75,
      polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos[0] + normal[0] * 0.03, pos[1] + normal[1] * 0.03, pos[2] + normal[2] * 0.03);
    mesh.lookAt(mesh.position.clone().add(new THREE.Vector3(...normal)));
    this.scene.add(mesh);
    this.decals.push({ mesh, born: performance.now(), life: 45000 });
    void isMetal;
  }

  tracer(from: Vec3, to: Vec3, friendly = true) {
    const mesh = this.tracerPool.find(m => !m.visible) ?? this.tracerPool[0];
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const len = a.distanceTo(b);
    if (len < 1) return;
    mesh.visible = true;
    mesh.position.copy(a).lerp(b, 0.5);
    mesh.lookAt(b);
    mesh.scale.set(1, 1, len * 0.5);
    (mesh.material as THREE.MeshBasicMaterial).color.setHex(friendly ? 0xffd27a : 0xff9a5a);
    this.tracers.push({ mesh, life: 0.08 });
  }

  collapse(pos: Vec3, size: number) {
    for (let i = 0; i < 40 * this.quality; i++) {
      this.spawn({
        pos: [pos[0] + (this.rng() - 0.5) * size, pos[1] + (this.rng() - 0.5) * size * 0.6, pos[2] + (this.rng() - 0.5) * size],
        vel: [(this.rng() - 0.5) * 6, -this.rng() * 3, (this.rng() - 0.5) * 6],
        life: 2.2 + this.rng() * 3, size: size * 0.15 + this.rng() * 2.4, color: new THREE.Color(0.42, 0.4, 0.36), kind: 'dust', gravity: 0.1, drag: 0.7
      });
    }
    for (let i = 0; i < 5; i++) this.spawnDustCloud([pos[0] + (this.rng() - 0.5) * size, pos[1], pos[2] + (this.rng() - 0.5) * size], size * 0.5, 4.5);
    this.addShake(0.9, 1.6);
  }

  muzzleFlash(pos: Vec3, dir: Vec3) {
    for (let i = 0; i < 4; i++) this.spawn({ pos: [...pos], vel: [dir[0] * 6 + (this.rng() - 0.5) * 2, dir[1] * 6 + (this.rng() - 0.5) * 2, dir[2] * 6 + (this.rng() - 0.5) * 2], life: 0.06 + this.rng() * 0.05, size: 0.55, color: new THREE.Color(1, 0.82, 0.45), kind: 'fire', gravity: 0, drag: 4 });
  }

  hitMarker() { /* handled in HUD */ }

  addShake(amp: number, time: number) { this.shakes.push({ amp, t: time }); }
  shakeOffset(t: number) {
    if (!this.shakes.length) return { x: 0, y: 0, roll: 0 };
    let x = 0, y = 0, roll = 0;
    for (const s of this.shakes) { const k = s.amp * Math.min(1, s.t * 2.2); x += Math.sin(t * 47) * k * 0.08; y += Math.cos(t * 39) * k * 0.07; roll += Math.sin(t * 23) * k * 0.03; }
    return { x, y, roll };
  }

  update(dt: number) {
    // particles
    const posAttr = this.geo.attributes.position as THREE.BufferAttribute;
    const colAttr = this.geo.attributes.pcolor as THREE.BufferAttribute;
    const sizeAttr = this.geo.attributes.psize as THREE.BufferAttribute;
    let count = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.vel.y += p.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      const t = p.life / p.maxLife;
      posAttr.setXYZ(count, p.pos.x, p.pos.y, p.pos.z);
      const fade = p.kind === 'fire' ? t : Math.min(1, t * 1.6);
      colAttr.setXYZ(count, p.color.r * fade, p.color.g * fade, p.color.b * fade);
      sizeAttr.setX(count, p.size * (p.kind === 'smoke' || p.kind === 'dust' ? (1.6 - t * 0.6) : Math.max(0.05, t)));
      count++;
    }
    this.geo.setDrawRange(0, count);
    posAttr.needsUpdate = true; colAttr.needsUpdate = true; sizeAttr.needsUpdate = true;
    // concrete chips
    const cpos = this.chipGeo.attributes.position as THREE.BufferAttribute;
    let ccount = 0;
    for (let i = this.chipData.length - 1; i >= 0; i--) {
      const c = this.chipData[i];
      c.life -= dt;
      if (c.life <= 0) { this.chipData.splice(i, 1); continue; }
      c.vel.y -= 12 * dt;
      c.pos.addScaledVector(c.vel, dt);
      cpos.setXYZ(ccount++, c.pos.x, c.pos.y, c.pos.z);
    }
    this.chipGeo.setDrawRange(0, ccount);
    cpos.needsUpdate = true;
    // tracers
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) { t.mesh.visible = false; this.tracers.splice(i, 1); }
    }
    // dust clouds
    for (let i = this.dustClouds.length - 1; i >= 0; i--) {
      const d = this.dustClouds[i];
      d.life -= dt;
      const k = 1 - d.life / d.maxLife;
      d.mesh.scale.setScalar(d.radius * (1 + k * 1.2));
      (d.mesh.material as THREE.SpriteMaterial).opacity = 0.62 * (1 - k);
      d.mesh.position.y += dt * 0.4;
      if (d.life <= 0) { this.scene.remove(d.mesh); (d.mesh.material as THREE.Material).dispose(); this.dustClouds.splice(i, 1); }
    }
    // camera shakes / explosion flashes
    for (let i = this.shakes.length - 1; i >= 0; i--) { this.shakes[i].t -= dt; if (this.shakes[i].t <= 0) this.shakes.splice(i, 1); }
    for (const l of this.explosionsLight) if (l.intensity > 0.1) l.intensity = Math.max(0, l.intensity - dt * 4200);
    // decals expire
    const now = performance.now();
    for (let i = this.decals.length - 1; i >= 0; i--) if (now - this.decals[i].born > this.decals[i].life) {
      const d = this.decals[i]; this.scene.remove(d.mesh); d.mesh.geometry.dispose(); (d.mesh.material as THREE.Material).dispose(); this.decals.splice(i, 1);
    }
  }

  setQuality(q: number) {
    this.quality = q;
    this.max = Math.round(4200 * q);
    this.maxChips = Math.round(900 * q);
  }

  handleEvent(e: GameEvent, cameraPos?: Vec3) {
    switch (e.e) {
      case 'explosion': this.explosion(e.pos, e.radius, e.kind); break;
      case 'impact': this.impact(e.pos, e.normal, e.material); break;
      case 'shot': this.muzzleFlash(e.pos, e.dir); break;
      case 'collapse': this.collapse(e.pos, e.size); break;
      case 'vehicleDestroyed': this.explosion(e.pos, 9, 'vehicle'); break;
      default: break;
    }
    void cameraPos;
  }

  /** concrete chips flying off a wall hit */
  chipsBurst(pos: Vec3, count: number, material: 'concrete' | 'wood' | 'metal' = 'concrete') {
    const n = Math.min(count, Math.max(0, this.maxChips - this.chipData.length));
    for (let i = 0; i < n; i++) {
      this.chipData.push({
        pos: new THREE.Vector3(pos[0], pos[1], pos[2]),
        vel: new THREE.Vector3((this.rng() - 0.5) * 7, this.rng() * 6 + 1, (this.rng() - 0.5) * 7),
        life: 0.7 + this.rng() * 0.7, size: 0.05 + this.rng() * 0.09
      });
      if (material === 'wood') this.spawn({ pos: [...pos], vel: [(this.rng() - 0.5) * 4, this.rng() * 4, (this.rng() - 0.5) * 4], life: 0.5, size: 0.08, color: new THREE.Color(0.4, 0.3, 0.2), kind: 'chip', gravity: -9, drag: 0.4 });
    }
    if (material === 'concrete') this.spawn({ pos: [...pos], vel: [0, 0.6, 0], life: 1.1, size: 0.9, color: new THREE.Color(0.68, 0.66, 0.6), kind: 'dust', gravity: 0.15, drag: 1.2 });
  }

  /** continuous smoke plume (destroyed vehicles, burning props) */
  smoke(pos: Vec3, scale = 1) {
    if (this.particles.length > this.max * 0.85) return;
    this.spawn({
      pos: [pos[0] + (this.rng() - 0.5) * 0.8, pos[1], pos[2] + (this.rng() - 0.5) * 0.8],
      vel: [(this.rng() - 0.5) * 1.2, 1.6 + this.rng() * 1.2, (this.rng() - 0.5) * 1.2],
      life: 2.4 + this.rng() * 1.6, size: (0.9 + this.rng() * 1.2) * scale,
      color: new THREE.Color(0.24, 0.23, 0.22), kind: 'smoke', gravity: 0.35, drag: 0.5
    });
  }

  /** a small torch of flame (burning vehicle) */
  flame(pos: Vec3, scale = 1) {
    if (this.particles.length > this.max * 0.9) return;
    this.spawn({
      pos: [pos[0] + (this.rng() - 0.5) * 0.6, pos[1], pos[2] + (this.rng() - 0.5) * 0.6],
      vel: [(this.rng() - 0.5) * 0.8, 1.8 + this.rng() * 1.4, (this.rng() - 0.5) * 0.8],
      life: 0.5 + this.rng() * 0.5, size: (0.5 + this.rng() * 0.5) * scale,
      color: new THREE.Color(1, 0.55, 0.18), kind: 'fire', gravity: 0.6, drag: 1.4
    });
  }

  /** dust / weather-light effects for vehicles */
  vehicleDust(pos: Vec3, speed: number) {
    if (Math.abs(speed) < 2 || this.particles.length > this.max * 0.8) return;
    this.spawn({ pos: [pos[0] + (this.rng() - 0.5), pos[1] - 0.6, pos[2] + (this.rng() - 0.5)], vel: [(this.rng() - 0.5) * 1.4, 0.6 + this.rng(), (this.rng() - 0.5) * 1.4], life: 1.1, size: 1.1 + this.rng(), color: new THREE.Color(0.5, 0.47, 0.4), kind: 'dust', gravity: 0.2, drag: 1.1 });
  }

  dispose() {
    this.scene.remove(this.points, this.chips);
    this.geo.dispose(); this.chipGeo.dispose();
    (this.points.material as THREE.Material).dispose();
    this.chipMat.map?.dispose(); this.chipMat.dispose();
    for (const t of this.tracerPool) { this.scene.remove(t); t.geometry.dispose(); (t.material as THREE.Material).dispose(); }
    for (const l of this.explosionsLight) this.scene.remove(l);
    for (const d of this.dustClouds) this.scene.remove(d.mesh);
    for (const d of this.decals) { this.scene.remove(d.mesh); d.mesh.geometry.dispose(); }
    this.particles = []; this.decals = []; this.chipData = []; this.dustClouds = [];
  }
}
export { SPRITE, chipTexture, Weather };
