import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { AssetEntry, Manifest } from '../shared/types';

export interface LoadedAsset {
  entry: AssetEntry;
  gltf: { scene: THREE.Group };
  parts: THREE.Mesh[];
  bounds: THREE.Box3;
  turret?: THREE.Object3D;
  rotor?: THREE.Object3D;
  tailRotor?: THREE.Object3D;
  wheels: THREE.Object3D[];
  /** mesh node name -> index inside `parts` (not GLTF traversal order) */
  partIndex: Map<string, number>;
  /** part names in GLTF mesh order (identical order to the sim's AssetGeo.parts) */
  order: string[];
}

const texCache = new Map<string, THREE.Texture>();
function concreteTexture(kind: 'panel' | 'brick' | 'asphalt' | 'metal'): THREE.Texture {
  if (texCache.has(kind)) return texCache.get(kind)!;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const base = kind === 'brick' ? '#8a5a46' : kind === 'asphalt' ? '#4a4a47' : kind === 'metal' ? '#7a7f7a' : '#b9b6ac';
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 5200; i++) {
    const v = Math.random();
    ctx.fillStyle = `rgba(${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},${Math.random() * 0.07})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  if (kind === 'panel') {
    ctx.strokeStyle = 'rgba(60,58,52,0.55)'; ctx.lineWidth = 2;
    for (let x = 0; x <= size; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke(); }
    for (let y = 0; y <= size; y += 86) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke(); }
    ctx.fillStyle = 'rgba(70,68,60,0.12)';
    for (let i = 0; i < 26; i++) ctx.fillRect(Math.random() * size, Math.random() * size, 8 + Math.random() * 30, 3 + Math.random() * 12);
  } else if (kind === 'brick') {
    for (let y = 0; y < size; y += 16) {
      const off = (y / 16) % 2 ? 16 : 0;
      for (let x = -32; x < size; x += 32) {
        ctx.fillStyle = `rgba(${120 + Math.random() * 40},${64 + Math.random() * 30},${48 + Math.random() * 24},1)`;
        ctx.fillRect(x + off + 1, y + 1, 30, 14);
      }
    }
  } else if (kind === 'asphalt') {
    for (let i = 0; i < 900; i++) { ctx.fillStyle = `rgba(${90 + Math.random() * 40},${90 + Math.random() * 40},${86 + Math.random() * 40},0.35)`; ctx.fillRect(Math.random() * size, Math.random() * size, 3, 3); }
  } else {
    ctx.strokeStyle = 'rgba(30,30,28,0.35)';
    for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.moveTo(0, i * 32 + Math.random() * 8); ctx.lineTo(size, i * 32 + Math.random() * 8); ctx.stroke(); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(kind, tex);
  return tex;
}

export class AssetLibrary {
  manifest: Manifest;
  cache = new Map<string, LoadedAsset>();
  loader: GLTFLoader;
  manager = new THREE.LoadingManager();
  failures: string[] = [];
  glowMat: THREE.MeshStandardMaterial;

  constructor(manifest: Manifest) {
    this.manifest = manifest;
    const draco = new DRACOLoader();
    draco.setDecoderPath('./draco/');
    this.loader = new GLTFLoader(this.manager);
    this.loader.setDRACOLoader(draco);
    this.glowMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x2a1a10, roughness: 0.6, metalness: 0.4 });
  }

  async loadAll(manifest: Manifest, onProgress?: (done: number, total: number) => void) {
    this.manifest = manifest;
    const entries = manifest.assets;
    let done = 0;
    const queue = [...entries];
    const worker = async () => {
      while (queue.length) {
        const entry = queue.shift()!;
        try { await this.load(entry); } catch (e) { this.failures.push(entry.id); console.warn('[render] asset failure', entry.id, e); }
        done++;
        onProgress?.(done, entries.length);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return this;
  }

  async load(entry: AssetEntry): Promise<LoadedAsset> {
    const cached = this.cache.get(entry.id);
    if (cached) return cached;
    const gltf = await this.loader.loadAsync(`./${entry.glb.replace(/^\.\//, '')}`);
    const root = gltf.scene as THREE.Group;
    const parts: THREE.Mesh[] = [];
    const partIndex = new Map<string, number>();
    let turret: THREE.Object3D | undefined, rotor: THREE.Object3D | undefined, tailRotor: THREE.Object3D | undefined;
    const wheels: THREE.Object3D[] = [];
    root.traverse(o => {
      if ((o as THREE.Mesh).isMesh) {
        const mesh = o as THREE.Mesh;
        const hasColor = !!mesh.geometry.getAttribute('color');
        const mat = new THREE.MeshStandardMaterial({
          vertexColors: hasColor, color: 0xffffff,
          roughness: entry.category === 'vehicle' || entry.category === 'building' ? 0.82 : 0.6,
          metalness: entry.category === 'weapon' ? 0.55 : 0.18,
          envMapIntensity: 0.4
        });
        if (entry.category === 'building') {
          mat.map = concreteTexture(/dk|cum|kinoteatr|brick|dorm/.test(entry.id) ? 'brick' : 'panel');
          mat.map.repeat.set(2, 2);
          mat.vertexColors = false;
        }
        if (entry.category === 'prop' && /fence|barrel|tyre|crate/.test(entry.id)) { mat.map = concreteTexture('metal'); mat.vertexColors = false; }
        mesh.material = mat;
        mesh.castShadow = entry.category !== 'building';
        mesh.receiveShadow = true;
        parts.push(mesh);
        partIndex.set(mesh.name, parts.length - 1);
        if (mesh.name.includes('turret')) turret = mesh;
        if (mesh.geometry) mesh.geometry.computeBoundingSphere();
        if (mesh.name === 'rotor') rotor = mesh;
        if (mesh.name === 'tailrotor') tailRotor = mesh;
        if (mesh.name.startsWith('wheel_')) wheels.push(mesh);
      }
    });
    // Re-order parts into GLTF mesh order so that `parts[i]` matches the simulator's
    // AssetGeo.parts[i] (both derive from json.meshes order, not traversal order).
    const order = ((gltf as any).parser?.json?.meshes ?? []).map((m: any) => m.name as string);
    const ordered: THREE.Mesh[] = [];
    const orderedIndex = new Map<string, number>();
    if (order.length === parts.length) {
      for (const name of order) {
        const idx = partIndex.get(name);
        if (idx === undefined) break;
        orderedIndex.set(name, ordered.length);
        ordered.push(parts[idx]);
      }
    }
    if (ordered.length !== parts.length) {
      ordered.length = 0;
      parts.forEach((p, i) => { ordered.push(p); orderedIndex.set(p.name, i); });
    }
    // vehicle helpers must point at the ordered array
    turret = ordered.find(p => p.name.includes('turret'));
    rotor = ordered.find(p => p.name === 'rotor');
    tailRotor = ordered.find(p => p.name === 'tailrotor');
    wheels.length = 0;
    for (const p of ordered) if (p.name.startsWith('wheel_')) wheels.push(p);
    const bounds = new THREE.Box3().setFromObject(root);
    const asset: LoadedAsset = { entry, gltf, parts: ordered, partIndex: orderedIndex, order, bounds, turret, rotor, tailRotor, wheels };
    this.cache.set(entry.id, asset);
    return asset;
  }

  get(id: string) { return this.cache.get(id); }

  /** Builds a renderable instance with per-part visibility masks for dynamic destruction. */
  instance(id: string, opts: { detail?: number; castShadow?: boolean } = {}): RenderInstance | null {
    const asset = this.cache.get(id);
    if (!asset) return null;
    return new RenderInstance(asset, opts.detail ?? 0, opts.castShadow ?? true);
  }

  dispose() {
    for (const a of this.cache.values()) {
      a.gltf.scene.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else mat?.dispose?.();
      });
    }
    this.cache.clear();
    for (const t of texCache.values()) t.dispose();
    texCache.clear();
  }
}

/** A live scene object bound to a simulation mesh id; supports hole punching. */
export class RenderInstance {
  asset: LoadedAsset;
  group = new THREE.Group();
  parts: THREE.Mesh[] = [];
  visibleMask: Uint8Array;
  dirty = false;
  hidden = false;
  constructor(asset: LoadedAsset, detail: number, castShadow: boolean) {
    this.asset = asset;
    const src = asset.gltf.scene.children[0] ?? asset.gltf.scene;
    // Clone materials per instance for damage tinting.
    asset.parts.forEach((p, i) => {
      if (detail > 0 && p.geometry.attributes.position.count > 3000) return;
      const m = new THREE.Mesh(p.geometry, p.material);
      m.name = p.name;
      m.castShadow = castShadow && this.asset.entry.category !== 'building';
      m.receiveShadow = true;
      m.userData.partIndex = i;
      m.userData.partName = p.name;
      this.parts.push(m);
      this.group.add(m);
    });
    void src;
    this.visibleMask = new Uint8Array(asset.parts.length).fill(1);
  }
  setHole(index: number) {
    this.visibleMask[index] = 0;
    const mesh = this.parts[index];
    if (mesh) mesh.visible = false;
  }
  /** per-panel visibility mask from the simulator (index === AssetGeo.parts index) */
  applyMask(vis: number[] | Uint8Array) {
    this.visibleMask = Uint8Array.from(vis);
    for (let i = 0; i < this.parts.length; i++) {
      const m = this.parts[i];
      m.visible = this.visibleMask[i] !== 0;
    }
  }
  setTint(color: number) {
    for (const m of this.parts) {
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.color) mat.color.setHex(color);
    }
  }
  dispose() {
    for (const p of this.parts) {
      const mat = p.material as THREE.Material;
      mat?.dispose?.();
    }
    this.parts = [];
    this.group.clear();
  }
}

/** Generic instanced debris: cheap boxes/concrete chunks for thousands of fragments. */
export class DebrisPool {
  free: THREE.InstancedMesh[] = [];
  count = 0;
  mesh: THREE.InstancedMesh;
  max: number;
  dummy = new THREE.Object3D();
  colors = [0x9a968b, 0x817d72, 0x6c665c, 0xa8a49a, 0x5a5c50];
  constructor(scene: THREE.Scene, max = 1400) {
    this.max = max;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.05 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    const col = new THREE.Color();
    for (let i = 0; i < max; i++) { col.setHex(this.colors[i % this.colors.length]); this.mesh.setColorAt(i, col); }
    scene.add(this.mesh);
  }
  set(i: number, x: number, y: number, z: number, q: { x: number; y: number; z: number; w: number } | undefined, size: number) {
    if (i >= this.max) return;
    this.dummy.position.set(x, y, z);
    if (q) this.dummy.quaternion.set(q.x, q.y, q.z, q.w);
    this.dummy.scale.setScalar(size);
    this.dummy.updateMatrix();
    this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.count = Math.max(this.mesh.count, i + 1);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  /** one-off visual rubble chunk (ring-buffered across the pool) */
  cursor = 0;
  setVisual(x: number, y: number, z: number, size: number, ry = 0) {
    const i = this.cursor % this.max;
    this.cursor++;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(ry * 0.3, ry, ry * 0.2));
    this.set(i, x, y, z, { x: q.x, y: q.y, z: q.z, w: q.w }, size);
  }
  /** clears the debris field (new match) */
  reset() { this.mesh.count = 0; this.count = 0; this.cursor = 0; }
  dispose(scene: THREE.Scene) { scene.remove(this.mesh); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
export { concreteTexture };
