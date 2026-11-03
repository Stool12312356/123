import * as THREE from 'three';
import type { Snapshot, Vec3, WorldSpec } from '../shared/types';

/**
 * Tactical minimap: renders the world's static road/building footprint into an
 * offscreen canvas once (from the world spec, not a screenshot), then overlays
 * capture points, teammates, spotted enemies and vehicles each frame.
 */
export class Minimap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  base: HTMLCanvasElement;
  world: WorldSpec | null = null;
  size = 256;
  zoom = 1;
  view: 'map' | 'rotate' = 'map';
  team = 0;
  ping: { x: number; z: number; until: number } | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = this.size * 2;
  }

  setWorld(world: WorldSpec) {
    this.world = world;
    this.bake();
  }

  /** Rasterises the map once: ground, roads, building blocks, water, points. */
  bake() {
    const w = this.world;
    if (!w) return;
    const g = this.base.getContext('2d')!;
    const S = this.base.width;
    const half = w.size / 2;
    const tx = (x: number) => ((x + half) / w.size) * S;
    const tz = (z: number) => ((z + half) / w.size) * S;
    g.fillStyle = '#2b342f';
    g.fillRect(0, 0, S, S);
    // subtle height shading from the terrain grid
    const n = Math.round(Math.sqrt(w.heights.length));
    const cell = S / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const h = w.heights[i * n + j] ?? 0;
        const v = Math.max(0, Math.min(1, h / 24));
        g.fillStyle = `rgba(${40 + v * 60},${52 + v * 62},${46 + v * 44},0.85)`;
        g.fillRect(j * cell, i * cell, cell + 1, cell + 1);
      }
    }
    if (w.water) {
      const a = w.water.rotation ?? 0;
      g.save();
      g.translate(tx(w.water.cx), tz(w.water.cz));
      g.rotate(a);
      g.fillStyle = 'rgba(44,74,82,0.92)';
      g.beginPath();
      g.ellipse(0, 0, (w.water.rx / w.size) * S, (w.water.rz / w.size) * S, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    for (const road of w.roads) {
      if (road.length < 2) continue;
      g.strokeStyle = 'rgba(120,118,110,0.5)';
      g.lineWidth = Math.max(2, (12 / w.size) * S);
      g.beginPath();
      g.moveTo(tx(road[0].x), tz(road[0].z));
      for (const p of road.slice(1)) g.lineTo(tx(p.x), tz(p.z));
      g.stroke();
    }
    // building footprints (rotated rectangles from the generated structures)
    for (const s of w.structures) {
      const dims = this.dimsOf(s.asset);
      g.save();
      g.translate(tx(s.x), tz(s.z));
      g.rotate(-s.ry);
      const bw = Math.max(3, (dims[0] / w.size) * S);
      const bd = Math.max(3, (dims[2] / w.size) * S);
      g.fillStyle = 'rgba(30,34,32,0.9)';
      g.fillRect(-bw / 2, -bd / 2, bw, bd);
      g.strokeStyle = 'rgba(190,186,172,0.35)';
      g.lineWidth = 1;
      g.strokeRect(-bw / 2, -bd / 2, bw, bd);
      g.restore();
    }
    for (const p of w.props) {
      if (!p.asset.includes('tree')) continue;
      g.fillStyle = 'rgba(58,72,52,0.8)';
      g.beginPath();
      g.arc(tx(p.x), tz(p.z), 1.4, 0, Math.PI * 2);
      g.fill();
    }
    // map border
    g.strokeStyle = 'rgba(233,228,216,0.18)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, S - 2, S - 2);
  }

  dimsCache = new Map<string, Vec3>();
  setDims(byId: Record<string, { dims: Vec3 }>) {
    for (const [k, v] of Object.entries(byId)) this.dimsCache.set(k, v.dims);
  }
  dimsOf(asset: string): Vec3 { return this.dimsCache.get(asset) ?? [14, 12, 12]; }

  setPing(x: number, z: number) { this.ping = { x, z, until: performance.now() + 2600 }; }

  draw(snap: Snapshot, playerPos: Vec3, yaw: number, team: number, points: { id: string; name: string; x: number; z: number; radius: number }[]) {
    const w = this.world;
    const g = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    if (!w) { g.fillStyle = '#26332e'; g.fillRect(0, 0, W, H); return; }
    g.save();
    const S = this.base.width;
    const half = w.size / 2;
    g.fillStyle = '#202824';
    g.fillRect(0, 0, W, H);
    g.drawImage(this.base, 0, 0, S, S, 0, 0, W, H);
    const px = ((playerPos[0] + half) / w.size) * W;
    const pz = ((playerPos[2] + half) / w.size) * H;
    const toX = (x: number) => ((x + half) / w.size) * W;
    const toZ = (z: number) => ((z + half) / w.size) * H;
    // capture points
    points.forEach((p, i) => {
      const st = snap.points.find(x => x.id === p.id);
      const owner = st?.owner ?? null;
      const r = Math.max(9, (p.radius / w.size) * W);
      g.beginPath();
      g.arc(toX(p.x), toZ(p.z), r, 0, Math.PI * 2);
      g.fillStyle = owner === team ? 'rgba(90,143,176,0.26)' : owner === null ? 'rgba(200,200,190,0.14)' : 'rgba(226,96,63,0.26)';
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = owner === team ? '#5a8fb0' : owner === null ? '#8b8b80' : '#e2603f';
      g.stroke();
      if (st?.contested) { g.strokeStyle = '#d3a94b'; g.lineWidth = 2; g.beginPath(); g.arc(toX(p.x), toZ(p.z), r + 4, 0, Math.PI * 2); g.stroke(); }
      if (st && owner !== team && st.progress > 1 && owner === null) {
        g.strokeStyle = '#d3a94b'; g.lineWidth = 3; g.beginPath();
        g.arc(toX(p.x), toZ(p.z), r - 2, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.min(100, st.progress)) / 100);
        g.stroke();
      }
      g.fillStyle = '#e9e4d8';
      g.font = 'bold 13px "Roboto Condensed", monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String.fromCharCode(65 + i), toX(p.x), toZ(p.z));
    });
    // teammates + spotted enemies
    for (const a of snap.ai) {
      const mate = a.team === team;
      if (!mate && a.pos[0] === 0 && a.pos[2] === 0) continue;
      if (!mate && !a.visibleEnemies.length) continue;
      if (!a.alive) continue;
      g.fillStyle = mate ? '#6fa8d6' : '#e2603f';
      g.beginPath(); g.arc(toX(a.pos[0]), toZ(a.pos[2]), mate ? 3 : 3.4, 0, Math.PI * 2); g.fill();
      if (mate) { g.strokeStyle = 'rgba(111,168,214,0.4)'; g.lineWidth = 1; g.beginPath(); g.arc(toX(a.pos[0]), toZ(a.pos[2]), 6, 0, Math.PI * 2); g.stroke(); }
    }
    // vehicles
    for (const v of snap.vehicles) {
      if (v.destroyed) continue;
      g.fillStyle = 'rgba(211,169,75,0.9)';
      g.beginPath();
      const vx = toX(v.pos[0]), vz = toZ(v.pos[2]);
      g.moveTo(vx, vz - 4); g.lineTo(vx + 3.4, vz + 3); g.lineTo(vx - 3.4, vz + 3);
      g.closePath(); g.fill();
    }
    // death markers / mcoms
    for (const m of snap.mcoms ?? []) {
      g.strokeStyle = m.destroyed ? '#555' : m.armed ? '#ff3b22' : '#d3a94b';
      g.lineWidth = 2;
      g.beginPath(); g.rect(toX(m.x) - 4, toZ(m.z) - 4, 8, 8); g.stroke();
    }
    // player arrow with view cone
    g.save();
    g.translate(px, pz);
    g.rotate(-yaw);
    const cone = g.createLinearGradient(0, 0, 0, -34);
    cone.addColorStop(0, 'rgba(255,255,255,0.28)');
    cone.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = cone;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(-18, -34); g.lineTo(18, -34); g.closePath(); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill();
    g.restore();
    // ping marker
    if (this.ping) {
      if (performance.now() > this.ping.until) this.ping = null;
      else {
        const t = (performance.now() % 800) / 800;
        g.strokeStyle = `rgba(233,228,216,${1 - t})`;
        g.lineWidth = 2;
        g.beginPath(); g.arc(toX(this.ping.x), toZ(this.ping.z), 4 + t * 14, 0, Math.PI * 2); g.stroke();
      }
    }
    g.restore();
  }
}
