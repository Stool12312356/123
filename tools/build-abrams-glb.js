#!/usr/bin/env node
/* Build the runtime GLB from the user's pure-WebGL Abrams source.
 * No npm packages are required. The source geometry is evaluated in a
 * sandbox, then serialized as glTF 2.0 with a standard scene hierarchy.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'assets/models/abrams-source');
const output = path.join(root, 'assets/models/abrams-user.glb');
const sources = ['geo.js', 'tank_hull.js', 'tank_turret.js']
  .map(name => fs.readFileSync(path.join(sourceDir, name), 'utf8'))
  .join('\n');
const context = { console };
vm.createContext(context);
vm.runInContext(`${sources}\nglobalThis.__abrams = buildTank();`, context, { timeout: 120000 });
const tank = context.__abrams;

const json = {
  asset: { version: '2.0', generator: 'NEXUS custom GLB pipeline' },
  scene: 0,
  scenes: [{ name: 'M1A2 Abrams', nodes: [0] }],
  nodes: [{ name: 'AbramsRoot', children: [] }],
  meshes: [],
  materials: [],
  accessors: [],
  bufferViews: [],
  buffers: [{ byteLength: 0 }],
  extras: {
    nexus: {
      source: 'User-supplied Google Drive pure-WebGL model',
      units: 'metres',
      axes: '+X forward, +Y up, +Z right',
      joints: { turret: [0.4, 1.52, 0], gun: [1.53, 0.41, 0] },
      runtimeRoles: ['hull', 'turret', 'gun', 'wheel', 'idler', 'sprocket', 'roller', 'link']
    }
  }
};

const materialInfo = [
  ['CARC tan', 0.0, 0.80],
  ['Gunmetal', 0.9, 0.36],
  ['Rubber', 0.0, 0.92],
  ['Optics', 0.0, 0.08],
  ['Steel', 0.7, 0.58],
  ['Mesh', 0.3, 0.80],
  ['Equipment', 0.0, 0.90]
];
for (const [name, metallicFactor, roughnessFactor] of materialInfo) {
  json.materials.push({
    name,
    pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor, roughnessFactor },
    doubleSided: true
  });
}

const chunks = [];
let byteLength = 0;
function align4(n) { return (n + 3) & ~3; }
function append(data, target) {
  const src = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const start = align4(byteLength);
  if (start > byteLength) chunks.push(Buffer.alloc(start - byteLength));
  chunks.push(src);
  const view = json.bufferViews.length;
  json.bufferViews.push({ buffer: 0, byteOffset: start, byteLength: src.length, ...(target ? { target } : {}) });
  byteLength = start + src.length;
  return view;
}
function accessor(data, componentType, type, count, opts = {}) {
  const view = append(data, opts.target);
  const index = json.accessors.length;
  json.accessors.push({
    bufferView: view,
    byteOffset: 0,
    componentType,
    count,
    type,
    ...(opts.normalized ? { normalized: true } : {}),
    ...(opts.min ? { min: opts.min } : {}),
    ...(opts.max ? { max: opts.max } : {}),
    ...(opts.name ? { name: opts.name } : {})
  });
  return index;
}
function bounds(a) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], a[i + k]); hi[k] = Math.max(hi[k], a[i + k]);
  }
  return [lo, hi];
}

const meshNames = ['hull', 'turretA2', 'gun', 'wheel', 'idler', 'sprocket', 'roller', 'link'];
const meshIndex = {};
for (const sourceName of meshNames) {
  const source = tank.meshes[sourceName];
  const name = sourceName === 'turretA2' ? 'turret' : sourceName;
  const count = source.n;
  const [min, max] = bounds(source.P);
  const pos = accessor(source.P, 5126, 'VEC3', count, { target: 34962, min, max, name: `${name} POSITION` });
  const normal = accessor(source.N, 5126, 'VEC3', count, { target: 34962, name: `${name} NORMAL` });
  const color = accessor(source.C, 5121, 'VEC4', count, { target: 34962, normalized: true, name: `${name} COLOR_0` });
  const material = accessor(source.M, 5121, 'VEC4', count, { target: 34962, name: `${name} _NEXUS_MATERIAL` });
  const byKind = Array.from({ length: 7 }, () => []);
  for (let i = 0; i < count; i += 3) {
    const kind = Math.min(6, source.M[i * 4 + 1]);
    byKind[kind].push(i, i + 1, i + 2);
  }
  const primitives = [];
  byKind.forEach((indices, kind) => {
    if (!indices.length) return;
    const idx = accessor(Uint32Array.from(indices), 5125, 'SCALAR', indices.length, {
      target: 34963, name: `${name} indices material ${kind}`
    });
    primitives.push({ attributes: { POSITION: pos, NORMAL: normal, COLOR_0: color, _NEXUS_MATERIAL: material }, indices: idx, material: kind, mode: 4 });
  });
  meshIndex[name] = json.meshes.length;
  json.meshes.push({ name, primitives, extras: { nexusRole: name } });
}

function addNode(node, parent = 0) {
  const index = json.nodes.length;
  json.nodes.push(node);
  (json.nodes[parent].children || (json.nodes[parent].children = [])).push(index);
  return index;
}
function qMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ];
}
const qz = a => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
const qy180 = [0, 1, 0, 0];

addNode({ name: 'Hull', mesh: meshIndex.hull, extras: { nexusRole: 'hull' } });
const turretRoot = addNode({ name: 'TurretPivot', translation: [0.4, 1.52, 0], children: [], extras: { nexusJoint: 'turret' } });
addNode({ name: 'Turret', mesh: meshIndex.turret, extras: { nexusRole: 'turret' } }, turretRoot);
const gunRoot = addNode({ name: 'GunPivot', translation: [1.53, 0.41, 0], children: [], extras: { nexusJoint: 'gun' } }, turretRoot);
addNode({ name: 'Gun', mesh: meshIndex.gun, extras: { nexusRole: 'gun' } }, gunRoot);

const zc = 1.42;
const wheels = [2.37, 1.42, 0.63, -0.14, -0.88, -1.62, -2.37];
const rollers = [[-1.55, 0.955], [0.75, 0.95]];
const arcs = tank.track.segs.filter(s => s.arc);
const idlerX = arcs[3].c.x;
for (const side of [1, -1]) {
  const rot = side > 0 ? qz(0) : qMul(qz(0), qy180);
  wheels.forEach((x, i) => addNode({ name: `RoadWheel_${side > 0 ? 'R' : 'L'}_${i + 1}`, mesh: meshIndex.wheel, translation: [x, 0.3925, side * zc], rotation: rot, extras: { nexusRole: 'wheel' } }));
  addNode({ name: `Idler_${side > 0 ? 'R' : 'L'}`, mesh: meshIndex.idler, translation: [idlerX, 0.7, side * zc], rotation: rot, extras: { nexusRole: 'idler' } });
  addNode({ name: `Sprocket_${side > 0 ? 'R' : 'L'}`, mesh: meshIndex.sprocket, translation: [-3.33, 0.82, side * zc], rotation: rot, extras: { nexusRole: 'sprocket' } });
  rollers.forEach(([x, y], i) => addNode({ name: `ReturnRoller_${side > 0 ? 'R' : 'L'}_${i + 1}`, mesh: meshIndex.roller, translation: [x, y, side * zc], rotation: rot, extras: { nexusRole: 'roller' } }));
  for (let k = 0; k < tank.track.N; k++) {
    const a = tank.track.at(k * tank.track.pitch - tank.track.pitch / 2);
    const b = tank.track.at(k * tank.track.pitch + tank.track.pitch / 2);
    const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    addNode({ name: `TrackLink_${side > 0 ? 'R' : 'L'}_${String(k + 1).padStart(2, '0')}`, mesh: meshIndex.link, translation: [x, y, side * zc], rotation: qz(angle), extras: { nexusRole: 'link' } });
  }
}

json.buffers[0].byteLength = align4(byteLength);
if (json.buffers[0].byteLength > byteLength) chunks.push(Buffer.alloc(json.buffers[0].byteLength - byteLength));
const bin = Buffer.concat(chunks);
let jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
if (jsonBuffer.length % 4) jsonBuffer = Buffer.concat([jsonBuffer, Buffer.alloc(4 - jsonBuffer.length % 4, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuffer.length + 8 + bin.length, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonBuffer.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(bin.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, Buffer.concat([header, jsonHeader, jsonBuffer, binHeader, bin]));
console.log(`${path.relative(root, output)}: ${(fs.statSync(output).size / 1024 / 1024).toFixed(2)} MiB, ${json.meshes.length} meshes, ${json.nodes.length} nodes`);
