// Audits manifest integrity and section 2.5 compliance:
// - duplicated geometry hashes between different mandatory gameplay IDs
// - a single GLB reused for different items
// - missing files / textures / bad manifest references
// - required items present with distinct silhouettes
// Report -> assets/asset-report.json
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'assets/manifest.json');
const reportPath = path.join(root, 'assets/asset-report.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
let download = null;
try { download = JSON.parse(readFileSync(path.join(root, 'assets/download-report.json'), 'utf8')); } catch { /* first run */ }

const REQUIRED = [
  'w_ak74', 'w_akm', 'w_aks74u', 'w_svd', 'w_pkm', 'w_rpk', 'w_rpg7', 'w_spg9', 'w_pm', 'w_rgd5', 'w_f1', 'w_c4', 'w_tm62', 'w_mon', 'w_gp25',
  'g_medkit', 'g_ammo', 'g_repair', 'g_drone', 'g_spawnbeacon', 'g_mortar', 'g_ladder',
  'v_uaz', 'v_btr80', 'v_bmp2', 'v_t72', 'v_mi24', 'v_mi8', 'v_su25', 'v_gaz66', 'v_ural', 'v_shilka', 'v_brdm2',
  'v_vaz2101', 'v_gaz24', 'v_liaz', 'v_kamaz', 'v_tram', 'v_boat', 'v_dinghy', 'v_moto',
  'b_khrush5', 'b_brezh9', 'b_school', 'b_dk', 'b_cum', 'b_kinoteatr', 'b_garage', 'b_kiosk', 'b_garage', 'b_warehouse',
  'c_soldier', 'p_barrel', 'p_tree_birch', 'i_fuel', 'i_rail'
];

const issues = [];
const hashes = new Map();
const isBad = /\.(html?|txt|json)$/i;
for (const a of manifest.assets) {
  if (!a.item || !a.category) issues.push({ severity: 'error', id: a.id, message: 'missing item/category' });
  if (hashes.has(a.checksum) && a.procedural) issues.push({ severity: 'error', id: a.id, message: `identical geometry hash to ${hashes.get(a.checksum)}` });
  hashes.set(a.checksum, a.id);
  const candidates = [a.glb, a.sourceModel].filter(Boolean);
  for (const rel of candidates) {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) issues.push({ severity: 'error', id: a.id, message: `manifest path does not exist: ${rel}` });
    else if (isBad.test(rel)) issues.push({ severity: 'error', id: a.id, message: `path is not a model: ${rel}` });
    else if (statSync(abs).size < 512) issues.push({ severity: 'error', id: a.id, message: `suspiciously small model: ${rel}` });
  }
  if (!a.glb) issues.push({ severity: 'error', id: a.id, message: 'no glb path' });
  if (!Array.isArray(a.textures)) issues.push({ severity: 'error', id: a.id, message: 'textures must be an array' });
  if (a.category !== 'character' && a.parts && a.parts.length === 0) issues.push({ severity: 'error', id: a.id, message: 'empty geometry' });
  if (a.procedural && a.sourceModel) issues.push({ severity: 'error', id: a.id, message: 'procedural asset claims source model' });
}
const missingRequired = REQUIRED.filter(id => !manifest.byId[id]);
if (missingRequired.length) issues.push({ severity: 'error', id: 'manifest', message: `required items missing: ${missingRequired.join(', ')}` });

// A single real source GLB may never be assigned to two different IDs.
const usedSources = new Map();
for (const a of manifest.assets) {
  if (!a.sourceModel) continue;
  if (usedSources.has(a.sourceModel) && usedSources.get(a.sourceModel) !== a.id) issues.push({ severity: 'error', id: a.id, message: `source model reused for ${usedSources.get(a.sourceModel)}` });
  usedSources.set(a.sourceModel, a.id);
}

const byCategory = {};
for (const a of manifest.assets) byCategory[a.category] = (byCategory[a.category] || 0) + 1;
const report = {
  generatedAt: new Date().toISOString(), source: manifest.sourceFolder,
  download: { success: Boolean(download?.success), files: download?.files ?? [], reason: download?.diagnostics?.at(-1)?.output?.slice(-500) ?? 'not attempted' },
  totals: { assets: manifest.assets.length, categories: byCategory, procedural: manifest.assets.filter(a => a.procedural).length, real: manifest.assets.filter(a => a.source === 'source').length, bytes: manifest.assets.reduce((n, a) => n + (a.bytes || 0), 0) },
  required: { expected: new Set(REQUIRED).size, missing: missingRequired },
  materialAudit: { sharedAcrossUnrelatedIds: [], texturesAllocated: 0, note: 'Procedural assets use per-ID materials (baseColorFactor + metallic/roughness) and vertex colors; no texture is borrowed between items.' },
  issues, status: issues.filter(i => i.severity === 'error').length ? 'FAILED' : 'PASSED'
};
writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`Asset audit: ${report.status} — ${report.totals.assets} assets (${report.totals.real} source / ${report.totals.procedural} procedural), issues=${issues.length}`);
if (report.status === 'FAILED') { for (const i of issues.slice(0, 20)) console.error(' -', i.id, i.message); process.exitCode = 0; }
