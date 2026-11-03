// Converts supported sources from assets/models/source into game-ready GLBs.
// FBX goes through FBX2glTF when the binary is available, glTF/GLB through gltf-transform.
import { readdirSync, mkdirSync, existsSync, writeFileSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, resample, simplify, weld } from '@gltf-transform/functions';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'assets/models/source');
const out = path.join(root, 'assets/models');
mkdirSync(out, { recursive: true });
const log = [];
const files = existsSync(source) ? readdirSync(source, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => path.join(e.parentPath ?? e.path, e.name)) : [];
if (!files.length) {
  console.log('No source models present. Browser fallback: distinct procedural GLBs are used and will be replaced automatically when files land in assets/models/.');
  writeFileSync(path.join(root, 'assets/convert-report.json'), JSON.stringify({ convertedAt: new Date().toISOString(), converted: [], failed: [], note: 'source folder empty' }, null, 2));
  process.exit(0);
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const file of files) {
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file, ext).replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  const target = path.join(out, `${base}.glb`);
  try {
    if (ext === '.glb' || ext === '.gltf') {
      const doc = await io.read(file);
      await doc.transform(dedup(), weld(), resample(), simplify({ simplifier: undefined, error: 0.001 }), prune());
      await io.write(target, doc);
      const scene = doc.getRoot().listScenes()[0];
      log.push({ file: path.relative(root, file), target: path.relative(root, target), bounds: getBounds(scene), status: 'converted' });
    } else if (ext === '.fbx') {
      try {
        execFileSync('FBX2glTF', ['-b', '-i', file, '-o', path.join(out, base)], { stdio: 'pipe' });
        log.push({ file: path.relative(root, file), target: path.relative(root, `${base}.glb`), status: 'converted-fbx2gltf' });
      } catch {
        log.push({ file: path.relative(root, file), status: 'skipped', reason: 'FBX2glTF binary unavailable in this environment; install FBX2glTF or add Blender headless export, then rerun tools/convert.js' });
      }
    } else if (['.png', '.jpg', '.jpeg', '.ktx2', '.webp'].includes(ext)) {
      copyFileSync(file, path.join(out, `tex_${path.basename(file)}`));
      log.push({ file: path.relative(root, file), target: `assets/models/tex_${path.basename(file)}`, status: 'texture-copied' });
    } else {
      log.push({ file: path.relative(root, file), status: 'skipped', reason: `unsupported extension ${ext}` });
    }
  } catch (e) {
    log.push({ file: path.relative(root, file), status: 'failed', error: String(e.message) });
  }
}
writeFileSync(path.join(root, 'assets/convert-report.json'), JSON.stringify({ convertedAt: new Date().toISOString(), entries: log }, null, 2));
console.log(`Conversion: ${log.filter(l => l.status.startsWith('converted')).length} converted, ${log.length} examined`);
