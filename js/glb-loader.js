/* NEXUS GLB loader — local, dependency-free glTF 2.0/GLB parser.
 * It intentionally handles the runtime subset used by the Abrams asset:
 * mesh primitives, typed accessors, vertex colours, custom attributes and
 * the node hierarchy. Rendering stays in js/abrams.js on pure WebGL.
 */
(function (global) {
    "use strict";

    const COMPONENTS = {
        5120: { C: Int8Array, bytes: 1 },
        5121: { C: Uint8Array, bytes: 1 },
        5122: { C: Int16Array, bytes: 2 },
        5123: { C: Uint16Array, bytes: 2 },
        5125: { C: Uint32Array, bytes: 4 },
        5126: { C: Float32Array, bytes: 4 }
    };
    const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

    function fail(message) { throw new Error("GLB: " + message); }

    function parse(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) fail("invalid header");
        if (view.getUint32(4, true) !== 2) fail("only glTF 2.0 is supported");
        if (view.getUint32(8, true) > view.byteLength) fail("truncated file");
        let offset = 12, json = null, binary = null;
        while (offset + 8 <= view.byteLength) {
            const size = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
            offset += 8;
            if (offset + size > view.byteLength) fail("truncated chunk");
            if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, offset, size)));
            else if (type === 0x004e4942) binary = new Uint8Array(arrayBuffer, offset, size);
            offset += size;
        }
        if (!json || !binary) fail("JSON or BIN chunk is missing");
        if (!json.asset || json.asset.version !== "2.0") fail("invalid glTF asset metadata");

        const readAccessor = index => {
            const a = json.accessors && json.accessors[index];
            if (!a || a.sparse) fail("missing or sparse accessor " + index);
            const b = json.bufferViews && json.bufferViews[a.bufferView];
            const info = COMPONENTS[a.componentType], width = WIDTH[a.type];
            if (!b || !info || !width) fail("unsupported accessor " + index);
            const count = a.count * width;
            const start = binary.byteOffset + (b.byteOffset || 0) + (a.byteOffset || 0);
            const stride = b.byteStride || info.bytes * width;
            if (stride === info.bytes * width && start % info.bytes === 0) return new info.C(binary.buffer, start, count);
            const out = new info.C(count);
            const source = new DataView(binary.buffer, binary.byteOffset + (b.byteOffset || 0), b.byteLength);
            const getter = a.componentType === 5126 ? "getFloat32" : a.componentType === 5125 ? "getUint32" :
                a.componentType === 5123 ? "getUint16" : a.componentType === 5122 ? "getInt16" :
                    a.componentType === 5121 ? "getUint8" : "getInt8";
            for (let i = 0; i < a.count; i++) for (let k = 0; k < width; k++) {
                out[i * width + k] = source[getter](i * stride + k * info.bytes, true);
            }
            return out;
        };

        const meshes = {};
        (json.meshes || []).forEach((mesh, meshIndex) => {
            const primitives = mesh.primitives || [];
            if (!primitives.length) return;
            const first = primitives[0];
            if (!first.attributes || first.attributes.POSITION === undefined || first.attributes.NORMAL === undefined) {
                fail("mesh " + (mesh.name || meshIndex) + " has no positions or normals");
            }
            const positions = readAccessor(first.attributes.POSITION);
            const normals = readAccessor(first.attributes.NORMAL);
            const colors = first.attributes.COLOR_0 === undefined ? null : readAccessor(first.attributes.COLOR_0);
            const nexusMaterial = first.attributes._NEXUS_MATERIAL === undefined ? null : readAccessor(first.attributes._NEXUS_MATERIAL);
            let length = 0;
            const parts = primitives.map(p => {
                if ((p.mode === undefined ? 4 : p.mode) !== 4) fail("only triangle primitives are supported");
                const indices = p.indices === undefined ? null : readAccessor(p.indices);
                const n = indices ? indices.length : positions.length / 3;
                length += n;
                return { indices, count: n, material: p.material };
            });
            const indices = new Uint32Array(length);
            let at = 0;
            parts.forEach(part => {
                if (part.indices) indices.set(part.indices, at);
                else for (let i = 0; i < part.count; i++) indices[at + i] = i;
                at += part.count;
            });
            const name = mesh.name || "mesh_" + meshIndex;
            meshes[name] = {
                name,
                role: mesh.extras && mesh.extras.nexusRole || name,
                positions,
                normals,
                colors,
                nexusMaterial,
                indices,
                bounds: json.accessors[first.attributes.POSITION] && {
                    min: json.accessors[first.attributes.POSITION].min,
                    max: json.accessors[first.attributes.POSITION].max
                }
            };
        });

        return { json, binary, meshes, nodes: json.nodes || [], scenes: json.scenes || [], metadata: json.extras || {} };
    }

    async function load(url) {
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) fail(`request failed (${response.status}) for ${url}`);
        return parse(await response.arrayBuffer());
    }

    global.NexusGLB = Object.freeze({ load, parse });
})(window);
