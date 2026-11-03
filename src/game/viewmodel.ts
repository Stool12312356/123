import * as THREE from 'three';
import type { AssetLibrary } from '../render/assets';
import type { Snapshot } from '../shared/types';
import { clamp } from '../shared/mathx';

/**
 * First-person weapon viewmodel. Built from the real GLB of the equipped weapon
 * (no shared stand-in), rendered in a separate overlay scene so it never clips
 * into walls, with bob / sway / sprint / ADS / reload / recoil animation.
 */
export class ViewModel {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  holder = new THREE.Group();
  base = new THREE.Group();
  assetId = '';
  weaponId = '';
  /** procedural fallback silhouettes, used only if a GLB is missing */
  fallback: THREE.Group | null = null;
  bobPhase = 0;
  recoil = 0;
  recoilPitch = 0;
  reloadT = 0;
  swayX = 0;
  swayY = 0;
  adsT = 0;
  sprintT = 0;
  meleeT = 0;
  visible = true;
  library: AssetLibrary;
  swing = new THREE.Vector3();

  constructor(library: AssetLibrary) {
    this.library = library;
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.01, 12);
    const light = new THREE.HemisphereLight(0xd9e2ea, 0x3a3a34, 1.15);
    this.scene.add(light);
    const key = new THREE.DirectionalLight(0xfff3e0, 1.6);
    key.position.set(1.2, 2.4, 1.6);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x7f9dc0, 0.7);
    rim.position.set(-2, 0.6, -1.4);
    this.scene.add(rim);
    this.scene.add(this.holder);
    this.holder.add(this.base);
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Build (or rebuild) the viewmodel for the given weapon id. */
  setWeapon(id: string) {
    if (id === this.weaponId) return;
    this.weaponId = id;
    this.clear();
    const lib = this.library;
    const asset = lib.get(id);
    if (asset) {
      const inst = lib.instance(id, { detail: 0 });
      if (inst) {
        const holder = new THREE.Group();
        const box = new THREE.Box3().setFromObject(asset.gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        const scale = size.length() > 0 ? 0.9 / Math.max(1.1, size.length()) : 1;
        for (const part of inst.parts) {
          part.material = (part.material as THREE.Material).clone();
          const m = part.material as THREE.MeshStandardMaterial;
          m.envMapIntensity = 0.7;
          part.castShadow = false;
          part.receiveShadow = false;
          holder.add(part);
        }
        holder.scale.setScalar(scale * 1.15);
        const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale * 1.15);
        holder.position.set(-center.x, -center.y, -center.z);
        this.base.add(holder);
        this.assetId = id;
        return;
      }
    }
    this.buildFallback(id);
  }

  /** Distinct procedural silhouette per weapon family — never a reused model. */
  buildFallback(id: string) {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2d2b, metalness: 0.75, roughness: 0.42 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3320, metalness: 0.1, roughness: 0.7 });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m;
    };
    const long = id.includes('svd') || id.includes('pkm');
    const l = long ? 1.15 : 0.86;
    add(new THREE.BoxGeometry(0.075, 0.09, l), metal, 0, 0, -l / 2);
    add(new THREE.CylinderGeometry(0.017, 0.017, long ? 0.7 : 0.42, 8), metal, 0, 0.02, -l - (long ? 0.28 : 0.16)).rotation.x = Math.PI / 2;
    if (id === 'w_pkm' || id === 'w_rpk') add(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 10), metal, 0, -0.11, -0.42).rotation.x = Math.PI / 2;
    else add(new THREE.BoxGeometry(0.05, 0.17, 0.08), metal, 0, -0.12, -0.22).rotation.x = 0.3;
    add(new THREE.BoxGeometry(0.055, 0.1, 0.26), wood, 0, -0.02, 0.06);
    add(new THREE.BoxGeometry(0.05, 0.12, 0.2), id.includes('aks74u') ? metal : wood, 0, -0.05, 0.26);
    if (id.includes('svd')) {
      add(new THREE.CylinderGeometry(0.045, 0.05, 0.34, 10), metal, 0, 0.11, -0.34).rotation.x = Math.PI / 2;
      add(new THREE.BoxGeometry(0.03, 0.05, 0.1), metal, 0, 0.1, -0.1);
    }
    if (id === 'w_rpg7' || id === 'w_spg9') {
      g.clear();
      add(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 12), metal, 0, 0, -0.45).rotation.x = Math.PI / 2;
      add(new THREE.ConeGeometry(0.13, 0.34, 12), metal, 0, 0, -1.2).rotation.x = -Math.PI / 2;
      add(new THREE.BoxGeometry(0.06, 0.12, 0.2), wood, 0, -0.09, 0.08);
      add(new THREE.BoxGeometry(0.05, 0.16, 0.1), metal, 0, -0.13, -0.3);
    }
    if (id === 'w_pm') {
      g.clear();
      add(new THREE.BoxGeometry(0.045, 0.11, 0.22), metal, 0, 0.02, -0.1);
      add(new THREE.BoxGeometry(0.04, 0.13, 0.05), wood, 0, -0.06, 0.04);
    }
    if (id === 'w_rgd5' || id === 'w_f1' || id === 'w_c4' || id === 'w_tm62' || id === 'w_mon50' || id.startsWith('g_')) {
      g.clear();
      const isMed = id === 'g_medkit';
      const isAmmo = id === 'g_ammo';
      const isRepair = id === 'g_repair';
      if (isMed) add(new THREE.BoxGeometry(0.26, 0.16, 0.12), new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.6 }), 0, 0, -0.1);
      else if (isAmmo) add(new THREE.BoxGeometry(0.3, 0.18, 0.16), new THREE.MeshStandardMaterial({ color: 0x4a5230, roughness: 0.7 }), 0, 0, -0.1);
      else if (isRepair) add(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 8), metal, 0, 0, -0.12).rotation.x = Math.PI / 2;
      else add(new THREE.IcosahedronGeometry(0.075, 0), new THREE.MeshStandardMaterial({ color: id === 'w_f1' ? 0x4a4f3a : 0x3e4632, roughness: 0.8 }), 0, 0, -0.09);
      add(new THREE.BoxGeometry(0.07, 0.1, 0.14), new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 0.85 }), 0.02, -0.06, 0.05);
    }
    const holder = new THREE.Group();
    holder.add(g);
    this.base.add(holder);
    this.fallback = holder;
    this.assetId = 'procedural:' + id;
  }

  clear() {
    for (const child of [...this.base.children]) {
      this.base.remove(child);
      child.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose?.();
        const mat = m.material as THREE.Material;
        if (mat && (mat as any).isMaterial && (mat as any).userData?.owned !== false) mat.dispose?.();
      });
    }
    this.fallback = null;
    this.assetId = '';
  }

  kick(amount = 1) {
    this.recoil = Math.min(0.22, this.recoil + 0.045 * amount);
    this.recoilPitch = Math.min(0.5, this.recoilPitch + 0.06 * amount);
  }

  melee() { this.meleeT = 0.34; }

  startReload(seconds: number) { this.reloadT = seconds; }

  /** Called every render frame with the movement state. */
  update(dt: number, snap: Snapshot, opts: { sprinting: boolean; moving: number; ads: boolean; grounded: boolean; pitch: number; yawRate: number }) {
    const p = snap.player;
    if (this.weaponId !== p.weapon) this.setWeapon(p.weapon);
    this.visible = p.alive && p.vehicle === null && !p.underWater;
    this.holder.visible = this.visible;
    if (p.reloading > 0 && this.reloadT <= 0) this.reloadT = Math.max(0.6, p.reloading);
    this.adsT += ((opts.ads ? 1 : 0) - this.adsT) * Math.min(1, dt * 12);
    this.sprintT += ((opts.sprinting && opts.moving > 0.4 ? 1 : 0) - this.sprintT) * Math.min(1, dt * 8);
    this.bobPhase += dt * (opts.sprinting ? 13 : 8.4) * clamp(opts.moving, 0, 1.4);
    this.recoil = Math.max(0, this.recoil - dt * 0.62);
    this.recoilPitch = Math.max(0, this.recoilPitch - dt * 2.2);
    this.reloadT = Math.max(0, this.reloadT - dt);
    this.meleeT = Math.max(0, this.meleeT - dt);
    this.swayX += ((-opts.yawRate * 0.02) - this.swayX) * Math.min(1, dt * 6);
    this.swayY += ((opts.pitch * 0.004) - this.swayY) * Math.min(1, dt * 6);
    const bobAmp = (1 - this.adsT * 0.82) * (0.014 + (opts.sprinting ? 0.03 : 0));
    const bobX = Math.sin(this.bobPhase) * bobAmp;
    const bobY = Math.abs(Math.cos(this.bobPhase)) * bobAmp * 0.85;
    const adsX = 0;
    const adsPos = this.adsT;
    const reloadSwing = this.reloadT > 0 ? Math.sin((1 - this.reloadT / Math.max(0.6, this.reloadT)) * Math.PI) : 0;
    const sprintDrop = this.sprintT;
    const meleeSwing = this.meleeT > 0 ? Math.sin((this.meleeT / 0.34) * Math.PI) : 0;
    const holder = this.holder;
    holder.position.set(
      0.19 + bobX + this.swayX + adsPos * -0.19 + adsX + sprintDrop * 0.03 + meleeSwing * 0.12,
      -0.17 + bobY + this.swayY - adsPos * 0.026 - reloadSwing * 0.18 - sprintDrop * 0.14,
      -0.34 + this.recoil * 1.1 + reloadSwing * 0.05
    );
    holder.rotation.set(
      -0.02 + this.recoilPitch * 0.55 + this.swayY * 0.9 + reloadSwing * 0.35 - sprintDrop * 0.42 + meleeSwing * 0.5,
      0.04 + this.swayX * 1.4 + sprintDrop * 0.5,
      0.02 + this.swayX * 0.6 + reloadSwing * 0.5 + meleeSwing * 0.6
    );
    const targetFov = this.adsT > 0.5 ? 40 : 55;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 10);
    this.camera.updateProjectionMatrix();
    // kick the physical gun back a touch when firing
    if (this.recoil > 0.01) holder.position.z += this.recoil * 0.06;
  }

  dispose() {
    this.clear();
    this.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}
