import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const DRIVE_URL = 'https://drive.google.com/drive/folders/1RZqwREAdswUge5VSHf4qVW8Q5AMB4FDQ?usp=sharing';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'assets/models/source');
await mkdir(destination, { recursive: true });
const report = { attemptedAt: new Date().toISOString(), url: DRIVE_URL, folderId: '1RZqwREAdswUge5VSHf4qVW8Q5AMB4FDQ', method: 'gdown --folder', success: false, files: [], diagnostics: [] };
const venv = path.join(root, '.cache/gdown-venv');
const setup = spawnSync('python', ['-m', 'venv', venv], { encoding: 'utf8', timeout: 60000 });
const python = path.join(venv, 'bin/python');
const pip = setup.status === 0 ? spawnSync(python, ['-m', 'pip', 'install', '-U', 'gdown'], { encoding: 'utf8', timeout: 120000 }) : setup;
report.diagnostics.push({ stage: 'isolated-install', exitCode: pip.status, output: (pip.stdout + pip.stderr).slice(-6000) });
if (pip.status === 0) {
  const run = spawnSync(python, ['-m', 'gdown', '--folder', '--no-cookies', '--output', destination, DRIVE_URL], { encoding: 'utf8', timeout: 180000 });
  report.diagnostics.push({ stage: 'download', exitCode: run.status, output: (run.stdout + run.stderr).slice(-10000) });
  const walk = async dir => { for (const entry of await readdir(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) await walk(file); else report.files.push(path.relative(root, file)); } };
  await walk(destination);
  report.success = report.files.length > 0 && run.status === 0;
}
await writeFile(path.join(root, 'assets/download-report.json'), JSON.stringify(report, null, 2));
console.log(report.success ? `Downloaded ${report.files.length} source files` : 'Drive unavailable; recorded actual diagnostics. Distinct procedural assets remain available.');
