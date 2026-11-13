/* ==========================================================================
 * NEXUS AQUARIUM — 3D-аквариум на чистом WebGL (без библиотек)
 * --------------------------------------------------------------------------
 *  - Вращение мышью / пальцем, зум колесом / щипком, инерция, авто-обзор
 *  - Процедурные рыбы 6 видов: стайное поведение, обход стен, питание
 *  - Растения с покачиванием, камни, коряги, песок с каустикой
 *  - Пузыри от распылителя, взвесь, лучи света, поверхность воды с бликами
 *  - День / ночь, звук (WebAudio), сохранение состава в localStorage
 *  Работает локально (file://) и в iframe-плеере на projects.html.
 * ========================================================================== */
(function () {
    "use strict";

    /* ---------------------------------------------------------------- *
     * Параметры страницы
     * ---------------------------------------------------------------- */
    const params = new URLSearchParams(window.location.search);
    const EMBED = params.get("embed") === "1";
    const STORE_KEY = "nx_aquarium";
    const MAX_FISH = 60;
    const MAX_FOOD = 90;

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

    /* Детерминированный ГПСЧ для декора (одинаковая сцена при каждом запуске) */
    function mulberry(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /* ---------------------------------------------------------------- *
     * Геометрия аквариума (мировые единицы)
     * ---------------------------------------------------------------- */
    const TANK = { x: 1.0, yMin: -0.55, yMax: 0.55, z: 0.45 };
    const WATER_Y = 0.46;
    const LAMP = [0, 0.66, -0.06];

    /* Высота песка: подъём к задней стенке + мягкие холмы + рябь */
    function sandHeight(x, z) {
        const back = clamp((0.45 - z) / 0.9, 0, 1);
        let h = -0.475 + 0.085 * back * back;
        h += 0.02 * Math.sin(x * 2.3 + 1.2) * Math.cos(z * 3.1 - 0.4) * back;
        h += 0.012 * Math.exp(-((x + 0.45) * (x + 0.45) * 7 + (z + 0.15) * (z + 0.15) * 14));
        h += 0.016 * Math.exp(-((x - 0.55) * (x - 0.55) * 9 + (z + 0.25) * (z + 0.25) * 12));
        h += 0.0035 * Math.sin(x * 38 + Math.sin(z * 9) * 2.0) * (0.5 + 0.5 * (1 - back));
        return h;
    }

    const SWIM = { xMin: -0.88, xMax: 0.88, yMax: WATER_Y - 0.07, zMin: -0.36, zMax: 0.36 };
    function swimFloor(x, z) { return sandHeight(x, z) + 0.07; }

    /* ---------------------------------------------------------------- *
     * Матрицы (column-major, как в WebGL)
     * ---------------------------------------------------------------- */
    const M4 = {
        persp(fovy, aspect, n, f) {
            const t = 1 / Math.tan(fovy / 2), nf = 1 / (n - f);
            return new Float32Array([t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0]);
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
        invert(m) {
            const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
            const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
            const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
            const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
            const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
            const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
            let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
            if (!det) return null;
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
        /* T · Ry(yaw) · Rz(pitch) · Rx(roll) · S */
        model(px, py, pz, yaw, pitch, roll, s) {
            const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
            // Rz·Rx
            const r00 = cp, r01 = -sp * cr, r02 = sp * sr;
            const r10 = sp, r11 = cp * cr, r12 = -cp * sr;
            const r20 = 0, r21 = sr, r22 = cr;
            // Ry · (Rz·Rx)
            const m00 = cy * r00 + sy * r20, m01 = cy * r01 + sy * r21, m02 = cy * r02 + sy * r22;
            const m10 = r10, m11 = r11, m12 = r12;
            const m20 = -sy * r00 + cy * r20, m21 = -sy * r01 + cy * r21, m22 = -sy * r02 + cy * r22;
            return new Float32Array([
                m00 * s, m10 * s, m20 * s, 0,
                m01 * s, m11 * s, m21 * s, 0,
                m02 * s, m12 * s, m22 * s, 0,
                px, py, pz, 1
            ]);
        },
        transform(m, x, y, z, w) {
            return [
                m[0] * x + m[4] * y + m[8] * z + m[12] * w,
                m[1] * x + m[5] * y + m[9] * z + m[13] * w,
                m[2] * x + m[6] * y + m[10] * z + m[14] * w,
                m[3] * x + m[7] * y + m[11] * z + m[15] * w
            ];
        }
    };
    const IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

    /* ---------------------------------------------------------------- *
     * Шум (камни, песок)
     * ---------------------------------------------------------------- */
    function hash3(x, y, z) {
        let h = x * 374761393 + y * 668265263 + z * 2147483647;
        h = (h ^ (h >>> 13)) * 1274126177;
        return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    }
    function noise3(x, y, z) {
        const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
        const xf = x - xi, yf = y - yi, zf = z - zi;
        const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
        const n = (a, b, c) => hash3(xi + a, yi + b, zi + c);
        const x00 = lerp(n(0, 0, 0), n(1, 0, 0), u), x10 = lerp(n(0, 1, 0), n(1, 1, 0), u);
        const x01 = lerp(n(0, 0, 1), n(1, 0, 1), u), x11 = lerp(n(0, 1, 1), n(1, 1, 1), u);
        return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w) * 2 - 1;
    }

    /* ---------------------------------------------------------------- *
     * Построитель мешей: позиции, нормали, цвет (a — эмиссия), sway
     * ---------------------------------------------------------------- */
    function Builder() {
        this.pos = []; this.nrm = []; this.col = []; this.sway = []; this.idx = [];
    }
    Builder.prototype.vert = function (p, n, c, sw) {
        this.pos.push(p[0], p[1], p[2]);
        this.nrm.push(n ? n[0] : 0, n ? n[1] : 1, n ? n[2] : 0);
        this.col.push(c[0], c[1], c[2], c.length > 3 ? c[3] : 0);
        this.sway.push(sw ? sw[0] : 0, sw ? sw[1] : 0);
        return this.pos.length / 3 - 1;
    };
    Builder.prototype.tri = function (a, b, c) { this.idx.push(a, b, c); };
    Builder.prototype.count = function () { return this.pos.length / 3; };
    /* Сглаженные нормали по граням (для вершин начиная с from) */
    Builder.prototype.smooth = function (from, idxFrom) {
        const P = this.pos, N = this.nrm;
        for (let i = from * 3; i < P.length; i++) N[i] = 0;
        for (let i = idxFrom; i < this.idx.length; i += 3) {
            const a = this.idx[i] * 3, b = this.idx[i + 1] * 3, c = this.idx[i + 2] * 3;
            const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
            const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
            const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            [a, b, c].forEach(k => { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; });
        }
        for (let i = from * 3; i < N.length; i += 3) {
            const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
            N[i] /= l; N[i + 1] /= l; N[i + 2] /= l;
        }
    };
    Builder.prototype.box = function (min, max, c) {
        const f = [
            [[1, 0, 0], [[max[0], min[1], max[2]], [max[0], min[1], min[2]], [max[0], max[1], min[2]], [max[0], max[1], max[2]]]],
            [[-1, 0, 0], [[min[0], min[1], min[2]], [min[0], min[1], max[2]], [min[0], max[1], max[2]], [min[0], max[1], min[2]]]],
            [[0, 1, 0], [[min[0], max[1], max[2]], [max[0], max[1], max[2]], [max[0], max[1], min[2]], [min[0], max[1], min[2]]]],
            [[0, -1, 0], [[min[0], min[1], min[2]], [max[0], min[1], min[2]], [max[0], min[1], max[2]], [min[0], min[1], max[2]]]],
            [[0, 0, 1], [[min[0], min[1], max[2]], [max[0], min[1], max[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]]]],
            [[0, 0, -1], [[max[0], min[1], min[2]], [min[0], min[1], min[2]], [min[0], max[1], min[2]], [max[0], max[1], min[2]]]]
        ];
        f.forEach(([n, q]) => {
            const a = this.vert(q[0], n, c), b = this.vert(q[1], n, c), d = this.vert(q[2], n, c), e = this.vert(q[3], n, c);
            this.tri(a, b, d); this.tri(a, d, e);
        });
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

    function upload(b) {
        const m = { count: b.idx.length, buffers: {} };
        const mk = (name, arr, size) => {
            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
            m.buffers[name] = { buf, size };
        };
        mk("aPos", b.pos, 3); mk("aNormal", b.nrm, 3); mk("aColor", b.col, 4); mk("aSway", b.sway, 2);
        if (b.extra) Object.keys(b.extra).forEach(k => mk(k, b.extra[k].data, b.extra[k].size));
        m.ibo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
        const big = b.count() > 65535;
        if (big && !UINT32) throw new Error("mesh too large");
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, big ? new Uint32Array(b.idx) : new Uint16Array(b.idx), gl.STATIC_DRAW);
        m.itype = big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
        return m;
    }

    const GLSL_COMMON = `
precision highp float;
uniform vec3 uCam;
uniform float uTime;
uniform float uNight;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uFog;
uniform vec3 uAccent;

float caustic(vec2 uv, float t) {
    vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
    vec2 i = p;
    float c = 1.0;
    float inten = 0.005;
    for (int n = 0; n < 4; n++) {
        float tt = t * (1.0 - (3.5 / float(n + 1)));
        i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
        c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
    }
    c /= 4.0;
    c = 1.17 - pow(c, 1.4);
    return clamp(pow(abs(c), 8.0), 0.0, 1.6);
}
float waterPath(vec3 wp) {
    vec3 rd = wp - uCam;
    float L = length(rd);
    rd /= L;
    vec3 inv = 1.0 / rd;
    vec3 t0 = (uBoxMin - uCam) * inv;
    vec3 t1 = (uBoxMax - uCam) * inv;
    vec3 tn = min(t0, t1);
    vec3 tf = max(t0, t1);
    float te = max(max(tn.x, tn.y), max(tn.z, 0.0));
    float tx = min(min(tf.x, tf.y), tf.z);
    if (tx < te) return 0.0;
    return clamp(min(L, tx) - te, 0.0, 10.0);
}
vec3 lightCol() { return mix(vec3(1.0, 0.96, 0.88), vec3(0.34, 0.48, 0.95), uNight); }
vec3 ambCol() { return mix(vec3(0.20, 0.28, 0.31), vec3(0.035, 0.06, 0.12), uNight); }
float depth01(vec3 wp) { return clamp((uBoxMax.y - wp.y) / (uBoxMax.y - uBoxMin.y), 0.0, 1.0); }
vec3 underwaterLit(vec3 base, vec3 n, vec3 wp, float spec) {
    vec3 L = normalize(vec3(0.15, 1.0, 0.25));
    float diff = max(dot(n, L), 0.0) * 0.8 + 0.2 * max(n.y, 0.0);
    float d = depth01(wp);
    float lamp = (1.0 - d * 0.45) * (1.0 - uNight * 0.72);
    float c = caustic(wp.xz * 0.85 + vec2(wp.y * 0.12), uTime * 0.45) * smoothstep(-0.25, 0.9, n.y);
    vec3 col = base * (ambCol() + lightCol() * diff * lamp) + lightCol() * c * 0.5 * lamp * (0.35 + base);
    vec3 V = normalize(uCam - wp);
    vec3 H = normalize(L + V);
    col += lightCol() * pow(max(dot(n, H), 0.0), 48.0) * spec * lamp;
    return col;
}
vec3 fogWater(vec3 col, vec3 wp) {
    float d = waterPath(wp);
    float f = 1.0 - exp(-d * 0.95);
    vec3 fogc = uFog * (1.0 - uNight * 0.72);
    col *= mix(vec3(1.0), vec3(0.72, 0.9, 1.0), depth01(wp));
    return mix(col, fogc, clamp(f, 0.0, 0.88));
}
`;

    function compile(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(s);
            gl.deleteShader(s);
            throw new Error("shader: " + log);
        }
        return s;
    }
    function program(vs, fs, ext) {
        const p = gl.createProgram();
        gl.attachShader(p, compile(gl.VERTEX_SHADER, "precision highp float;\n" + vs));
        gl.attachShader(p, compile(gl.FRAGMENT_SHADER, (ext || "") + GLSL_COMMON + fs));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(p));
        const pr = { p, u: {}, a: {} };
        const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < nu; i++) { const info = gl.getActiveUniform(p, i); pr.u[info.name] = gl.getUniformLocation(p, info.name); }
        const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
        for (let i = 0; i < na; i++) { const info = gl.getActiveAttrib(p, i); pr.a[info.name] = gl.getAttribLocation(p, info.name); }
        return pr;
    }

    /* ----- Шейдеры ----- */
    const VS_LIT = `
attribute vec3 aPos; attribute vec3 aNormal; attribute vec4 aColor; attribute vec2 aSway;
uniform mat4 uVP; uniform mat4 uModel; uniform float uTime; uniform float uSwayOn;
varying vec3 vWP; varying vec3 vN; varying vec4 vCol;
void main() {
    vec3 p = aPos;
    if (uSwayOn > 0.5) {
        float w = aSway.x; float ph = aSway.y;
        p.x += (sin(uTime * 1.05 + ph + p.y * 2.5) * 0.055 + sin(uTime * 2.2 + ph * 1.7) * 0.012) * w;
        p.z += cos(uTime * 0.8 + ph * 1.3 + p.y * 2.0) * 0.032 * w;
    }
    vec4 wp = uModel * vec4(p, 1.0);
    vWP = wp.xyz; vN = (uModel * vec4(aNormal, 0.0)).xyz; vCol = aColor;
    gl_Position = uVP * wp;
}`;
    const FS_LIT = `
uniform float uInWater;
varying vec3 vWP; varying vec3 vN; varying vec4 vCol;
void main() {
    vec3 V = normalize(uCam - vWP);
    vec3 n = normalize(vN);
    if (dot(n, V) < 0.0) n = -n;
    vec3 base = vCol.rgb;
    vec3 col;
    if (uInWater > 0.5) {
        float g = fract(sin(dot(floor(vWP * 160.0), vec3(12.9898, 78.233, 45.164))) * 43758.5453);
        base *= 0.92 + g * 0.16;
        col = underwaterLit(base, n, vWP, 0.12);
        col = fogWater(col, vWP);
    } else {
        vec3 L = normalize(vec3(0.3, 1.0, 0.6));
        float d = max(dot(n, L), 0.0);
        vec3 room = mix(vec3(0.46, 0.48, 0.5), vec3(0.16, 0.18, 0.3), uNight);
        col = base * (0.16 + room * d * 0.85);
        col += pow(1.0 - max(dot(n, V), 0.0), 3.0) * uAccent * 0.1;
        vec3 H = normalize(L + V);
        col += room * pow(max(dot(n, H), 0.0), 60.0) * 0.25;
    }
    float acc = step(0.75, vCol.a);
    float wht = step(0.25, vCol.a) * (1.0 - acc);
    col = mix(col, uAccent * 1.45, acc);
    col = mix(col, lightCol() * mix(1.3, 0.55, uNight), wht);
    gl_FragColor = vec4(col, 1.0);
}`;

    const VS_FISH = `
attribute vec3 aPos; attribute vec3 aNormal; attribute float aFin;
uniform mat4 uVP; uniform mat4 uModel; uniform float uPhase; uniform float uAmp;
varying vec3 vWP; varying vec3 vN; varying vec3 vL; varying float vFin;
void main() {
    vec3 p = aPos;
    float back = clamp(0.42 - p.x, 0.0, 1.3);
    float w = back * back;
    float s = sin(uPhase - back * 3.3);
    p.z += s * uAmp * w;
    vec3 n = aNormal;
    n.x -= cos(uPhase - back * 3.3) * uAmp * w * 1.5 * sign(aNormal.z);
    vL = aPos; vFin = aFin;
    vec4 wp = uModel * vec4(p, 1.0);
    vWP = wp.xyz; vN = (uModel * vec4(n, 0.0)).xyz;
    gl_Position = uVP * wp;
}`;
    const FS_FISH = `
uniform float uPattern; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3;
uniform vec3 uEye; uniform float uGlow;
varying vec3 vWP; varying vec3 vN; varying vec3 vL; varying float vFin;
float bandW(float x, float c, float w) { return 1.0 - smoothstep(w * 0.75, w, abs(x - c)); }
float bandB(float x, float c, float w, float e) { float d = abs(x - c); return smoothstep(w * 0.8, w, d) * (1.0 - smoothstep(w + e * 0.7, w + e, d)); }
vec3 fishColor() {
    float x = vL.x; float y = vL.y;
    vec3 c = uC1;
    if (uPattern < 0.5) {
        c = mix(uC1, vec3(0.86, 0.9, 0.95), smoothstep(0.0, -0.07, y));
        float stripe = 1.0 - smoothstep(0.012, 0.024, abs(y - 0.03 - 0.03 * (x + 0.1)));
        c = mix(c, uC2 * 1.5, stripe * step(-0.3, x) * (1.0 - smoothstep(0.34, 0.4, x)));
        float red = smoothstep(0.015, -0.015, y) * smoothstep(0.12, -0.04, x) * step(-0.31, x);
        c = mix(c, uC3, red * 0.95);
        if (vFin > 0.5) c = mix(vec3(0.75, 0.8, 0.85), uC3, 0.15);
    } else if (uPattern < 1.5) {
        float wsum = bandW(x, 0.27, 0.045) + bandW(x, 0.02, 0.05) + bandW(x, -0.25, 0.035);
        float bsum = bandB(x, 0.27, 0.045, 0.018) + bandB(x, 0.02, 0.05, 0.018) + bandB(x, -0.25, 0.035, 0.016);
        c = mix(uC1, uC2, clamp(wsum, 0.0, 1.0));
        c = mix(c, uC3, clamp(bsum, 0.0, 1.0));
        if (vFin > 0.5) { float edge = smoothstep(0.75, 1.0, abs(y) / 0.3) + smoothstep(-0.38, -0.46, x); c = mix(uC1 * 1.05, uC3, clamp(edge, 0.0, 1.0)); }
    } else if (uPattern < 2.5) {
        float bars = bandW(x, 0.2, 0.035) + bandW(x, -0.02, 0.03) + bandW(x, -0.22, 0.028);
        c = mix(uC1, vec3(0.92, 0.93, 0.9), smoothstep(0.1, -0.15, y) * 0.4);
        c = mix(c, uC3, clamp(bars, 0.0, 1.0) * 0.92);
        c = mix(c, uC2, smoothstep(0.12, 0.2, y) * smoothstep(0.1, 0.35, x) * 0.6);
        if (vFin > 0.5) c = mix(c, vec3(0.8, 0.82, 0.8), 0.25);
    } else if (uPattern < 3.5) {
        c = mix(uC1, uC2, smoothstep(0.02, -0.12, y));
        c = mix(c, uC1 * 1.2, smoothstep(0.1, 0.2, y));
        if (vFin > 0.5) c = mix(uC1 * 1.15, vec3(1.0, 0.92, 0.75), 0.35);
    } else if (uPattern < 4.5) {
        c = mix(uC1, vec3(0.8, 0.82, 0.78), smoothstep(0.0, -0.06, y));
        if (vFin > 0.5) {
            float t = clamp((-0.3 - x) / 0.35, 0.0, 1.0);
            c = mix(uC2, uC3, t);
            float spots = smoothstep(0.55, 0.75, sin(x * 90.0) * sin(y * 80.0));
            c = mix(c, vec3(0.08, 0.05, 0.12), spots * t);
        }
    } else {
        c = uC1;
        float pal = 1.0 - smoothstep(0.03, 0.045, abs(y - 0.055 - 0.05 * sin((x + 0.32) * 4.6)));
        pal *= step(-0.33, x) * (1.0 - smoothstep(0.3, 0.36, x));
        float eyeBand = (1.0 - smoothstep(0.02, 0.035, abs(x - 0.2 + y * 0.6))) * step(0.0, y);
        c = mix(c, uC3, max(pal, eyeBand * 0.9));
        if (vFin > 0.5) c = (x < -0.32) ? uC2 : mix(uC1 * 0.9, uC3, smoothstep(0.65, 1.0, abs(y) / 0.3));
    }
    if (vFin < 0.5) {
        float e = length(vec2(x - uEye.x, y - uEye.y));
        float r = uEye.z;
        c = mix(c, vec3(0.92, 0.82, 0.45), 1.0 - smoothstep(r * 1.35, r * 1.6, e));
        c = mix(c, vec3(0.01), 1.0 - smoothstep(r * 0.85, r, e));
    }
    return c;
}
void main() {
    vec3 V = normalize(uCam - vWP);
    vec3 n = normalize(vN);
    if (dot(n, V) < 0.0) n = -n;
    vec3 base = fishColor();
    vec3 col = underwaterLit(base, n, vWP, vFin > 0.5 ? 0.15 : 0.7);
    float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    col += fres * vec3(0.35, 0.6, 0.75) * 0.25 * (1.0 - uNight * 0.6);
    col += lightCol() * 0.12 * vFin * (1.0 - uNight * 0.6);
    col += base * uGlow * uNight * 0.45;
    col = fogWater(col, vWP);
    gl_FragColor = vec4(col, 1.0);
}`;

    const VS_GLASS = `
attribute vec3 aPos; attribute vec3 aNormal; attribute vec2 aUV;
uniform mat4 uVP;
varying vec3 vWP; varying vec3 vN; varying vec2 vUV;
void main() { vWP = aPos; vN = aNormal; vUV = aUV; gl_Position = uVP * vec4(aPos, 1.0); }`;
    const FS_GLASS = `
uniform float uBack;
varying vec3 vWP; varying vec3 vN; varying vec2 vUV;
void main() {
    vec3 V = normalize(uCam - vWP);
    vec3 n = normalize(vN);
    float ndv = abs(dot(n, V));
    float fres = pow(1.0 - ndv, 4.0);
    vec2 e2 = abs(vUV * 2.0 - 1.0);
    float edge = max(smoothstep(0.988, 1.0, e2.x), smoothstep(0.982, 1.0, e2.y));
    float below = 1.0 - smoothstep(-0.004, 0.004, vWP.y - uBoxMax.y);
    vec3 col; float a;
    if (uBack > 0.5) {
        float wp = waterPath(vWP);
        float f = 1.0 - exp(-wp * 0.95);
        vec3 fogc = uFog * (1.0 - uNight * 0.72);
        col = mix(fogc * 0.55, fogc, f);
        col += lightCol() * caustic(vWP.xy * 0.7 + vWP.z, uTime * 0.4) * 0.05 * below * (1.0 - uNight * 0.7);
        a = mix(0.06, 0.94, f * below) + 0.05;
    } else {
        col = vec3(0.7, 0.86, 0.9) * mix(1.0, 0.45, uNight);
        a = 0.035 + fres * 0.4;
        float streak = smoothstep(0.035, 0.0, abs(fract(vUV.x * 1.3 + vUV.y * 0.45 + 0.15) - 0.5)) * 0.06;
        streak += smoothstep(0.012, 0.0, abs(fract(vUV.x * 1.3 + vUV.y * 0.45 + 0.21) - 0.5)) * 0.05;
        a += streak * (1.0 - uNight * 0.6);
        float wl = 1.0 - smoothstep(0.0, 0.01, abs(vWP.y - uBoxMax.y - 0.004 * sin(vWP.x * 9.0 + vWP.z * 9.0 + uTime * 1.6)));
        col += vec3(0.75, 0.95, 1.0) * wl * 0.6 * (1.0 - uNight * 0.5);
        a += wl * 0.35 * abs(n.z + n.x);
    }
    col += edge * mix(vec3(0.55, 0.78, 0.72), uAccent, 0.25) * 0.8;
    a = max(a, edge * 0.6);
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

    const VS_WATER = `
attribute vec3 aPos;
uniform mat4 uVP; uniform float uTime;
varying vec3 vWP; varying vec3 vN;
void main() {
    vec3 p = aPos;
    float x = p.x, z = p.z, t = uTime;
    float h = 0.006 * sin(x * 9.0 + t * 1.6) + 0.004 * sin(z * 13.0 - t * 2.1 + x * 3.0) + 0.0025 * sin((x + z) * 23.0 + t * 3.1);
    float dx = 0.054 * cos(x * 9.0 + t * 1.6) + 0.012 * cos(z * 13.0 - t * 2.1 + x * 3.0) + 0.0575 * cos((x + z) * 23.0 + t * 3.1);
    float dz = 0.052 * cos(z * 13.0 - t * 2.1 + x * 3.0) + 0.0575 * cos((x + z) * 23.0 + t * 3.1);
    float edge = smoothstep(0.0, 0.05, 1.0 - abs(x)) * smoothstep(0.0, 0.05, 0.45 - abs(z));
    p.y += h * edge;
    vWP = p; vN = normalize(vec3(-dx * edge, 1.0, -dz * edge));
    gl_Position = uVP * vec4(p, 1.0);
}`;
    const FS_WATER = `
uniform vec3 uLamp;
varying vec3 vWP; varying vec3 vN;
void main() {
    vec3 V = normalize(uCam - vWP);
    vec3 n = normalize(vN);
    bool below = uCam.y < vWP.y;
    if (below) n = -n;
    float ndv = max(dot(n, V), 0.0);
    float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    vec3 Ld = normalize(uLamp - vWP);
    vec3 col; float a;
    if (!below) {
        vec3 R = reflect(-V, n);
        float spec = pow(max(dot(R, Ld), 0.0), 90.0) * 1.6;
        vec3 sky = mix(vec3(0.04, 0.05, 0.06), vec3(0.16, 0.19, 0.2), clamp(R.y, 0.0, 1.0)) + uAccent * 0.04;
        col = mix(uFog * 0.7 * (1.0 - uNight * 0.7), sky, fres) + lightCol() * spec * (1.0 - uNight * 0.5);
        a = mix(0.32, 0.88, fres) + spec * 0.5;
    } else {
        float tir = smoothstep(0.58, 0.7, 1.0 - ndv);
        vec3 bright = mix(vec3(0.55, 0.85, 0.9), vec3(0.75, 0.95, 1.0), caustic(vWP.xz * 1.3, uTime * 0.6));
        col = mix(uFog * 1.4, bright, tir) * mix(1.0, 0.35, uNight);
        a = mix(0.35, 0.92, tir);
        col = fogWater(col, vWP - n * 0.001);
    }
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}`;

    const VS_PTS = `
attribute vec3 aPos; attribute vec3 aInfo;
uniform mat4 uVP; uniform float uScale;
varying vec3 vWP; varying vec3 vInfo;
void main() {
    vWP = aPos; vInfo = aInfo;
    gl_Position = uVP * vec4(aPos, 1.0);
    gl_PointSize = clamp(aInfo.x * uScale / gl_Position.w, 1.0, 96.0);
}`;
    const FS_PTS = `
varying vec3 vWP; varying vec3 vInfo;
void main() {
    vec2 q = gl_PointCoord - 0.5;
    float d = length(q) * 2.0;
    if (d > 1.0) discard;
    float kind = vInfo.y; float alpha = vInfo.z;
    vec3 col; float a;
    if (kind < 0.5) {
        float ring = smoothstep(1.0, 0.82, d) * (0.18 + 0.82 * smoothstep(0.55, 0.95, d));
        float hl = 1.0 - smoothstep(0.0, 0.22, length(gl_PointCoord - vec2(0.36, 0.3)));
        col = mix(vec3(0.75, 0.92, 1.0), vec3(1.0), hl) * mix(1.0, 0.55, uNight);
        a = (ring * 0.6 + hl * 0.85) * alpha;
    } else if (kind < 1.5) {
        float sh = 1.0 - d * 0.5;
        col = vec3(0.62, 0.36, 0.16) * sh * (ambCol() * 1.5 + lightCol() * 0.7 * (1.0 - uNight * 0.6));
        a = smoothstep(1.0, 0.75, d) * alpha;
    } else {
        col = mix(vec3(0.75, 0.88, 0.82), vec3(0.45, 0.6, 0.95), uNight);
        a = (1.0 - d) * 0.28 * alpha;
    }
    float wpath = waterPath(vWP);
    col = mix(col, uFog * (1.0 - uNight * 0.7), clamp(1.0 - exp(-wpath * 0.8), 0.0, 0.8));
    gl_FragColor = vec4(col, a);
}`;

    const VS_RAYS = `
attribute vec3 aPos; attribute vec3 aCorner;
uniform mat4 uVP; uniform vec3 uCam;
varying vec2 vC; varying float vPh;
void main() {
    vec3 toCam = vec3(uCam.x - aPos.x, 0.0, uCam.z - aPos.z);
    toCam = normalize(toCam + vec3(0.0001));
    vec3 right = vec3(toCam.z, 0.0, -toCam.x);
    float len = aCorner.z;
    float cy = aCorner.y;
    vec3 p = aPos + right * aCorner.x * (0.07 + cy * 0.09) + vec3((aPos.x - 0.0) * 0.18 * cy, -cy * len, (aPos.z + 0.06) * 0.15 * cy);
    vC = aCorner.xy; vPh = aPos.x * 7.0 + aPos.z * 3.0;
    gl_Position = uVP * vec4(p, 1.0);
}`;
    const FS_RAYS = `
uniform float uRay;
varying vec2 vC; varying float vPh;
void main() {
    float fall = pow(1.0 - vC.y, 1.6) * smoothstep(0.0, 0.08, vC.y);
    float side = 1.0 - vC.x * vC.x;
    float fl = 0.65 + 0.35 * sin(uTime * 0.7 + vPh) * sin(uTime * 0.43 + vPh * 1.7);
    float a = fall * side * fl * uRay;
    gl_FragColor = vec4(lightCol() * a, a);
}`;

    const VS_FULL = `
attribute vec2 aXY;
varying vec2 vUV;
void main() { vUV = aXY * 0.5 + 0.5; gl_Position = vec4(aXY, 0.999, 1.0); }`;
    const FS_BG = `
uniform vec2 uRes;
varying vec2 vUV;
void main() {
    vec2 uv = vUV;
    vec3 top = mix(vec3(0.03, 0.035, 0.04), vec3(0.012, 0.016, 0.03), uNight);
    vec3 bot = mix(vec3(0.012, 0.014, 0.014), vec3(0.004, 0.006, 0.012), uNight);
    vec3 col = mix(bot, top, uv.y);
    vec2 c = (uv - vec2(0.5, 0.52)) * vec2(uRes.x / uRes.y, 1.0);
    col += uAccent * 0.07 * exp(-dot(c, c) * 3.0);
    col += vec3(0.1, 0.25, 0.28) * 0.05 * exp(-dot(c, c) * 6.0) * (1.0 - uNight);
    vec2 g = fract(gl_FragCoord.xy / 26.0);
    float dotg = 1.0 - smoothstep(0.0, 1.6 / 26.0, length(g - 0.5));
    col += uAccent * dotg * 0.035;
    float vig = smoothstep(1.35, 0.35, length((uv - 0.5) * vec2(1.25, 1.0)));
    gl_FragColor = vec4(col * vig, 1.0);
}`;

    const VS_FLOOR = `
attribute vec3 aPos;
uniform mat4 uVP;
varying vec3 vWP;
void main() { vWP = aPos; gl_Position = uVP * vec4(aPos, 1.0); }`;
    const FS_FLOOR = `
varying vec3 vWP;
void main() {
    vec2 p = vWP.xz;
    float r = length(p * vec2(0.8, 1.0));
    vec2 g = abs(fract(p * 2.0 - 0.5) - 0.5) / fwidth(p * 2.0);
    float line = 1.0 - min(min(g.x, g.y), 1.0);
    float fade = exp(-r * r * 0.09);
    vec2 sh = abs(p) - vec2(1.12, 0.56);
    float shadow = 1.0 - smoothstep(0.0, 0.45, length(max(sh, 0.0)) + min(max(sh.x, sh.y), 0.0));
    float glow = exp(-pow(max(abs(p.y - 0.62), 0.0) * 4.0, 2.0)) * smoothstep(1.5, 0.6, abs(p.x)) * step(0.5, p.y);
    vec3 col = uAccent * (line * 0.22 * fade + glow * 0.12);
    float a = clamp(line * 0.5 * fade + shadow * 0.75 + glow * 0.3, 0.0, 1.0);
    gl_FragColor = vec4(mix(col, vec3(0.0), shadow * 0.8), a);
}`;

    let P;
    try {
        P = {
            lit: program(VS_LIT, FS_LIT),
            fish: program(VS_FISH, FS_FISH),
            glass: program(VS_GLASS, FS_GLASS),
            water: program(VS_WATER, FS_WATER),
            pts: program(VS_PTS, FS_PTS),
            rays: program(VS_RAYS, FS_RAYS),
            bg: program(VS_FULL, FS_BG),
            floor: DERIV
                ? program(VS_FLOOR, FS_FLOOR, "#extension GL_OES_standard_derivatives : enable\n")
                : program(VS_FLOOR, FS_FLOOR.replace("fwidth(p * 2.0)", "vec2(0.03)"))
        };
    } catch (e) {
        console.error(e);
        if (fail) { fail.hidden = false; const m = $("#aq-fail-msg"); if (m) m.textContent = String(e.message || e).slice(0, 300); }
        return;
    }

    /* ---------------------------------------------------------------- *
     * Сцена: статичные меши
     * ---------------------------------------------------------------- */
    const rng = mulberry(20261112);

    /* Песок + «срез» песка у стёкол */
    function buildSand() {
        const b = new Builder();
        const NX = 96, NZ = 44;
        const sandCol = (x, z) => {
            const n = noise3(x * 6, 0, z * 6) * 0.5 + noise3(x * 23, 3, z * 23) * 0.25;
            const k = 0.85 + n * 0.25;
            return [0.74 * k, 0.64 * k, 0.47 * k, 0];
        };
        const grid = [];
        for (let j = 0; j <= NZ; j++) {
            for (let i = 0; i <= NX; i++) {
                const x = -TANK.x + 0.002 + (i / NX) * (TANK.x * 2 - 0.004), z = -TANK.z + 0.002 + (j / NZ) * (TANK.z * 2 - 0.004);
                grid.push(b.vert([x, sandHeight(x, z), z], null, sandCol(x, z)));
            }
        }
        const start = b.idx.length;
        for (let j = 0; j < NZ; j++) {
            for (let i = 0; i < NX; i++) {
                const a = j * (NX + 1) + i, c = a + NX + 1;
                b.tri(a, c, a + 1); b.tri(a + 1, c, c + 1);
            }
        }
        b.smooth(0, start);
        /* Боковые срезы: слои песка и гравия */
        const skirt = (pts, n) => {
            const from = b.count();
            pts.forEach(([x, z], k) => {
                const top = sandHeight(x, z);
                const layer = 0.9 + 0.1 * Math.sin(k * 0.7);
                b.vert([x, top, z], n, [0.66 * layer, 0.56 * layer, 0.41 * layer, 0]);
                b.vert([x, TANK.yMin + 0.002, z], n, [0.36, 0.3, 0.22, 0]);
            });
            for (let k = 0; k < pts.length - 1; k++) {
                const a = from + k * 2;
                b.tri(a, a + 1, a + 2); b.tri(a + 2, a + 1, a + 3);
            }
        };
        const S = 64, e = 0.003;
        const line = (x0, z0, x1, z1) => { const r = []; for (let k = 0; k <= S; k++) r.push([lerp(x0, x1, k / S), lerp(z0, z1, k / S)]); return r; };
        skirt(line(-TANK.x + e, TANK.z - e, TANK.x - e, TANK.z - e), [0, 0, 1]);
        skirt(line(TANK.x - e, -TANK.z + e, -TANK.x + e, -TANK.z + e), [0, 0, -1]);
        skirt(line(-TANK.x + e, -TANK.z + e, -TANK.x + e, TANK.z - e), [-1, 0, 0]);
        skirt(line(TANK.x - e, TANK.z - e, TANK.x - e, -TANK.z + e), [1, 0, 0]);
        return b;
    }

    /* Икосфера для камней */
    function icosphere(sub) {
        const t = (1 + Math.sqrt(5)) / 2;
        let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
        let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
            [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
        v = v.map(p => { const l = Math.hypot(p[0], p[1], p[2]); return [p[0] / l, p[1] / l, p[2] / l]; });
        for (let s = 0; s < sub; s++) {
            const cache = {}, nf = [];
            const mid = (a, b) => {
                const k = a < b ? a + "_" + b : b + "_" + a;
                if (cache[k] !== undefined) return cache[k];
                const p = [(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2];
                const l = Math.hypot(p[0], p[1], p[2]);
                v.push([p[0] / l, p[1] / l, p[2] / l]);
                return (cache[k] = v.length - 1);
            };
            f.forEach(([a, b, c]) => { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); });
            f = nf;
        }
        return { v, f };
    }
    const ICO = icosphere(3);
    const ICO_LOW = icosphere(1);

    function addRock(b, cx, cz, sx, sy, sz, rot, tint, seed, low) {
        const geo = low ? ICO_LOW : ICO;
        const from = b.count(), idxFrom = b.idx.length;
        const cy = sandHeight(cx, cz) - sy * 0.35;
        const cr = Math.cos(rot), sr = Math.sin(rot);
        geo.v.forEach(p => {
            let d = 1 + 0.28 * noise3(p[0] * 1.7 + seed, p[1] * 1.7, p[2] * 1.7) + 0.09 * noise3(p[0] * 4.5, p[1] * 4.5 + seed, p[2] * 4.5);
            if (p[1] < -0.2) d *= 0.92;
            let x = p[0] * d * sx, y = p[1] * d * sy, z = p[2] * d * sz;
            y = Math.max(y, -sy * 0.9) + (p[1] > 0.6 ? -0.15 * sy * (p[1] - 0.6) : 0);
            const wx = cx + x * cr - z * sr, wz = cz + x * sr + z * cr;
            const n = noise3(p[0] * 6 + seed, p[1] * 6, p[2] * 6);
            const k = 0.78 + 0.22 * n + (p[1] > 0.3 ? 0.08 : -0.05);
            b.vert([wx, cy + y, wz], null, [tint[0] * k, tint[1] * k, tint[2] * k, 0]);
        });
        geo.f.forEach(([a, c, d]) => b.tri(from + a, from + c, from + d));
        b.smooth(from, idxFrom);
    }

    /* Труба вдоль кривой Безье (коряги, шланг) */
    function addTube(b, pts, r0, r1, col, segs, ring) {
        const from = b.count(), idxFrom = b.idx.length;
        const bez = t => {
            const u = 1 - t;
            return [0, 1, 2].map(k => u * u * u * pts[0][k] + 3 * u * u * t * pts[1][k] + 3 * u * t * t * pts[2][k] + t * t * t * pts[3][k]);
        };
        let prevN = [0, 1, 0];
        for (let s = 0; s <= segs; s++) {
            const t = s / segs;
            const p = bez(t), q = bez(Math.min(1, t + 0.01)), o = bez(Math.max(0, t - 0.01));
            let tx = q[0] - o[0], ty = q[1] - o[1], tz = q[2] - o[2];
            const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
            let nx = prevN[1] * tz - prevN[2] * ty, ny = prevN[2] * tx - prevN[0] * tz, nz = prevN[0] * ty - prevN[1] * tx;
            let nl = Math.hypot(nx, ny, nz);
            if (nl < 1e-4) { nx = 1; ny = 0; nz = 0; nl = 1; }
            nx /= nl; ny /= nl; nz /= nl;
            const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
            prevN = [bx, by, bz];
            const r = lerp(r0, r1, t) * (1 + 0.08 * Math.sin(t * 23));
            for (let k = 0; k <= ring; k++) {
                const a = (k / ring) * TAU, ca = Math.cos(a), sa = Math.sin(a);
                const dx = nx * ca + bx * sa, dy = ny * ca + by * sa, dz = nz * ca + bz * sa;
                const g = 0.85 + 0.15 * Math.sin(t * 40 + k * 2.1);
                b.vert([p[0] + dx * r, p[1] + dy * r, p[2] + dz * r], [dx, dy, dz], [col[0] * g, col[1] * g, col[2] * g, col[3] || 0]);
            }
        }
        for (let s = 0; s < segs; s++) {
            for (let k = 0; k < ring; k++) {
                const a = from + s * (ring + 1) + k, c = a + ring + 1;
                b.tri(a, c, a + 1); b.tri(a + 1, c, c + 1);
            }
        }
        b.smooth(from, idxFrom);
    }

    function buildDecor() {
        const b = buildSand();
        const R = rng;
        /* Камни: композиция слева, справа и у задней стенки */
        const rocks = [
            [-0.62, -0.18, 0.2, 0.15, 0.16, 0.4, [0.42, 0.42, 0.44]],
            [-0.42, -0.26, 0.14, 0.2, 0.12, 1.3, [0.46, 0.44, 0.42]],
            [-0.75, 0.02, 0.09, 0.07, 0.08, 2.1, [0.4, 0.4, 0.42]],
            [0.5, -0.24, 0.17, 0.22, 0.13, 0.9, [0.38, 0.39, 0.42]],
            [0.66, -0.1, 0.11, 0.09, 0.1, 2.6, [0.44, 0.42, 0.4]],
            [0.34, 0.12, 0.06, 0.04, 0.05, 0.2, [0.48, 0.46, 0.43]],
            [-0.15, -0.32, 0.12, 0.1, 0.08, 1.9, [0.41, 0.41, 0.43]],
            [0.05, 0.24, 0.045, 0.03, 0.04, 0.7, [0.5, 0.48, 0.45]],
            [-0.3, 0.2, 0.035, 0.025, 0.03, 1.1, [0.47, 0.45, 0.42]]
        ];
        rocks.forEach((r, i) => addRock(b, r[0], r[1], r[2], r[3], r[4], r[5], r[6], i * 7.3 + 1));
        /* Галька */
        for (let i = 0; i < 70; i++) {
            const x = R() * 1.9 - 0.95, z = R() * 0.84 - 0.42;
            const s = 0.008 + R() * 0.014;
            const g = 0.35 + R() * 0.3;
            addRock(b, x, z, s, s * 0.6, s * 0.8, R() * 6, [g, g * 0.95, g * 0.88], 100 + i, true);
        }
        /* Коряги */
        const wood = [0.27, 0.17, 0.1, 0];
        addTube(b, [[-0.2, sandHeight(-0.2, -0.05) - 0.01, -0.05], [-0.05, -0.36, -0.12], [0.12, -0.22, -0.2], [0.28, -0.05, -0.3]], 0.03, 0.01, wood, 30, 9);
        addTube(b, [[0.02, -0.38, -0.12], [0.06, -0.3, -0.02], [0.08, -0.24, 0.02], [0.0, -0.16, 0.06]], 0.016, 0.005, wood, 16, 7);
        addTube(b, [[0.15, -0.25, -0.2], [0.25, -0.24, -0.12], [0.3, -0.18, -0.08], [0.38, -0.16, -0.06]], 0.012, 0.004, wood, 14, 7);
        /* Распылитель + шланг вдоль задней стенки */
        const sx = 0.78, sz = -0.3, sy = sandHeight(sx, sz);
        addTube(b, [[sx - 0.035, sy + 0.012, sz], [sx - 0.01, sy + 0.012, sz], [sx + 0.01, sy + 0.012, sz], [sx + 0.035, sy + 0.012, sz]], 0.018, 0.018, [0.55, 0.57, 0.58, 0], 6, 12);
        addTube(b, [[sx + 0.035, sy + 0.012, sz], [0.92, sy, -0.36], [0.95, 0.0, -0.42], [0.95, 0.56, -0.42]], 0.0045, 0.0045, [0.25, 0.4, 0.38, 0], 30, 6);
        return b;
    }

    /* Растения: ленты с покачиванием (aSway: вес, фаза) */
    function buildPlants() {
        const b = new Builder();
        const R = mulberry(77);
        const blade = (x, z, h, w, ang, bend, c0, c1, type, swayK) => {
            const from = b.count();
            const S = type === "carpet" ? 2 : 8;
            const y0 = sandHeight(x, z) - 0.01;
            const sx = Math.cos(ang), sz = Math.sin(ang);
            const nrm = [-sz, 0.15, sx];
            const ph = R() * TAU;
            for (let s = 0; s <= S; s++) {
                const t = s / S;
                const cx = x + bend[0] * t * t * h, cz = z + bend[1] * t * t * h, cy = y0 + t * h * (1 - 0.25 * t * Math.hypot(bend[0], bend[1]));
                let ww;
                if (type === "sword") ww = w * Math.pow(Math.sin(Math.PI * (0.06 + 0.94 * t)), 0.8);
                else if (type === "carpet") ww = w * (1 - t * 0.8);
                else ww = w * (1 - t * 0.65);
                const k = lerp(0, 1, t);
                const c = [lerp(c0[0], c1[0], k), lerp(c0[1], c1[1], k), lerp(c0[2], c1[2], k), 0];
                const sw = [t * t * h * swayK, ph];
                b.vert([cx - sx * ww / 2, cy, cz - sz * ww / 2], nrm, c, sw);
                b.vert([cx + sx * ww / 2, cy, cz + sz * ww / 2], nrm, c, sw);
            }
            for (let s = 0; s < S; s++) { const a = from + s * 2; b.tri(a, a + 1, a + 2); b.tri(a + 2, a + 1, a + 3); }
        };
        /* Валлиснерия — высокая трава у задней стенки */
        const clusters = [[-0.88, -0.32, 14], [-0.55, -0.38, 12], [-0.05, -0.38, 16], [0.25, -0.37, 10], [0.62, -0.38, 10], [0.88, -0.2, 8], [-0.9, 0.0, 7]];
        clusters.forEach(([cx, cz, n]) => {
            for (let i = 0; i < n; i++) {
                const x = cx + (R() - 0.5) * 0.14, z = clamp(cz + (R() - 0.5) * 0.1, -0.43, 0.43);
                const h = 0.45 + R() * 0.45;
                const g = R();
                blade(x, z, h, 0.012 + R() * 0.01, R() * Math.PI, [(R() - 0.5) * 0.35, (R() - 0.2) * 0.2],
                    [0.12, 0.32 + g * 0.08, 0.1], [0.36 + g * 0.1, 0.62 + g * 0.1, 0.22], "grass", 1.0);
            }
        });
        /* Красные стеблевые — пучки слева и справа */
        [[-0.34, -0.12, 9], [0.78, 0.0, 8]].forEach(([cx, cz, n]) => {
            for (let i = 0; i < n; i++) {
                const x = cx + (R() - 0.5) * 0.1, z = cz + (R() - 0.5) * 0.1;
                blade(x, z, 0.18 + R() * 0.16, 0.035, R() * Math.PI, [(R() - 0.5) * 0.3, (R() - 0.5) * 0.3],
                    [0.42, 0.12, 0.1], [0.85, 0.28, 0.22], "sword", 0.8);
            }
        });
        /* Эхинодорус — розетки широких листьев */
        [[-0.68, 0.12], [0.2, -0.16], [0.52, 0.1]].forEach(([cx, cz]) => {
            const n = 9;
            for (let i = 0; i < n; i++) {
                const a = (i / n) * TAU + R() * 0.4;
                const out = 0.5 + R() * 0.4;
                blade(cx, cz, 0.16 + R() * 0.12, 0.06 + R() * 0.02, a + Math.PI / 2, [Math.cos(a) * out, Math.sin(a) * out],
                    [0.1, 0.3, 0.12], [0.3, 0.6, 0.2], "sword", 0.55);
            }
        });
        /* Ковёр переднего плана */
        for (let i = 0; i < 900; i++) {
            const x = R() * 1.94 - 0.97, z = 0.05 + R() * 0.38;
            if (Math.abs(x - 0.34) < 0.08 && Math.abs(z - 0.12) < 0.06) continue;
            const g = R();
            blade(x, z, 0.025 + R() * 0.035, 0.008 + R() * 0.006, R() * Math.PI, [(R() - 0.5) * 0.6, (R() - 0.5) * 0.6],
                [0.12, 0.3 + g * 0.1, 0.1], [0.35 + g * 0.15, 0.7, 0.25], "carpet", 0.6);
        }
        return b;
    }

    /* Тумба, рамка, светильник — вне воды */
    function buildOutside() {
        const b = new Builder();
        const dark = [0.06, 0.065, 0.07, 0], mid = [0.1, 0.105, 0.11, 0], ACC = [1, 1, 1, 1], LAMPC = [1, 1, 1, 0.5];
        b.box([-1.08, -1.25, -0.52], [1.08, -0.6, 0.52], dark);
        b.box([-1.1, -0.6, -0.54], [1.1, -0.585, 0.54], mid);
        b.box([-1.0, -0.66, 0.521], [1.0, -0.653, 0.524], ACC);
        for (let i = 0; i < 6; i++) b.box([-0.96 + i * 0.03, -1.2, 0.521], [-0.95 + i * 0.03, -1.12, 0.523], ACC);
        b.box([-1.06, -1.25, 0.519], [1.06, -1.23, 0.53], [0.03, 0.03, 0.035, 0]);
        b.box([0.0, -1.18, 0.521], [1.0, -1.175, 0.523], [0.2, 0.2, 0.22, 0]);
        b.box([-1.015, -0.585, -0.465], [1.015, -0.55, 0.465], [0.03, 0.035, 0.035, 0]);
        b.box([-1.012, 0.535, -0.462], [1.012, 0.555, -0.45], [0.05, 0.06, 0.06, 0]);
        b.box([-1.012, 0.535, 0.45], [1.012, 0.555, 0.462], [0.05, 0.06, 0.06, 0]);
        b.box([-1.012, 0.535, -0.45], [-1.0, 0.555, 0.45], [0.05, 0.06, 0.06, 0]);
        b.box([1.0, 0.535, -0.45], [1.012, 0.555, 0.45], [0.05, 0.06, 0.06, 0]);
        /* Светильник на кронштейнах */
        b.box([-0.94, 0.62, -0.16], [0.94, 0.665, 0.04], [0.07, 0.075, 0.08, 0]);
        b.box([-0.9, 0.614, -0.13], [0.9, 0.62, 0.01], LAMPC);
        b.box([-0.94, 0.632, 0.041], [0.94, 0.638, 0.044], ACC);
        b.box([-0.93, 0.555, -0.47], [-0.91, 0.62, -0.45], mid);
        b.box([0.91, 0.555, -0.47], [0.93, 0.62, -0.45], mid);
        b.box([-0.93, 0.555, 0.45], [-0.91, 0.62, 0.47], mid);
        b.box([0.91, 0.555, 0.45], [0.93, 0.62, 0.47], mid);
        b.box([-0.93, 0.6, -0.47], [-0.91, 0.62, 0.47], mid);
        b.box([0.91, 0.6, -0.47], [0.93, 0.62, 0.47], mid);
        return b;
    }

    function buildGlass() {
        const b = new Builder();
        const uv = [];
        const x = TANK.x, y0 = TANK.yMin, y1 = TANK.yMax, z = TANK.z;
        const quad = (a, c, d, e, n) => {
            const i0 = b.vert(a, n, [0, 0, 0, 0]), i1 = b.vert(c, n, [0, 0, 0, 0]), i2 = b.vert(d, n, [0, 0, 0, 0]), i3 = b.vert(e, n, [0, 0, 0, 0]);
            uv.push(0, 0, 1, 0, 1, 1, 0, 1);
            b.tri(i0, i1, i2); b.tri(i0, i2, i3);
        };
        quad([-x, y0, z], [x, y0, z], [x, y1, z], [-x, y1, z], [0, 0, 1]);
        quad([x, y0, -z], [-x, y0, -z], [-x, y1, -z], [x, y1, -z], [0, 0, -1]);
        quad([x, y0, z], [x, y0, -z], [x, y1, -z], [x, y1, z], [1, 0, 0]);
        quad([-x, y0, -z], [-x, y0, z], [-x, y1, z], [-x, y1, -z], [-1, 0, 0]);
        quad([-x, y0, -z], [x, y0, -z], [x, y0, z], [-x, y0, z], [0, -1, 0]);
        b.extra = { aUV: { data: uv, size: 2 } };
        return b;
    }

    function buildWater() {
        const b = new Builder();
        const NX = 90, NZ = 40;
        for (let j = 0; j <= NZ; j++) {
            for (let i = 0; i <= NX; i++) b.vert([-TANK.x + (i / NX) * TANK.x * 2, WATER_Y, -TANK.z + (j / NZ) * TANK.z * 2], [0, 1, 0], [0, 0, 0, 0]);
        }
        for (let j = 0; j < NZ; j++) {
            for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i, c = a + NX + 1; b.tri(a, c, a + 1); b.tri(a + 1, c, c + 1); }
        }
        return b;
    }

    function buildRays() {
        const b = new Builder();
        const corner = [];
        const R = mulberry(5);
        for (let i = 0; i < 9; i++) {
            const x = -0.78 + i * 0.195 + (R() - 0.5) * 0.08, z = -0.08 + (R() - 0.5) * 0.3;
            const len = 0.62 + R() * 0.25;
            const from = b.count();
            [[-1, 0], [1, 0], [1, 1], [-1, 1]].forEach(([cx, cy]) => { b.vert([x, WATER_Y, z], null, [0, 0, 0, 0]); corner.push(cx, cy, len); });
            b.tri(from, from + 1, from + 2); b.tri(from, from + 2, from + 3);
        }
        b.extra = { aCorner: { data: corner, size: 3 } };
        return b;
    }

    function buildFloor() {
        const b = new Builder();
        const s = 7, y = -1.25;
        const a = b.vert([-s, y, -s], [0, 1, 0], [0, 0, 0, 0]), c = b.vert([s, y, -s], [0, 1, 0], [0, 0, 0, 0]);
        const d = b.vert([s, y, s], [0, 1, 0], [0, 0, 0, 0]), e = b.vert([-s, y, s], [0, 1, 0], [0, 0, 0, 0]);
        b.tri(a, e, d); b.tri(a, d, c);
        return b;
    }

    /* ---------------------------------------------------------------- *
     * Рыбы: виды и процедурный меш
     * ---------------------------------------------------------------- */
    const SPECIES = {
        neon: {
            name: "Неон", latin: "Paracheirodon innesi", len: 0.11, H: 0.12, W: 0.065, bias: 1.25, round: 0.8, top: 1.0, bot: 0.95,
            tail: { type: "fork", spread: 0.13, len: 0.14 }, dorsal: [0.0, -0.12, 0.08, 0.02], anal: [-0.05, -0.25, 0.05, 0.02],
            speed: 0.2, turn: 3.2, school: true, pattern: 0, c1: [0.3, 0.42, 0.42], c2: [0.15, 0.62, 1.0], c3: [0.95, 0.12, 0.12], eye: [0.37, 0.025, 0.034], glow: 0.9, start: 12
        },
        clown: {
            name: "Клоун", latin: "Amphiprion ocellaris", len: 0.16, H: 0.17, W: 0.1, bias: 1.15, round: 0.65, top: 1.05, bot: 0.95,
            tail: { type: "round", spread: 0.14, len: 0.13 }, dorsal: [0.22, -0.25, 0.09, 0.05], anal: [-0.02, -0.24, 0.07, 0.03],
            speed: 0.13, turn: 2.6, school: false, pattern: 1, c1: [1.0, 0.42, 0.06], c2: [1.0, 1.0, 0.98], c3: [0.03, 0.02, 0.02], eye: [0.35, 0.04, 0.04], glow: 0.25, start: 3
        },
        angel: {
            name: "Скалярия", latin: "Pterophyllum scalare", len: 0.21, H: 0.27, W: 0.055, bias: 1.4, round: 0.55, top: 1.0, bot: 1.0,
            tail: { type: "fork", spread: 0.17, len: 0.16, lyre: true }, dorsal: [0.18, -0.2, 0.38, 0.22], anal: [0.12, -0.22, 0.38, 0.24],
            speed: 0.08, turn: 1.6, school: false, pattern: 2, c1: [0.78, 0.8, 0.76], c2: [0.95, 0.75, 0.3], c3: [0.08, 0.07, 0.06], eye: [0.33, 0.06, 0.04], glow: 0.2, start: 2
        },
        gold: {
            name: "Золотая рыбка", latin: "Carassius auratus", len: 0.2, H: 0.21, W: 0.13, bias: 1.2, round: 0.6, top: 1.05, bot: 1.0,
            tail: { type: "veil", spread: 0.22, len: 0.3 }, dorsal: [0.18, -0.12, 0.12, 0.04], anal: [-0.08, -0.22, 0.08, 0.05],
            speed: 0.1, turn: 2.0, school: false, pattern: 3, c1: [1.0, 0.5, 0.08], c2: [1.0, 0.78, 0.35], c3: [1, 1, 1], eye: [0.36, 0.05, 0.04], glow: 0.3, start: 2
        },
        guppy: {
            name: "Гуппи", latin: "Poecilia reticulata", len: 0.1, H: 0.12, W: 0.07, bias: 1.3, round: 0.75, top: 0.95, bot: 1.05,
            tail: { type: "fan", spread: 0.24, len: 0.34 }, dorsal: [-0.02, -0.2, 0.09, 0.08], anal: [-0.08, -0.2, 0.04, 0.02],
            speed: 0.17, turn: 3.0, school: true, pattern: 4, c1: [0.55, 0.55, 0.48], c2: [1.0, 0.45, 0.1], c3: [0.35, 0.15, 0.95], eye: [0.37, 0.03, 0.04], glow: 0.6, start: 6
        },
        tang: {
            name: "Голубой хирург", latin: "Paracanthurus hepatus", len: 0.19, H: 0.22, W: 0.065, bias: 1.25, round: 0.55, top: 1.0, bot: 1.0,
            tail: { type: "fork", spread: 0.15, len: 0.14 }, dorsal: [0.3, -0.3, 0.07, 0.03], anal: [0.15, -0.3, 0.06, 0.03],
            speed: 0.14, turn: 2.4, school: false, pattern: 5, c1: [0.08, 0.32, 0.95], c2: [1.0, 0.85, 0.1], c3: [0.02, 0.03, 0.08], eye: [0.33, 0.06, 0.035], glow: 0.35, start: 2
        }
    };
    const SPECIES_ORDER = ["neon", "guppy", "clown", "tang", "gold", "angel"];

    function buildFishMesh(sp) {
        const b = new Builder();
        const fin = [];
        const N = 22, RING = 16;
        const xTail = -0.32, xHead = 0.5;
        const prof = t => {
            const pr = Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, sp.bias))), sp.round);
            return pr + 0.16 * (1 - t) * (1 - t);
        };
        const halfH = x => { const t = clamp((x - xTail) / (xHead - xTail), 0, 1); return sp.H * prof(t); };
        for (let i = 0; i < N; i++) {
            const t = i / (N - 1);
            const x = xTail + t * (xHead - xTail);
            const f = prof(t);
            for (let j = 0; j < RING; j++) {
                const a = (j / RING) * TAU;
                const s = Math.sin(a), c = Math.cos(a);
                const y = s * sp.H * f * (s > 0 ? sp.top : sp.bot) - 0.01 * f;
                b.vert([x, y, c * sp.W * f], null, [0, 0, 0, 0]);
                fin.push(0);
            }
        }
        for (let i = 0; i < N - 1; i++) {
            for (let j = 0; j < RING; j++) {
                const a = i * RING + j, c = i * RING + (j + 1) % RING, d = a + RING, e = c + RING;
                b.tri(a, d, c); b.tri(c, d, e);
            }
        }
        const cap = b.vert([xTail - 0.005, 0, 0], null, [0, 0, 0, 0]); fin.push(0);
        for (let j = 0; j < RING; j++) b.tri(cap, (j + 1) % RING, j);
        b.smooth(0, 0);

        /* Плавник: многоугольник «веер» из центра основания, с подразбиением по радиусу */
        const finFan = (base, outline) => {
            const from = b.count();
            const RS = 4;
            for (let r = 0; r <= RS; r++) {
                const k = r / RS;
                outline.forEach(p => { b.vert([lerp(base[0], p[0], k), lerp(base[1], p[1], k), 0], [0, 0, 1], [0, 0, 0, 0]); fin.push(1); });
            }
            const L = outline.length;
            for (let r = 0; r < RS; r++) {
                for (let k = 0; k < L - 1; k++) {
                    const a = from + r * L + k, c = a + L;
                    b.tri(a, c, a + 1); b.tri(a + 1, c, c + 1);
                }
            }
        };
        /* Хвост */
        const T = sp.tail, ped = halfH(xTail + 0.02);
        const tx = xTail + 0.03;
        const out = [];
        const steps = 14;
        for (let k = 0; k <= steps; k++) {
            const u = k / steps;
            const ang = lerp(-1, 1, u);
            let x = tx - T.len, y = ang * T.spread;
            if (T.type === "fork") { x += T.len * 0.42 * (1 - Math.abs(ang)) * (1 - Math.abs(ang)) * 1.1; if (T.lyre) x -= T.len * 0.35 * Math.pow(Math.abs(ang), 6); }
            else if (T.type === "round") x = tx - T.len * Math.cos(ang * 1.1) * 0.95;
            else if (T.type === "fan") { x = tx - T.len * (0.75 + 0.25 * Math.cos(ang * 1.4)); y = ang * T.spread * (0.9 + 0.1 * Math.cos(ang)); }
            else if (T.type === "veil") { x = tx - T.len * (0.8 + 0.2 * Math.sin(u * Math.PI * 3)); y = ang * T.spread * (1 - 0.15 * Math.abs(ang)); }
            out.push([x, y]);
        }
        out.unshift([tx, -ped * 0.95]); out.push([tx, ped * 0.95]);
        finFan([tx + 0.02, 0], out);
        /* Спинной и анальный плавники: [xFront, xBack, height, sweep] */
        const finStrip = (spec, up) => {
            const [x0, x1, h, sweep] = spec;
            const from = b.count();
            const S = 10;
            for (let k = 0; k <= S; k++) {
                const u = k / S;
                const x = lerp(x0, x1, u);
                const baseY = (up ? 1 : -1) * halfH(x) * (up ? sp.top : sp.bot) * 0.94 - 0.01;
                const shape = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15)), 0.7) * (1 - 0.35 * u) + (u > 0.85 ? 0 : 0);
                const hh = h * shape;
                b.vert([x, baseY, 0], [0, 0, 1], [0, 0, 0, 0]); fin.push(1);
                b.vert([x - sweep * shape, baseY + (up ? hh : -hh), 0], [0, 0, 1], [0, 0, 0, 0]); fin.push(1);
            }
            for (let k = 0; k < S; k++) { const a = from + k * 2; b.tri(a, a + 1, a + 2); b.tri(a + 2, a + 1, a + 3); }
        };
        finStrip(sp.dorsal, true);
        finStrip(sp.anal, false);
        /* Грудные плавники */
        [1, -1].forEach(side => {
            const from = b.count();
            const x = 0.22, y = -halfH(0.22) * 0.25, z = side * sp.W * 0.75;
            const pts = [[x, y, z], [x - 0.12, y - 0.05, z + side * 0.06], [x - 0.1, y + 0.02, z + side * 0.05]];
            pts.forEach(p => { b.vert(p, [0, 1, 0], [0, 0, 0, 0]); fin.push(1); });
            b.tri(from, from + 1, from + 2);
        });
        b.extra = { aFin: { data: fin, size: 1 } };
        return upload(b);
    }

    /* ---------------------------------------------------------------- *
     * Загрузка мешей
     * ---------------------------------------------------------------- */
    const MESH = {
        decor: upload(buildDecor()),
        plants: upload(buildPlants()),
        outside: upload(buildOutside()),
        glass: upload(buildGlass()),
        water: upload(buildWater()),
        rays: upload(buildRays()),
        floor: upload(buildFloor()),
        fish: {}
    };
    Object.keys(SPECIES).forEach(k => { MESH.fish[k] = buildFishMesh(SPECIES[k]); });

    const fullTri = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, fullTri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const ptsBuf = gl.createBuffer();
    const PTS_MAX = 1400;
    const ptsData = new Float32Array(PTS_MAX * 6);

    /* ---------------------------------------------------------------- *
     * Отрисовка: привязка атрибутов
     * ---------------------------------------------------------------- */
    let enabledAttribs = [];
    function bindAttribs(pr, mesh) {
        enabledAttribs.forEach(l => gl.disableVertexAttribArray(l));
        enabledAttribs = [];
        Object.keys(pr.a).forEach(name => {
            const loc = pr.a[name];
            const b = mesh.buffers[name];
            if (!b) return;
            gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, b.size, gl.FLOAT, false, 0, 0);
            enabledAttribs.push(loc);
        });
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
    }
    function drawMesh(pr, mesh) {
        bindAttribs(pr, mesh);
        gl.drawElements(gl.TRIANGLES, mesh.count, mesh.itype, 0);
    }
    function u(pr, name) { return pr.u[name]; }
    function setCommon(pr) {
        gl.useProgram(pr.p);
        if (u(pr, "uVP")) gl.uniformMatrix4fv(u(pr, "uVP"), false, state.vp);
        if (u(pr, "uCam")) gl.uniform3fv(u(pr, "uCam"), state.cam);
        if (u(pr, "uTime")) gl.uniform1f(u(pr, "uTime"), state.time);
        if (u(pr, "uNight")) gl.uniform1f(u(pr, "uNight"), state.night);
        if (u(pr, "uBoxMin")) gl.uniform3f(u(pr, "uBoxMin"), -TANK.x, TANK.yMin, -TANK.z);
        if (u(pr, "uBoxMax")) gl.uniform3f(u(pr, "uBoxMax"), TANK.x, WATER_Y, TANK.z);
        if (u(pr, "uFog")) gl.uniform3f(u(pr, "uFog"), 0.07, 0.22, 0.25);
        if (u(pr, "uAccent")) gl.uniform3fv(u(pr, "uAccent"), ACCENT);
    }

    /* ---------------------------------------------------------------- *
     * Состояние
     * ---------------------------------------------------------------- */
    const state = {
        time: 0, night: 0, nightTarget: 0,
        yaw: 0.42, pitch: 0.2, dist: 3.4, target: [0, -0.22, 0],
        vYaw: 0, vPitch: 0, autoRotate: true, lastInteract: -10,
        vp: null, view: null, proj: null, cam: [0, 0, 3], w: 1, h: 1, dpr: 1,
        sound: true, bubbles: true, rays: true
    };
    const DEFAULT_VIEW = { yaw: 0.42, pitch: 0.2, dist: 3.4 };

    const fishes = [];
    const food = [];
    const bubbles = [];
    const dust = [];
    let schoolTargets = {};

    function randomSwimPoint() {
        const x = rand(SWIM.xMin + 0.05, SWIM.xMax - 0.05), z = rand(SWIM.zMin + 0.03, SWIM.zMax - 0.03);
        const y = rand(swimFloor(x, z) + 0.03, SWIM.yMax - 0.03);
        return [x, y, z];
    }

    let fishUid = 0;
    function addFish(kind, silent) {
        if (fishes.length >= MAX_FISH) { if (!silent) toast("Аквариум полон: максимум " + MAX_FISH + " рыб"); return null; }
        const sp = SPECIES[kind];
        const p = silent ? randomSwimPoint() : [rand(-0.6, 0.6), WATER_Y - 0.08, rand(-0.2, 0.2)];
        const dir = rand(0, TAU);
        const f = {
            id: ++fishUid, kind, sp,
            size: sp.len * rand(0.85, 1.15),
            p, v: [Math.cos(dir) * sp.speed * 0.5, silent ? 0 : -0.06, Math.sin(dir) * sp.speed * 0.5],
            target: randomSwimPoint(), timer: rand(2, 6),
            yaw: -dir, pitch: 0, roll: 0, phase: rand(0, TAU), amp: 0.06,
            hunger: rand(0.4, 1), boost: 1, scare: 0,
            offset: [rand(-0.12, 0.12), rand(-0.06, 0.06), rand(-0.08, 0.08)],
            pace: rand(0.85, 1.15)
        };
        fishes.push(f);
        if (!silent) { save(); updateStats(); }
        return f;
    }
    function removeFish(kind) {
        for (let i = fishes.length - 1; i >= 0; i--) {
            if (!kind || fishes[i].kind === kind) { fishes.splice(i, 1); save(); updateStats(); return true; }
        }
        return false;
    }

    function dropFood(x, z, n) {
        for (let i = 0; i < n && food.length < MAX_FOOD; i++) {
            food.push({
                p: [clamp(x + rand(-0.05, 0.05), -0.95, 0.95), WATER_Y - 0.003, clamp(z + rand(-0.04, 0.04), -0.42, 0.42)],
                float: rand(0.6, 2.2), vy: 0, life: 0, eaten: false, ph: rand(0, TAU), size: rand(0.009, 0.014), alpha: 1
            });
        }
        updateStats();
    }

    /* ---------------------------------------------------------------- *
     * Поведение рыб
     * ---------------------------------------------------------------- */
    function angleDiff(a, b) { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; }

    function updateFish(dt) {
        const night = state.night;
        Object.keys(SPECIES).forEach(k => {
            if (!SPECIES[k].school) return;
            const st = schoolTargets[k] || (schoolTargets[k] = { p: randomSwimPoint(), t: rand(4, 8) });
            st.t -= dt;
            if (st.t <= 0) { st.p = randomSwimPoint(); st.t = rand(4, 9); }
        });
        for (let i = 0; i < fishes.length; i++) {
            const f = fishes[i], sp = f.sp;
            const base = sp.speed * f.pace * (1 - night * 0.45);
            let speed = base * f.boost;
            let des = null;
            let chasing = false;

            /* Корм */
            if (f.hunger > 0.15 && food.length) {
                let best = null, bd = 1.3;
                for (let j = 0; j < food.length; j++) {
                    const fd = food[j];
                    if (fd.eaten) continue;
                    const d = Math.hypot(fd.p[0] - f.p[0], fd.p[1] - f.p[1], fd.p[2] - f.p[2]);
                    if (d < bd) { bd = d; best = fd; }
                }
                if (best) {
                    chasing = true;
                    speed = base * 2.1;
                    des = [best.p[0] - f.p[0], best.p[1] - f.p[1], best.p[2] - f.p[2]];
                    if (bd < f.size * 0.45 + 0.012) {
                        best.eaten = true;
                        f.hunger = Math.max(0, f.hunger - 0.3);
                        f.boost = 1.5;
                        sfxEat();
                    }
                }
            }
            if (f.scare > 0) {
                f.scare -= dt;
                speed = base * 3.2;
                des = f.flee.slice();
            }
            if (!des) {
                let tgt = f.target;
                if (sp.school && schoolTargets[f.kind]) {
                    const st = schoolTargets[f.kind].p;
                    tgt = [st[0] + f.offset[0], st[1] + f.offset[1], st[2] + f.offset[2]];
                } else {
                    f.timer -= dt;
                    const dd = Math.hypot(tgt[0] - f.p[0], tgt[1] - f.p[1], tgt[2] - f.p[2]);
                    if (dd < 0.08 || f.timer <= 0) { f.target = randomSwimPoint(); f.timer = rand(3, 8); }
                }
                des = [tgt[0] - f.p[0], (tgt[1] - f.p[1]) * 0.7, tgt[2] - f.p[2]];
            }
            let dl = Math.hypot(des[0], des[1], des[2]) || 1;
            des = [des[0] / dl * speed, des[1] / dl * speed, des[2] / dl * speed];

            /* Разделение и выравнивание в стае */
            let ax = 0, ay = 0, az = 0, an = 0;
            for (let j = 0; j < fishes.length; j++) {
                if (j === i) continue;
                const o = fishes[j];
                const dx = f.p[0] - o.p[0], dy = f.p[1] - o.p[1], dz = f.p[2] - o.p[2];
                const d2 = dx * dx + dy * dy + dz * dz;
                const r = (f.size + o.size) * 0.55;
                if (d2 < r * r && d2 > 1e-8) {
                    const d = Math.sqrt(d2), k = (r - d) / r * speed * 2.2;
                    des[0] += dx / d * k; des[1] += dy / d * k * 0.6; des[2] += dz / d * k;
                }
                if (sp.school && o.kind === f.kind && d2 < 0.09) { ax += o.v[0]; ay += o.v[1]; az += o.v[2]; an++; }
            }
            if (an) { des[0] = lerp(des[0], ax / an, 0.3); des[1] = lerp(des[1], ay / an, 0.3); des[2] = lerp(des[2], az / an, 0.3); }

            /* Стенки, дно, поверхность */
            const m = 0.1;
            const floorY = swimFloor(f.p[0], f.p[2]);
            if (f.p[0] > SWIM.xMax - m) des[0] -= (f.p[0] - (SWIM.xMax - m)) / m * speed * 2.5;
            if (f.p[0] < SWIM.xMin + m) des[0] += ((SWIM.xMin + m) - f.p[0]) / m * speed * 2.5;
            if (f.p[2] > SWIM.zMax - m) des[2] -= (f.p[2] - (SWIM.zMax - m)) / m * speed * 2.5;
            if (f.p[2] < SWIM.zMin + m) des[2] += ((SWIM.zMin + m) - f.p[2]) / m * speed * 2.5;
            if (!chasing && f.p[1] > SWIM.yMax - 0.04) des[1] -= (f.p[1] - (SWIM.yMax - 0.04)) / 0.04 * speed;
            if (f.p[1] < floorY + 0.04) des[1] += ((floorY + 0.04) - f.p[1]) / 0.04 * speed;

            const k = Math.min(1, dt * sp.turn);
            f.v[0] += (des[0] - f.v[0]) * k;
            f.v[1] += (des[1] - f.v[1]) * k;
            f.v[2] += (des[2] - f.v[2]) * k;
            const hs = Math.hypot(f.v[0], f.v[2]);
            const maxVy = Math.max(0.02, hs * 0.6);
            f.v[1] = clamp(f.v[1], -maxVy * (chasing ? 1.6 : 1), maxVy * (chasing ? 1.6 : 1));
            const vs = Math.hypot(f.v[0], f.v[1], f.v[2]);
            const vmax = speed * 1.4;
            if (vs > vmax) { f.v[0] *= vmax / vs; f.v[1] *= vmax / vs; f.v[2] *= vmax / vs; }

            f.p[0] = clamp(f.p[0] + f.v[0] * dt, SWIM.xMin, SWIM.xMax);
            f.p[2] = clamp(f.p[2] + f.v[2] * dt, SWIM.zMin, SWIM.zMax);
            /* За кормом рыба поднимается к самой поверхности */
            const ceil = chasing ? WATER_Y - 0.02 : Math.max(SWIM.yMax, Math.min(f.p[1], WATER_Y - 0.02) - dt * 0.05);
            f.p[1] = clamp(f.p[1] + f.v[1] * dt, swimFloor(f.p[0], f.p[2]), ceil);

            if (hs > 0.004) {
                const ty = Math.atan2(-f.v[2], f.v[0]);
                const d = angleDiff(f.yaw, ty);
                const turn = clamp(d, -dt * 4.5, dt * 4.5);
                f.yaw += turn;
                f.roll = lerp(f.roll, clamp(-d * 0.5, -0.45, 0.45), Math.min(1, dt * 4));
            }
            f.pitch = lerp(f.pitch, clamp(Math.atan2(f.v[1], Math.max(hs, 0.01)) * 0.8, -0.6, 0.6), Math.min(1, dt * 4));
            const rel = vs / Math.max(base, 0.01);
            f.phase += dt * (5 + rel * 7) * (sp.pattern === 2 ? 0.6 : 1);
            f.amp = lerp(f.amp, 0.035 + Math.min(rel, 2.5) * 0.045, Math.min(1, dt * 3));
            f.boost = lerp(f.boost, 1, Math.min(1, dt * 0.8));
            f.hunger = Math.min(1, f.hunger + dt * 0.012);
        }
    }

    /* ---------------------------------------------------------------- *
     * Частицы: корм, пузыри, взвесь
     * ---------------------------------------------------------------- */
    const STONE = [0.78, sandHeight(0.78, -0.3) + 0.02, -0.3];
    let bubbleAcc = 0;
    for (let i = 0; i < 260; i++) {
        const p = randomSwimPoint();
        dust.push({ p, v: [rand(-0.01, 0.01), rand(-0.004, 0.006), rand(-0.01, 0.01)], s: rand(0.004, 0.009), ph: rand(0, TAU) });
    }

    function updateParticles(dt) {
        /* Корм: плавает, тонет, лежит на дне */
        for (let i = food.length - 1; i >= 0; i--) {
            const fd = food[i];
            fd.life += dt;
            if (fd.eaten) { food.splice(i, 1); continue; }
            if (fd.float > 0) {
                fd.float -= dt;
                fd.p[0] += Math.sin(state.time * 0.8 + fd.ph) * 0.004 * dt;
                fd.p[1] = WATER_Y - 0.004 + Math.sin(state.time * 1.6 + fd.p[0] * 9) * 0.002;
            } else {
                const fl = sandHeight(fd.p[0], fd.p[2]) + 0.005;
                if (fd.p[1] > fl) {
                    fd.vy = lerp(fd.vy, 0.045, dt * 0.8);
                    fd.p[1] = Math.max(fl, fd.p[1] - fd.vy * dt);
                    fd.p[0] += Math.sin(state.time * 1.3 + fd.ph) * 0.02 * dt;
                    fd.p[2] += Math.cos(state.time * 1.1 + fd.ph) * 0.015 * dt;
                } else if (fd.life > 40) {
                    fd.alpha -= dt * 0.25;
                    if (fd.alpha <= 0) { food.splice(i, 1); continue; }
                }
            }
        }
        /* Пузыри от распылителя */
        if (state.bubbles) {
            bubbleAcc += dt * 26;
            while (bubbleAcc > 1) {
                bubbleAcc -= 1;
                if (bubbles.length < 420) bubbles.push({ p: [STONE[0] + rand(-0.03, 0.03), STONE[1], STONE[2] + rand(-0.012, 0.012)], v: rand(0.18, 0.34), s: rand(0.008, 0.024), ph: rand(0, TAU), alpha: 1 });
            }
            if (Math.random() < dt * 0.6) {
                const p = randomSwimPoint();
                bubbles.push({ p: [p[0], sandHeight(p[0], p[2]) + 0.02, p[2]], v: rand(0.08, 0.14), s: rand(0.006, 0.01), ph: rand(0, TAU), alpha: 1 });
            }
        }
        for (let i = bubbles.length - 1; i >= 0; i--) {
            const bb = bubbles[i];
            bb.v = Math.min(bb.v + dt * 0.05, 0.45);
            bb.p[1] += bb.v * dt;
            bb.p[0] += Math.sin(state.time * 6 + bb.ph) * 0.03 * dt;
            bb.p[2] += Math.cos(state.time * 5 + bb.ph) * 0.02 * dt;
            if (bb.p[1] > WATER_Y - 0.004) { bubbles.splice(i, 1); if (Math.random() < 0.05) sfxBubble(); }
        }
        for (let i = 0; i < dust.length; i++) {
            const d = dust[i];
            d.p[0] += (d.v[0] + Math.sin(state.time * 0.3 + d.ph) * 0.006) * dt;
            d.p[1] += (d.v[1] + Math.cos(state.time * 0.25 + d.ph) * 0.004) * dt;
            d.p[2] += d.v[2] * dt;
            if (d.p[0] > TANK.x - 0.02) d.p[0] = -TANK.x + 0.03; else if (d.p[0] < -TANK.x + 0.02) d.p[0] = TANK.x - 0.03;
            if (d.p[2] > TANK.z - 0.02) d.p[2] = -TANK.z + 0.03; else if (d.p[2] < -TANK.z + 0.02) d.p[2] = TANK.z - 0.03;
            const fl = sandHeight(d.p[0], d.p[2]) + 0.01;
            if (d.p[1] > WATER_Y - 0.02) d.p[1] = fl + 0.02; else if (d.p[1] < fl) d.p[1] = WATER_Y - 0.03;
        }
    }

    /* ---------------------------------------------------------------- *
     * Камера и ввод
     * ---------------------------------------------------------------- */
    function updateCamera() {
        /* Камера не опускается ниже пола комнаты */
        state.dist = clamp(state.dist, state.minDist || 1.7, 6.5);
        state.pitch = Math.max(state.pitch, Math.asin(clamp((-1.1 - state.target[1]) / state.dist, -1, 1)));
        const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
        state.cam = [
            state.target[0] + Math.sin(state.yaw) * cp * state.dist,
            state.target[1] + sp * state.dist,
            state.target[2] + Math.cos(state.yaw) * cp * state.dist
        ];
        const aspect = state.w / state.h;
        const fov = aspect < 0.8 ? 0.95 : 0.72;
        state.proj = M4.persp(fov, aspect, 0.05, 40);
        state.view = M4.lookAt(state.cam, state.target, [0, 1, 0]);
        state.vp = M4.mul(state.proj, state.view);
        state.ivp = M4.invert(state.vp);
    }

    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, Math.floor(canvas.clientWidth * dpr)), h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        state.w = w; state.h = h; state.dpr = dpr;
        /* На узких экранах камера дальше, чтобы аквариум помещался */
        state.minDist = state.w / state.h < 0.8 ? 2.6 : 1.7;
        DEFAULT_VIEW.dist = state.w / state.h < 0.8 ? 4.8 : 3.4;
    }

    function rayFrom(clientX, clientY) {
        const r = canvas.getBoundingClientRect();
        const nx = ((clientX - r.left) / r.width) * 2 - 1, ny = 1 - ((clientY - r.top) / r.height) * 2;
        const a = M4.transform(state.ivp, nx, ny, -1, 1), b = M4.transform(state.ivp, nx, ny, 1, 1);
        const o = [a[0] / a[3], a[1] / a[3], a[2] / a[3]], e = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
        const d = [e[0] - o[0], e[1] - o[1], e[2] - o[2]];
        const l = Math.hypot(d[0], d[1], d[2]);
        return { o, d: [d[0] / l, d[1] / l, d[2] / l] };
    }
    function rayBox(ray, min, max) {
        let tn = -Infinity, tf = Infinity, axis = -1;
        for (let k = 0; k < 3; k++) {
            if (Math.abs(ray.d[k]) < 1e-9) { if (ray.o[k] < min[k] || ray.o[k] > max[k]) return null; continue; }
            let t0 = (min[k] - ray.o[k]) / ray.d[k], t1 = (max[k] - ray.o[k]) / ray.d[k];
            if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
            if (t0 > tn) { tn = t0; axis = k; }
            tf = Math.min(tf, t1);
            if (tn > tf) return null;
        }
        return tf < 0 ? null : { t: Math.max(tn, 0), axis };
    }
    function pickFish(ray) {
        let best = null, bt = Infinity;
        fishes.forEach(f => {
            const ox = f.p[0] - ray.o[0], oy = f.p[1] - ray.o[1], oz = f.p[2] - ray.o[2];
            const t = ox * ray.d[0] + oy * ray.d[1] + oz * ray.d[2];
            if (t < 0) return;
            const px = ray.o[0] + ray.d[0] * t - f.p[0], py = ray.o[1] + ray.d[1] * t - f.p[1], pz = ray.o[2] + ray.d[2] * t - f.p[2];
            const r = f.size * 0.42;
            if (px * px + py * py + pz * pz < r * r && t < bt) { bt = t; best = f; }
        });
        return best;
    }

    function interact() { state.lastInteract = state.time; ensureAudio(); }

    const pointers = new Map();
    let drag = null, pinch = null;
    canvas.addEventListener("pointerdown", e => {
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        interact();
        state.vYaw = 0; state.vPitch = 0;
        if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), last: performance.now(), moved: false };
        else if (pointers.size === 2) {
            const [a, b] = Array.from(pointers.values());
            pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: state.dist };
            drag = null;
        }
        canvas.classList.add("is-grab");
        hideTip();
    });
    canvas.addEventListener("pointermove", e => {
        if (!pointers.has(e.pointerId)) { hover(e); return; }
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && pointers.size >= 2) {
            const [a, b] = Array.from(pointers.values());
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            state.dist = clamp(pinch.dist * pinch.d / Math.max(d, 1), state.minDist, 6.5);
            interact();
            return;
        }
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY;
        if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) drag.moved = true;
        const k = 0.0055;
        const now = performance.now();
        const dtm = Math.max(8, now - drag.last) / 1000;
        drag.last = now;
        state.yaw -= dx * k;
        state.pitch = clamp(state.pitch + dy * k, -0.32, 1.25);
        /* Скорость для инерции — по реальному времени между событиями, со сглаживанием */
        state.vYaw = clamp(lerp(state.vYaw, -dx * k / dtm, 0.5), -4, 4);
        state.vPitch = clamp(lerp(state.vPitch, dy * k / dtm, 0.5), -3, 3);
        interact();
    });
    const endPointer = e => {
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = null;
        if (drag && pointers.size === 0) {
            /* Палец/мышь остановились перед отпусканием — без инерции */
            if (performance.now() - drag.last > 90) { state.vYaw = 0; state.vPitch = 0; }
            if (!drag.moved && performance.now() - drag.t < 450 && e.type === "pointerup") click(e.clientX, e.clientY);
            drag = null;
        }
        if (pointers.size === 0) canvas.classList.remove("is-grab");
    };
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);
    canvas.addEventListener("pointerleave", () => hideTip());
    canvas.addEventListener("wheel", e => {
        e.preventDefault();
        const k = e.deltaMode === 1 ? 0.05 : 0.0012;
        state.dist = clamp(state.dist * (1 + e.deltaY * k), state.minDist, 6.5);
        interact();
    }, { passive: false });
    canvas.addEventListener("dblclick", e => { e.preventDefault(); resetView(); });
    canvas.addEventListener("contextmenu", e => e.preventDefault());

    function click(x, y) {
        const ray = rayFrom(x, y);
        const f = pickFish(ray);
        if (f) {
            f.scare = 0.9;
            f.flee = [f.p[0] - ray.o[0], 0, f.p[2] - ray.o[2]];
            const l = Math.hypot(f.flee[0], f.flee[2]) || 1;
            f.flee = [f.flee[0] / l + rand(-0.4, 0.4), rand(-0.2, 0.3), f.flee[2] / l + rand(-0.4, 0.4)];
            toast(`${f.sp.name} · ${f.sp.latin}`);
            sfxBubble(); return;
        }
        /* Поверхность воды → корм */
        if (ray.d[1] < -0.02) {
            const t = (WATER_Y - ray.o[1]) / ray.d[1];
            const hx = ray.o[0] + ray.d[0] * t, hz = ray.o[2] + ray.d[2] * t;
            if (t > 0 && Math.abs(hx) < TANK.x - 0.02 && Math.abs(hz) < TANK.z - 0.02) {
                const hitBox = rayBox(ray, [-TANK.x, TANK.yMin, -TANK.z], [TANK.x, TANK.yMax, TANK.z]);
                if (hitBox && hitBox.axis === 1) { dropFood(hx, hz, 6); sfxDrop(); return; }
            }
        }
        /* Стекло → рыбы пугаются */
        const hit = rayBox(ray, [-TANK.x, TANK.yMin, -TANK.z], [TANK.x, TANK.yMax, TANK.z]);
        if (hit) {
            const hp = [ray.o[0] + ray.d[0] * hit.t, ray.o[1] + ray.d[1] * hit.t, ray.o[2] + ray.d[2] * hit.t];
            let n = 0;
            fishes.forEach(ff => {
                const dx = ff.p[0] - hp[0], dy = ff.p[1] - hp[1], dz = ff.p[2] - hp[2];
                const d = Math.hypot(dx, dy, dz);
                if (d < 0.45) { ff.scare = 0.7; ff.flee = [dx / (d || 1), dy / (d || 1) * 0.4, dz / (d || 1)]; n++; }
            });
            sfxTap();
            if (n) toast("Тук-тук! Рыбы разбежались");
        }
    }

    /* Подсказка с названием рыбы при наведении */
    const tip = $("#aq-tip");
    let hoverRaf = 0, hoverEv = null;
    function hover(e) {
        hoverEv = e;
        if (hoverRaf) return;
        hoverRaf = requestAnimationFrame(() => {
            hoverRaf = 0;
            if (!hoverEv || pointers.size) return;
            const f = pickFish(rayFrom(hoverEv.clientX, hoverEv.clientY));
            if (!f) { hideTip(); canvas.classList.remove("is-fish"); return; }
            canvas.classList.add("is-fish");
            tip.innerHTML = `<b>${f.sp.name}</b><i>${f.sp.latin}</i><span>сытость ${Math.round((1 - f.hunger) * 100)}%</span>`;
            tip.style.transform = `translate(${hoverEv.clientX + 14}px, ${hoverEv.clientY + 14}px)`;
            tip.hidden = false;
        });
    }
    function hideTip() { if (tip) tip.hidden = true; }

    function resetView() {
        state.yaw = DEFAULT_VIEW.yaw; state.pitch = DEFAULT_VIEW.pitch; state.dist = DEFAULT_VIEW.dist;
        state.vYaw = 0; state.vPitch = 0;
        interact();
    }

    /* ---------------------------------------------------------------- *
     * Звук: шум воды + пузырьки (WebAudio, без файлов)
     * ---------------------------------------------------------------- */
    let AC = null, master = null;
    function ensureAudio() {
        if (!state.sound) return;
        if (AC) { if (AC.state === "suspended") AC.resume(); return; }
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        try {
            AC = new Ctx();
            master = AC.createGain();
            master.gain.value = 0.0;
            master.connect(AC.destination);
            const len = AC.sampleRate * 2;
            const buf = AC.createBuffer(1, len, AC.sampleRate);
            const data = buf.getChannelData(0);
            let last = 0;
            for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; data[i] = last * 3.5; }
            const src = AC.createBufferSource();
            src.buffer = buf; src.loop = true;
            const lp = AC.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 520;
            const g = AC.createGain(); g.gain.value = 0.35;
            src.connect(lp); lp.connect(g); g.connect(master);
            src.start();
            master.gain.setTargetAtTime(0.5, AC.currentTime, 0.6);
        } catch (e) { AC = null; }
    }
    function blip(f0, f1, dur, vol) {
        if (!AC || !state.sound || AC.state !== "running") return;
        const t = AC.currentTime;
        const o = AC.createOscillator(), g = AC.createGain();
        o.type = "sine";
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(f1, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(master);
        o.start(t); o.stop(t + dur + 0.02);
    }
    function sfxBubble() { blip(rand(500, 900), rand(1200, 2200), rand(0.04, 0.08), 0.05); }
    function sfxEat() { blip(320, 180, 0.06, 0.06); }
    function sfxDrop() { for (let i = 0; i < 4; i++) setTimeout(() => blip(rand(900, 1300), rand(400, 600), 0.05, 0.04), i * 60); }
    function sfxTap() { blip(180, 90, 0.12, 0.18); setTimeout(() => blip(170, 85, 0.1, 0.12), 110); }
    function setSound(on) {
        state.sound = on;
        if (on) ensureAudio();
        if (master && AC) master.gain.setTargetAtTime(on ? 0.5 : 0, AC.currentTime, 0.2);
        save();
    }

    /* ---------------------------------------------------------------- *
     * Сохранение состава аквариума
     * ---------------------------------------------------------------- */
    let saveTimer = 0;
    function save() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            const counts = {};
            fishes.forEach(f => { counts[f.kind] = (counts[f.kind] || 0) + 1; });
            try { localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, fish: counts, night: state.nightTarget > 0.5, sound: state.sound, auto: state.autoRotate, bubbles: state.bubbles, rays: state.rays })); } catch (e) { /* хранилище недоступно */ }
        }, 300);
    }
    function load() {
        let s = null;
        try { s = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { s = null; }
        if (s && s.fish && typeof s.fish === "object") {
            SPECIES_ORDER.forEach(k => { const n = clamp(parseInt(s.fish[k], 10) || 0, 0, MAX_FISH); for (let i = 0; i < n; i++) addFish(k, true); });
            if (s.night) { state.night = state.nightTarget = 1; }
            if (typeof s.sound === "boolean") state.sound = s.sound;
            if (typeof s.auto === "boolean") state.autoRotate = s.auto;
            if (typeof s.bubbles === "boolean") state.bubbles = s.bubbles;
            if (typeof s.rays === "boolean") state.rays = s.rays;
        }
        if (!fishes.length) SPECIES_ORDER.forEach(k => { for (let i = 0; i < SPECIES[k].start; i++) addFish(k, true); });
    }

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
    const stFish = $("#st-fish"), stFood = $("#st-food"), stFps = $("#st-fps"), stTemp = $("#st-temp"), stMode = $("#st-mode");
    function updateStats() {
        if (stFish) stFish.textContent = String(fishes.length);
        if (stFood) stFood.textContent = String(food.length);
    }
    function paintToggles() {
        $$("[data-aq]").forEach(b => {
            const a = b.getAttribute("data-aq");
            let on = null;
            if (a === "night") on = state.nightTarget > 0.5;
            else if (a === "auto") on = state.autoRotate;
            else if (a === "sound") on = state.sound;
            else if (a === "bubbles") on = state.bubbles;
            else if (a === "rays") on = state.rays;
            if (on !== null) b.setAttribute("aria-pressed", String(on));
        });
        if (stMode) stMode.textContent = state.nightTarget > 0.5 ? "НОЧЬ" : "ДЕНЬ";
        const sndIco = $("[data-aq='sound'] .ico-on"), sndOff = $("[data-aq='sound'] .ico-off");
        if (sndIco && sndOff) { sndIco.hidden = !state.sound; sndOff.hidden = state.sound; }
    }

    const menu = $("#aq-species");
    function buildMenu() {
        if (!menu) return;
        menu.innerHTML = SPECIES_ORDER.map(k => {
            const s = SPECIES[k];
            const sw = s.pattern === 0 || s.pattern === 4 ? s.c2 : s.c1; /* неон и гуппи — по яркому цвету полосы / хвоста */
            const c = sw.map(v => Math.round(v * 255)).join(",");
            return `<button type="button" role="menuitem" data-species="${k}"><i style="background:rgb(${c})"></i><span><b>${s.name}</b><small>${s.latin}</small></span></button>`;
        }).join("");
    }
    function toggleMenu(force) {
        if (!menu) return;
        const on = force === undefined ? menu.hidden : force;
        menu.hidden = !on;
        const btn = $("[data-aq='add']");
        if (btn) btn.setAttribute("aria-expanded", String(on));
    }

    function feed() {
        const n = 3;
        for (let i = 0; i < n; i++) dropFood(rand(-0.7, 0.7), rand(-0.25, 0.25), 4);
        sfxDrop();
        toast("Корм в воде — смотрите, как рыбы собираются");
    }
    function setNight(on) {
        state.nightTarget = on ? 1 : 0;
        paintToggles(); save();
        toast(on ? "Ночной режим: лунный свет, рыбы отдыхают" : "Дневной свет");
    }

    function action(a, el) {
        interact();
        switch (a) {
            case "feed": feed(); break;
            case "add": toggleMenu(); break;
            case "remove": if (removeFish()) toast("Рыбка отправлена в отсадник"); else toast("В аквариуме нет рыб"); break;
            case "night": setNight(state.nightTarget < 0.5); break;
            case "auto": state.autoRotate = !state.autoRotate; paintToggles(); save(); toast(state.autoRotate ? "Авто-обзор включён" : "Авто-обзор выключен"); break;
            case "sound": setSound(!state.sound); paintToggles(); break;
            case "bubbles": state.bubbles = !state.bubbles; paintToggles(); save(); break;
            case "rays": state.rays = !state.rays; paintToggles(); save(); break;
            case "reset": resetView(); toast("Вид сброшен"); break;
            case "fullscreen": {
                const d = document;
                if (d.fullscreenElement) d.exitFullscreen && d.exitFullscreen();
                else if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen().catch(() => toast("Полный экран недоступен в этом окне"));
                break;
            }
            case "close":
                if (EMBED && window.parent !== window) window.parent.postMessage({ type: "nexus:player-close" }, "*");
                else window.location.href = "../projects.html#aquarium";
                break;
            default: break;
        }
        if (el) el.blur && a !== "add" && el.blur();
    }
    document.addEventListener("click", e => {
        const b = e.target.closest("[data-aq]");
        if (b) { action(b.getAttribute("data-aq"), b); return; }
        const s = e.target.closest("[data-species]");
        if (s) {
            const k = s.getAttribute("data-species");
            if (addFish(k)) toast(`${SPECIES[k].name} запущена в аквариум`);
            sfxDrop();
            toggleMenu(false);
            return;
        }
        if (menu && !menu.hidden && !e.target.closest("#aq-species")) toggleMenu(false);
    });

    document.addEventListener("keydown", e => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key.toLowerCase();
        const map = { f: "feed", "а": "feed", n: "night", "т": "night", r: "reset", "к": "reset", a: "auto", "ф": "auto", m: "sound", "ь": "sound", b: "bubbles", "и": "bubbles", "+": "add", "=": "add", "-": "remove" };
        if (k === "escape") {
            if (menu && !menu.hidden) { toggleMenu(false); return; }
            if (document.fullscreenElement) return;
            if (EMBED) action("close");
            return;
        }
        if (map[k]) { e.preventDefault(); action(map[k]); return; }
        const step = 0.12;
        if (e.key === "ArrowLeft") { state.yaw += step; interact(); }
        else if (e.key === "ArrowRight") { state.yaw -= step; interact(); }
        else if (e.key === "ArrowUp") { state.pitch = clamp(state.pitch + step * 0.6, -0.32, 1.25); interact(); }
        else if (e.key === "ArrowDown") { state.pitch = clamp(state.pitch - step * 0.6, -0.32, 1.25); interact(); }
        else return;
        e.preventDefault();
    });

    /* ---------------------------------------------------------------- *
     * Кадр
     * ---------------------------------------------------------------- */
    function fillPoints() {
        let n = 0;
        const put = (p, size, kind, alpha) => {
            if (n >= PTS_MAX) return;
            const o = n * 6;
            ptsData[o] = p[0]; ptsData[o + 1] = p[1]; ptsData[o + 2] = p[2];
            ptsData[o + 3] = size; ptsData[o + 4] = kind; ptsData[o + 5] = alpha;
            n++;
        };
        dust.forEach(d => put(d.p, d.s, 2, 0.6 + 0.4 * Math.sin(state.time + d.ph)));
        food.forEach(f => put(f.p, f.size, 1, f.alpha));
        bubbles.forEach(b => put(b.p, b.s, 0, 1));
        return n;
    }

    function render() {
        gl.viewport(0, 0, state.w, state.h);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        /* Фон */
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        setCommon(P.bg);
        gl.uniform2f(u(P.bg, "uRes"), state.w, state.h);
        enabledAttribs.forEach(l => gl.disableVertexAttribArray(l)); enabledAttribs = [];
        gl.bindBuffer(gl.ARRAY_BUFFER, fullTri);
        gl.enableVertexAttribArray(P.bg.a.aXY); enabledAttribs.push(P.bg.a.aXY);
        gl.vertexAttribPointer(P.bg.a.aXY, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        /* Пол с сеткой и тенью */
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        setCommon(P.floor);
        drawMesh(P.floor, MESH.floor);
        gl.depthMask(true);
        gl.disable(gl.BLEND);

        /* Непрозрачное */
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
        setCommon(P.lit);
        gl.uniformMatrix4fv(u(P.lit, "uModel"), false, IDENT);
        gl.uniform1f(u(P.lit, "uSwayOn"), 0);
        gl.uniform1f(u(P.lit, "uInWater"), 0);
        gl.disable(gl.CULL_FACE);
        drawMesh(P.lit, MESH.outside);
        gl.uniform1f(u(P.lit, "uInWater"), 1);
        drawMesh(P.lit, MESH.decor);
        gl.uniform1f(u(P.lit, "uSwayOn"), 1);
        drawMesh(P.lit, MESH.plants);

        setCommon(P.fish);
        fishes.forEach(f => {
            const m = M4.model(f.p[0], f.p[1], f.p[2], f.yaw, f.pitch, f.roll, f.size);
            gl.uniformMatrix4fv(u(P.fish, "uModel"), false, m);
            gl.uniform1f(u(P.fish, "uPhase"), f.phase);
            gl.uniform1f(u(P.fish, "uAmp"), f.amp);
            gl.uniform1f(u(P.fish, "uPattern"), f.sp.pattern);
            gl.uniform3fv(u(P.fish, "uC1"), f.sp.c1);
            gl.uniform3fv(u(P.fish, "uC2"), f.sp.c2);
            gl.uniform3fv(u(P.fish, "uC3"), f.sp.c3);
            gl.uniform3fv(u(P.fish, "uEye"), f.sp.eye);
            gl.uniform1f(u(P.fish, "uGlow"), f.sp.glow);
            drawMesh(P.fish, MESH.fish[f.kind]);
        });

        /* Прозрачное: задние стёкла → лучи → частицы → вода → передние стёкла */
        gl.enable(gl.BLEND);
        gl.depthMask(false);
        gl.enable(gl.CULL_FACE);

        setCommon(P.glass);
        gl.uniform1f(u(P.glass, "uBack"), 1);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.cullFace(gl.FRONT);
        drawMesh(P.glass, MESH.glass);

        gl.disable(gl.CULL_FACE);
        if (state.rays) {
            setCommon(P.rays);
            gl.uniform1f(u(P.rays, "uRay"), lerp(0.09, 0.035, state.night));
            gl.blendFunc(gl.ONE, gl.ONE);
            drawMesh(P.rays, MESH.rays);
        }

        const n = fillPoints();
        if (n) {
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            setCommon(P.pts);
            gl.uniform1f(u(P.pts, "uScale"), state.h * state.proj[5] * 0.5);
            enabledAttribs.forEach(l => gl.disableVertexAttribArray(l)); enabledAttribs = [];
            gl.bindBuffer(gl.ARRAY_BUFFER, ptsBuf);
            gl.bufferData(gl.ARRAY_BUFFER, ptsData.subarray(0, n * 6), gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(P.pts.a.aPos); gl.vertexAttribPointer(P.pts.a.aPos, 3, gl.FLOAT, false, 24, 0);
            gl.enableVertexAttribArray(P.pts.a.aInfo); gl.vertexAttribPointer(P.pts.a.aInfo, 3, gl.FLOAT, false, 24, 12);
            enabledAttribs.push(P.pts.a.aPos, P.pts.a.aInfo);
            gl.drawArrays(gl.POINTS, 0, n);
        }

        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        setCommon(P.water);
        gl.uniform3fv(u(P.water, "uLamp"), LAMP);
        drawMesh(P.water, MESH.water);

        setCommon(P.glass);
        gl.uniform1f(u(P.glass, "uBack"), 0);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);
        drawMesh(P.glass, MESH.glass);

        gl.disable(gl.CULL_FACE);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
    }

    let last = performance.now(), fpsAcc = 0, fpsN = 0, tempT = 0;
    function frame(now) {
        const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
        last = now;
        state.time += dt;

        /* Инерция и авто-обзор */
        if (!drag) {
            state.yaw += state.vYaw * dt;
            state.pitch = clamp(state.pitch + state.vPitch * dt, -0.32, 1.25);
            state.vYaw *= Math.pow(0.04, dt);
            state.vPitch *= Math.pow(0.02, dt);
            if (state.autoRotate && state.time - state.lastInteract > 6) state.yaw += dt * 0.09;
        }
        state.night = lerp(state.night, state.nightTarget, Math.min(1, dt * 1.8));

        resize();
        updateCamera();
        updateFish(dt);
        updateParticles(dt);
        render();

        fpsAcc += dt; fpsN++;
        if (fpsAcc > 0.5) {
            if (stFps) stFps.textContent = String(Math.round(fpsN / fpsAcc));
            fpsAcc = 0; fpsN = 0;
            updateStats();
        }
        tempT += dt;
        if (tempT > 3 && stTemp) { tempT = 0; stTemp.textContent = (24.5 + Math.sin(state.time * 0.05) * 0.2 + rand(-0.05, 0.05)).toFixed(1); }
        requestAnimationFrame(frame);
    }

    canvas.addEventListener("webglcontextlost", e => {
        e.preventDefault();
        if (fail) { fail.hidden = false; const m = $("#aq-fail-msg"); if (m) m.textContent = "Видеоконтекст WebGL потерян. Перезагрузите страницу."; }
    });

    /* ---------------------------------------------------------------- *
     * Старт
     * ---------------------------------------------------------------- */
    buildMenu();
    load();
    resize();
    state.dist = DEFAULT_VIEW.dist;
    paintToggles();
    updateStats();
    const hint = $("#aq-hint");
    if (hint) setTimeout(() => hint.classList.add("is-hidden"), 7000);
    canvas.addEventListener("pointerdown", () => { if (hint) hint.classList.add("is-hidden"); }, { once: true });
    document.documentElement.classList.add("aq-ready");
    requestAnimationFrame(t => { last = t; frame(t); });

    /* Для тестов и консоли */
    window.NexusAquarium = {
        state, fishes, food, bubbles, SPECIES,
        addFish: k => addFish(k || "neon"), removeFish, feed, setNight, resetView,
        click, drop: (x, z, n) => dropFood(x, z, n || 6)
    };
})();
