// Builds every procedural GLB asset and the authoritative manifest.
import { mkdirSync, writeFileSync, existsSync, readdirSync, statSync, createReadStream } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeGLB } from './lib/glb.js';
import { weaponDefs, gadgetDefs, vehicleDefs, characterDefs, main } from './lib/defs.js';
import { buildingDefs, propsDefs, installationDefs } from './lib/defs2.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelDirs = ['assets', 'models'];
const outDir = path.join(root, ...modelDirs, 'procedural');
mkdirSync(outDir, { recursive: true });

const realFiles = new Map();
const scan = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'source' && e.name !== 'procedural') scan(p); }
    else if (e.name.toLowerCase().endsWith('.glb')) realFiles.set(e.name.replace(/\.glb$/i, '').toLowerCase(), path.relative(path.join(root, ...modelDirs), p));
  }
};
if (existsSync(path.join(root, ...modelDirs))) scan(path.join(root, ...modelDirs));

const all = [...weaponDefs(), ...gadgetDefs(), ...vehicleDefs(), ...characterDefs(), ...buildingDefs(), ...propsDefs(), ...installationDefs()];
const manifest = { version: 1, generatedAt: new Date().toISOString(), sourceFolder: 'https://drive.google.com/drive/folders/1RZqwREAdswUge5VSHf4qVW8Q5AMB4FDQ?usp=sharing', assets: [], byId: {} };
const errors = [];

for (const def of all) {
  const proceduralFile = path.join(outDir, `${def.id}.glb`);
  try {
    const info = writeGLB(proceduralFile, def.id, def.parts(), [main]);
    const realRel = realFiles.get(def.id.toLowerCase());
    const hasReal = Boolean(realRel);
    const entry = {
      id: def.id, category: def.category, item: def.item, kind: def.kind ?? def.class ?? null,
      source: hasReal ? 'source' : 'procedural', placeholder: !hasReal, procedural: !hasReal,
      sourceModel: hasReal ? `assets/models/${realRel}` : null,
      glb: hasReal ? `assets/models/${realRel}` : `assets/models/procedural/${def.id}.glb`,
      scale: 1, pivot: [0, 0, 0], dims: def.dims, materials: [`${def.id}_main`], textures: [],
      lod: [{ level: 0, distance: 0, glb: `assets/models/procedural/${def.id}.glb` }],
      collider: def.collider ?? 'convex', checksum: info.checksum, bytes: info.bytes, triangles: info.triangles,
      parts: info.parts, stats: def.stats ?? {}, building: def.building ?? null,
      wheels: def.wheels ?? null, wheelRadius: def.wheelRadius ?? null, seats: def.seats ?? null,
      turretPivot: def.turretPivot ?? null, rotorPivot: def.rotorPivot ?? null, tailRotorPivot: def.tailRotorPivot ?? null,
      amphibious: def.amphibious ?? false, rail: def.rail ?? false
    };
    manifest.assets.push(entry);
    manifest.byId[def.id] = entry;
  } catch (e) {
    errors.push({ id: def.id, message: String(e && e.stack || e) });
  }
}

const categories = {};
for (const a of manifest.assets) categories[a.category] = (categories[a.category] || 0) + 1;
manifest.counts = categories;
manifest.errors = errors;
writeFileSync(path.join(root, 'assets/manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`Manifest: ${manifest.assets.length} assets, ${Object.entries(categories).map(([k, v]) => `${k}=${v}`).join(', ')}; errors=${errors.length}`);
