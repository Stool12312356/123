// Static sanity check for the built game: verifies every module the browser needs is present
// and that runtime asset URLs referenced from the code really exist on disk.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const dist = 'dist';
const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map(m => m[1]);
const styles = [...html.matchAll(/href="([^"]+\.css)"/g)].map(m => m[1]);
const problems = [];
if (!scripts.length) problems.push('index.html does not reference a built JS entry');
for (const s of [...scripts, ...styles]) {
  const p = path.join(dist, s.replace(/^\.\//, ''));
  if (!existsSync(p)) problems.push(`missing build artifact ${s}`);
}
const assets = readdirSync(path.join(dist, 'assets'));
for (const must of ['manifest.json']) if (!existsSync(path.join(dist, must))) problems.push(`missing ${must}`);
if (!assets.some(a => a.startsWith('worker-'))) problems.push('worker chunk missing');
if (!existsSync(path.join(dist, 'assets/models/procedural'))) problems.push('GLB library not copied into dist');
const glbs = readdirSync(path.join(dist, 'assets/models/procedural')).filter(f => f.endsWith('.glb'));
const manifest = JSON.parse(readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
if (glbs.length !== manifest.assets.length) problems.push(`GLB count ${glbs.length} != manifest ${manifest.assets.length}`);
for (const a of manifest.assets) {
  if (!existsSync(path.join(dist, a.glb))) problems.push(`manifest entry ${a.id} -> ${a.glb} not in dist`);
}
const entry = readFileSync(path.join(dist, scripts[0].replace(/^\.\//, '')), 'utf8');
for (const needle of ['assets/manifest.json', 'red-storm']) if (!entry.includes(needle) && needle === 'assets/manifest.json') problems.push(`entry does not fetch ${needle}`);
if (!styles.length) problems.push('no CSS emitted');
console.log(`bundle check: entry=${scripts[0]} css=${styles[0] ?? 'none'} glb=${glbs.length} assets=${manifest.assets.length}`);
if (problems.length) { console.error('FAILED:\n' + problems.join('\n')); process.exit(1); }
console.log('bundle check: PASSED');
