import re
tpl = open('src/template.html').read()
parts = []
r1 = open('src/render1.mjs').read()
r1 = re.sub(r"^import \* as THREE from '[^']+';\n", '', r1, flags=re.M)
parts.append(open('src/physics.mjs').read())
parts.append(r1)
parts.append(open('src/render2.mjs').read())
parts.append(open('src/main.mjs').read())
loader = """/* ---------------------------------------------------------------------------
   three.js loader (CDN with a mirror fallback, so one blocked mirror cannot
   kill the whole page)
   ------------------------------------------------------------------------- */
let THREE = globalThis.__JB_THREE__ || null;
if (!THREE) {
  const CDN = [
    'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
    'https://unpkg.com/three@0.160.0/build/three.module.js',
    'https://cdn.skypack.dev/three@0.160.0'
  ];
  for (const url of CDN) {
    try { THREE = await import(url); break; } catch (e) { console.warn('[jbeam] CDN failed:', url); }
  }
}
if (!THREE) {
  const e = document.getElementById('err');
  if (e) { e.style.display = 'block'; e.textContent = 'three.js could not be loaded from any CDN - connectivity to cdn.jsdelivr.net or unpkg.com is required.'; }
  const m = document.getElementById('bootMsg');
  if (m) m.textContent = 'three.js unavailable';
  throw new Error('three.js unavailable');
}
"""
bundle = loader + "\n\n" + "\n\n".join(parts)
out = tpl.replace('__BUNDLE__', bundle)
open('index.html','w').write(out)
print('index.html', len(out), 'bytes;', out.count('\n'), 'lines')
