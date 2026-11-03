// Minimal robust GLB writer used by the offline asset pipeline.
// Each asset is written as a root node with named child parts, so the runtime can
// detach wheels / turrets / wall panels / support columns as independent bodies.
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FLOAT = 5126, UINT = 5125;
const COMP_COUNT = { SCALAR: 1, VEC3: 3, VEC4: 4 };

class Builder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.idx = []; this.base = 0; this.boxes = []; this.triGroup = []; }
  record(c, s, ry = 0) { this.boxes.push({ c: c.map(v => Math.round(v * 100) / 100), s: s.map(v => Math.round(v * 100) / 100), ry: Math.round(ry * 1000) / 1000 }); }
  vertex(p, n, c) { this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.col.push(c[0], c[1], c[2]); return this.base++; }
  quad(a, b, c, d, normal, color) {
    const i0 = this.vertex(a, normal, color), i1 = this.vertex(b, normal, color), i2 = this.vertex(c, normal, color), i3 = this.vertex(d, normal, color);
    this.idx.push(i0, i1, i2, i0, i2, i3);
  }
  clear() { this.pos = []; this.nor = []; this.col = []; this.idx = []; this.base = 0; this.boxes = []; this.triGroup = []; }
}

function rotY(p, ry, cx = 0, cz = 0) {
  if (!ry) return p;
  const s = Math.sin(ry), c = Math.cos(ry), x = p[0] - cx, z = p[2] - cz;
  return [cx + x * c + z * s, p[1], cz - x * s + z * c];
}

function addBox(b, cx, cy, cz, sx, sy, sz, color, ry = 0) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const P = (x, y, z) => rotY([cx + x, cy + y, cz + z], ry, cx, cz);
  const R = (n) => { const r = rotY(n, ry); return r; };
  b.record([cx, cy, cz], [sx, sy, sz], ry);
  b.quad(P(-hx, hy, -hz), P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), [0, 1, 0], color);
  b.quad(P(-hx, -hy, hz), P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), [0, -1, 0], color);
  b.quad(P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), R([0, 0, 1]), color);
  b.quad(P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), R([0, 0, -1]), color);
  b.quad(P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), R([1, 0, 0]), color);
  b.quad(P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), R([-1, 0, 0]), color);
}

function addCylinder(b, cx, cy, cz, r, h, color, seg = 12, axis = 'y', taper = 1, ry = 0) {
  const top = [], bot = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const p1 = axis === 'y' ? [cx + ca * r, cy + h / 2, cz + sa * r] : axis === 'x' ? [cx + h / 2, cy + ca * r, cz + sa * r] : [cx + ca * r, cy + sa * r, cz + h / 2];
    const p0 = axis === 'y' ? [cx + ca * r * taper, cy - h / 2, cz + sa * r * taper] : axis === 'x' ? [cx - h / 2, cy + ca * r * taper, cz + sa * r * taper] : [cx + ca * r * taper, cy + sa * r * taper, cz - h / 2];
    top.push(rotY(p1, ry, cx, cz)); bot.push(rotY(p0, ry, cx, cz));
  }
  b.record([cx, cy, cz], axis === 'y' ? [r * 2, h, r * 2] : axis === 'x' ? [h, r * 2, r * 2] : [r * 2, r * 2, h], ry);
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    const n = [0, 1, 0];
    b.quad(bot[i], bot[j], top[j], top[i], n, color);
    b.quad([cx, cy + (axis === 'y' ? h / 2 : 0), cz], top[j], top[i], [cx, cy + (axis === 'y' ? h / 2 : 0), cz], [0, 1, 0], color);
    b.quad([cx, cy - (axis === 'y' ? h / 2 : 0), cz], bot[i], bot[j], [cx, cy - (axis === 'y' ? h / 2 : 0), cz], [0, -1, 0], color);
  }
}

function addSphere(b, cx, cy, cz, r, color, seg = 10, rings = 6, sy = 1) {
  b.record([cx, cy, cz], [r * 2, r * 2 * sy, r * 2]);
  for (let j = 0; j < rings; j++) {
    const v0 = j / rings, v1 = (j + 1) / rings;
    for (let i = 0; i < seg; i++) {
      const u0 = i / seg, u1 = (i + 1) / seg;
      const P = (u, v) => {
        const th = v * Math.PI, ph = u * Math.PI * 2;
        return [cx + r * Math.sin(th) * Math.cos(ph), cy + r * Math.cos(th) * sy, cz + r * Math.sin(th) * Math.sin(ph)];
      };
      const n = (u, v) => { const th = v * Math.PI, ph = u * Math.PI * 2; return [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]; };
      const a = P(u0, v0), bb = P(u1, v0), c = P(u1, v1), d = P(u0, v1);
      const i0 = b.vertex(a, n(u0, v0), color), i1 = b.vertex(bb, n(u1, v0), color), i2 = b.vertex(c, n(u1, v1), color), i3 = b.vertex(d, n(u0, v1), color);
      b.idx.push(i0, i1, i2, i0, i2, i3);
      const g = b.boxes.length - 1; b.triGroup.push(g, g);
    }
  }
}

function addWedge(b, cx, cy, cz, sx, sy, sz, color, ry = 0) {
  b.record([cx, cy, cz], [sx, sy, sz], ry);
  const hx = sx / 2, hz = sz / 2;
  const A = [-hx, -sy / 2, -hz], B = [hx, -sy / 2, -hz], C = [hx, -sy / 2, hz], D = [-hx, -sy / 2, hz];
  const E = [-hx, sy / 2, hz], F = [hx, sy / 2, hz];
  const R = (p) => rotY([cx + p[0], cy + p[1], cz + p[2]], ry, cx, cz);
  b.quad(R(A), R(B), R(C), R(D), [0, -1, 0], color);
  b.quad(R(D), R(C), R(F), R(E), [0, 0, 1], color);
  b.quad(R(A), R(D), R(E), R(E), [-1, 0, 0], color);
  b.quad(R(B), R(C), R(F), R(F), [1, 0, 0], color);
  b.quad(R(A), R(B), R(F), R(E), [0, 1, 0], color);
}

const COLORS = {
  steel: [0.29, 0.31, 0.29], darksteel: [0.16, 0.17, 0.16], black: [0.07, 0.075, 0.07],
  wood: [0.36, 0.24, 0.13], darkwood: [0.2, 0.13, 0.075], wood2: [0.46, 0.33, 0.18],
  concrete: [0.52, 0.51, 0.47], concrete2: [0.63, 0.62, 0.57], concrete3: [0.4, 0.395, 0.37],
  brick: [0.45, 0.24, 0.18], brick2: [0.52, 0.3, 0.22], rust: [0.36, 0.21, 0.13],
  olive: [0.24, 0.28, 0.17], olive2: [0.29, 0.31, 0.2], green: [0.25, 0.36, 0.19], darkgreen: [0.15, 0.22, 0.12],
  glass: [0.16, 0.22, 0.24], window: [0.1, 0.14, 0.16], red: [0.62, 0.12, 0.09], blue: [0.1, 0.15, 0.26],
  cream: [0.72, 0.69, 0.6], white: [0.8, 0.8, 0.77], yellow: [0.65, 0.55, 0.14], orange: [0.7, 0.32, 0.08],
  tan: [0.48, 0.4, 0.27], sand: [0.55, 0.46, 0.3], skin: [0.62, 0.46, 0.33], sky: [0.5, 0.62, 0.7],
  gold: [0.6, 0.46, 0.13], snow: [0.82, 0.84, 0.85], rubber: [0.06, 0.06, 0.06], leather: [0.15, 0.11, 0.08]
};

function writeGLB(file, assetId, parts, materials) {
  const buffers = [];
  let offset = 0;
  const bufferViews = [], accessors = [], gltfMaterials = [], meshes = [], nodes = [];
  const matIndex = new Map();
  for (const m of materials) { matIndex.set(m.id, gltfMaterials.length); gltfMaterials.push({ name: `${assetId}_${m.id}`, pbrMetallicRoughness: { baseColorFactor: [...(m.color || [1, 1, 1]), 1], metallicFactor: m.metallic ?? 0.1, roughnessFactor: m.roughness ?? 0.8 }, doubleSided: false }); }
  const addAccessor = (data, type, componentType, min, max, target = 34962) => {
    const arr = componentType === FLOAT ? new Float32Array(data) : new Uint32Array(data);
    const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const padding = (4 - (buf.length % 4)) % 4;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, target });
    buffers.push(buf); if (padding) buffers.push(Buffer.alloc(padding)); offset += buf.length + padding;
    accessors.push({ bufferView: bufferViews.length - 1, componentType, count: data.length / COMP_COUNT[type], type, min, max });
    return accessors.length - 1;
  };
  for (const part of parts) {
    const b = part.builder;
    if (!b.idx.length) continue;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < b.pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], b.pos[i + k]); max[k] = Math.max(max[k], b.pos[i + k]); }
    const pAcc = addAccessor(b.pos, 'VEC3', FLOAT, min, max);
    const nAcc = addAccessor(b.nor, 'VEC3', FLOAT, undefined, undefined);
    const cAcc = addAccessor(b.col, 'VEC3', FLOAT, undefined, undefined);
    const iAcc = addAccessor(b.idx, 'SCALAR', UINT, undefined, undefined, 34963);
    const gAcc = addAccessor(b.triGroup, 'SCALAR', UINT, undefined, undefined, 34962);
    accessors[nAcc].min = undefined; accessors[nAcc].max = undefined;
    meshes.push({ name: part.name, extras: { boxes: b.boxes }, primitives: [{ attributes: { POSITION: pAcc, NORMAL: nAcc, COLOR_0: cAcc, _TRI_GROUP: gAcc }, indices: iAcc, material: matIndex.get(part.material) ?? 0 }] });
    nodes.push({ name: part.name, mesh: meshes.length - 1 });
  }
  const root = { name: assetId, children: nodes.map((_, i) => i + 1) };
  const gltf = {
    asset: { version: '2.0', generator: 'Red Storm procedural asset forge 1.0' },
    scene: 0, scenes: [{ name: assetId, nodes: [0] }], nodes: [root, ...nodes],
    meshes, materials: gltfMaterials, accessors, bufferViews,
    buffers: [{ byteLength: offset }]
  };
  let json = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPad = (4 - (json.length % 4)) % 4; if (jsonPad) json = Buffer.concat([json, Buffer.alloc(jsonPad, 0x20)]);
  const bin = Buffer.concat(buffers);
  const total = 12 + 8 + json.length + 8 + bin.length;
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
  const jHead = Buffer.alloc(8); jHead.writeUInt32LE(json.length, 0); jHead.writeUInt32LE(0x4e4f534a, 4);
  const bHead = Buffer.alloc(8); bHead.writeUInt32LE(bin.length, 0); bHead.writeUInt32LE(0x004e4942, 4);
  const glb = Buffer.concat([header, jHead, json, bHead, bin]);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, glb);
  return { bytes: glb.length, checksum: crypto.createHash('sha256').update(glb).digest('hex'), triangles: parts.reduce((n, p) => n + p.builder.idx.length / 3, 0), parts: parts.map(p => p.name) };
}

export { Builder, addBox, addCylinder, addSphere, addWedge, writeGLB, COLORS, rotY };
