// src/main.js
"use strict";

import { Renderer } from "./Renderer.js";
import { vsPlanet, fsPlanet, vsWater, fsWater, vsBg, fsBg } from "./shaders.js";
import { v3normalize } from "./Placement.js";
import { displacedRadius } from "./noise.js";

// TWGL + m4 via CDN (window.twgl / window.m4)
const twgl = window.twgl;
const m4 = window.m4;
const webglLessonsUI = window.webglLessonsUI;

function getPickRay(canvas, projection, viewMatrix, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;

  const nx = (x / rect.width) * 2 - 1;
  const ny = (1 - y / rect.height) * 2 - 1;

  const invVP = m4.inverse(m4.multiply(projection, viewMatrix));

  // clip space z=-1 (near) e z=+1 (far)
  const p0 = m4.transformPoint(invVP, [nx, ny, -1]);
  const p1 = m4.transformPoint(invVP, [nx, ny, 1]);

  const dir = v3normalize([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]);
  return { origin: p0, dir };
}

function raySphere(origin, dir, radius) {
  const ox = origin[0],
    oy = origin[1],
    oz = origin[2];
  const dx = dir[0],
    dy = dir[1],
    dz = dir[2];

  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (ox * dx + oy * dy + oz * dz);
  const c = ox * ox + oy * oy + oz * oz - radius * radius;

  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;

  const s = Math.sqrt(disc);
  const t0 = (-b - s) / (2 * a);
  const t1 = (-b + s) / (2 * a);
  const t = t0 > 0 ? t0 : t1 > 0 ? t1 : null;
  if (t == null) return null;

  return [ox + dx * t, oy + dy * t, oz + dz * t];
}


function main() {
  if (!twgl || !m4) {
    alert("twgl/m4 não carregaram. Confira os <script src=...> no HTML.");
    return;
  }

  // ✅ Importante: com attribPrefix="a_", os arrays devem se chamar position/normal/texcoord
  twgl.setDefaults({ attribPrefix: "a_" });

  const canvas = document.querySelector("canvas");
  const gl = canvas.getContext("webgl2", { antialias: true });
  if (!gl) {
    alert("WebGL2 não disponível.");
    return;
  }

  // -------------------------
  // Data/UI (ajuste livre)
  // -------------------------
  const data = {
    // planeta
    radius: 42,
    planetNoiseAmp: 12,
    planetNoiseFreq: 3.5,
    seed: 5.0,
    octaves: 6,

    // biomas (altura = (raioAtual - radius))
    ocean: 0.5,
    beach: 1,
    mountain: 8,
    snow: 14,

    // esfera
    subdivisionsAxis: 160,
    subdivisionsHeight: 80,

    // camera
    cameraZoom: 3.8,

    // água
    waterOffset: 2.2,
    waterAlpha: 0.35,
    fresnelPow: 3.5,
    specPow: 80,
    specStrength: 0.9,
    deepness: 0.65,

    // ondas
    waveAmp: 0.45,
    waveLen: 0.55,
    waveSpeed: 0.8,

    // ruído água
    waterNoiseAmp: 0.35,
    waterNoiseFreq: 10.0,

    // debug
    triangles: true,

    // objetos (valores iniciais; o Renderer tem os dele também)
    treeCount: 100,
    fishCount: 80,
    treeScale: 1000,
    fishScale: 1.2,
    fishSpeed: 0.06,

    lightX: 0.3,
    lightY: 0.8,
  };

  if (webglLessonsUI) {
    webglLessonsUI.setupUI(document.querySelector("#ui"), data, [
      { type: "slider", key: "cameraZoom", min: 1.5, max: 8, step: 0.1, precision: 1 },
      { type: "slider", key: "radius", min: 20, max: 200, step: 1, change: rebuildSphere },
      { type: "slider", key: "planetNoiseAmp", min: 0, max: 40, step: 0.5, precision: 1 },
      { type: "slider", key: "planetNoiseFreq", min: 0.1, max: 12, step: 0.1, precision: 1 },
      { type: "slider", key: "seed", min: 0, max: 50, step: 0.1, precision: 1 },
      { type: "slider", key: "octaves", min: 1, max: 10, step: 1 },

      { type: "slider", key: "ocean", min: -20, max: 10, step: 0.5, precision: 1 },
      { type: "slider", key: "beach", min: -10, max: 20, step: 0.5, precision: 1 },
      { type: "slider", key: "mountain", min: 0, max: 30, step: 0.5, precision: 1 },
      { type: "slider", key: "snow", min: 0, max: 50, step: 0.5, precision: 1 },

      { type: "slider", key: "waterOffset", min: 0.0, max: 10.0, step: 0.1, precision: 1 },
      { type: "slider", key: "waterAlpha", min: 0.05, max: 0.85, step: 0.01, precision: 2 },
      { type: "slider", key: "waveAmp", min: 0.0, max: 4.0, step: 0.05, precision: 2 },
      { type: "slider", key: "waveSpeed", min: 0.0, max: 5.0, step: 0.05, precision: 2 },
      { type: "slider", key: "waterNoiseAmp", min: 0.0, max: 2.0, step: 0.02, precision: 2 },
      { type: "slider", key: "waterNoiseFreq", min: 0.1, max: 30.0, step: 0.1, precision: 1 },
      

      { type: "checkbox", key: "triangles" },
    ]);
  }

  // -------------------------
  // Programs planeta/água
  // -------------------------
  const programPlanet = twgl.createProgramInfo(gl, [vsPlanet, fsPlanet]);
  const programWater = twgl.createProgramInfo(gl, [vsWater, fsWater]);
  const programBg = twgl.createProgramInfo(gl, [vsBg, fsBg]);


  // -------------------------
  // Esfera (shared)
  // -------------------------
  let sphereBufferInfo = null;
  let sphereVaoPlanet = null;
  let sphereVaoWater = null;

  function rebuildSphere() {
    const sphere = twgl.primitives.createSphereVertices(
      1.0,
      data.subdivisionsAxis | 0,
      data.subdivisionsHeight | 0
    );
    sphereBufferInfo = twgl.createBufferInfoFromArrays(gl, sphere);
    sphereVaoPlanet = twgl.createVAOFromBufferInfo(gl, programPlanet, sphereBufferInfo);
    sphereVaoWater = twgl.createVAOFromBufferInfo(gl, programWater, sphereBufferInfo);
  }

  rebuildSphere();

  // -------------------------
  // Renderer de OBJ (árvores/peixes) - mantém o seu
  // -------------------------
  const renderer = new Renderer(canvas, { twgl, m4, displacedRadius });
  Object.assign(renderer.data, {
    radius: data.radius,
    planetNoiseAmp: data.planetNoiseAmp,
    planetNoiseFreq: data.planetNoiseFreq,
    seed: data.seed,
    octaves: data.octaves,
    ocean: data.ocean,
    beach: data.beach,
    mountain: data.mountain,
    waterOffset: data.waterOffset,
    treeScale: data.treeScale,
    fishScale: data.fishScale,
    fishSpeed: data.fishSpeed,
    treeCount: data.treeCount,
    fishCount: data.fishCount,
  });

  renderer.loadModels().catch(console.error);


  // -------------------------
  // Controle de rotação
  // -------------------------
  let autoRotationY = 0;
  let mouseRotationMatrix = m4.identity();
  let pauseRotation = false;
  let firstclick =false;

  let lastPos = null;
  let moving = false;

  function getRelativeMousePosition(e) {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    return [
      (x - canvas.width / 2) / window.devicePixelRatio,
      (y - canvas.height / 2) / window.devicePixelRatio,
    ];
  }

  canvas.addEventListener("wheel", (e) => {
  e.preventDefault();

  const zoomSpeed = 0.0015; // sensibilidade (ajuste aqui)

  // deltaY > 0 = scroll pra baixo (zoom out)
  data.cameraZoom += e.deltaY * zoomSpeed;

  // limites seguros
  data.cameraZoom = Math.max(1.2, Math.min(12.0, data.cameraZoom));
}, { passive: false });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("mousedown", (e) => {
  // Verifica se é o botão direito (button 2)
  if (e.button === 2) {
    e.preventDefault(); // Evita comportamentos estranhos
    pauseRotation = !pauseRotation; // Se estava true vira false, se false vira true
    
    // Opcional: Log para você testar no console
    console.log("Rotação pausada:", pauseRotation);
  }
});

  canvas.addEventListener("mousedown", (e) => {
    e.preventDefault();
    lastPos = getRelativeMousePosition(e);
    moving = true;
  });
  window.addEventListener("mouseup", () => (moving = false));
  window.addEventListener("mousemove", (e) => {
    if (!moving) return;
    const pos = getRelativeMousePosition(e);
    const size = [4 / canvas.width, 4 / canvas.height];
    const dx = (lastPos[0] - pos[0]) * size[0];
    const dy = (lastPos[1] - pos[1]) * size[1];

    let inc = m4.xRotation(dy * 5);
    inc = m4.multiply(inc, m4.yRotation(dx * 5));
    mouseRotationMatrix = m4.multiply(inc, mouseRotationMatrix);
    lastPos = pos;
  });

  // -------------------------
  // Matrices “atuais” (para pick no mouse)
  // -------------------------
  let projection = m4.identity();
  let viewMatrix = m4.identity();
  let worldMatrix = m4.identity();
  let viewProjection = m4.identity();

  // mouse move: atualiza direção upLocal para repelir peixes
  canvas.addEventListener("mousemove", (e) => {
    if (!projection || !viewMatrix || !worldMatrix) return;

    const ray = getPickRay(canvas, projection, viewMatrix, e.clientX, e.clientY);
    const hit = raySphere(ray.origin, ray.dir, data.radius);
    if (!hit) {
      renderer.setMouseUpLocal(null);
      return;
    }

    const invWorld = m4.inverse(worldMatrix);
    const localHit = m4.transformPoint(invWorld, hit);
    const upLocal = v3normalize(localHit);

    renderer.setMouseUpLocal(upLocal);
  });

canvas.addEventListener("click", (e) => {
  if (!projection || !viewMatrix || !worldMatrix) return;

  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) * (gl.canvas.width / rect.width));
  const y = Math.floor((e.clientY - rect.top) * (gl.canvas.height / rect.height));

  // SHIFT + click = remover árvore clicada
  if (e.shiftKey) {
    const idx = renderer.pickTreeAtPixel(x, y, viewProjection, worldMatrix);
    if (idx >= 0) {
      renderer.removeTreeByIndex(idx);
    }
    return;
  }

  // click normal = adicionar árvore no verde (continua igual)
  const ray = getPickRay(canvas, projection, viewMatrix, e.clientX, e.clientY);
  const hit = raySphere(ray.origin, ray.dir, data.radius);
  if (!hit) return;

  const invWorld = m4.inverse(worldMatrix);
  const localHit = m4.transformPoint(invWorld, hit);
  const upLocal = v3normalize(localHit);

  renderer.addTreeAtUp(upLocal);
});


  // -------------------------
  // Render loop
  // -------------------------
  gl.enable(gl.DEPTH_TEST);

  let lastTime = 0;

  function renderFrame(timeMs) {
  const t = timeMs * 0.001;
  const dt = t - lastTime;
  lastTime = t;

  // mantém renderer sincronizado com UI
  Object.assign(renderer.data, {
    radius: data.radius,
    planetNoiseAmp: data.planetNoiseAmp,
    planetNoiseFreq: data.planetNoiseFreq,
    seed: data.seed,
    octaves: data.octaves,

    ocean: data.ocean,
    beach: data.beach,
    mountain: data.mountain,

    waterOffset: data.waterOffset,

    treeCount: data.treeCount,
    fishCount: data.fishCount,
    treeScale: data.treeScale,
    fishScale: data.fishScale,
    fishSpeed: data.fishSpeed,
    debugWire: !data.triangles,
  });

  if (!pauseRotation) autoRotationY = t * 0.25;

  twgl.resizeCanvasToDisplaySize(gl.canvas, window.devicePixelRatio);
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // 0) BACKGROUND (estrelas)
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);

    gl.useProgram(programBg.program);
    gl.bindVertexArray(null); // full-screen triangle sem VAO

    twgl.setUniforms(programBg, {
      u_resolution: [gl.canvas.width, gl.canvas.height],
      u_time: t,
      u_center: [0.5, 0.5],          // planeta está no centro
      u_clearRadius: 0.55,           // ajuste: 0.45~0.70
      u_clearStrength: 1.0,          // 0.6~1.4
      u_starDensity: 0.08,           // 0.05~0.12
    });

    // draw full-screen triangle
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // restaura pro resto da cena
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);


  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LESS);
  gl.depthMask(true);
  gl.disable(gl.BLEND);

  // --- MATRIZES ---
  const fov = Math.PI * 0.25;
  const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;

  // near menor ajuda no zoom (se precisar)
  projection = m4.perspective(fov, aspect, 0.2, 5000);

  const distance = data.radius * data.cameraZoom;
  const cameraPosition = [0, 0, distance];
  const target = [0, 0, 0];
  const up = [0, 1, 0];
  const cameraMatrix = m4.lookAt(cameraPosition, target, up);
  viewMatrix = m4.inverse(cameraMatrix);
  viewProjection = m4.multiply(projection, viewMatrix);

  const autoMatrix = m4.yRotation(autoRotationY);
  worldMatrix = m4.multiply(mouseRotationMatrix, autoMatrix);

  // 1) PLANETA (OPACO)
  gl.useProgram(programPlanet.program);
  gl.bindVertexArray(sphereVaoPlanet);

  twgl.setUniforms(programPlanet, {
    u_viewProjection: viewProjection,
    u_world: worldMatrix,

    u_baseRadius: data.radius,
    u_noiseAmp: data.planetNoiseAmp,
    u_noiseFreq: data.planetNoiseFreq,
    u_seed: data.seed,
    u_octaves: data.octaves,

    u_ocean: data.ocean,
    u_beach: data.beach,
    u_mountain: data.mountain,
    u_snow: data.snow,
  });

  twgl.drawBufferInfo(gl, sphereBufferInfo, data.triangles ? gl.TRIANGLES : gl.LINES);

  // 2) OBJETOS (OPACOS) — ANTES DA ÁGUA
  gl.disable(gl.BLEND);
  gl.depthMask(true);
  renderer.update(dt, t);
  renderer.drawObjects(viewProjection, worldMatrix);

  // 3) ÁGUA (TRANSPARENTE) — POR ÚLTIMO
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // ✅ água NÃO escreve depth, senão “some” peixe/árvore atrás dela
  gl.depthMask(false);
  gl.depthFunc(gl.LEQUAL);

  gl.useProgram(programWater.program);
  gl.bindVertexArray(sphereVaoWater);

  twgl.setUniforms(programWater, {
    u_viewProjection: viewProjection,
    u_world: worldMatrix,

    u_baseRadius: data.radius,
    u_waterOffset: data.waterOffset,
    u_time: t,

    u_waveAmp: data.waveAmp,
    u_waveLen: data.waveLen,
    u_waveSpeed: data.waveSpeed,

    u_noiseAmp: data.waterNoiseAmp,
    u_noiseFreq: data.waterNoiseFreq,
    u_seed: data.seed,
    u_octaves: Math.max(1, Math.min(10, data.octaves)),

    u_cameraPos: cameraPosition,
    u_alpha: data.waterAlpha,
    u_fresnelPow: data.fresnelPow,
    u_specPow: data.specPow,
    u_specStrength: data.specStrength,
    u_deepness: data.deepness,
  });

  twgl.drawBufferInfo(gl, sphereBufferInfo, gl.TRIANGLES);

  // --- restaura estados (boa prática) ---
  gl.depthMask(true);
  gl.depthFunc(gl.LESS);
  gl.disable(gl.BLEND);
  gl.bindVertexArray(null);

  requestAnimationFrame(renderFrame);
}


  requestAnimationFrame(renderFrame);
}

main();
