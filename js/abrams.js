/* ==========================================================================
 * NEXUS ABRAMS — интерактивная M1A2 на чистом WebGL (без библиотек).
 * --------------------------------------------------------------------------
 * Геометрия загружается из assets/models/abrams-user.glb — GLB, собранного
 * из исходной модели пользователя. Локальный js/glb-loader.js разбирает
 * glTF 2.0, а этот модуль сохраняет рендер, анимацию и интерфейс NEXUS:
 * башню, пушку, ходовую, выстрел, окраски, чертёж и ортогональные виды.
 *
 * Единицы — метры. Оси: +X вперёд, +Y вверх, +Z правый борт.
 * ========================================================================== */
(async function () {
    "use strict";

    /* ---------------------------------------------------------------- *
     * Параметры страницы
     * ---------------------------------------------------------------- */
    const params = new URLSearchParams(window.location.search);
    const EMBED = params.get("embed") === "1";
    const STORE_KEY = "nx_abrams";

    function parseAccent(hex) {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
        if (!m) return [204 / 255, 94 / 255, 55 / 255];
        const n = parseInt(m[1], 16);
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }
    const ACCENT = parseAccent(params.get("accent"));
    document.documentElement.style.setProperty("--aq-r", Math.round(ACCENT[0] * 255));
    document.documentElement.style.setProperty("--aq-g", Math.round(ACCENT[1] * 255));
    document.documentElement.style.setProperty("--aq-b", Math.round(ACCENT[2] * 255));
    if (EMBED) document.documentElement.classList.add("aq-embed");

    const $ = (s, r) => (r || document).querySelector(s);
    const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const rand = (a, b) => a + Math.random() * (b - a);
    const TAU = Math.PI * 2;
    const DEG = Math.PI / 180;
    const wrap180 = a => { a = ((a + 180) % 360 + 360) % 360 - 180; return a; };

    /* ---------------------------------------------------------------- *
     * Векторы и матрицы (column-major, как в WebGL)
     * ---------------------------------------------------------------- */
    const V = {
        add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
        sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
        mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
        dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
        cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
        len: a => Math.hypot(a[0], a[1], a[2]),
        norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
    };

    const M4 = {
        ident: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
        persp(fovy, aspect, n, f) {
            const t = 1 / Math.tan(fovy / 2), nf = 1 / (n - f);
            return new Float32Array([t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0]);
        },
        ortho(l, r, b, t, n, f) {
            const lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f);
            return new Float32Array([-2 * lr, 0, 0, 0, 0, -2 * bt, 0, 0, 0, 0, 2 * nf, 0, (l + r) * lr, (t + b) * bt, (f + n) * nf, 1]);
        },
        lookAt(e, c, up) {
            let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
            let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
            let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
            l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
            const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
            return new Float32Array([
                xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
                -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1
            ]);
        },
        mul(a, b) {
            const o = new Float32Array(16);
            for (let c = 0; c < 4; c++) {
                for (let r = 0; r < 4; r++) {
                    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
                }
            }
            return o;
        },
        chain() { let m = arguments[0]; for (let i = 1; i < arguments.length; i++) m = M4.mul(m, arguments[i]); return m; },
        invert(m) {
            const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
            const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
            const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
            const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
            const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
            const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
            let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
            if (!det) return M4.ident();
            det = 1 / det;
            return new Float32Array([
                (a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det,
                (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
                (a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det,
                (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
                (a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det,
                (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
                (a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det,
                (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det
            ]);
        },
        T(x, y, z) { const m = M4.ident(); m[12] = x; m[13] = y; m[14] = z; return m; },
        S(x, y, z) { const m = M4.ident(); m[0] = x; m[5] = y; m[10] = z; return m; },
        RX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
        RY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
        RZ(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
        /* Поворот вокруг оси, проходящей через точку p */
        about(p, R) { return M4.chain(M4.T(p[0], p[1], p[2]), R, M4.T(-p[0], -p[1], -p[2])); },
        xf(m, p) {
            return [
                m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
                m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
                m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
            ];
        },
        xn(m, n) { return [m[0] * n[0] + m[4] * n[1] + m[8] * n[2], m[1] * n[0] + m[5] * n[1] + m[9] * n[2], m[2] * n[0] + m[6] * n[1] + m[10] * n[2]]; },
        transform(m, x, y, z, w) {
            return [
                m[0] * x + m[4] * y + m[8] * z + m[12] * w,
                m[1] * x + m[5] * y + m[9] * z + m[13] * w,
                m[2] * x + m[6] * y + m[10] * z + m[14] * w,
                m[3] * x + m[7] * y + m[11] * z + m[15] * w
            ];
        }
    };

    /* ---------------------------------------------------------------- *
     * Mesh utilities + dimensions from the user-supplied GLB
     * ---------------------------------------------------------------- */
    function featureEdges(b, cosThr) {
        const P = b.pos, I = b.idx, map = new Map();
        const q = i => Math.round(P[i * 3] * 2000) + "," + Math.round(P[i * 3 + 1] * 2000) + "," + Math.round(P[i * 3 + 2] * 2000);
        for (let t = 0; t < I.length; t += 3) {
            const ia = I[t], ib = I[t + 1], ic = I[t + 2];
            const ux = P[ib * 3] - P[ia * 3], uy = P[ib * 3 + 1] - P[ia * 3 + 1], uz = P[ib * 3 + 2] - P[ia * 3 + 2];
            const vx = P[ic * 3] - P[ia * 3], vy = P[ic * 3 + 1] - P[ia * 3 + 1], vz = P[ic * 3 + 2] - P[ia * 3 + 2];
            const n = V.norm([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]);
            if (!isFinite(n[0])) continue;
            [[ia, ib], [ib, ic], [ic, ia]].forEach(([i, j]) => {
                const ka = q(i), kb = q(j);
                if (ka === kb) return;
                const key = ka < kb ? ka + "|" + kb : kb + "|" + ka;
                let e = map.get(key);
                if (!e) { e = { a: i, b: j, n: [] }; map.set(key, e); }
                e.n.push(n);
            });
        }
        const out = [];
        map.forEach(e => {
            let feat = e.n.length === 1;
            if (!feat) {
                let par = false, sharp = false;
                for (let i = 0; i < e.n.length; i++) for (let j = i + 1; j < e.n.length; j++) {
                    const dot = V.dot(e.n[i], e.n[j]);
                    if (Math.abs(dot) > 0.985 && dot > 0) par = true;
                    if (dot < cosThr) sharp = true;
                }
                feat = sharp && !par;
            }
            if (feat) out.push(P[e.a * 3], P[e.a * 3 + 1], P[e.a * 3 + 2], P[e.b * 3], P[e.b * 3 + 1], P[e.b * 3 + 2]);
        });
        return out;
    }

    const DIM = {
        nose: 3.93, rear: -4.04, muzzle: 5.61, gunMuzzle: 3.68, skirt: 1.74, roof: 2.45,
        trackZ: 1.42, trackW: 0.635,
        wheelR: 0.3175, wheelY: 0.3925,
        wheels: [2.37, 1.42, 0.63, -0.14, -0.88, -1.62, -2.37],
        idler: [3.21348685535, 0.70], idlerR: 0.30,
        sprocket: [-3.33, 0.82], sprocketR: 0.3397,
        rollers: [[-1.55, 0.955], [0.75, 0.95]], rollerR: 0.09,
        pivot: 0.40, turretY: 1.52,
        trunnion: [1.53, 0.41],
        elevMin: -9, elevMax: 20
    };

    /* ---------------------------------------------------------------- *
     * WebGL
     * ---------------------------------------------------------------- */
    const canvas = $("#aq-canvas");
    const fail = $("#aq-fail");
    let gl = null;
    try {
        gl = canvas.getContext("webgl", { antialias: true, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false })
            || canvas.getContext("experimental-webgl", { antialias: true, alpha: false });
    } catch (e) { gl = null; }
    if (!gl) {
        if (fail) fail.hidden = false;
        document.documentElement.classList.add("aq-no-webgl");
        return;
    }
    const UINT32 = !!gl.getExtension("OES_element_index_uint");
    const DERIV = !!gl.getExtension("OES_standard_derivatives");

    function compile(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("shader: " + gl.getShaderInfoLog(s));
        return s;
    }
    function program(vs, fs) {
        const p = gl.createProgram();
        gl.attachShader(p, compile(gl.VERTEX_SHADER, "precision highp float;\n" + vs));
        gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(p));
        const pr = { p, u: {}, a: {} };
        const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < nu; i++) { const info = gl.getActiveUniform(p, i); pr.u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name); }
        const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
        for (let i = 0; i < na; i++) { const info = gl.getActiveAttrib(p, i); pr.a[info.name] = gl.getAttribLocation(p, info.name); }
        return pr;
    }
    function mkBuf(data, target, usage) {
        const buf = gl.createBuffer();
        gl.bindBuffer(target || gl.ARRAY_BUFFER, buf);
        gl.bufferData(target || gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW);
        return buf;
    }
    function upload(b, withLines, dynamic) {
        const big = b.count() > 65535;
        if (big && !UINT32) throw new Error("mesh too large");
        const m = {
            pos: mkBuf(new Float32Array(b.pos), gl.ARRAY_BUFFER, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW),
            nrm: mkBuf(new Float32Array(b.nrm), gl.ARRAY_BUFFER, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW),
            col: mkBuf(new Float32Array(b.col)),
            ibo: mkBuf(big ? new Uint32Array(b.idx) : new Uint16Array(b.idx), gl.ELEMENT_ARRAY_BUFFER),
            count: b.idx.length, itype: big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, verts: b.count()
        };
        if (withLines) {
            const L = featureEdges(b, 0.8);
            m.lines = { buf: mkBuf(new Float32Array(L)), count: L.length / 3 };
        }
        return m;
    }

    /* ----- Шейдеры ----- */
    const GLSL_SHADOW = `
uniform sampler2D uShadow;
uniform float uShadowRes;
float unpackD(vec4 c) { return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0)); }
float shadowAt(vec4 sp, float ndl) {
    vec3 p = sp.xyz / sp.w * 0.5 + 0.5;
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
    float bias = 0.0007 + 0.0022 * (1.0 - ndl);
    float t = 1.0 / uShadowRes, s = 0.0;
    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            float d = unpackD(texture2D(uShadow, p.xy + vec2(float(x), float(y)) * t * 1.25));
            s += (p.z - bias > d) ? 0.0 : 1.0;
        }
    }
    return s / 9.0;
}
`;
    const GLSL_NOISE = `
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise3(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 tonemap(vec3 c) {
    /* плёночная кривая (ACES, аппроксимация) — контраст в тенях, мягкие света */
    c *= 0.56;
    c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
    return sqrt(c);
}
`;
    const GLSL_AO = `
uniform sampler2D uAO; uniform vec2 uView; uniform vec2 uAOTexel; uniform float uAOOn;
float ssao() {
    if (uAOOn < 0.5) return 1.0;
    return texture2D(uAO, gl_FragCoord.xy / uView).r;
}
`;
    /* SSAO: глубина (из прохода глубины) → затенение щелей, стыков и контакта с землёй */
    const VS_QUAD = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
    const FS_AO = `precision highp float;
uniform sampler2D uDepth; uniform mat4 uIP; uniform vec2 uTexel; uniform float uScale; uniform float uOrtho; uniform float uRadius; uniform float uPower;
varying vec2 vUv;
float unpackD(vec4 c) { return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0)); }
vec3 posAt(vec2 uv) {
    float d = unpackD(texture2D(uDepth, uv));
    vec4 p = uIP * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
}
void main() {
    float d0 = unpackD(texture2D(uDepth, vUv));
    if (d0 > 0.99999) { gl_FragColor = vec4(1.0); return; }
    vec3 P = posAt(vUv);
    vec3 px = posAt(vUv + vec2(uTexel.x, 0.0)), nx = posAt(vUv - vec2(uTexel.x, 0.0));
    vec3 py = posAt(vUv + vec2(0.0, uTexel.y)), ny = posAt(vUv - vec2(0.0, uTexel.y));
    vec3 dx = abs(px.z - P.z) < abs(P.z - nx.z) ? px - P : P - nx;
    vec3 dy = abs(py.z - P.z) < abs(P.z - ny.z) ? py - P : P - ny;
    vec3 N = normalize(cross(dx, dy));
    if (N.z < 0.0) N = -N;
    float depth = max(-P.z, 0.1);
    float rpx = uOrtho > 0.5 ? uRadius * uScale : uRadius * uScale / depth;
    rpx = clamp(rpx, 2.0, 90.0);
    vec2 cell = mod(floor(gl_FragCoord.xy), 4.0);
    float ang = (cell.x * 4.0 + cell.y + fract(cell.x * 0.37 + cell.y * 0.61) * 0.0) * 0.3927;
    float jr = fract((cell.y * 4.0 + cell.x) * 0.618);
    float sum = 0.0, r2 = uRadius * uRadius;
    for (int i = 0; i < 14; i++) {
        float fi = float(i);
        float a = ang + fi * 2.39996;
        vec2 off = vec2(cos(a), sin(a)) * sqrt(fract((fi + jr) / 14.0) + 0.02) * rpx * uTexel;
        vec3 v = posAt(vUv + off) - P;
        float vv = dot(v, v);
        float fall = max(0.0, 1.0 - vv / r2);
        sum += max(0.0, dot(v, N) - 0.003 - depth * 0.0004) / (vv + 0.0025) * fall;
    }
    float ao = clamp(1.0 - uRadius * 2.4 / 14.0 * sum, 0.0, 1.0);
    gl_FragColor = vec4(vec3(pow(ao, uPower)), 1.0);
}`;
    const FS_AOBLUR = `precision highp float;
uniform sampler2D uOcc; uniform sampler2D uDepth; uniform vec2 uTexel;
varying vec2 vUv;
float unpackD(vec4 c) { return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0)); }
void main() {
    float d0 = unpackD(texture2D(uDepth, vUv));
    float s = 0.0, w = 0.0;
    for (int y = -2; y < 2; y++) for (int x = -2; x < 2; x++) {
        vec2 uv = vUv + (vec2(float(x), float(y)) + 0.5) * uTexel;
        float d = unpackD(texture2D(uDepth, uv));
        float k = 1.0 / (1.0 + abs(d - d0) * 4000.0);
        s += texture2D(uOcc, uv).r * k; w += k;
    }
    gl_FragColor = vec4(vec3(s / max(w, 1e-4)), 1.0);
}`;
    const VS_MAIN = `
attribute vec3 aPos; attribute vec3 aNormal; attribute vec4 aColor;
uniform mat4 uVP; uniform mat4 uModel; uniform mat4 uLightVP;
varying vec3 vW; varying vec3 vN; varying vec3 vL; varying vec4 vC; varying vec4 vS;
void main() {
    vec4 w = uModel * vec4(aPos, 1.0);
    vN = mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNormal;
    vW = w.xyz; vL = aPos; vC = aColor;
    vS = uLightVP * vec4(w.xyz + normalize(vN) * 0.035, 1.0);
    gl_Position = uVP * w;
}`;
    const FS_MAIN = `precision highp float;
uniform vec3 uCam; uniform vec3 uViewDir; uniform float uOrtho;
uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uSky; uniform vec3 uGnd;
uniform vec3 uPaint; uniform vec3 uPaint2; uniform vec3 uPaint3; uniform float uCamo;
uniform vec3 uDust; uniform float uDirt; uniform float uBlue;
uniform vec3 uFog; uniform float uFogD;
uniform vec3 uFlashPos; uniform float uFlash; uniform float uSeed; uniform vec3 uSkyTop; uniform vec3 uFill;
varying vec3 vW; varying vec3 vN; varying vec3 vL; varying vec4 vC; varying vec4 vS;
${GLSL_SHADOW}
${GLSL_NOISE}
${GLSL_AO}
void main() {
    vec3 N = normalize(vN);
    vec3 Vd = uOrtho > 0.5 ? -uViewDir : normalize(uCam - vW);
    if (dot(N, Vd) < -0.3) N = -N;
    float mat = floor(vC.a + 0.01), sub = vC.a - mat;
    vec3 base = vC.rgb;
    /* rough — шероховатость, f0 — отражение в нормаль, metal — доля металла */
    float rough = 0.8, f0 = 0.035, metal = 0.0;
    if (mat < 0.5) {
        vec3 paint = uPaint;
        if (uCamo > 0.5) {
            vec3 q = vL + vec3(uSeed, 0.0, uSeed * 0.7);
            float n1 = noise3(q * vec3(0.75, 1.1, 0.75)) + 0.45 * noise3(q * 1.9 + 3.7);
            float n2 = noise3(q * vec3(0.9, 1.0, 0.9) + vec3(11.0, 5.0, 2.0)) + 0.45 * noise3(q * 2.2 + 7.0);
            if (n1 > 0.86) paint = uPaint2;
            if (n2 > 1.0) paint = uPaint3;
        }
        base *= paint;
        /* CARC — матовая краска: мелкая неоднородность, потёки и выгорание сверху */
        float g = noise3(vL * 9.0) * 0.06 - 0.03 + (noise3(vL * 31.0) - 0.5) * 0.03;
        base *= 1.0 + g;
        float streak = noise3(vec3(vL.x * 14.0, vL.y * 1.2, vL.z * 14.0));
        base *= 1.0 - 0.05 * smoothstep(0.55, 0.9, streak) * (1.0 - abs(N.y));
        base *= 1.0 + 0.035 * max(N.y, 0.0);
        float dirt = (1.0 - smoothstep(0.15, 1.45, vW.y)) * uDirt * (0.75 + 0.5 * noise3(vL * 3.0));
        base = mix(base, uDust, clamp(dirt, 0.0, 1.0) * 0.6);
        rough = 0.82; f0 = 0.03;
    } else if (mat < 1.5) {
        if (sub < 0.2) { rough = 0.93; f0 = 0.02; }                    /* резина */
        else if (sub < 0.45) { rough = 0.55; f0 = 0.06; metal = 0.45; } /* сталь */
        else { rough = 0.38; f0 = 0.08; metal = 0.85; }                 /* воронёный металл */
    } else if (mat < 2.5) {
        float k = uBlue > 0.5 ? 0.0 : 1.0;
        gl_FragColor = vec4(mix(vec3(0.75, 0.88, 1.0), base * 1.25, k), 1.0);
        return;
    } else {
        rough = 0.06; f0 = 0.09; metal = 0.0;                            /* оптика */
    }
    vec3 alb = base * base;
    float ndl = max(dot(N, uSun), 0.0);
    float sh = shadowAt(vS, ndl);
    float occ = ssao();
    vec3 H = normalize(uSun + Vd);
    float ndv = max(dot(N, Vd), 0.0);
    float gloss = mix(180.0, 6.0, rough);
    vec3 F0 = mix(vec3(f0), alb * 1.6 + 0.04, metal);
    vec3 Fs = F0 + (1.0 - F0) * pow(1.0 - max(dot(H, Vd), 0.0), 5.0);
    vec3 sp = Fs * (gloss + 8.0) / 25.13 * pow(max(dot(N, H), 0.0), gloss) * ndl * sh;
    /* Окружение: небо сверху, земля снизу (полусферы) + отскок от земли */
    vec3 amb = mix(uGnd, uSky, N.y * 0.5 + 0.5) * 0.92;
    float hao = 0.62 + 0.38 * smoothstep(0.05, 1.3, vW.y);
    float ao = occ * hao;
    vec3 Rf = reflect(-Vd, N);
    vec3 env = mix(uGnd * 0.9, mix(uFog, uSkyTop, smoothstep(0.0, 0.6, Rf.y)), smoothstep(-0.12, 0.08, Rf.y));
    vec3 Fe = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - ndv, 5.0);
    vec3 col = alb * (1.0 - metal * 0.85) * (amb * ao + uSunCol * ndl * sh * mix(1.0, occ, 0.3));
    col += alb * (1.0 - metal * 0.7) * mix(uSky, uGnd * 1.6, 0.45) * 1.9 * max(dot(N, uFill), 0.0) * ao;
    /* отражённый от земли свет снизу-спереди */
    col += alb * (1.0 - metal * 0.7) * uGnd * 1.1 * max(dot(N, normalize(vec3(0.55, -0.55, -0.2))), 0.0) * ao;
    /* слабый контровой свет сзади, чтобы корма не проваливалась */
    col += alb * (1.0 - metal * 0.7) * uSky * 0.45 * max(dot(N, normalize(vec3(-0.8, 0.35, 0.3))), 0.0) * ao;
    col += uSunCol * sp + env * Fe * (1.0 - rough * 0.9) * ao;
    if (mat > 2.5) col += vec3(0.02, 0.05, 0.06) * (1.0 - ndv);
    vec3 fl = uFlashPos - vW; float fd = length(fl);
    col += alb * vec3(1.0, 0.62, 0.28) * uFlash * max(dot(N, fl / max(fd, 0.001)), 0.0) * 14.0 / (1.0 + fd * fd);
    col += amb * pow(1.0 - ndv, 4.0) * 0.05 * ao;
    float f = 1.0 - exp(-length(uCam - vW) * uFogD);
    col = mix(col, uFog, f);
    if (uBlue > 0.5) {
        float l = 0.30 + 0.45 * max(dot(N, normalize(vec3(0.35, 0.8, 0.5))), 0.0) + 0.12 * N.y + 0.1 * sh;
        vec3 bp = mix(vec3(0.045, 0.16, 0.38), vec3(0.17, 0.38, 0.70), l);
        gl_FragColor = vec4(bp, 1.0);
        return;
    }
    if (uAOOn > 1.5) col = vec3(occ * occ);
    gl_FragColor = vec4(tonemap(col), 1.0);
}`;
    const VS_SHADOW = `
attribute vec3 aPos;
uniform mat4 uLightVP; uniform mat4 uModel;
void main() { gl_Position = uLightVP * uModel * vec4(aPos, 1.0); }`;
    const FS_SHADOW = `precision highp float;
vec4 packD(float d) {
    vec4 e = fract(d * vec4(1.0, 255.0, 65025.0, 16581375.0));
    e -= e.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
    return e;
}
void main() { gl_FragColor = packD(gl_FragCoord.z); }`;
    const VS_GROUND = `
attribute vec3 aPos;
uniform mat4 uVP; uniform mat4 uLightVP;
varying vec3 vW; varying vec4 vS;
void main() { vW = aPos; vS = uLightVP * vec4(aPos, 1.0); gl_Position = uVP * vec4(aPos, 1.0); }`;
    const FS_GROUND = (DERIV ? "#extension GL_OES_standard_derivatives : enable\n" : "") + `precision highp float;
uniform vec3 uCam; uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uSky; uniform float uOrtho;
uniform vec3 uG1; uniform vec3 uG2; uniform vec3 uG3; uniform float uGType;
uniform float uScroll; uniform float uTrail; uniform float uBlue;
uniform vec3 uFog; uniform float uFogD; uniform vec3 uFlashPos; uniform float uFlash;
varying vec3 vW; varying vec4 vS;
${GLSL_SHADOW}
${GLSL_NOISE}
${GLSL_AO}
float gridLine(vec2 p, float step, float w) {
    vec2 g = p / step;
    ${DERIV ? "vec2 fw = fwidth(g);" : "vec2 fw = vec2(0.02);"}
    vec2 a = abs(fract(g - 0.5) - 0.5) / max(fw, vec2(0.0001));
    return 1.0 - clamp(min(a.x, a.y) - w, 0.0, 1.0);
}
void main() {
    vec2 p = vec2(vW.x + uScroll, vW.z);
    float dist = length(uCam.xz - vW.xz);
    if (uBlue > 0.5) {
        vec3 c = vec3(0.06, 0.20, 0.44);
        float g1 = gridLine(vW.xz, 0.5, 0.0), g2 = gridLine(vW.xz, 2.0, 0.4);
        c = mix(c, vec3(0.30, 0.50, 0.80), g1 * 0.35 * (1.0 - smoothstep(10.0, 40.0, dist)));
        c = mix(c, vec3(0.62, 0.78, 1.0), g2 * 0.5 * (1.0 - smoothstep(20.0, 70.0, dist)));
        float sh = shadowAt(vS, 1.0);
        c *= 0.72 + 0.28 * sh;
        gl_FragColor = vec4(c, 1.0);
        return;
    }
    float n = noise3(vec3(p * 0.12, 0.0)) * 0.6 + noise3(vec3(p * 0.5, 3.0)) * 0.3 + noise3(vec3(p * 2.3, 7.0)) * 0.1;
    vec3 c = mix(uG1, uG2, smoothstep(0.25, 0.75, n));
    if (uGType < 0.5) {
        float rip = sin(p.x * 2.6 + p.y * 0.8 + noise3(vec3(p * 0.6, 1.0)) * 5.0);
        c *= 0.96 + 0.04 * rip;
    } else {
        float gr = noise3(vec3(p * 7.0, 2.0));
        c = mix(c, uG3, smoothstep(0.55, 0.85, gr) * 0.6);
    }
    c *= 0.94 + 0.12 * noise3(vec3(p * 5.0, 5.0));
    float tz = abs(vW.z);
    float band = smoothstep(1.10, 1.14, tz) * (1.0 - smoothstep(1.70, 1.74, tz));
    float behind = 1.0 - smoothstep(2.4, 2.8, vW.x);
    float reach = 1.0 - smoothstep(uTrail - 1.0, uTrail + 1.0, 2.6 - vW.x);
    float tread = 0.55 + 0.45 * step(0.45, fract(p.x / 0.19));
    float trail = band * behind * reach * (1.0 - smoothstep(25.0, 140.0, -vW.x));
    c = mix(c, c * (uGType < 0.5 ? 0.72 : 0.6), trail * tread);
    vec2 q = abs(vec2(vW.x - 0.0, vW.z)) - vec2(3.75, 1.78);
    float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    float ao = mix(0.5, 1.0, smoothstep(-0.4, 1.4, sd)) * ssao();
    vec3 alb = c * c;
    float sh = shadowAt(vS, uSun.y);
    vec3 col = alb * (uSky * 0.55 * ao + uSunCol * uSun.y * sh * mix(0.8, 1.0, ao));
    vec3 fl = uFlashPos - vW; float fd = length(fl);
    col += alb * vec3(1.0, 0.62, 0.28) * uFlash * 10.0 / (1.0 + fd * fd);
    float f = 1.0 - exp(-dist * uFogD);
    col = mix(col, uFog, clamp(f, 0.0, 1.0));
    gl_FragColor = vec4(tonemap(col), 1.0);
}`;
    const VS_SKY = `
attribute vec2 aPos;
varying vec2 vP;
void main() { vP = aPos; gl_Position = vec4(aPos, 0.9999, 1.0); }`;
    const FS_SKY = `precision highp float;
uniform mat4 uIVP; uniform vec3 uSun; uniform vec3 uFog; uniform vec3 uSkyTop; uniform float uBlue; uniform float uOrtho;
varying vec2 vP;
${GLSL_NOISE}
void main() {
    if (uBlue > 0.5) {
        vec3 c = mix(vec3(0.05, 0.17, 0.38), vec3(0.03, 0.10, 0.25), vP.y * 0.5 + 0.5);
        gl_FragColor = vec4(c, 1.0);
        return;
    }
    vec4 a = uIVP * vec4(vP, -1.0, 1.0), b = uIVP * vec4(vP, 1.0, 1.0);
    vec3 d = normalize(b.xyz / b.w - a.xyz / a.w);
    float h = uOrtho > 0.5 ? vP.y * 0.5 + 0.2 : d.y;
    vec3 c = mix(uFog, uSkyTop, smoothstep(0.0, 0.55, h));
    c = mix(c, uFog * 0.9, smoothstep(0.0, -0.2, h));
    float s = max(dot(d, uSun), 0.0);
    c += vec3(1.0, 0.85, 0.6) * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.12) * (1.0 - uOrtho);
    gl_FragColor = vec4(tonemap(c), 1.0);
}`;
    const VS_LINE = `
attribute vec3 aPos;
uniform mat4 uVP; uniform mat4 uModel;
void main() { gl_Position = uVP * uModel * vec4(aPos, 1.0); }`;
    const FS_LINE = `precision highp float;
uniform vec4 uColor;
void main() { gl_FragColor = uColor; }`;
    const VS_PART = `
attribute vec3 aPos; attribute float aSize; attribute vec4 aCol;
uniform mat4 uVP; uniform float uPointScale; uniform float uOrtho; uniform float uMaxPt;
varying vec4 vCol;
void main() {
    gl_Position = uVP * vec4(aPos, 1.0);
    float w = uOrtho > 0.5 ? 1.0 : gl_Position.w;
    gl_PointSize = clamp(aSize * uPointScale / max(w, 0.1), 1.0, uMaxPt);
    vCol = aCol;
}`;
    const FS_PART = `precision highp float;
varying vec4 vCol;
void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r = dot(q, q);
    if (r > 1.0) discard;
    float a = (1.0 - r);
    a *= a;
    gl_FragColor = vec4(vCol.rgb, vCol.a * a);
}`;

    let PR;
    try {
        PR = {
            main: program(VS_MAIN, FS_MAIN),
            shadow: program(VS_SHADOW, FS_SHADOW),
            ground: program(VS_GROUND, FS_GROUND),
            sky: program(VS_SKY, FS_SKY),
            line: program(VS_LINE, FS_LINE),
            part: program(VS_PART, FS_PART),
            ao: program(VS_QUAD, FS_AO),
            aoblur: program(VS_QUAD, FS_AOBLUR)
        };
    } catch (err) {
        if (fail) { fail.hidden = false; const m = $("#aq-fail-msg"); if (m) m.textContent = String(err.message || err).slice(0, 400); }
        throw err;
    }

    /* ----- Runtime GLB model (user-supplied source, no external loader) ----- */
    let GLB_MODEL;
    try {
        if (!window.NexusGLB) throw new Error("локальный GLB-загрузчик не подключён");
        GLB_MODEL = await window.NexusGLB.load("../assets/models/abrams-user.glb");
    } catch (err) {
        if (fail) {
            fail.hidden = false;
            const m = $("#aq-fail-msg");
            if (m) m.textContent = "Не удалось загрузить модель Abrams: " + String(err && err.message || err).slice(0, 400);
        }
        throw err;
    }

    function glbBuilder(name) {
        const part = GLB_MODEL.meshes[name];
        if (!part) throw new Error("GLB: отсутствует меш " + name);
        const count = part.positions.length / 3;
        if (part.normals.length !== part.positions.length) throw new Error("GLB: неверные нормали " + name);
        const col = new Float32Array(count * 4);
        const src = part.colors, mat = part.nexusMaterial;
        const paint = [178, 150, 108];
        const alpha = [0, 1.6, 1.0, 3.0, 1.3, 1.3, 1.0];
        for (let i = 0; i < count; i++) {
            const kind = mat ? Math.min(6, mat[i * 4 + 1]) : 0;
            for (let k = 0; k < 3; k++) {
                const c = src ? src[i * 4 + k] : 255;
                col[i * 4 + k] = kind === 0 ? c / paint[k] : c / 255;
            }
            col[i * 4 + 3] = alpha[kind];
        }
        return {
            pos: part.positions,
            nrm: part.normals,
            col,
            idx: part.indices,
            count() { return count; }
        };
    }

    const SOURCE_MESH = {
        hull: glbBuilder("hull"), turret: glbBuilder("turret"), gun: glbBuilder("gun"),
        wheel: glbBuilder("wheel"), idler: glbBuilder("idler"), sprocket: glbBuilder("sprocket"),
        roller: glbBuilder("roller"), link: glbBuilder("link")
    };
    const MESH = {
        hull: upload(SOURCE_MESH.hull, true),
        turret: upload(SOURCE_MESH.turret, true),
        gun: upload(SOURCE_MESH.gun, true),
        wheel: upload(SOURCE_MESH.wheel, true),
        idler: upload(SOURCE_MESH.idler, true),
        sprocket: upload(SOURCE_MESH.sprocket, true),
        roller: upload(SOURCE_MESH.roller, true)
    };

    /* Track path from the supplied model. Geometry itself comes from GLB; only
       the loaded link instances are repositioned to preserve the drive control. */
    function sourceTrackPath() {
        const off = 0.03;
        function pathFor(idlerX) {
            const circles = [{ x: DIM.sprocket[0], y: DIM.sprocket[1], r: DIM.sprocketR }]
                .concat(DIM.rollers.map(r => ({ x: r[0], y: r[1], r: DIM.rollerR + off })))
                .concat([{ x: idlerX, y: DIM.idler[1], r: DIM.idlerR + off }])
                .concat(DIM.wheels.map(x => ({ x, y: DIM.wheelY, r: DIM.wheelR + off })));
            const n = circles.length, tangents = [], segs = [];
            for (let i = 0; i < n; i++) {
                const a = circles[i], b = circles[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y;
                const d = Math.hypot(dx, dy), hx = dx / d, hy = dy / d, k = (a.r - b.r) / d;
                const q = Math.sqrt(1 - k * k);
                tangents.push([hx * k - hy * q, hy * k + hx * q]);
            }
            let length = 0;
            for (let i = 0; i < n; i++) {
                const c = circles[i], p = tangents[(i - 1 + n) % n], q = tangents[i];
                const a0 = Math.atan2(p[1], p[0]), a1 = Math.atan2(q[1], q[0]);
                let da = a0 - a1;
                while (da < -1e-7) da += TAU;
                while (da > TAU - 1e-7) da -= TAU;
                if (da < 0) da = 0;
                segs.push({ arc: true, c, a0, da, length: c.r * da, start: length });
                length += c.r * da;
                const next = circles[(i + 1) % n];
                const p0 = [c.x + c.r * q[0], c.y + c.r * q[1]];
                const p1 = [next.x + next.r * q[0], next.y + next.r * q[1]];
                const lineLength = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
                segs.push({ arc: false, p0, p1, length: lineLength, start: length });
                length += lineLength;
            }
            return {
                segs, L: length,
                at(distance) {
                    distance = ((distance % length) + length) % length;
                    for (const seg of segs) if (distance <= seg.start + seg.length + 1e-9) {
                        const t = distance - seg.start;
                        if (seg.arc) {
                            const a = seg.a0 - t / seg.c.r;
                            return [seg.c.x + seg.c.r * Math.cos(a), seg.c.y + seg.c.r * Math.sin(a)];
                        }
                        const f = seg.length ? t / seg.length : 0;
                        return [seg.p0[0] + (seg.p1[0] - seg.p0[0]) * f, seg.p0[1] + (seg.p1[1] - seg.p0[1]) * f];
                    }
                    return [circles[0].x, circles[0].y];
                }
            };
        }
        let path = pathFor(DIM.idler[0]);
        const links = Math.round(path.L / 0.194);
        let lo = DIM.idler[0] - 0.2, hi = DIM.idler[0] + 0.2;
        for (let i = 0; i < 50; i++) {
            const mid = (lo + hi) / 2;
            if (pathFor(mid).L > links * 0.194) hi = mid;
            else lo = mid;
        }
        DIM.idler[0] = (lo + hi) / 2;
        path = pathFor(DIM.idler[0]);
        path.N = links; path.pitch = path.L / links;
        return path;
    }

    const PATH = sourceTrackPath();
    const LINKS = PATH.N, PITCH = PATH.pitch;
    const linkB = SOURCE_MESH.link, LV = linkB.count();
    const track = (function () {
        const total = LINKS * 2;
        const pos = new Float32Array(total * LV * 3), nrm = new Float32Array(total * LV * 3);
        const col = new Float32Array(total * LV * 4);
        const idx = new Uint32Array(total * linkB.idx.length);
        for (let k = 0; k < total; k++) {
            col.set(linkB.col, k * LV * 4);
            const base = k * LV, io = k * linkB.idx.length;
            for (let i = 0; i < linkB.idx.length; i++) idx[io + i] = base + linkB.idx[i];
        }
        const b = { pos, nrm, col, idx, count() { return total * LV; } };
        const m = upload(b, false, true);
        m.P = pos; m.N = nrm;
        return m;
    })();
    let lastTrackOff = NaN;
    function updateTrack(off) {
        if (off === lastTrackOff) return;
        lastTrackOff = off;
        const P = track.P, N = track.N, lp = linkB.pos, ln = linkB.nrm;
        let o = 0;
        [DIM.trackZ, -DIM.trackZ].forEach(zc => {
            for (let k = 0; k < LINKS; k++) {
                const a = PATH.at(k * PITCH + off - PITCH / 2), b = PATH.at(k * PITCH + off + PITCH / 2);
                const px = (a[0] + b[0]) / 2, py = (a[1] + b[1]) / 2;
                const dx = b[0] - a[0], dy = b[1] - a[1], dl = Math.hypot(dx, dy) || 1;
                const tx = dx / dl, ty = dy / dl, nx = ty, ny = -tx;
                for (let i = 0; i < LV; i++) {
                    const u = lp[i * 3], n = lp[i * 3 + 1], w = lp[i * 3 + 2];
                    P[o] = px + tx * u + nx * n; P[o + 1] = py + ty * u + ny * n; P[o + 2] = zc + w;
                    const nu = ln[i * 3], nn = ln[i * 3 + 1], nw = ln[i * 3 + 2];
                    N[o] = tx * nu + nx * nn; N[o + 1] = ty * nu + ny * nn; N[o + 2] = nw;
                    o += 3;
                }
            }
        });
        gl.bindBuffer(gl.ARRAY_BUFFER, track.pos); gl.bufferSubData(gl.ARRAY_BUFFER, 0, P);
        gl.bindBuffer(gl.ARRAY_BUFFER, track.nrm); gl.bufferSubData(gl.ARRAY_BUFFER, 0, N);
    }

    /* Земля, небо */
    const G = 260;
    const groundBuf = mkBuf(new Float32Array([-G, 0, -G, G, 0, -G, G, 0, G, -G, 0, -G, G, 0, G, -G, 0, G]));
    const skyBuf = mkBuf(new Float32Array([-1, -1, 3, -1, -1, 3]));

    /* Размерные линии (статичны) */
    const dimLines = (function () {
        const L = [], y = 0.02, tick = (x, z, h) => { L.push(x, y, z, x, h, z); };
        const zL = -2.55, zH = -3.25, xW = 6.55, xHt = -4.75, zHt = 2.15;
        L.push(DIM.rear, y, zL, DIM.muzzle, y, zL); tick(DIM.rear, zL, 0.35); tick(DIM.muzzle, zL, 0.35);
        L.push(DIM.rear, y, zL, DIM.rear, y, -1.9); L.push(DIM.muzzle, y, zL, DIM.muzzle, y, -0.3);
        L.push(DIM.rear, y, zH, DIM.nose, y, zH); tick(DIM.rear, zH, 0.3); tick(DIM.nose, zH, 0.3);
        L.push(DIM.nose, y, zH, DIM.nose, y, -1.9); L.push(DIM.rear, y, zH, DIM.rear, y, zL);
        L.push(xW, y, -DIM.skirt, xW, y, DIM.skirt); L.push(xW, y, -DIM.skirt, 3.9, y, -DIM.skirt); L.push(xW, y, DIM.skirt, 3.9, y, DIM.skirt);
        L.push(xHt, 0, zHt, xHt, DIM.roof, zHt); L.push(xHt - 0.15, DIM.roof, zHt, -1.9, DIM.roof, zHt * 0.7); L.push(xHt - 0.15, 0.001, zHt, xHt + 0.15, 0.001, zHt);
        return { buf: mkBuf(new Float32Array(L)), count: L.length / 3 };
    })();

    /* Тени: RGBA-текстура с упакованной глубиной */
    const SHADOW_RES = 2048;
    let AO_R = 0.34, AO_P = 2.2;
    const shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SHADOW_RES, SHADOW_RES, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const shadowFbo = gl.createFramebuffer();
    const shadowRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, shadowRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, SHADOW_RES, SHADOW_RES);
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, shadowTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, shadowRb);
    const SHADOW_OK = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!SHADOW_OK) {
        gl.bindTexture(gl.TEXTURE_2D, shadowTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    }
    const MAX_PT = (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) || [1, 64])[1];

    /* SSAO: буфер глубины экрана + буфер затенения */
    const AO = { w: 0, h: 0, ok: false };
    function mkTarget(w, h, filter, depth) {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const f = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        let rb = null;
        if (depth) {
            rb = gl.createRenderbuffer();
            gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
            gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
        }
        const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { t, f, rb, ok };
    }
    function freeTarget(x) { if (!x) return; gl.deleteTexture(x.t); gl.deleteFramebuffer(x.f); if (x.rb) gl.deleteRenderbuffer(x.rb); }
    function ensureAO() {
        const sc = state.dpr > 1.25 ? 0.5 : 1;
        const w = Math.max(1, Math.round(state.w * sc)), h = Math.max(1, Math.round(state.h * sc));
        if (AO.w === w && AO.h === h) return AO.ok;
        freeTarget(AO.depth); freeTarget(AO.occ); freeTarget(AO.blur);
        AO.depth = mkTarget(w, h, gl.NEAREST, true);
        AO.occ = mkTarget(w, h, gl.NEAREST, false);
        AO.blur = mkTarget(w, h, gl.LINEAR, false);
        AO.w = w; AO.h = h; AO.sc = sc; AO.ok = AO.depth.ok && AO.occ.ok && AO.blur.ok;
        return AO.ok;
    }
    const quadBuf = mkBuf(new Float32Array([-1, -1, 3, -1, -1, 3]));
    const FILL = V.norm([0.25, 0.30, -0.92]);

    /* Частицы */
    const MAX_PARTS = 900;
    const partData = new Float32Array(MAX_PARTS * 8);
    const partBuf = mkBuf(partData, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW);
    const parts = [];
    function spawn(o) {
        if (parts.length >= MAX_PARTS) parts.shift();
        parts.push(Object.assign({ v: [0, 0, 0], life: 0, max: 1, size: 0.5, grow: 0, col: [1, 1, 1], a: 0.6, add: false, drag: 0.5, lift: 0 }, o));
    }

    /* ---------------------------------------------------------------- *
     * Окружение и окраска
     * ---------------------------------------------------------------- */
    const CAMOS = [
        { name: "ПУСТЫНЯ", label: "Пустынный CARC 686A (tan)", paint: [0.72, 0.62, 0.45], p2: [0.72, 0.62, 0.45], p3: [0.72, 0.62, 0.45], camo: 0, env: 0 },
        { name: "ЛЕС", label: "Зелёный CARC 383 (NATO green)", paint: [0.30, 0.34, 0.21], p2: [0.30, 0.34, 0.21], p3: [0.30, 0.34, 0.21], camo: 0, env: 1 },
        { name: "НАТО-3", label: "Трёхцветный камуфляж НАТО", paint: [0.30, 0.34, 0.21], p2: [0.36, 0.27, 0.18], p3: [0.10, 0.10, 0.09], camo: 1, env: 1 }
    ];
    const ENVS = [
        { sky: [0.52, 0.62, 0.78], top: [0.30, 0.52, 0.84], fog: [0.86, 0.80, 0.70], gnd: [0.42, 0.36, 0.28], sun: [2.15, 1.95, 1.65],
            g1: [0.74, 0.62, 0.45], g2: [0.66, 0.54, 0.38], g3: [0.56, 0.47, 0.34], gtype: 0, dust: [0.80, 0.70, 0.54], dirt: 0.75, puff: [0.80, 0.70, 0.55] },
        { sky: [0.50, 0.60, 0.72], top: [0.33, 0.50, 0.76], fog: [0.74, 0.78, 0.78], gnd: [0.25, 0.27, 0.18], sun: [2.0, 1.9, 1.7],
            g1: [0.38, 0.42, 0.24], g2: [0.44, 0.40, 0.28], g3: [0.30, 0.36, 0.18], gtype: 1, dust: [0.40, 0.34, 0.25], dirt: 0.7, puff: [0.46, 0.40, 0.31] }
    ];
    const SUN = V.norm([0.30, 0.66, 0.69]);
    const lightVP = (function () {
        const c = [0.6, 1.0, 0];
        const e = V.add(c, V.mul(SUN, 30));
        return M4.mul(M4.ortho(-8.5, 8.5, -8.5, 8.5, 5, 60), M4.lookAt(e, c, [0, 1, 0]));
    })();
    const VIEWS = [
        { id: "3d", name: "3D" }, { id: "side", name: "СБОКУ" }, { id: "front", name: "СПЕРЕДИ" },
        { id: "top", name: "СВЕРХУ" }, { id: "rear", name: "СЗАДИ" }
    ];

    /* ---------------------------------------------------------------- *
     * Состояние
     * ---------------------------------------------------------------- */
    const DEFAULT_VIEW = { yaw: 0.78, pitch: 0.2, dist: 14 };
    const state = {
        yaw: DEFAULT_VIEW.yaw, pitch: DEFAULT_VIEW.pitch, dist: DEFAULT_VIEW.dist, vYaw: 0, vPitch: 0,
        target: [0.75, 1.15, 0], autoRotate: true, lastInteract: -10, time: 0,
        view: 0, camo: 0, blue: false, dims: false, sound: true,
        az: 0, azT: 0, el: 0, elT: 0, speed: 0, speedT: 0, accel: 0, odo: 0, driven: 0,
        recoilT: 9, reload: 0, flash: 0, shake: 0,
        rock: { p: 0, pv: 0, r: 0, rv: 0 }, susp: 0, turretMoving: 0,
        w: 1, h: 1, dpr: 1, fps: 0, seed: 0
    };
    const keys = new Set();

    function load() {
        try {
            const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
            if (!s || typeof s !== "object") return;
            if (s.camo >= 0 && s.camo < CAMOS.length) state.camo = s.camo | 0;
            if (typeof s.sound === "boolean") state.sound = s.sound;
            if (typeof s.auto === "boolean") state.autoRotate = s.auto;
            if (typeof s.blue === "boolean") state.blue = s.blue;
            if (typeof s.dims === "boolean") state.dims = s.dims;
        } catch (e) { /* приватный режим */ }
    }
    function save() {
        try { localStorage.setItem(STORE_KEY, JSON.stringify({ camo: state.camo, sound: state.sound, auto: state.autoRotate, blue: state.blue, dims: state.dims })); } catch (e) { /* ignore */ }
    }

    /* ---------------------------------------------------------------- *
     * Звук: свист газотурбинного AGT-1500, лязг траков, выстрел
     * ---------------------------------------------------------------- */
    let AC = null, master = null, au = null;
    function ensureAudio() {
        if (!state.sound) return;
        if (!AC) {
            try {
                const Ctx = window.AudioContext || window.webkitAudioContext;
                if (!Ctx) return;
                AC = new Ctx();
                setupAudio();
            } catch (e) { AC = null; return; }
        }
        if (AC.state === "suspended") AC.resume().catch(() => {});
    }
    function noiseBuf(sec) {
        const n = Math.floor(AC.sampleRate * sec), buf = AC.createBuffer(1, n, AC.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        return buf;
    }
    function setupAudio() {
        master = AC.createGain(); master.gain.value = state.sound ? 0.55 : 0; master.connect(AC.destination);
        const nb = noiseBuf(2);
        const mk = (type, f) => { const o = AC.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; };
        const gain = v => { const g = AC.createGain(); g.gain.value = v; return g; };
        const filt = (type, f, q) => { const b = AC.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q || 0.7; return b; };
        const loopNoise = () => { const s = AC.createBufferSource(); s.buffer = nb; s.loop = true; s.start(); return s; };
        au = { nb };
        /* Турбина: два тона + полосовой фильтр */
        au.t1 = mk("sawtooth", 820); au.t2 = mk("sine", 1640);
        au.tf = filt("bandpass", 1500, 5); au.tg = gain(0.0);
        au.t1.connect(au.tf); au.t2.connect(au.tf); au.tf.connect(au.tg); au.tg.connect(master);
        /* Воздух / свист */
        au.wn = loopNoise(); au.wf = filt("bandpass", 3200, 1.2); au.wg = gain(0.0);
        au.wn.connect(au.wf); au.wf.connect(au.wg); au.wg.connect(master);
        /* Рокот */
        au.rn = loopNoise(); au.rf = filt("lowpass", 140, 0.9); au.rg = gain(0.0);
        au.rn.connect(au.rf); au.rf.connect(au.rg); au.rg.connect(master);
        /* Лязг траков */
        au.c = mk("square", 20); au.cf = filt("bandpass", 520, 2.5); au.cg = gain(0.0);
        au.c.connect(au.cf); au.cf.connect(au.cg); au.cg.connect(master);
        /* Гидравлика башни */
        au.h = mk("triangle", 150); au.hf = filt("lowpass", 600, 1); au.hg = gain(0.0);
        au.h.connect(au.hf); au.hf.connect(au.hg); au.hg.connect(master);
        /* Эхо для выстрела */
        au.dl = AC.createDelay(1.0); au.dl.delayTime.value = 0.38;
        au.df = filt("lowpass", 900, 0.7); au.dg = gain(0.32);
        au.dl.connect(au.df); au.df.connect(au.dg); au.dg.connect(au.dl); au.dg.connect(master);
    }
    function updateAudio(dt) {
        if (!AC || !au) return;
        const t = AC.currentTime, k = clamp(Math.abs(state.speed) / 18.6, 0, 1), acc = clamp(Math.abs(state.accel) / 2, 0, 1);
        const set = (p, v) => p.setTargetAtTime(v, t, 0.12);
        set(au.t1.frequency, 760 + 820 * k + 160 * acc); set(au.t2.frequency, 1520 + 1640 * k + 320 * acc);
        set(au.tf.frequency, 1400 + 1200 * k);
        set(au.tg.gain, 0.018 + 0.03 * k + 0.012 * acc);
        set(au.wg.gain, 0.012 + 0.03 * k);
        set(au.rg.gain, 0.05 + 0.32 * k);
        set(au.c.frequency, Math.max(2, Math.abs(state.speed) / PITCH * 0.5));
        set(au.cg.gain, 0.06 * clamp(k * 4, 0, 1));
        set(au.hg.gain, state.turretMoving > 0.01 ? 0.05 : 0);
        void dt;
    }
    function sfxFire() {
        if (!AC || !au || !state.sound) return;
        const t = AC.currentTime;
        const s = AC.createBufferSource(); s.buffer = au.nb;
        const f = AC.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(7000, t); f.frequency.exponentialRampToValueAtTime(180, t + 1.2);
        const g = AC.createGain(); g.gain.setValueAtTime(1.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
        s.connect(f); f.connect(g); g.connect(master); g.connect(au.dl); s.start(t); s.stop(t + 2);
        const o = AC.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.6);
        const og = AC.createGain(); og.gain.setValueAtTime(1.2, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
        o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.9);
    }
    function sfxClank() {
        if (!AC || !au || !state.sound) return;
        const t = AC.currentTime;
        [[880, 0], [610, 0.09], [1250, 0.16]].forEach(([fq, d]) => {
            const o = AC.createOscillator(); o.type = "square"; o.frequency.value = fq;
            const bf = AC.createBiquadFilter(); bf.type = "bandpass"; bf.frequency.value = fq * 1.5; bf.Q.value = 8;
            const g = AC.createGain(); g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.25, t + d + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.12);
            o.connect(bf); bf.connect(g); g.connect(master); o.start(t + d); o.stop(t + d + 0.15);
        });
    }
    function setSound(on) {
        state.sound = on;
        if (on) ensureAudio();
        if (master && AC) master.gain.setTargetAtTime(on ? 0.55 : 0, AC.currentTime, 0.05);
        paintToggles(); save();
    }

    /* ---------------------------------------------------------------- *
     * Кинематика: матрицы корпуса, башни, пушки, колёс
     * ---------------------------------------------------------------- */
    const X = {};
    function kinematics() {
        const bob = Math.sin(state.time * 19) * 0.004 * clamp(Math.abs(state.speed) / 10, 0, 1) + Math.sin(state.time * 7.3) * 0.0025 * clamp(Math.abs(state.speed) / 10, 0, 1);
        X.hull = M4.chain(M4.T(0, bob, 0), M4.about([0, 0.8, 0], M4.mul(M4.RZ(state.susp + state.rock.p), M4.RX(state.rock.r))));
        X.turret = M4.chain(X.hull, M4.T(DIM.pivot, DIM.turretY, 0), M4.RY(-state.az * DEG));
        X.gun = M4.chain(X.turret, M4.T(DIM.trunnion[0], DIM.trunnion[1], 0), M4.RZ(state.el * DEG));
        const t = state.recoilT, rec = t < 0.035 ? 0.34 * (t / 0.035) : 0.34 * Math.exp(-(t - 0.035) * 4.2);
        X.barrel = M4.mul(X.gun, M4.T(-rec, 0, 0));
        X.recoil = rec;
    }
    function wheelM(x, y, z, ang) {
        const m = M4.chain(M4.T(x, y, z), M4.RZ(ang));
        return z > 0 ? m : M4.mul(m, M4.RY(Math.PI));
    }
    function drawList() {
        const L = [
            { m: MESH.hull, M: X.hull },
            { m: MESH.turret, M: X.turret },
            { m: MESH.gun, M: X.barrel },
            { m: track, M: M4.ident() }
        ];
        const o = state.odo;
        [DIM.trackZ, -DIM.trackZ].forEach(z => {
            DIM.wheels.forEach((x, i) => L.push({ m: MESH.wheel, M: wheelM(x, DIM.wheelY, z, -o / DIM.wheelR + i * 1.3) }));
            L.push({ m: MESH.idler, M: wheelM(DIM.idler[0], DIM.idler[1], z, -o / DIM.idlerR) });
            DIM.rollers.forEach(([x, y]) => L.push({ m: MESH.roller, M: wheelM(x, y, z, -o / DIM.rollerR) }));
            L.push({ m: MESH.sprocket, M: wheelM(DIM.sprocket[0], DIM.sprocket[1], z, -o / DIM.sprocketR) });
        });
        return L;
    }

    /* ---------------------------------------------------------------- *
     * Камера
     * ---------------------------------------------------------------- */
    function camFit() { return Math.max(12.5, 5.7 / (Math.tan(16 * DEG) * Math.max(0.3, state.w / state.h))); }
    function camMin() { return 4.5; }
    function camMax() { return Math.max(30, camFit() * 1.8); }
    function computeCamera() {
        const v = VIEWS[state.view].id, aspect = state.w / state.h;
        const sh = state.shake, jx = (Math.random() - 0.5) * sh * 0.12, jy = (Math.random() - 0.5) * sh * 0.12;
        state.ortho = v !== "3d";
        if (!state.ortho) {
            const cp = Math.cos(state.pitch);
            const t = [state.target[0] + jx, state.target[1] + jy, state.target[2]];
            state.cam = [t[0] + state.dist * cp * Math.cos(state.yaw), t[1] + state.dist * Math.sin(state.pitch), t[2] + state.dist * cp * Math.sin(state.yaw)];
            state.proj = M4.persp(32 * DEG, aspect, 0.1, 400);
            state.view_ = M4.lookAt(state.cam, t, [0, 1, 0]);
            state.pointScale = state.h / (2 * Math.tan(16 * DEG));
            state.fogD = 0.0045;
        } else {
            let eye, c, up = [0, 1, 0], w, h;
            if (v === "side") { c = [0.95, 1.65, 0]; eye = [0.95, 1.65, -60]; w = 10.2; h = 3.8; }
            else if (v === "front") { c = [0, 1.65, 0]; eye = [60, 1.65, 0]; w = 4.2; h = 3.8; }
            else if (v === "rear") { c = [0, 1.65, 0]; eye = [-60, 1.65, 0]; w = 4.2; h = 3.8; }
            else { c = [0.95, 0, 0]; eye = [0.95, 60, 0]; up = [0, 0, 1]; w = 10.2; h = 4.0; }
            c = [c[0] + jx, c[1] + jy, c[2]]; eye = [eye[0] + jx, eye[1] + jy, eye[2]];
            const hh = Math.max(h / 2, w / 2 / aspect) * 1.14 * (state.orthoZoom || 1);
            state.cam = eye;
            state.proj = M4.ortho(-hh * aspect, hh * aspect, -hh, hh, 1, 140);
            state.view_ = M4.lookAt(eye, c, up);
            state.pointScale = state.h / (2 * hh);
            state.fogD = 0.0;
            state.viewDir = V.norm(V.sub(c, eye));
        }
        if (!state.ortho) state.viewDir = V.norm(V.sub(state.target, state.cam));
        state.vp = M4.mul(state.proj, state.view_);
        state.ivp = M4.invert(state.vp);
    }
    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, Math.floor(canvas.clientWidth * dpr)), h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        state.w = w; state.h = h; state.dpr = dpr;
        DEFAULT_VIEW.dist = camFit();
        state.dist = clamp(state.dist, camMin(), camMax());
    }
    function resetView() {
        state.view = 0; state.orthoZoom = 1;
        state.yaw = DEFAULT_VIEW.yaw; state.pitch = DEFAULT_VIEW.pitch; state.dist = DEFAULT_VIEW.dist;
        state.vYaw = 0; state.vPitch = 0;
        paintToggles();
    }

    /* ---------------------------------------------------------------- *
     * Действия: выстрел и пр.
     * ---------------------------------------------------------------- */
    function muzzleFrame() {
        const p = M4.xf(X.barrel, [DIM.gunMuzzle, 0, 0]);
        const q = M4.xf(X.barrel, [DIM.gunMuzzle + 1, 0, 0]);
        return { p, d: V.norm(V.sub(q, p)) };
    }
    function fire() {
        if (state.reload > 0) { toast(`Заряжание… ${state.reload.toFixed(1)} с`); return false; }
        ensureAudio();
        state.recoilT = 0; state.reload = 4.0; state.flash = 1; state.shake = 1;
        const a = state.az * DEG;
        state.rock.pv += 0.22 * Math.cos(a) * Math.cos(state.el * DEG);
        state.rock.rv += -0.22 * Math.sin(a);
        kinematics();
        const { p, d } = muzzleFrame();
        state.flashPos = p;
        const env = ENVS[CAMOS[state.camo].env];
        spawn({ p: V.add(p, V.mul(d, 0.6)), max: 0.12, size: 3.2, grow: 6, col: [1.0, 0.75, 0.35], a: 1, add: true, drag: 0 });
        spawn({ p: V.add(p, V.mul(d, 1.6)), max: 0.09, size: 2.2, grow: 4, col: [1.0, 0.85, 0.5], a: 1, add: true, drag: 0 });
        for (let i = 0; i < 14; i++) {
            const s = V.norm([d[0] + rand(-0.6, 0.6), d[1] + rand(-0.4, 0.5), d[2] + rand(-0.6, 0.6)]);
            spawn({ p: V.add(p, V.mul(d, 0.3)), v: V.mul(s, rand(6, 16)), max: rand(0.08, 0.2), size: rand(0.5, 1.1), col: [1, 0.6, 0.2], a: 0.9, add: true, drag: 4 });
        }
        for (let i = 0; i < 34; i++) {
            const sp = rand(1, 14), side = V.norm(V.cross(d, [0, 1, 0]));
            const v = V.add(V.mul(d, sp), V.add(V.mul(side, rand(-3, 3)), [0, rand(-0.5, 2), 0]));
            spawn({ p: V.add(p, V.mul(d, rand(0, 1.5))), v, max: rand(2.5, 5), size: rand(0.9, 1.7), grow: rand(1.4, 2.6), col: [0.74, 0.72, 0.68], a: rand(0.4, 0.62), drag: 2.2, lift: 0.4 });
        }
        /* Пыль от ударной волны */
        const gp = [p[0] + d[0] * 2.5, 0.1, p[2] + d[2] * 2.5];
        for (let i = 0; i < 26; i++) {
            const a2 = rand(0, TAU), sp = rand(2, 7);
            spawn({ p: [gp[0] + rand(-0.5, 0.5), 0.1, gp[2] + rand(-0.5, 0.5)], v: [Math.cos(a2) * sp + d[0] * 3, rand(0.3, 1.5), Math.sin(a2) * sp + d[2] * 3], max: rand(2, 3.5), size: rand(0.8, 1.5), grow: 1.5, col: env.puff, a: 0.35, drag: 1.8, lift: 0.1 });
        }
        /* Трассер снаряда */
        spawn({ p: V.add(p, V.mul(d, 1)), v: V.mul(d, 260), max: 0.5, size: 0.5, col: [1, 0.9, 0.6], a: 1, add: true, drag: 0 });
        sfxFire();
        if (hint) hint.classList.add("is-hidden");
        return true;
    }
    function setDrive(on) {
        state.speedT = on ? (state.speedT > 0.1 ? state.speedT : 30 / 3.6) : 0;
        syncSliders(true); paintToggles();
    }
    function cycleView(dir) {
        state.view = (state.view + (dir || 1) + VIEWS.length) % VIEWS.length;
        state.orthoZoom = 1;
        paintToggles();
        toast(state.view === 0 ? "Перспектива 3D" : `Ортогональный вид: ${VIEWS[state.view].name.toLowerCase()} — как на чертеже`);
    }

    /* ---------------------------------------------------------------- *
     * Ввод
     * ---------------------------------------------------------------- */
    function interact() { state.lastInteract = state.time; ensureAudio(); }
    const pointers = new Map();
    let drag = null, pinch = null;
    canvas.addEventListener("pointerdown", e => {
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        interact();
        state.vYaw = 0; state.vPitch = 0;
        if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, last: performance.now() };
        else if (pointers.size === 2) {
            const [a, b] = Array.from(pointers.values());
            pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: state.dist, oz: state.orthoZoom || 1 };
            drag = null;
        }
        canvas.classList.add("is-grab");
    });
    canvas.addEventListener("pointermove", e => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && pointers.size >= 2) {
            const [a, b] = Array.from(pointers.values());
            const d = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1);
            if (state.view) state.orthoZoom = clamp(pinch.oz * pinch.d / d, 0.35, 2.5);
            else state.dist = clamp(pinch.dist * pinch.d / d, camMin(), camMax());
            interact();
            return;
        }
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY;
        if (state.view && Math.hypot(dx, dy) > 0) {
            /* Перетаскивание в ортогональном виде → обратно в 3D с той же стороны */
            const v = VIEWS[state.view].id;
            state.yaw = v === "side" ? -Math.PI / 2 : v === "front" ? 0 : v === "rear" ? Math.PI : -Math.PI / 2;
            state.pitch = v === "top" ? 1.4 : 0.02;
            state.view = 0; paintToggles();
        }
        const k = 0.0055, now = performance.now(), dtm = Math.max(8, now - drag.last) / 1000;
        drag.last = now;
        state.yaw += dx * k;
        state.pitch = clamp(state.pitch + dy * k, -0.04, 1.45);
        state.vYaw = clamp(lerp(state.vYaw, dx * k / dtm, 0.5), -4, 4);
        state.vPitch = clamp(lerp(state.vPitch, dy * k / dtm, 0.5), -3, 3);
        interact();
    });
    const endPointer = e => {
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = null;
        if (drag && pointers.size === 0) {
            if (performance.now() - drag.last > 90) { state.vYaw = 0; state.vPitch = 0; }
            drag = null;
        }
        if (pointers.size === 0) canvas.classList.remove("is-grab");
    };
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);
    canvas.addEventListener("wheel", e => {
        e.preventDefault();
        const k = e.deltaMode === 1 ? 0.05 : 0.0012;
        if (state.view) state.orthoZoom = clamp((state.orthoZoom || 1) * (1 + e.deltaY * k), 0.35, 2.5);
        else state.dist = clamp(state.dist * (1 + e.deltaY * k), camMin(), camMax());
        interact();
    }, { passive: false });
    canvas.addEventListener("dblclick", e => { e.preventDefault(); resetView(); toast("Вид сброшен"); });
    canvas.addEventListener("contextmenu", e => e.preventDefault());

    /* ---------------------------------------------------------------- *
     * HUD
     * ---------------------------------------------------------------- */
    const toastBox = $("#aq-toast");
    let toastTimer = 0;
    function toast(text) {
        if (!toastBox) return;
        toastBox.textContent = text;
        toastBox.hidden = false;
        toastBox.classList.remove("is-in"); void toastBox.offsetWidth; toastBox.classList.add("is-in");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toastBox.hidden = true; }, 2400);
    }
    const stMode = $("#st-mode"), stView = $("#st-view"), stFps = $("#st-fps"), viewL = $("#ab-view-l"), ready = $("#ab-ready");
    const sTur = $("#ab-turret"), sGun = $("#ab-gun"), sSpd = $("#ab-speed");
    const oTur = $("#ab-turret-v"), oGun = $("#ab-gun-v"), oSpd = $("#ab-speed-v");
    function paintToggles() {
        $$("[data-ab]").forEach(b => {
            const a = b.getAttribute("data-ab");
            let on = null;
            if (a === "auto") on = state.autoRotate;
            else if (a === "sound") on = state.sound;
            else if (a === "blue") on = state.blue;
            else if (a === "dims") on = state.dims;
            else if (a === "drive") on = Math.abs(state.speedT) > 0.05;
            if (on !== null) b.setAttribute("aria-pressed", String(on));
        });
        const on = $("[data-ab='sound'] .ico-on"), off = $("[data-ab='sound'] .ico-off");
        if (on) on.hidden = !state.sound;
        if (off) off.hidden = state.sound;
        if (stMode) stMode.textContent = CAMOS[state.camo].name;
        if (stView) stView.textContent = VIEWS[state.view].name;
        if (viewL) viewL.textContent = state.view ? VIEWS[state.view].name.charAt(0) + VIEWS[state.view].name.slice(1).toLowerCase() : "Вид";
        document.documentElement.classList.toggle("ab-blue", state.blue);
        if (labelsBox) labelsBox.hidden = !state.dims;
    }
    let lastOut = "";
    function syncSliders(force) {
        if (force || document.activeElement !== sTur) sTur.value = String(Math.round(wrap180(state.azT)));
        if (force || document.activeElement !== sGun) sGun.value = String(state.elT);
        if (force || document.activeElement !== sSpd) sSpd.value = String(Math.round(state.speedT * 3.6));
    }
    function updateOutputs() {
        const s = `${Math.round(wrap180(state.az))}|${state.el.toFixed(1)}|${Math.round(state.speed * 3.6)}|${state.reload > 0 ? state.reload.toFixed(1) : "R"}`;
        if (s === lastOut) return;
        lastOut = s;
        oTur.textContent = `${Math.round(wrap180(state.az))}°`;
        oGun.textContent = `${state.el >= 0 ? "+" : ""}${state.el.toFixed(1)}°`;
        oSpd.textContent = `${Math.round(state.speed * 3.6)} км/ч`;
        if (ready) {
            ready.textContent = state.reload > 0 ? `ЗАРЯЖАНИЕ ${state.reload.toFixed(1)}` : "ЗАРЯЖЕНО";
            ready.classList.toggle("is-reload", state.reload > 0);
        }
    }
    sTur.addEventListener("input", () => { state.azT = +sTur.value; interact(); });
    sGun.addEventListener("input", () => { state.elT = +sGun.value; interact(); });
    sSpd.addEventListener("input", () => { state.speedT = +sSpd.value / 3.6; interact(); paintToggles(); });
    [sTur, sGun, sSpd].forEach(s => s.addEventListener("keydown", e => e.stopPropagation()));

    function action(a, el) {
        interact();
        switch (a) {
            case "fire": fire(); break;
            case "drive": setDrive(Math.abs(state.speedT) < 0.05); toast(Math.abs(state.speedT) > 0.05 ? "Вперёд: 30 км/ч" : "Стоп"); break;
            case "center": state.azT = 0; state.elT = 0; syncSliders(true); toast("Башня по-походному: 0°"); break;
            case "camo":
                state.camo = (state.camo + 1) % CAMOS.length; paintToggles(); save();
                toast(CAMOS[state.camo].label);
                break;
            case "blue": state.blue = !state.blue; paintToggles(); save(); toast(state.blue ? "Режим чертежа" : "Обычный режим"); break;
            case "dims": state.dims = !state.dims; paintToggles(); save(); toast(state.dims ? "Размеры и подписи узлов" : "Подписи скрыты"); break;
            case "view": cycleView(1); break;
            case "auto": state.autoRotate = !state.autoRotate; paintToggles(); save(); toast(state.autoRotate ? "Авто-обзор включён" : "Авто-обзор выключен"); break;
            case "sound": setSound(!state.sound); toast(state.sound ? "Звук включён" : "Звук выключен"); break;
            case "reset": resetView(); toast("Вид сброшен"); break;
            case "fullscreen": {
                const d = document;
                if (d.fullscreenElement) d.exitFullscreen && d.exitFullscreen();
                else if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen().catch(() => toast("Полный экран недоступен в этом окне"));
                break;
            }
            case "close":
                if (EMBED && window.parent !== window) window.parent.postMessage({ type: "nexus:player-close" }, "*");
                else window.location.href = "../projects.html#abrams";
                break;
            default: break;
        }
        if (el && el.blur) el.blur();
    }
    document.addEventListener("click", e => {
        const b = e.target.closest("[data-ab]");
        if (b) action(b.getAttribute("data-ab"), b);
    });
    const HOLD = ["KeyQ", "KeyE", "KeyR", "KeyF", "KeyW", "KeyS"];
    document.addEventListener("keyup", e => { keys.delete(e.code); });
    window.addEventListener("blur", () => keys.clear());
    document.addEventListener("keydown", e => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (HOLD.includes(e.code)) { e.preventDefault(); if (!keys.has(e.code)) interact(); keys.add(e.code); return; }
        const map = { Space: "fire", KeyX: "stopnow", KeyT: "center", KeyC: "camo", KeyB: "blue", KeyL: "dims", KeyV: "view", KeyA: "auto", KeyM: "sound", KeyH: "reset" };
        if (e.key === "Escape") {
            if (document.fullscreenElement) return;
            if (state.view) { resetView(); return; }
            if (EMBED) action("close");
            return;
        }
        const a = map[e.code];
        if (a) {
            e.preventDefault();
            if (e.repeat && a !== "fire") return;
            if (a === "stopnow") { state.speedT = 0; syncSliders(true); paintToggles(); toast("Стоп"); return; }
            action(a);
            return;
        }
        const step = 0.12;
        if (e.key === "ArrowLeft") { state.yaw -= step; interact(); }
        else if (e.key === "ArrowRight") { state.yaw += step; interact(); }
        else if (e.key === "ArrowUp") { state.pitch = clamp(state.pitch + step * 0.6, -0.04, 1.45); interact(); }
        else if (e.key === "ArrowDown") { state.pitch = clamp(state.pitch - step * 0.6, -0.04, 1.45); interact(); }
        else return;
        if (state.view) { state.view = 0; paintToggles(); }
        e.preventDefault();
    });

    /* ---------------------------------------------------------------- *
     * Подписи узлов и размеры (HTML поверх канваса)
     * ---------------------------------------------------------------- */
    const labelsBox = $("#ab-labels");
    const LABELS = [
        { f: "barrel", p: [2.70, 0.10, 0], n: [0, 1, 0.2], t: "120-мм гладкоствольная пушка M256" },
        { f: "barrel", p: [1.55, 0.18, 0], n: [0, 1, -0.2], t: "Эжектор продувки ствола" },
        { f: "turret", p: [-0.74, 1.30, 0.55], n: [0.2, 1, 0.4], t: "Командир: башенка + 12,7-мм M2" },
        { f: "turret", p: [-0.72, 1.18, -0.58], n: [0.2, 1, -0.4], t: "Заряжающий: 7,62-мм M240" },
        { f: "turret", p: [0.42, 1.12, 0.86], n: [0.4, 1, 0.3], t: "Прицел наводчика GPS" },
        { f: "turret", p: [1.20, 0.52, -1.35], n: [0.3, 0.3, -1], t: "Дымовые гранатомёты M250" },
        { f: "turret", p: [1.55, 0.50, 1.05], n: [1, 0.2, 0.6], t: "Комбинированная броня лба башни" },
        { f: "turret", p: [-2.68, 0.62, -0.6], n: [-1, 0.6, 0], t: "Корзина кормовой ниши" },
        { f: "turret", p: [-2.38, 2.60, 1.02], n: [0, 1, 0], t: "Антенны радиостанций" },
        { f: "hull", p: [2.84, 1.48, 0], n: [1, 1, 0], t: "Люк механика-водителя" },
        { f: "hull", p: [2.9, 1.20, 1.74], n: [0, 0, 1], t: "Бортовые броневые экраны" },
        { f: "hull", p: [-0.14, 0.40, 1.67], n: [0, 0, 1], t: "7 опорных катков" },
        { f: "hull", p: [-3.33, 0.82, 1.72], n: [-0.3, 0, 1], t: "Ведущее колесо (сзади)" },
        { f: "hull", p: [3.21, 0.70, 1.72], n: [0.3, 0, 1], t: "Направляющее колесо" },
        { f: "hull", p: [-4.04, 1.28, -0.5], n: [-1, 0, 0], t: "Выхлоп ГТД AGT-1500, 1500 л.с." },
        { f: "hull", p: [-3.0, 1.78, 0], n: [0, 1, 0], t: "Решётки МТО" }
    ];    const DIMS = [
        { a: [1, 0, 0], p: [3.4, 0.02, -2.55], t: `L ${(DIM.muzzle - DIM.rear).toFixed(2)} м с пушкой` },
        { a: [1, 0, 0], p: [-1.6, 0.02, -3.25], t: `${(DIM.nose - DIM.rear).toFixed(2)} м корпус` },
        { a: [0, 0, 1], p: [6.55, 0.02, 0], t: `B ${(DIM.skirt * 2).toFixed(2)} м` },
        { a: [0, 1, 0], p: [-4.75, DIM.roof / 2, 2.15], t: `H ${DIM.roof.toFixed(2)} м` }
    ];
    if (labelsBox) {
        LABELS.forEach(l => { l.el = document.createElement("div"); l.el.className = "ab-label"; l.el.innerHTML = "<b></b>"; l.el.firstChild.textContent = l.t; labelsBox.appendChild(l.el); });
        DIMS.forEach(d => { d.el = document.createElement("div"); d.el.className = "ab-dim"; d.el.textContent = d.t; labelsBox.appendChild(d.el); });
    }
    function project(p) {
        const c = M4.transform(state.vp, p[0], p[1], p[2], 1);
        if (c[3] <= 0.01) return null;
        return [(c[0] / c[3] * 0.5 + 0.5) * canvas.clientWidth, (0.5 - c[1] / c[3] * 0.5) * canvas.clientHeight];
    }
    /* прямоугольники HUD (относительно холста) — подписи под ними не показываем */
    let hudRects = [], hudAt = -1e9;
    function hudObstacles() {
        const now = performance.now();
        if (now - hudAt < 500) return hudRects;
        hudAt = now;
        const cr = canvas.getBoundingClientRect();
        hudRects = [".aq-brand", ".aq-stats", ".ab-panel", ".aq-bar", ".aq-toast"].map(q => document.querySelector(q))
            .filter(e => e && !e.hidden && e.getClientRects().length)
            .map(e => { const r = e.getBoundingClientRect(); return [r.left - cr.left - 4, r.right - cr.left + 4, r.top - cr.top - 4, r.bottom - cr.top + 4]; });
        return hudRects;
    }
    function updateLabels() {
        if (!labelsBox || !state.dims) return;
        const ctr = project([0.6, 1.4, 0]) || [0, 0];
        const boxes = hudObstacles().slice();
        DIMS.forEach(d => {
            const s = project(d.p);
            /* размер вдоль оси взгляда вырождается в точку — прячем */
            const flat = state.ortho && Math.abs(V.dot(d.a, state.viewDir)) > 0.9;
            d.el.hidden = !s || flat;
            if (!s || flat) return;
            const hw = (d.w || (d.w = d.el.offsetWidth) || 90) / 2 + 6;
            s[0] = Math.min(Math.max(s[0], hw), canvas.clientWidth - hw);
            d.el.style.transform = `translate(${s[0].toFixed(1)}px, ${s[1].toFixed(1)}px) translate(-50%, -50%)`;
            boxes.push([s[0] - hw, s[0] + hw, s[1] - 12, s[1] + 12]);
        });
        LABELS.forEach(l => {
            const M = X[l.f];
            const p = M4.xf(M, l.p), n = V.norm(M4.xn(M, l.n));
            const toCam = state.ortho ? V.mul(state.viewDir, -1) : V.norm(V.sub(state.cam, p));
            const s = project(p);
            /* в ортопроекциях нормаль «вбок» проходит тест — отсекаем дальнюю половину танка */
            const far = state.ortho && V.dot(V.sub(p, [0, 1.4, 0]), state.viewDir) > 1.2;
            const vis = s && !far && V.dot(n, toCam) > -0.05;
            l.el.hidden = !vis;
            if (!vis) return;
            /* сторона подписи: к краю от центра, но не за пределы экрана */
            const W = canvas.clientWidth, w = (l.w || (l.w = l.el.firstChild.offsetWidth) || 160) + 26;
            let left = s[0] < ctr[0];
            if (!left && s[0] + w > W - 6) left = true;
            else if (left && s[0] - w < 6) left = false;
            /* простое разрежение: подпись, налезающая на уже показанную, скрывается */
            const bx = left ? [s[0] - w, s[0] - 20] : [s[0] + 20, s[0] + w], by = [s[1] - 40, s[1] - 16];
            if (boxes.some(q => bx[0] < q[1] && bx[1] > q[0] && by[0] < q[3] && by[1] > q[2])) { l.el.hidden = true; return; }
            boxes.push([bx[0], bx[1], by[0], by[1]]);
            l.el.classList.toggle("is-left", left);
            l.el.style.transform = `translate(${s[0].toFixed(1)}px, ${s[1].toFixed(1)}px)`;
        });
    }

    /* ---------------------------------------------------------------- *
     * Отрисовка
     * ---------------------------------------------------------------- */
    function bindMesh(pr, m, full) {
        gl.bindBuffer(gl.ARRAY_BUFFER, m.pos);
        gl.enableVertexAttribArray(pr.a.aPos); gl.vertexAttribPointer(pr.a.aPos, 3, gl.FLOAT, false, 0, 0);
        if (full) {
            gl.bindBuffer(gl.ARRAY_BUFFER, m.nrm);
            gl.enableVertexAttribArray(pr.a.aNormal); gl.vertexAttribPointer(pr.a.aNormal, 3, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, m.col);
            gl.enableVertexAttribArray(pr.a.aColor); gl.vertexAttribPointer(pr.a.aColor, 4, gl.FLOAT, false, 0, 0);
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
    }
    function disableAttribs() { for (let i = 0; i < 6; i++) gl.disableVertexAttribArray(i); }

    function render() {
        const list = drawList();
        const env = ENVS[CAMOS[state.camo].env], cm = CAMOS[state.camo];
        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);

        /* 1. Карта теней */
        if (SHADOW_OK) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
            gl.viewport(0, 0, SHADOW_RES, SHADOW_RES);
            gl.clearColor(1, 1, 1, 1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            const pr = PR.shadow;
            gl.useProgram(pr.p);
            disableAttribs();
            gl.uniformMatrix4fv(pr.u.uLightVP, false, lightVP);
            list.forEach(it => {
                bindMesh(pr, it.m, false);
                gl.uniformMatrix4fv(pr.u.uModel, false, it.M);
                gl.drawElements(gl.TRIANGLES, it.m.count, it.m.itype, 0);
            });
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
        /* 1б. Глубина экрана → SSAO */
        const aoOn = !state.blue && state.ao !== false && ensureAO();
        if (aoOn) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, AO.depth.f);
            gl.viewport(0, 0, AO.w, AO.h);
            gl.clearColor(1, 1, 1, 1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            let p2 = PR.shadow;
            gl.useProgram(p2.p);
            disableAttribs();
            gl.uniformMatrix4fv(p2.u.uLightVP, false, state.vp);
            list.forEach(it => {
                bindMesh(p2, it.m, false);
                gl.uniformMatrix4fv(p2.u.uModel, false, it.M);
                gl.drawElements(gl.TRIANGLES, it.m.count, it.m.itype, 0);
            });
            gl.bindBuffer(gl.ARRAY_BUFFER, groundBuf);
            gl.enableVertexAttribArray(p2.a.aPos); gl.vertexAttribPointer(p2.a.aPos, 3, gl.FLOAT, false, 0, 0);
            gl.uniformMatrix4fv(p2.u.uModel, false, M4.ident());
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            gl.bindFramebuffer(gl.FRAMEBUFFER, AO.occ.f);
            gl.disable(gl.DEPTH_TEST);
            disableAttribs();
            p2 = PR.ao;
            gl.useProgram(p2.p);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, AO.depth.t);
            gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
            gl.enableVertexAttribArray(p2.a.aPos); gl.vertexAttribPointer(p2.a.aPos, 2, gl.FLOAT, false, 0, 0);
            gl.uniform1i(p2.u.uDepth, 0);
            gl.uniformMatrix4fv(p2.u.uIP, false, M4.invert(state.proj));
            gl.uniform2f(p2.u.uTexel, 1 / AO.w, 1 / AO.h);
            gl.uniform1f(p2.u.uScale, state.pointScale * AO.sc);
            gl.uniform1f(p2.u.uOrtho, state.ortho ? 1 : 0);
            gl.uniform1f(p2.u.uRadius, AO_R);
            gl.uniform1f(p2.u.uPower, AO_P);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            gl.bindFramebuffer(gl.FRAMEBUFFER, AO.blur.f);
            p2 = PR.aoblur;
            gl.useProgram(p2.p);
            gl.enableVertexAttribArray(p2.a.aPos); gl.vertexAttribPointer(p2.a.aPos, 2, gl.FLOAT, false, 0, 0);
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, AO.occ.t);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, AO.depth.t);
            gl.uniform1i(p2.u.uDepth, 0); gl.uniform1i(p2.u.uOcc, 1);
            gl.uniform2f(p2.u.uTexel, 1 / AO.w, 1 / AO.h);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            gl.enable(gl.DEPTH_TEST);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, aoOn ? AO.blur.t : shadowTex);
        gl.activeTexture(gl.TEXTURE0);
        const setAO = pr => {
            gl.uniform1i(pr.u.uAO, 1); gl.uniform1f(pr.u.uAOOn, aoOn ? (state.aoDebug ? 2 : 1) : 0);
            gl.uniform2f(pr.u.uView, state.w, state.h);
            gl.uniform2f(pr.u.uAOTexel, 1 / state.w, 1 / state.h);
        };
        gl.viewport(0, 0, state.w, state.h);
        const fog = state.blue ? [0.05, 0.17, 0.38] : env.fog;
        gl.clearColor(fog[0], fog[1], fog[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const fogLin = fog.map(c => c * c), skyLin = env.sky.map(c => c * c), gndLin = env.gnd.map(c => c * c);
        const flash = state.flash, fp = state.flashPos || [0, 0, 0];

        /* 2. Небо */
        disableAttribs();
        gl.depthMask(false);
        let pr = PR.sky;
        gl.useProgram(pr.p);
        gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
        gl.enableVertexAttribArray(pr.a.aPos); gl.vertexAttribPointer(pr.a.aPos, 2, gl.FLOAT, false, 0, 0);
        gl.uniformMatrix4fv(pr.u.uIVP, false, state.ivp);
        gl.uniform3fv(pr.u.uSun, SUN); gl.uniform3fv(pr.u.uFog, fogLin); gl.uniform3fv(pr.u.uSkyTop, env.top.map(c => c * c));
        gl.uniform1f(pr.u.uBlue, state.blue ? 1 : 0); gl.uniform1f(pr.u.uOrtho, state.ortho ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.depthMask(true);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, shadowTex);

        /* 3. Земля */
        disableAttribs();
        pr = PR.ground;
        gl.useProgram(pr.p);
        gl.bindBuffer(gl.ARRAY_BUFFER, groundBuf);
        gl.enableVertexAttribArray(pr.a.aPos); gl.vertexAttribPointer(pr.a.aPos, 3, gl.FLOAT, false, 0, 0);
        gl.uniformMatrix4fv(pr.u.uVP, false, state.vp); gl.uniformMatrix4fv(pr.u.uLightVP, false, lightVP);
        gl.uniform3fv(pr.u.uCam, state.cam); gl.uniform3fv(pr.u.uSun, SUN); gl.uniform3fv(pr.u.uSunCol, env.sun);
        gl.uniform3fv(pr.u.uSky, skyLin); gl.uniform1f(pr.u.uOrtho, state.ortho ? 1 : 0);
        gl.uniform3fv(pr.u.uG1, env.g1); gl.uniform3fv(pr.u.uG2, env.g2); gl.uniform3fv(pr.u.uG3, env.g3); gl.uniform1f(pr.u.uGType, env.gtype);
        gl.uniform1f(pr.u.uScroll, state.odo % 1000); gl.uniform1f(pr.u.uTrail, Math.min(state.driven, 400));
        gl.uniform1f(pr.u.uBlue, state.blue ? 1 : 0);
        gl.uniform3fv(pr.u.uFog, fogLin); gl.uniform1f(pr.u.uFogD, state.ortho ? 0.0 : 0.0075);
        gl.uniform3fv(pr.u.uFlashPos, fp); gl.uniform1f(pr.u.uFlash, flash);
        gl.uniform1i(pr.u.uShadow, 0); gl.uniform1f(pr.u.uShadowRes, SHADOW_RES);
        setAO(pr);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        /* 4. Танк */
        disableAttribs();
        pr = PR.main;
        gl.useProgram(pr.p);
        gl.uniformMatrix4fv(pr.u.uVP, false, state.vp); gl.uniformMatrix4fv(pr.u.uLightVP, false, lightVP);
        gl.uniform3fv(pr.u.uCam, state.cam); gl.uniform3fv(pr.u.uViewDir, state.viewDir); gl.uniform1f(pr.u.uOrtho, state.ortho ? 1 : 0);
        gl.uniform3fv(pr.u.uSun, SUN); gl.uniform3fv(pr.u.uSunCol, env.sun); gl.uniform3fv(pr.u.uSky, skyLin); gl.uniform3fv(pr.u.uGnd, gndLin);
        gl.uniform3fv(pr.u.uPaint, cm.paint); gl.uniform3fv(pr.u.uPaint2, cm.p2); gl.uniform3fv(pr.u.uPaint3, cm.p3); gl.uniform1f(pr.u.uCamo, cm.camo);
        gl.uniform3fv(pr.u.uDust, env.dust); gl.uniform1f(pr.u.uDirt, env.dirt * (0.6 + 0.4 * clamp(state.driven / 200, 0, 1)));
        gl.uniform1f(pr.u.uBlue, state.blue ? 1 : 0);
        gl.uniform3fv(pr.u.uFog, fogLin); gl.uniform1f(pr.u.uFogD, state.fogD);
        gl.uniform3fv(pr.u.uFlashPos, fp); gl.uniform1f(pr.u.uFlash, flash); gl.uniform1f(pr.u.uSeed, state.seed);
        gl.uniform1i(pr.u.uShadow, 0); gl.uniform1f(pr.u.uShadowRes, SHADOW_RES);
        setAO(pr);
        gl.uniform3fv(pr.u.uSkyTop, env.top.map(c => c * c)); gl.uniform3fv(pr.u.uFill, FILL);
        if (state.blue) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 2); }
        list.forEach(it => {
            bindMesh(pr, it.m, true);
            gl.uniformMatrix4fv(pr.u.uModel, false, it.M);
            gl.drawElements(gl.TRIANGLES, it.m.count, it.m.itype, 0);
        });
        gl.disable(gl.POLYGON_OFFSET_FILL);

        /* 5. Контуры (режим чертежа) и размерные линии */
        if (state.blue || state.dims) {
            disableAttribs();
            pr = PR.line;
            gl.useProgram(pr.p);
            gl.uniformMatrix4fv(pr.u.uVP, false, state.vp);
            gl.enableVertexAttribArray(pr.a.aPos);
            gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            if (state.blue) {
                gl.uniform4fv(pr.u.uColor, [0.86, 0.93, 1.0, 0.95]);
                list.forEach(it => {
                    if (!it.m.lines) return;
                    gl.bindBuffer(gl.ARRAY_BUFFER, it.m.lines.buf);
                    gl.vertexAttribPointer(pr.a.aPos, 3, gl.FLOAT, false, 0, 0);
                    gl.uniformMatrix4fv(pr.u.uModel, false, it.M);
                    gl.drawArrays(gl.LINES, 0, it.m.lines.count);
                });
            }
            if (state.dims) {
                gl.uniform4fv(pr.u.uColor, state.blue ? [1, 1, 1, 0.9] : [ACCENT[0], ACCENT[1], ACCENT[2], 0.95]);
                gl.bindBuffer(gl.ARRAY_BUFFER, dimLines.buf);
                gl.vertexAttribPointer(pr.a.aPos, 3, gl.FLOAT, false, 0, 0);
                gl.uniformMatrix4fv(pr.u.uModel, false, M4.ident());
                gl.drawArrays(gl.LINES, 0, dimLines.count);
            }
            gl.disable(gl.BLEND);
        }

        /* 6. Частицы: дым/пыль (альфа), затем вспышки (аддитивно) */
        if (parts.length) {
            disableAttribs();
            pr = PR.part;
            gl.useProgram(pr.p);
            gl.uniformMatrix4fv(pr.u.uVP, false, state.vp);
            gl.uniform1f(pr.u.uPointScale, state.pointScale); gl.uniform1f(pr.u.uOrtho, state.ortho ? 1 : 0); gl.uniform1f(pr.u.uMaxPt, MAX_PT);
            let n = 0;
            const fillPass = add => {
                const start = n;
                parts.forEach(p => {
                    if (p.add !== add) return;
                    const t = p.life / p.max, o = n * 8;
                    partData[o] = p.p[0]; partData[o + 1] = p.p[1]; partData[o + 2] = p.p[2];
                    partData[o + 3] = p.size * (1 + p.grow * t);
                    const fade = add ? (1 - t) : Math.min(1, t * 25) * Math.pow(1 - t, 1.6);
                    const c = state.blue ? [0.85, 0.93, 1] : p.col;
                    partData[o + 4] = c[0]; partData[o + 5] = c[1]; partData[o + 6] = c[2]; partData[o + 7] = p.a * fade;
                    n++;
                });
                return [start, n - start];
            };
            const sm = fillPass(false), fx = fillPass(true);
            gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, partData.subarray(0, n * 8));
            gl.enableVertexAttribArray(pr.a.aPos); gl.vertexAttribPointer(pr.a.aPos, 3, gl.FLOAT, false, 32, 0);
            gl.enableVertexAttribArray(pr.a.aSize); gl.vertexAttribPointer(pr.a.aSize, 1, gl.FLOAT, false, 32, 12);
            gl.enableVertexAttribArray(pr.a.aCol); gl.vertexAttribPointer(pr.a.aCol, 4, gl.FLOAT, false, 32, 16);
            gl.enable(gl.BLEND); gl.depthMask(false);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            if (sm[1]) gl.drawArrays(gl.POINTS, sm[0], sm[1]);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
            if (fx[1]) gl.drawArrays(gl.POINTS, fx[0], fx[1]);
            gl.depthMask(true); gl.disable(gl.BLEND);
        }
    }

    /* ---------------------------------------------------------------- *
     * Обновление
     * ---------------------------------------------------------------- */
    function approachAngle(cur, target, maxStep) {
        const d = wrap180(target - cur);
        return wrap180(cur + clamp(d, -maxStep, maxStep));
    }
    let dustAcc = 0;
    function update(dt) {
        state.time += dt;
        /* Клавиши: башня / ствол / ход */
        let moved = false;
        if (keys.has("KeyQ")) { state.azT = wrap180(state.az - 30); moved = true; }
        if (keys.has("KeyE")) { state.azT = wrap180(state.az + 30); moved = true; }
        if (!keys.has("KeyQ") && !keys.has("KeyE") && state.keyTurret) { state.azT = state.az; }
        state.keyTurret = keys.has("KeyQ") || keys.has("KeyE");
        if (keys.has("KeyR")) { state.elT = clamp(state.elT + 18 * dt, DIM.elevMin, DIM.elevMax); moved = true; }
        if (keys.has("KeyF")) { state.elT = clamp(state.elT - 18 * dt, DIM.elevMin, DIM.elevMax); moved = true; }
        if (keys.has("KeyW")) { state.speedT = clamp(state.speedT + 12 / 3.6 * dt, -30 / 3.6, 67 / 3.6); moved = true; }
        if (keys.has("KeyS")) { state.speedT = clamp(state.speedT - 12 / 3.6 * dt, -30 / 3.6, 67 / 3.6); moved = true; }
        if (moved) { syncSliders(); state.lastInteract = state.time; paintTogglesThrottled(); }

        /* Башня: ~40°/с, ствол: ~20°/с; над МТО ствол приподнимается */
        const prevAz = state.az;
        state.az = approachAngle(state.az, state.azT, 40 * dt);
        const back = clamp((Math.abs(wrap180(state.az)) - 85) / 25, 0, 1);
        const minEl = lerp(DIM.elevMin, 3.0, back);
        const elT = clamp(state.elT, minEl, DIM.elevMax);
        state.el += clamp(elT - state.el, -20 * dt, 20 * dt);
        state.turretMoving = Math.abs(wrap180(state.az - prevAz)) / Math.max(dt, 1e-4) > 1 ? 1 : 0;

        /* Ход: разгон ~1,5 м/с², торможение ~3,5 м/с² */
        const prevV = state.speed;
        const dv = state.speedT - state.speed;
        const a = Math.sign(dv) === Math.sign(state.speed) || state.speed === 0 ? 1.6 : 3.5;
        state.speed += clamp(dv, -a * dt, a * dt);
        state.accel = lerp(state.accel, (state.speed - prevV) / Math.max(dt, 1e-4), 0.1);
        state.odo += state.speed * dt;
        state.driven += Math.abs(state.speed) * dt;
        state.susp = lerp(state.susp, clamp(state.accel * 0.006, -0.03, 0.03), Math.min(1, dt * 4));

        /* Раскачка корпуса после выстрела (затухающая пружина) */
        const r = state.rock;
        r.pv += (-38 * r.p - 4.5 * r.pv) * dt; r.p += r.pv * dt;
        r.rv += (-46 * r.r - 5.0 * r.rv) * dt; r.r += r.rv * dt;

        state.recoilT += dt;
        if (state.reload > 0) {
            state.reload -= dt;
            if (state.reload <= 0) { state.reload = 0; sfxClank(); }
        }
        state.flash = Math.max(0, state.flash - dt * 9);
        state.shake = Math.max(0, state.shake - dt * 3.5);

        /* Пыль из-под гусениц */
        const env = ENVS[CAMOS[state.camo].env];
        const sp = Math.abs(state.speed);
        if (sp > 0.5) {
            dustAcc += dt * sp * (env.gtype ? 1.2 : 2.6);
            while (dustAcc > 1) {
                dustAcc -= 1;
                const s = Math.random() < 0.5 ? 1 : -1, back2 = state.speed > 0;
                const x = back2 ? rand(-3.4, -2.6) : rand(2.8, 3.6);
                spawn({ p: [x, rand(0.1, 0.5), s * rand(1.2, 1.75)], v: [-state.speed * rand(0.2, 0.6), rand(0.3, 1.2), s * rand(0.1, 0.6)], max: rand(1.5, 3), size: rand(0.8, 1.5), grow: 2.4, col: env.puff, a: env.gtype ? 0.22 : 0.4, drag: 2.5, lift: 0.15 });
            }
            if (Math.random() < dt * (2 + Math.abs(state.accel) * 3)) {
                spawn({ p: [-3.95, rand(1.0, 1.5), rand(-0.9, 0.9)], v: [-rand(0.5, 1.5), rand(0.3, 0.8), rand(-0.3, 0.3)], max: 2, size: 0.6, grow: 2.5, col: [0.5, 0.5, 0.5], a: 0.12, drag: 1, lift: 0.3 });
            }
        }
        /* Частицы */
        for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i];
            p.life += dt;
            if (p.life >= p.max) { parts.splice(i, 1); continue; }
            const k = Math.exp(-p.drag * dt);
            p.v[0] *= k; p.v[1] = p.v[1] * k + p.lift * dt; p.v[2] *= k;
            p.p[0] += (p.v[0] - (p.add ? 0 : state.speed)) * dt; p.p[1] += p.v[1] * dt; p.p[2] += p.v[2] * dt;
            if (p.p[1] < 0.05) { p.p[1] = 0.05; p.v[1] = Math.abs(p.v[1]) * 0.3; }
        }

        /* Камера */
        if (!state.view) {
            if (Math.abs(state.vYaw) > 1e-4 || Math.abs(state.vPitch) > 1e-4) {
                if (!pointers.size) {
                    state.yaw += state.vYaw * dt; state.pitch = clamp(state.pitch + state.vPitch * dt, -0.04, 1.45);
                    const d = Math.exp(-dt * 3.2); state.vYaw *= d; state.vPitch *= d;
                }
            }
            if (state.autoRotate && state.time - state.lastInteract > 6 && !pointers.size) {
                state.yaw += dt * 0.12;
                state.pitch = lerp(state.pitch, 0.2 + Math.sin(state.time * 0.1) * 0.08, dt * 0.3);
            }
        }
    }
    let ptT = 0;
    function paintTogglesThrottled() { if (state.time - ptT > 0.25) { ptT = state.time; paintToggles(); } }

    /* ---------------------------------------------------------------- *
     * Кадр
     * ---------------------------------------------------------------- */
    let last = 0, fpsAcc = 0, fpsN = 0, frozen = false;
    function frame(t) {
        const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
        last = t;
        if (!frozen) update(dt);
        kinematics();
        updateTrack(-state.odo);
        computeCamera();
        render();
        updateLabels();
        updateOutputs();
        updateAudio(dt);
        fpsAcc += dt; fpsN++;
        if (fpsAcc > 0.5) {
            state.fps = Math.round(fpsN / fpsAcc);
            if (stFps) stFps.textContent = String(state.fps);
            fpsAcc = 0; fpsN = 0;
        }
        requestAnimationFrame(frame);
    }

    canvas.addEventListener("webglcontextlost", e => {
        e.preventDefault();
        if (fail) { fail.hidden = false; const m = $("#aq-fail-msg"); if (m) m.textContent = "Видеоконтекст WebGL потерян. Перезагрузите страницу."; }
    });
    window.addEventListener("resize", resize);

    /* ---------------------------------------------------------------- *
     * Старт
     * ---------------------------------------------------------------- */
    load();
    resize();
    state.dist = DEFAULT_VIEW.dist;
    const vq = params.get("view");
    if (vq) { const i = VIEWS.findIndex(v => v.id === vq); if (i >= 0) state.view = i; }
    if (params.get("blue") === "1") state.blue = true;
    paintToggles();
    syncSliders(true);
    [["#st-len", DIM.muzzle - DIM.rear], ["#st-wid", DIM.skirt * 2], ["#st-hgt", DIM.roof]].forEach(([id, v]) => { const el = $(id); if (el) el.textContent = v.toFixed(2); });
    const hint = $("#aq-hint");
    if (hint) setTimeout(() => hint.classList.add("is-hidden"), 7000);
    canvas.addEventListener("pointerdown", () => { if (hint) hint.classList.add("is-hidden"); }, { once: true });
    document.documentElement.classList.add("aq-ready");
    requestAnimationFrame(t => { last = t; frame(t); });

    /* Для тестов и консоли */
    window.NexusAbrams = {
        state, DIM, MESH, fire, resetView, keys, parts, gl,
        setView(id) { const i = VIEWS.findIndex(v => v.id === id); if (i >= 0) { state.view = i; state.orthoZoom = 1; paintToggles(); } },
        setTurret(az, el) { state.azT = state.az = wrap180(az || 0); state.elT = state.el = el || 0; syncSliders(true); },
        setCamo(i) { state.camo = clamp(i | 0, 0, CAMOS.length - 1); paintToggles(); },
        setBlue(on) { state.blue = !!on; paintToggles(); },
        setDims(on) { state.dims = !!on; paintToggles(); },
        freeze(on) { frozen = !!on; },
        step(dt, n) { for (let i = 0; i < (n || 1); i++) update(dt || 1 / 60); },
        stats: () => ({
            hullVerts: MESH.hull.verts, turretVerts: MESH.turret.verts, links: LINKS, trackLen: +PATH.L.toFixed(2),
            length: +(DIM.muzzle - DIM.rear).toFixed(2), width: DIM.skirt * 2, height: DIM.roof, shadow: SHADOW_OK
        })
    };
})();
