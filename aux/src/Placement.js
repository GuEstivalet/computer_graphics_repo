// src/Placement.js
export function v3normalize(v){
  const l = Math.hypot(v[0],v[1],v[2]) || 1;
  return [v[0]/l, v[1]/l, v[2]/l];
}
export function v3cross(a,b){
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
export function v3add(a,b){ return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
export function v3scale(v,s){ return [v[0]*s, v[1]*s, v[2]*s]; }
export function v3dot(a,b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }

export function basisFromUp(up) {
  const a = Math.abs(up[1]) < 0.999 ? [0,1,0] : [1,0,0];
  const right = v3normalize(v3cross(a, up));
  const fwd = v3normalize(v3cross(up, right));
  return { right, up, fwd };
}

// pega um "up" aleatório estável
export function fibonacciDir(i, n) {
  const phi = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (i / (n - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y*y));
  const t = phi * i;
  return [Math.cos(t) * r, y, Math.sin(t) * r];
}

// altura do terreno para um "up" (use sua displacedRadius/fbm3 se já tem)
export function terrainRadiusAtUp(displacedRadiusFn, up, data) {
  return displacedRadiusFn(up, data.radius, data.planetNoiseAmp, data.planetNoiseFreq, data.seed, data.octaves ?? 6);
}

// critérios de bioma por altura (h = r - baseRadius)
export function isGreen(displacedRadiusFn, up, data) {
  const r = terrainRadiusAtUp(displacedRadiusFn, up, data);
  const h = r - data.radius;
  return h > (data.ocean - 2.0) && h < (data.mountain + 5.0);
}
export function isWater(displacedRadiusFn, up, data) {
  const r = terrainRadiusAtUp(displacedRadiusFn, up, data);
  const h = r - data.radius;
  return h < data.ocean; // “água”
}

// objeto instanciado: guarda up + posição + yaw etc.
export function makeTreeInstance(displacedRadiusFn, up, data) {
  const { right, fwd } = basisFromUp(up);
  const r = terrainRadiusAtUp(displacedRadiusFn, up, data);
  const lift = data.treeScale * 0.5;
  const pos = v3scale(up, r * 1.01 + lift);
  return { up, right, fwd, scale: data.treeScale };
}

// “gira vetor v ao redor do eixo axis”
export function rotateAroundAxis(v, axis, ang){
  const a = v3normalize(axis);
  const c = Math.cos(ang), s = Math.sin(ang);
  // Rodrigues
  const term1 = v3scale(v, c);
  const term2 = v3scale(v3cross(a, v), s);
  const term3 = v3scale(a, v3dot(a, v) * (1 - c));
  return v3add(v3add(term1, term2), term3);
}

export function makeFishInstance(up, data) {
  const { right, fwd } = basisFromUp(up);

  // direção inicial no plano tangente (unitária)
  const dir = v3normalize(v3add(v3scale(right, Math.random()*2-1), v3scale(fwd, Math.random()*2-1)));

  const phase = Math.random() * Math.PI * 2;
  const speed = data.fishSpeed * (0.7 + Math.random()*0.6);

  return { up, dir, phase, speed, scale: data.fishScale, _upNow: up, _dirNow: dir };
}
