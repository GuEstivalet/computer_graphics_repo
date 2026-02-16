// ==========================
// NOISE + FBM (CPU version)
// ==========================

function fract(x) {
  return x - Math.floor(x);
}

function hash31(x, y, z) {
  const n = x * 127.1 + y * 311.7 + z * 74.7;
  return fract(Math.sin(n) * 43758.5453123);
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise3(p) {
  const ix = Math.floor(p[0]);
  const iy = Math.floor(p[1]);
  const iz = Math.floor(p[2]);

  const fx = p[0] - ix;
  const fy = p[1] - iy;
  const fz = p[2] - iz;

  const ux = smoothstep(fx);
  const uy = smoothstep(fy);
  const uz = smoothstep(fz);

  function n(x, y, z) {
    return hash31(ix + x, iy + y, iz + z);
  }

  const n000 = n(0,0,0);
  const n100 = n(1,0,0);
  const n010 = n(0,1,0);
  const n110 = n(1,1,0);
  const n001 = n(0,0,1);
  const n101 = n(1,0,1);
  const n011 = n(0,1,1);
  const n111 = n(1,1,1);

  const nx00 = n000*(1-ux)+n100*ux;
  const nx10 = n010*(1-ux)+n110*ux;
  const nx01 = n001*(1-ux)+n101*ux;
  const nx11 = n011*(1-ux)+n111*ux;

  const nxy0 = nx00*(1-uy)+nx10*uy;
  const nxy1 = nx01*(1-uy)+nx11*uy;

  return nxy0*(1-uz)+nxy1*uz;
}

export function fbm3(p, seed, octaves) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1.0;

  for (let i = 0; i < Math.min(12, octaves); i++) {
    const pp = [
      p[0] * freq + seed,
      p[1] * freq + seed * 1.37,
      p[2] * freq + seed * 2.11,
    ];

    const v = valueNoise3(pp) * 2 - 1;
    sum += v * amp;

    freq *= 2.0;
    amp *= 0.5;
  }

  return sum;
}

export function displacedRadius(up, baseRadius, noiseAmp, noiseFreq, seed, octaves) {
  const p = [
    up[0] * noiseFreq,
    up[1] * noiseFreq,
    up[2] * noiseFreq,
  ];

  const n = fbm3(p, seed, octaves);
  return baseRadius + n * noiseAmp;
}
