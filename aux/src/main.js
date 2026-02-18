// src/main.js
"use strict";

// =========================================================
// IMPORTS / GLOBALS
// =========================================================
import { Renderer } from "./Renderer.js";
import {
  vsPlanet, fsPlanet,
  vsWater, fsWater,
  vsBg, fsBg,
  vsPollen, fsPollen,
  vsShadow, fsShadow,
} from "./shaders.js";
import { v3normalize } from "./Placement.js";
import { displacedRadius } from "./noise.js";

// TWGL + m4 via CDN (window.twgl / window.m4)
const twgl = window.twgl;
const m4 = window.m4;
const webglLessonsUI = window.webglLessonsUI;

// =========================================================
// PICKING / RAYCAST HELPERS
// =========================================================

// func para picktree
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

// =========================================================
// APP ENTRY
// =========================================================
function main() {
  // -------------------------
  // Boot / Context
  // -------------------------
  if (!twgl || !m4) {
    alert("twgl/m4 não carregaram. Confira os <script src=...> no HTML.");
    return;
  }

  //  Importante: com attribPrefix="a_", os arrays devem se chamar position/normal/texcoord
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
    waterNoiseFreq: 20.0,

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
    oceanDepth: 2.5,     // quanto “afunda” o oceano
    landLift: 0.0,       // se quiser a terra um pouco acima do base
    mountainLift: 6.0,   // altura dos picos
    biomeBlend: 0.8,

  };

  // -------------------------
  // UI
  // -------------------------
  if (webglLessonsUI) {
    webglLessonsUI.setupUI(document.querySelector("#ui"), data, [
    { type: "slider", key: "cameraZoom", min: 1.5, max: 8, step: 0.1, precision: 1 },

    { type: "slider", key: "planetNoiseAmp", min: 0, max: 40, step: 0.5, precision: 1 },
    { type: "slider", key: "planetNoiseFreq", min: 0.1, max: 12, step: 0.1, precision: 1 },
    { type: "slider", key: "seed", min: 0, max: 50, step: 0.1, precision: 1 },
    { type: "slider", key: "octaves", min: 1, max: 10, step: 1 },

    { type: "slider", key: "ocean", min: -20, max: 10, step: 0.5, precision: 1 },
    { type: "slider", key: "beach", min: -10, max: 20, step: 0.5, precision: 1 },
    { type: "slider", key: "mountain", min: 0, max: 30, step: 0.5, precision: 1 },
    { type: "slider", key: "snow", min: 0, max: 50, step: 0.5, precision: 1 },

    // água: manter apenas offset (removidos waveAmp/waveSpeed/waterNoiseAmp/waterNoiseFreq)
    { type: "slider", key: "waterOffset", min: 0.0, max: 10.0, step: 0.1, precision: 1 },

    // luz
    { type: "slider", key: "lightX", min: -1.0, max: 1.0, step: 0.01, precision: 2 },
    { type: "slider", key: "lightY", min: -1.0, max: 1.0, step: 0.01, precision: 2 },
    { type: "slider", key: "fishScale", min: 0.1, max: 5.0, step: 0.05, precision: 2 },
    { type: "slider", key: "subdivisionsAxis", min: 8, max: 360, step: 1 },
    { type: "slider", key: "subdivisionsHeight", min: 4, max: 240, step: 1 },

    { type: "checkbox", key: "triangles" },
    ]);
  }

  // =========================================================
  // ASSETS / TEXTURES
  // =========================================================

  //criando texturas
  const texGrass = twgl.createTexture(gl, {
    src: "texture/grass_detail.jpg",
    min: gl.LINEAR_MIPMAP_LINEAR,
    mag: gl.LINEAR,
    wrap: gl.REPEAT,
  });

  const texRock = twgl.createTexture(gl, {
    src: "texture/rock_detail.jpg",
    min: gl.LINEAR_MIPMAP_LINEAR,
    mag: gl.LINEAR,
    wrap: gl.REPEAT,
  });

  // =========================================================
  // PROGRAMS / SHADERS
  // =========================================================

  // Programs planeta/água
  const programPlanet = twgl.createProgramInfo(gl, [vsPlanet, fsPlanet]);
  const programWater = twgl.createProgramInfo(gl, [vsWater, fsWater]);
  const programBg = twgl.createProgramInfo(gl, [vsBg, fsBg]);
  const programPollen = twgl.createProgramInfo(gl, [vsPollen, fsPollen]);
  const programShadow = twgl.createProgramInfo(gl, [vsShadow, fsShadow]);

  // =========================================================
  // SHADOW MAP SETUP
  // =========================================================

  // Iluminação complexa
  const SHADOW_SIZE = 2048;

  const shadowDepthTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, shadowDepthTexture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.DEPTH_COMPONENT24,
    SHADOW_SIZE,
    SHADOW_SIZE,
    0,
    gl.DEPTH_COMPONENT,
    gl.UNSIGNED_INT,
    null
  );

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const shadowFramebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFramebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.DEPTH_ATTACHMENT,
    gl.TEXTURE_2D,
    shadowDepthTexture,
    0
  );

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // =========================================================
  // GEOMETRY: SPHERE (SHARED)
  // =========================================================
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

  let lastSphereKey = `${data.subdivisionsAxis}|${data.subdivisionsHeight}`;

  // =========================================================
  // PARTICLES: POLLEN
  // =========================================================

  // quantidade de partículas
  const POLLEN_COUNT = 1200;

  // atributos: up (vec3), phase (float), speed (float), size (float)
  const pollenUp = new Float32Array(POLLEN_COUNT * 3);
  const pollenPhase = new Float32Array(POLLEN_COUNT);
  const pollenSpeed = new Float32Array(POLLEN_COUNT);
  const pollenSize = new Float32Array(POLLEN_COUNT);

  // amostra direções uniformes na esfera (fibonacci)
  function fibDir(i, n) {
    const phi = Math.PI * (3 - Math.sqrt(5));
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const t = phi * i;
    return [Math.cos(t) * r, y, Math.sin(t) * r];
  }

  for (let i = 0; i < POLLEN_COUNT; i++) {
    const up = fibDir(i + 1, POLLEN_COUNT + 2);

    pollenUp[i * 3 + 0] = up[0];
    pollenUp[i * 3 + 1] = up[1];
    pollenUp[i * 3 + 2] = up[2];

    pollenPhase[i] = Math.random();                  // 0..1
    pollenSpeed[i] = 0.08 + Math.random() * 0.18;    // velocidade do ciclo
    pollenSize[i] = 1.5 + Math.random() * 2.2;       // px
  }

  const pollenBufferInfo = twgl.createBufferInfoFromArrays(gl, {
    up: { numComponents: 3, data: pollenUp },
    phase: { numComponents: 1, data: pollenPhase },
    speed: { numComponents: 1, data: pollenSpeed },
    size: { numComponents: 1, data: pollenSize },
  });

  // VAO
  const pollenVao = twgl.createVAOFromBufferInfo(gl, programPollen, pollenBufferInfo);

  // =========================================================
  // OBJ RENDERER (TREES / FISHES)
  // =========================================================
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
    treeScale: data.treeScale,
    fishCount: data.fishCount,
    oceanDepth: data.oceanDepth,
    landLift: data.landLift,
    mountainLift: data.mountainLift,
    biomeBlend: data.biomeBlend,
  });

  renderer.loadModels().catch(console.error);
  renderer.programShadow = programShadow;

  // =========================================================
  // INPUT / ROTATION CONTROL
  // =========================================================
  let autoRotationY = 0;
  let mouseRotationMatrix = m4.identity();
  let pauseRotation = false;

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

  // =========================================================
  // LISTENERS
  // =========================================================

  // para modo jogo
  let followFish = false;
  let followFishIndex = 0;

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();

      const zoomSpeed = 0.0015; // sensibilidade (ajuste aqui)

      // deltaY > 0 = scroll pra baixo (zoom out)
      data.cameraZoom += e.deltaY * zoomSpeed;

      // limites seguros
      data.cameraZoom = Math.max(1.2, Math.min(12.0, data.cameraZoom));
    },
    { passive: false }
  );

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

  // modo jogo
  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;

    if (e.code === "Digit7") {
      followFish = !followFish;

      if (followFish) {
        followFishIndex = 0;

        renderer.setFollowFishEnabled(true);
        renderer.setControlledFishIndex(followFishIndex);

        // limpa alvo antigo
        renderer.setMouseTargetUpLocal(null);

        // pausa rotação do planeta
        pauseRotation = true;
      } else {
        renderer.setFollowFishEnabled(false);

        // limpa alvo do mouse
        renderer.setMouseTargetUpLocal(null);
        renderer.setMouseUpLocal(null);
        pauseRotation = false;
      }
    }
  });

  // =========================================================
  // PICK STATE (MATRICES)
  // =========================================================
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
      if (followFish) renderer.setMouseTargetUpLocal(null);
      else renderer.setMouseUpLocal(null);
      return;
    }

    const invWorld = m4.inverse(worldMatrix);
    const localHit = m4.transformPoint(invWorld, hit);
    const upLocal = v3normalize(localHit);

    if (followFish) renderer.setMouseTargetUpLocal(upLocal);
    else renderer.setMouseUpLocal(upLocal);
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

  // =========================================================
  // RELIEF CHANGE TRACKING
  // =========================================================
  let lastReliefKey = "";

  function reliefKey(d) {
    return [
      d.radius, d.planetNoiseAmp, d.planetNoiseFreq, d.seed, d.octaves,
      d.oceanDepth, d.landLift, d.mountainLift, d.biomeBlend,
      d.ocean, d.beach, d.mountain
    ].join("|");
  }

  // =========================================================
  // RENDER LOOP
  // =========================================================
  gl.enable(gl.DEPTH_TEST);

  let lastTime = 0;

  function renderFrame(timeMs) {
    const t = timeMs * 0.001;
    const dt = t - lastTime;
    lastTime = t;

    const sphereKey = `${data.subdivisionsAxis}|${data.subdivisionsHeight}`;
    if (sphereKey !== lastSphereKey) {
      lastSphereKey = sphereKey;
      rebuildSphere();
    }
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
      treeScale: data.treeScale,
      fishSpeed: data.fishSpeed,
      debugWire: !data.triangles,
    });

    const k = reliefKey(data);
    if (k !== lastReliefKey) {
      lastReliefKey = k;
      renderer.cullTreesThatWouldNeedDisplacement(0.1);
    }

    if (!pauseRotation) autoRotationY = t * 0.25;

    twgl.resizeCanvasToDisplaySize(gl.canvas, window.devicePixelRatio);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // -------------------------------------------------------
    // PASS 0: BACKGROUND (estrelas)
    // -------------------------------------------------------
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);

    gl.useProgram(programBg.program);
    gl.bindVertexArray(null); // full-screen triangle sem VAO

    // Light setup
    const lx = data.lightX;
    const ly = data.lightY;
    const lz = 0.35;
    let lightDir = [lx, ly, lz];
    {
      const L = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
      lightDir = [lightDir[0] / L, lightDir[1] / L, lightDir[2] / L];
    }
    renderer.lightDir = lightDir;

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

    // -------------------------------------------------------
    // PASS SETUP: STATES + MATRICES
    // -------------------------------------------------------
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // --- MATRIZES ---
    const fov = Math.PI * 0.25;
    const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;

    // near menor ajuda no zoom (se precisar)
    projection = m4.perspective(fov, aspect, 0.2, 5000);

    const autoMatrix = m4.yRotation(autoRotationY);
    worldMatrix = m4.multiply(mouseRotationMatrix, autoMatrix);

    // mudança para modo jogo
    let cameraPosition, target, up;

    if (!followFish) {
      const distance = data.radius * data.cameraZoom;
      cameraPosition = [0, 0, distance];
      target = [0, 0, 0];
      up = [0, 1, 0];
    } else {
      const pose = renderer.getControlledFishLocalPose();

      if (!pose) {
        const distance = data.radius * data.cameraZoom;
        cameraPosition = [0, 0, distance];
        target = [0, 0, 0];
        up = [0, 1, 0];
      } else {
        // worldMatrix precisa existir antes
        const fishWorldPos = m4.transformPoint(worldMatrix, pose.posLocal);

        // vel world
        const velEnd = m4.transformPoint(worldMatrix, [
          pose.posLocal[0] + pose.velLocal[0],
          pose.posLocal[1] + pose.velLocal[1],
          pose.posLocal[2] + pose.velLocal[2],
        ]);
        let fishWorldVel = [
          velEnd[0] - fishWorldPos[0],
          velEnd[1] - fishWorldPos[1],
          velEnd[2] - fishWorldPos[2],
        ];
        const vL = Math.hypot(fishWorldVel[0], fishWorldVel[1], fishWorldVel[2]) || 1;
        fishWorldVel = [fishWorldVel[0] / vL, fishWorldVel[1] / vL, fishWorldVel[2] / vL];

        // up world
        const upEnd = m4.transformPoint(worldMatrix, [
          pose.posLocal[0] + pose.up[0],
          pose.posLocal[1] + pose.up[1],
          pose.posLocal[2] + pose.up[2],
        ]);
        let fishWorldUp = [
          upEnd[0] - fishWorldPos[0],
          upEnd[1] - fishWorldPos[1],
          upEnd[2] - fishWorldPos[2],
        ];
        const uL = Math.hypot(fishWorldUp[0], fishWorldUp[1], fishWorldUp[2]) || 1;
        fishWorldUp = [fishWorldUp[0] / uL, fishWorldUp[1] / uL, fishWorldUp[2] / uL];

        const behind = 10.0;
        const above = data.radius * 0.15;

        cameraPosition = [
          fishWorldPos[0] - fishWorldVel[0] * behind + fishWorldUp[0] * above,
          fishWorldPos[1] - fishWorldVel[1] * behind + fishWorldUp[1] * above,
          fishWorldPos[2] - fishWorldVel[2] * behind + fishWorldUp[2] * above,
        ];
        target = fishWorldPos;
        up = fishWorldUp;
      }
    }

    const cameraMatrix = m4.lookAt(cameraPosition, target, up);
    viewMatrix = m4.inverse(cameraMatrix);
    viewProjection = m4.multiply(projection, viewMatrix);
    viewMatrix = m4.inverse(cameraMatrix);
    viewProjection = m4.multiply(projection, viewMatrix);

    // -------------------------------------------------------
    // PASS: SHADOW MAP
    // -------------------------------------------------------
    // Iluminação shadow
    const lightPos = [
      lightDir[0] * data.radius * 6,
      lightDir[1] * data.radius * 6,
      lightDir[2] * data.radius * 6
    ];

    const lightTarget = [0, 0, 0];
    const lightUp = [0, 1, 0];

    const lightView = m4.inverse(m4.lookAt(lightPos, lightTarget, lightUp));
    const lightProj = m4.orthographic(
      -data.radius * 3,
      data.radius * 3,
      -data.radius * 3,
      data.radius * 3,
      1,
      data.radius * 10
    );

    const lightVP = m4.multiply(lightProj, lightView);

    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFramebuffer);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    // depth-only (forte recomendado)
    gl.colorMask(false, false, false, false);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);

    gl.useProgram(programShadow.program);

    // SÓ OBJETOS no shadow map:
    renderer.drawShadow(programShadow, lightVP, worldMatrix);

    // restaura
    gl.colorMask(true, true, true, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // restaura
    gl.cullFace(gl.BACK);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // -------------------------------------------------------
    // PASS 1: PLANETA (OPACO)
    // -------------------------------------------------------
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
      u_texGrass: texGrass,
      u_texRock: texRock,
      u_texScale: 0.3,

      u_lightDir: lightDir,
      u_cameraPos: cameraPosition,
      u_ambient: 0.03,   // baixo para “lado escuro quase preto”
      u_diffuse: 1.1,
      u_shadowMap: shadowDepthTexture,
      u_lightVP: lightVP,
    });

    twgl.drawBufferInfo(gl, sphereBufferInfo, data.triangles ? gl.TRIANGLES : gl.LINES);

    // -------------------------------------------------------
    // PASS 2: OBJETOS (OPACOS) — ANTES DA ÁGUA
    // -------------------------------------------------------
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    renderer.update(dt, t);
    renderer.drawObjects(viewProjection, worldMatrix, {
      u_lightDir: lightDir,
    });

    // -------------------------------------------------------
    // PASS 3: ÁGUA (TRANSPARENTE) — POR ÚLTIMO
    // -------------------------------------------------------
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    //  água NÃO escreve depth, senão “some” peixe/árvore atrás dela
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

    // -------------------------------------------------------
    // PASS 4: POLLEN (PARTICLES)
    // -------------------------------------------------------
    gl.enable(gl.BLEND);

    // opcional: dá pra deixar um brilho mais "mágico"
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    gl.enable(gl.DEPTH_TEST);
    // não escreve no depth pra não “sumir” atrás de si mesmo
    gl.depthMask(false);

    gl.useProgram(programPollen.program);
    gl.bindVertexArray(pollenVao);

    twgl.setUniforms(programPollen, {
      u_viewProjection: viewProjection,
      u_world: worldMatrix,
      u_time: t,
      u_baseRadius: data.radius,
      u_waterOffset: data.waterOffset,
    });

    gl.drawArrays(gl.POINTS, 0, POLLEN_COUNT);

    // restaura
    gl.depthMask(true);
    gl.disable(gl.BLEND);

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
