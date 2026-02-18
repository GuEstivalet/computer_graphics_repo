// src/Renderer.js

// =========================================================
// IMPORTS
// =========================================================
import {
  loadText,
  parseOBJ,
  computeExtentsFromPositions,
  generateNormalsForTriangles,
} from "./obj.js";

import { vsObj, fsObj, vsPick, fsPick } from "./shaders.js";

import {
  basisFromUp,
  v3normalize,
  v3scale,
  isGreen,
  isWater,
  makeTreeInstance,
  makeFishInstance,
} from "./Placement.js";

// =========================================================
// HELPERS: VEC3 MATH
// =========================================================
function v3dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function v3add(a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function v3sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function v3mul(a, s) { return [a[0]*s, a[1]*s, a[2]*s]; }
function v3len(a) { return Math.hypot(a[0], a[1], a[2]); }
function v3norm(a) {
  const L = v3len(a) || 1;
  return [a[0]/L, a[1]/L, a[2]/L];
}
function v3cross(a, b) {
  return [
    a[1]*b[2] - a[2]*b[1],
    a[2]*b[0] - a[0]*b[2],
    a[0]*b[1] - a[1]*b[0],
  ];
}

// =========================================================
// HELPERS: SPHERE TANGENT / MOTION
// =========================================================
function projectToTangent(v, up) {
  const d = v3dot(v, up);
  return v3sub(v, v3mul(up, d));
}

function stepOnSphere(up, velTangent, step) {
  return v3norm(v3add(up, v3mul(velTangent, step)));
}

function reflect(v, n) {
  const d = v3dot(v, n);
  return v3sub(v, v3mul(n, 2*d));
}

// =========================================================
// HELPERS: WIREFRAME INDICES
// =========================================================
function buildWireframeIndicesFromTriangles(triIndices) {
  const edges = new Set();

  function addEdge(a, b) {
    const min = a < b ? a : b;
    const max = a < b ? b : a;
    edges.add(min + "," + max);
  }

  for (let i = 0; i < triIndices.length; i += 3) {
    const a = triIndices[i + 0];
    const b = triIndices[i + 1];
    const c = triIndices[i + 2];
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  const out = new Uint32Array(edges.size * 2);
  let o = 0;
  for (const key of edges) {
    const [a, b] = key.split(",").map(Number);
    out[o++] = a;
    out[o++] = b;
  }

  if (out.length && Math.max(...out) < 65536) {
    return new Uint16Array(out);
  }
  return out;
}

// =========================================================
// RENDERER
// =========================================================
export class Renderer {

  // =======================================================
  // LIFECYCLE / SETUP
  // =======================================================
  constructor(canvas, deps) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl2");
    if (!this.gl) return;

    this.twgl = deps.twgl;
    this.m4 = deps.m4;
    this.twgl.setDefaults({ attribPrefix: "a_" });

    this.control = {
      enabled: false,
      fishIndex: 0,
    };

    this.mouseTargetUpLocal = null;
    this.setMouseTargetUpLocal = (upLocal) => {
      this.mouseTargetUpLocal = upLocal;
    };

    this.textures = {
      tree: null,
      fish: null,
    };

    this.data = {
      radius: 100,
      planetNoiseAmp: 12,
      planetNoiseFreq: 3.5,
      seed: 5.0,
      octaves: 6,
      ocean: -4,
      beach: 1,
      mountain: 8,

      waterOffset: 2.2,
      fishScale: 1.2,
      fishSpeed: 0.9,

      treeCount: 100,
      treeScale: 3.0,
      fishCount: 25,

      fishClearance: 1.2,
      fishBounce: 1.0,
      fishMinDot: 0.985,
      fishPanicTime: 0.3,
      fishPanicMul: 2.0,
      fishPanicDot: 0.985,

      objectDetail: 1, 
    };

    this.shadow = {
      treeVao: null,
      fishVao: null,
    };

    this.programPick = this.twgl.createProgramInfo(this.gl, [vsPick, fsPick]);
    this.pick = { fb: null, tex: null, depth: null, w: 0, h: 0 };
    this.treePickVao = null;

    this.displacedRadius = deps.displacedRadius;

    this.programObj = this.twgl.createProgramInfo(this.gl, [vsObj, fsObj]);

    this.models = {
      tree: { arrays: null, bufferInfo: null, wireArrays: null, wireBufferInfo: null, scaleFix: 1 },
      fish: { arrays: null, bufferInfo: null, wireArrays: null, wireBufferInfo: null, scaleFix: 1 },
    };

    this.trees = [];
    this.fishes = [];

    this.treeInst = { bufferInfo: null, vao: null, count: 0 };
    this.fishInst = { bufferInfo: null, vao: null, count: 0 };

    this.mouseUpLocal = null;
    this.setMouseUpLocal = (upLocal) => {
      this.mouseUpLocal = upLocal;
    };
  }

  // =======================================================
  // GAME MODE CONTROLS
  // =======================================================
  setFollowFishEnabled(on) {
    this.control.enabled = !!on;

    if (!this.control.enabled) {
      for (const f of this.fishes) f._controlBoost = 0;
    }
  }

  setControlledFishIndex(idx) {
    const n = this.fishes.length;
    if (!n) { this.control.fishIndex = 0; return; }
    this.control.fishIndex = Math.max(0, Math.min(n - 1, idx | 0));
  }

  getControlledFishLocalPose() {
    const n = this.fishes.length;
    if (!n) return null;

    const idx = Math.max(0, Math.min(n - 1, this.control.fishIndex | 0));
    const f = this.fishes[idx];

    const up = v3norm(f._upNow || f.up);

    const waterR = this.data.radius + this.data.waterOffset;
    const posLocal = v3scale(up, waterR * 1.002);

    let velLocal = f._vel;
    if (!velLocal) {
      const { fwd } = basisFromUp(up);
      velLocal = fwd;
    } else {
      velLocal = v3norm(projectToTangent(velLocal, up));
    }

    return { idx, up, posLocal, velLocal };
  }

  // =======================================================
  // PICKING: TREE REMOVE
  // =======================================================
  pickTreeAtPixel(x, y, viewProjection, worldMatrix) {
    const gl = this.gl;

    if (!this.treeInst.bufferInfo || !this.treePickVao || this.treeInst.count <= 0) return -1;

    const w = gl.canvas.width;
    const h = gl.canvas.height;
    this._resizePickBuffer(w, h);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pick.fb);
    gl.viewport(0, 0, w, h);

    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.programPick.program);
    gl.bindVertexArray(this.treePickVao);

    this.twgl.setUniforms(this.programPick, {
      u_viewProjection: viewProjection,
      u_world: worldMatrix,
    });

    this.twgl.drawBufferInfo(
      gl,
      this.treeInst.bufferInfo,
      gl.TRIANGLES,
      this.treeInst.bufferInfo.numElements,
      0,
      this.treeInst.count
    );

    const px = new Uint8Array(4);

    const ry = h - 1 - y;
    gl.readPixels(x, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);

    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const id = px[0] + px[1] * 256 + px[2] * 65536;

    const idx = id - 1;
    if (idx < 0 || idx >= this.trees.length) return -1;

    return idx;
  }

  _resizePickBuffer(w, h) {
    const gl = this.gl;

    if (this.pick.fb && this.pick.w === w && this.pick.h === h) return;

    if (this.pick.tex) gl.deleteTexture(this.pick.tex);
    if (this.pick.depth) gl.deleteRenderbuffer(this.pick.depth);
    if (this.pick.fb) gl.deleteFramebuffer(this.pick.fb);

    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error("Picking framebuffer incompleto:", status.toString(16));
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.pick.fb = fb;
    this.pick.tex = tex;
    this.pick.depth = depth;
    this.pick.w = w;
    this.pick.h = h;
  }

  // =======================================================
  // MODEL LOADING
  // =======================================================
  async loadModels() {
    await this._loadOne("tree", "obj/tree.obj");
    await this._loadOne("fish", "obj/fish.obj");

    console.log("TREE model:", this.models.tree);
    console.log("FISH model:", this.models.fish);

    this._seedTrees();
    this._seedFishes();

    this._rebuildTreeInstances();
    this._rebuildFishInstances();
  }

  async _loadOne(name, url) {
    const gl = this.gl;

    const txt = await loadText(url);
    let arrays = parseOBJ(txt);

    const pos = arrays.position.data;

    if (!arrays.normal?.data || arrays.normal.data.length !== pos.length) {
      arrays.normal = { numComponents: 3, data: generateNormalsForTriangles(pos) };
    }

    const ext = computeExtentsFromPositions(pos);
    this.models[name].extents = ext;

    const dx = ext.max[0] - ext.min[0];
    const dy = ext.max[1] - ext.min[1];
    const dz = ext.max[2] - ext.min[2];
    let axis = 0;
    if (dy > dx && dy > dz) axis = 1;
    else if (dz > dx && dz > dy) axis = 2;

    this.models[name].longAxis = axis;
    const maxDim =
      Math.max(ext.max[0] - ext.min[0], ext.max[1] - ext.min[1], ext.max[2] - ext.min[2]) || 1;

    this.models[name].arrays = arrays;
    this.models[name].scaleFix = 1 / maxDim;
    this.models[name].bufferInfo = this.twgl.createBufferInfoFromArrays(gl, arrays);

    console.log(
      `[${name}] loaded: verts=${pos.length / 3} scaleFix=${this.models[name].scaleFix}`
    );

    if (arrays.indices) {
      const wire = buildWireframeIndicesFromTriangles(arrays.indices);

      this.models[name].wireArrays = {
        position: arrays.position,
        normal: arrays.normal,
        indices: wire,
      };

      this.models[name].wireBufferInfo = this.twgl.createBufferInfoFromArrays(gl, this.models[name].wireArrays);
    } else {
      this.models[name].wireArrays = null;
      this.models[name].wireBufferInfo = null;
    }



    await this._loadMTLTexture(name, url);
  }

  // =======================================================
  // MATERIAL / TEXTURES (.mtl)
  // =======================================================
  async _loadMTLTexture(modelName, objUrl) {
    const gl = this.gl;

    const mtlUrl = objUrl.replace(".obj", ".mtl");

    try {
      const txt = await loadText(mtlUrl);

      const lines = txt.split(/\r?\n/);
      let textureFile = null;

      for (const line of lines) {
        const l = line.trim();
        if (l.startsWith("map_Kd")) {
          const parts = l.split(/\s+/);
          textureFile = parts[1];
          break;
        }
      }

      if (!textureFile) return;

      const basePath = objUrl.substring(0, objUrl.lastIndexOf("/") + 1);
      const texUrl = basePath + textureFile;

      this.textures[modelName] = this.twgl.createTexture(gl, {
        src: texUrl,
        flipY: true,
        min: gl.LINEAR_MIPMAP_LINEAR,
        mag: gl.LINEAR,
        wrap: gl.REPEAT,
        crossOrigin: "",
      });

    } catch (e) {
      console.warn("MTL não encontrado para", modelName);
    }
  }

  // =======================================================
  // SPAWN / WORLD POPULATION
  // =======================================================
  _seedTrees() {
    this.trees.length = 0;

    const want = this.data.treeCount | 0;
    let placed = 0;
    let attempts = 0;

    const maxAttempts = Math.max(5000, want * 400);

    while (placed < want && attempts < maxAttempts) {
      attempts++;

      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const z = 2 * v - 1;
      const r = Math.sqrt(Math.max(0, 1 - z*z));
      const up = [Math.cos(theta) * r, z, Math.sin(theta) * r];

      if (!isGreen((u, ...rest) => this.terrainRadiusAtUp(u), up, this.data)) continue;
      const h = this.terrainHeightAtUp(up);
      if (h < this.data.beach) continue;
      if (h > this.data.mountain) continue;

      const t = makeTreeInstance(this.displacedRadius, up, this.data);
      t._rPlaced = this.terrainRadiusAtUp(up);   // raio do terreno quando foi plantada
      this.trees.push(t);
      placed++;
    }

    console.log("trees placed:", this.trees.length, "attempts:", attempts);
  }

  _seedFishes() {
    this.fishes.length = 0;

    const want = this.data.fishCount | 0;
    let placed = 0;
    let attempts = 0;

    const minDot = this.data.fishMinDot ?? 0.985;

    const maxAttempts = Math.max(8000, want * 1200);

    while (placed < want && attempts < maxAttempts) {
      attempts++;

      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const z = 2 * v - 1;
      const rr = Math.sqrt(Math.max(0, 1 - z * z));
      const up = [Math.cos(theta) * rr, z, Math.sin(theta) * rr];

      if (!isWater(this.displacedRadius, up, this.data)) continue;

      let ok = true;
      for (let k = 0; k < this.fishes.length; k++) {
        const d = v3dot(this.fishes[k]._upNow || this.fishes[k].up, up);
        if (d > minDot) { ok = false; break; }
      }
      if (!ok) continue;

      const f = makeFishInstance(up, this.data);

      const rvec = v3norm([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1]);
      let vel = v3cross(rvec, up);
      vel = projectToTangent(vel, up);
      vel = v3norm(vel);

      f._upNow = v3norm(up);
      f._vel = vel;
      f._speed = this.data.fishSpeed;
      f._boostUntil = 0;

      this.fishes.push(f);
      placed++;
    }

    console.log("fishes placed:", this.fishes.length, "attempts:", attempts);
  }

  addTreeAtUp(upLocal) {
    const up = v3normalize(upLocal);

    if (!isGreen(this.displacedRadius, up, this.data)) return false;

    const t = makeTreeInstance(this.displacedRadius, up, this.data);
    t._rPlaced = this.terrainRadiusAtUp(up);
    this.trees.push(t);
    this._rebuildTreeInstances();
    return true;
  }

  // =======================================================
  // TERRAIN SAMPLING
  // =======================================================
  terrainRadiusAtUp(up) {
    let r = this.displacedRadius(
      up,
      this.data.radius,
      this.data.planetNoiseAmp,
      this.data.planetNoiseFreq,
      this.data.seed,
      this.data.octaves ?? 6
    );

    const h = r - this.data.radius;

    const band = (a, b, x) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };

    const tOcean = band(this.data.ocean - 0.5,    this.data.ocean + 0.5,    h);
    const tBeach = band(this.data.beach - 0.5,    this.data.beach + 0.5,    h);
    const tMount = band(this.data.mountain - 0.5, this.data.mountain + 0.5, h);

    const oceanDepth   = this.data.oceanDepth   ?? 0.0;
    const landLift     = this.data.landLift     ?? 0.0;
    const mountainLift = this.data.mountainLift ?? 0.0;
    const biomeBlend   = this.data.biomeBlend   ?? 0.0;

    let biomeLift = 0.0;
    biomeLift += (-oceanDepth)   * tOcean;
    biomeLift += ( landLift)     * tBeach;
    biomeLift += ( mountainLift) * tMount;

    r += biomeLift * biomeBlend;

    return r;
  }

  terrainHeightAtUp(up) {
    return this.terrainRadiusAtUp(up) - this.data.radius;
  }

  // =======================================================
  // TREE CULLING (RELIEF CHANGE)
  // =======================================================
  cullTreesThatWouldNeedDisplacement(eps = 0.05) {
    for (let i = this.trees.length - 1; i >= 0; i--) {
      const t = this.trees[i];
      const up = v3normalize(t.up);

      const rPlaced = t._rPlaced ?? this.terrainRadiusAtUp(up);
      const rNow = this.terrainRadiusAtUp(up);

      if (rNow > rPlaced + eps) {
        this.trees.splice(i, 1);
        continue;
      }

      // if (rNow < rPlaced - eps) this.trees.splice(i, 1);
    }

    this._rebuildTreeInstances();
  }

  // =======================================================
  // SIMULATION: FISH UPDATE
  // =======================================================
  update(dt, timeSec) {
    const mouse = this.mouseUpLocal;

    const heightAt = (up) => this.terrainHeightAtUp(up);

    const boundaryNormalTangent = (up, velTangent) => {
      const eps = 0.02;

      const v = v3norm(projectToTangent(velTangent, up));
      const perp = v3norm(v3cross(up, v));

      const upF = stepOnSphere(up, v, eps);
      const upB = stepOnSphere(up, v3mul(v, -1), eps);
      const upP = stepOnSphere(up, perp, eps);
      const upM = stepOnSphere(up, v3mul(perp, -1), eps);

      const hF = heightAt(upF);
      const hB = heightAt(upB);
      const hP = heightAt(upP);
      const hM = heightAt(upM);

      const dV = (hF - hB) / (2 * eps);
      const dP = (hP - hM) / (2 * eps);

      let g = v3add(v3mul(v, dV), v3mul(perp, dP));
      g = projectToTangent(g, up);

      if (v3len(g) < 1e-6) g = perp;
      return v3norm(g);
    };

    for (const f of this.fishes) {
      let up = v3norm(f._upNow || f.up);

      let vel = f._vel;

      if (this.control.enabled) {
        const idx = this.control.fishIndex | 0;
        const isControlled = (this.fishes[idx] === f);

        if (isControlled && this.mouseTargetUpLocal) {

          const targetUp = v3norm(this.mouseTargetUpLocal);

          let desired = projectToTangent(v3sub(targetUp, up), up);

          if (v3len(desired) > 1e-6) {
            desired = v3norm(desired);

            const turn = 1.0 - Math.pow(0.001, dt);
            vel = v3norm(v3add(v3mul(vel, 1.0 - turn), v3mul(desired, turn)));
            vel = v3norm(projectToTangent(vel, up));
          }

          const near = v3dot(up, targetUp) > 0.985;
          if (near) {
            f._boostUntil = timeSec + 0.3;
          }
        }
      }

      if (!vel) {
        const r = v3norm([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1]);
        vel = v3norm(projectToTangent(v3cross(r, up), up));
      } else {
        vel = v3norm(projectToTangent(vel, up));
      }

      if (mouse) {
        const d = v3dot(up, mouse);
        if (d > 0.97) {
          const away = projectToTangent(v3sub(up, mouse), up);
          const k = (d - 0.97) * 6.0;
          vel = v3norm(v3add(vel, v3mul(v3norm(away), k)));
        }
      }

      const baseSpeed = f._speed ?? this.data.fishSpeed;
      const boosting = timeSec < (f._boostUntil ?? 0);
      const mul = boosting ? (this.data.fishPanicMul ?? 2.0) : 1.0;

      let step = Math.max(0.000001, baseSpeed * dt);

      step *= mul;

      for (let iter = 0; iter < 4; iter++) {
        const upNext = stepOnSphere(up, vel, step);

        const terrainR = this.terrainRadiusAtUp(upNext);
        const waterR   = this.data.radius + this.data.waterOffset;

        const blocked = terrainR > (waterR - (this.data.fishClearance ?? 1.2));

        if (!blocked) {
          up = upNext;
          break;
        }

        const n = boundaryNormalTangent(up, vel);
        const nFix = v3dot(vel, n) > 0 ? v3mul(n, -1) : n;

        vel = reflect(vel, nFix);
        vel = v3norm(projectToTangent(vel, up));

        const bounce = (this.data.fishBounce ?? 1.0);
        vel = v3norm(v3mul(vel, bounce));

        step *= 0.45;
      }

      f._upNow = up;
      f._vel = vel;
    }

    this._rebuildFishInstances();
  }

  // =======================================================
  // INSTANCE BUILDERS
  // =======================================================
  _rebuildTreeInstances() {
    const gl = this.gl;
    const count = this.trees.length;
    this.treeInst.count = count;
    if (!count || !this.models.tree.arrays) return;

    const iWorld0 = new Float32Array(count * 4);
    const iWorld1 = new Float32Array(count * 4);
    const iWorld2 = new Float32Array(count * 4);
    const iWorld3 = new Float32Array(count * 4);

    const s = this.data.treeScale * this.models.tree.scaleFix * 0.01;

    for (let i = 0; i < count; i++) {
      const t = this.trees[i];
      const up = v3normalize(t.up);
      const { right, fwd } = basisFromUp(up);
      const lift = 0.15;
      const rPlaced = (t._rPlaced ?? this.terrainRadiusAtUp(up));
      const pos = v3scale(up, rPlaced + lift);

      const world = this.m4.identity();
      world[0] = right[0] * s; world[1] = right[1] * s; world[2]  = right[2] * s;
      world[4] = up[0] * s;    world[5] = up[1] * s;    world[6]  = up[2] * s;
      world[8] = fwd[0] * s;   world[9] = fwd[1] * s;   world[10] = fwd[2] * s;
      world[12] = pos[0];      world[13] = pos[1];      world[14] = pos[2]; world[15] = 1;

      const o = i * 4;
      iWorld0.set(world.slice(0, 4), o);
      iWorld1.set(world.slice(4, 8), o);
      iWorld2.set(world.slice(8, 12), o);
      iWorld3.set(world.slice(12, 16), o);
    }

    const instArrays = {
      iWorld0: { data: iWorld0, numComponents: 4, divisor: 1 },
      iWorld1: { data: iWorld1, numComponents: 4, divisor: 1 },
      iWorld2: { data: iWorld2, numComponents: 4, divisor: 1 },
      iWorld3: { data: iWorld3, numComponents: 4, divisor: 1 },
    };

    const combinedArrays = { ...this.models.tree.arrays, ...instArrays };
    this.treeInst.bufferInfo = this.twgl.createBufferInfoFromArrays(gl, combinedArrays);
    this.treeInst.vao = this.twgl.createVAOFromBufferInfo(gl, this.programObj, this.treeInst.bufferInfo);

    if (this.programShadow) {
      this.shadow.treeVao = this.twgl.createVAOFromBufferInfo(
        gl,
        this.programShadow,
        this.treeInst.bufferInfo
      );
    }

    this.treePickVao = this.twgl.createVAOFromBufferInfo(gl, this.programPick, this.treeInst.bufferInfo);
  }

  _rebuildFishInstances() {
    const gl = this.gl;
    const { m4 } = this;

    const count = this.fishes.length;
    this.fishInst.count = count;
    if (!count || !this.models.fish.arrays) return;

    const iWorld0 = new Float32Array(count * 4);
    const iWorld1 = new Float32Array(count * 4);
    const iWorld2 = new Float32Array(count * 4);
    const iWorld3 = new Float32Array(count * 4);

    for (let i = 0; i < count; i++) {
      const f = this.fishes[i];

      const upAxis = v3norm(f._upNow || f.up);

      let fwdAxis = f._vel ? projectToTangent(f._vel, upAxis) : null;
      if (!fwdAxis || v3len(fwdAxis) < 1e-6) {
        const tmp = basisFromUp(upAxis);
        fwdAxis = tmp.fwd;
      }
      fwdAxis = v3norm(fwdAxis);

      let rightAxis = v3cross(upAxis, fwdAxis);
      if (v3len(rightAxis) < 1e-6) {
        rightAxis = basisFromUp(upAxis).right;
      }
      rightAxis = v3norm(rightAxis);

      fwdAxis = v3norm(v3cross(rightAxis, upAxis));

      const s = this.data.fishScale * this.models.fish.scaleFix;

      const r = this.terrainRadiusAtUp(upAxis);
      const waterR = this.data.radius + this.data.waterOffset;
      const pos = v3scale(upAxis, Math.max(r, waterR) * 1.001);

      let world = m4.identity();
      world[0] = rightAxis[0] * s; world[1] = rightAxis[1] * s; world[2]  = rightAxis[2] * s;
      world[4] = upAxis[0] * s;    world[5] = upAxis[1] * s;    world[6]  = upAxis[2] * s;
      world[8] = fwdAxis[0] * s;   world[9] = fwdAxis[1] * s;   world[10] = fwdAxis[2] * s;
      world[12] = pos[0];          world[13] = pos[1];          world[14] = pos[2]; world[15] = 1;

      const fix = m4.multiply(
        m4.xRotation(-Math.PI * 0.5),
        m4.zRotation(Math.PI)
      );
      world = m4.multiply(world, fix);

      const o = i * 4;
      iWorld0.set(world.slice(0, 4), o);
      iWorld1.set(world.slice(4, 8), o);
      iWorld2.set(world.slice(8, 12), o);
      iWorld3.set(world.slice(12, 16), o);
    }

    const instArrays = {
      iWorld0: { data: iWorld0, numComponents: 4, divisor: 1 },
      iWorld1: { data: iWorld1, numComponents: 4, divisor: 1 },
      iWorld2: { data: iWorld2, numComponents: 4, divisor: 1 },
      iWorld3: { data: iWorld3, numComponents: 4, divisor: 1 },
    };

    const combinedArrays = { ...this.models.fish.arrays, ...instArrays };
    this.fishInst.bufferInfo = this.twgl.createBufferInfoFromArrays(gl, combinedArrays);
    this.fishInst.vao = this.twgl.createVAOFromBufferInfo(gl, this.programObj, this.fishInst.bufferInfo);
  }

  // =======================================================
  // TREE MANAGEMENT
  // =======================================================
  removeTreeByIndex(idx) {
    if (idx < 0 || idx >= this.trees.length) return false;
    this.trees.splice(idx, 1);
    this._rebuildTreeInstances();
    return true;
  }

  // =======================================================
  // RENDERING: SHADOW PASS
  // =======================================================
  drawShadow(programShadow, lightVP, worldMatrix) {
    const gl = this.gl;

    gl.useProgram(programShadow.program);

    if (this.shadow.treeVao && this.treeInst.count > 0) {
      gl.bindVertexArray(this.shadow.treeVao);

      this.twgl.setUniforms(programShadow, {
        u_lightVP: lightVP,
        u_world: worldMatrix,
      });

      this.twgl.drawBufferInfo(
        gl,
        this.treeInst.bufferInfo,
        gl.TRIANGLES,
        this.treeInst.bufferInfo.numElements,
        0,
        this.treeInst.count
      );
    }

    if (this.shadow.fishVao && this.fishInst.count > 0) {
      gl.bindVertexArray(this.shadow.fishVao);

      this.twgl.setUniforms(programShadow, {
        u_lightVP: lightVP,
        u_world: worldMatrix,
      });

      this.twgl.drawBufferInfo(
        gl,
        this.fishInst.bufferInfo,
        gl.TRIANGLES,
        this.fishInst.bufferInfo.numElements,
        0,
        this.fishInst.count
      );
    }

    gl.bindVertexArray(null);
  }

  // =======================================================
  // RENDERING: OBJECTS PASS
  // =======================================================
  drawObjects(viewProjection, worldMatrix, timeSec) {
    const gl = this.gl;

    gl.useProgram(this.programObj.program);

    const drawMode = this.data.debugWire ? gl.LINES : gl.TRIANGLES;

    if (this.treeInst.vao && this.treeInst.count > 0) {
      gl.bindVertexArray(this.treeInst.vao);

      this.twgl.setUniforms(this.programObj, {
        u_viewProjection: viewProjection,
        u_world: worldMatrix,
        u_useTexture: !!this.textures.tree,
        u_texture: this.textures.tree,
        u_lightDir: this.lightDir,

        u_time: timeSec,
        u_isFish: 0.0,
        u_swimAmp: 0.0,
        u_swimFreq: 0.0,
        u_swimSpeed: 0.0
      });

      const model = this.models.tree;
      const base = (this.data.debugWire && model.wireBufferInfo) ? model.wireBufferInfo : model.bufferInfo;

      this.twgl.drawBufferInfo(
        gl,
        this.treeInst.bufferInfo,
        drawMode,
        this.treeInst.bufferInfo.numElements,
        0,
        this.treeInst.count
      );
    }

    if (this.fishInst.vao && this.fishInst.count > 0) {
      gl.bindVertexArray(this.fishInst.vao);

      const fish = this.models.fish;
      const axis = fish.longAxis ?? 0;
      const ext = fish.extents;

      this.twgl.setUniforms(this.programObj, {
        u_viewProjection: viewProjection,
        u_world: worldMatrix,
        u_lightDir: this.lightDir,

        u_useTexture: !!this.textures.fish,
        u_texture: this.textures.fish,

        u_time: timeSec,
        u_isFish: 1.0,
        u_swimAmp: 0.12,
        u_swimFreq: 10.0,
        u_swimSpeed: 6.0,

        u_swimAxis: axis,
        u_swimMin: ext.min[axis],
        u_swimMax: ext.max[axis],
      });

      this.twgl.drawBufferInfo(
        gl,
        this.fishInst.bufferInfo,
        drawMode,
        this.fishInst.bufferInfo.numElements,
        0,
        this.fishInst.count
      );
    }

    gl.bindVertexArray(null);
  }
}
