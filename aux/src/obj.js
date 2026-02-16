// src/obj.js
export async function loadText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao carregar ${url}: ${res.status}`);
  return await res.text();
}

export function parseOBJ(objText) {
  const positions = [[0,0,0]];
  const texcoords = [[0,0]];
  const normals   = [[0,0,1]];

  const outPos = [];
  const outUV  = [];
  const outNrm = [];

  function addVertex(v) {
    const [p, t, n] = v.split('/').map(s => s ? parseInt(s, 10) : 0);
    const pp = positions[p] || [0,0,0];
    const tt = texcoords[t] || [0,0];
    const nn = normals[n]   || [0,0,1];
    outPos.push(pp[0], pp[1], pp[2]);
    outUV.push(tt[0], tt[1]);
    outNrm.push(nn[0], nn[1], nn[2]);
  }

  const lines = objText.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const parts = line.split(/\s+/);
    const tag = parts[0];

    if (tag === 'v') positions.push(parts.slice(1,4).map(Number));
    else if (tag === 'vt') texcoords.push(parts.slice(1,3).map(Number));
    else if (tag === 'vn') normals.push(parts.slice(1,4).map(Number));
    else if (tag === 'f') {
      const verts = parts.slice(1);
      for (let i = 1; i + 1 < verts.length; i++) {
        addVertex(verts[0]);
        addVertex(verts[i]);
        addVertex(verts[i+1]);
      }
    }
  }

  return {
    position: { numComponents: 3, data: outPos },
    normal:   { numComponents: 3, data: outNrm },
    texcoord: { numComponents: 2, data: outUV },
  };
}

export function computeExtentsFromPositions(pos) {
  let minX = pos[0], minY = pos[1], minZ = pos[2];
  let maxX = pos[0], maxY = pos[1], maxZ = pos[2];
  for (let i = 3; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i+1], z = pos[i+2];
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

export function generateNormalsForTriangles(positions) {
  const n = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i], ay = positions[i+1], az = positions[i+2];
    const bx = positions[i+3], by = positions[i+4], bz = positions[i+5];
    const cx = positions[i+6], cy = positions[i+7], cz = positions[i+8];

    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;

    const nx = aby*acz - abz*acy;
    const ny = abz*acx - abx*acz;
    const nz = abx*acy - aby*acx;

    n[i]+=nx; n[i+1]+=ny; n[i+2]+=nz;
    n[i+3]+=nx; n[i+4]+=ny; n[i+5]+=nz;
    n[i+6]+=nx; n[i+7]+=ny; n[i+8]+=nz;
  }
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.hypot(n[i], n[i+1], n[i+2]) || 1;
    n[i]/=len; n[i+1]/=len; n[i+2]/=len;
  }
  return n;
}
