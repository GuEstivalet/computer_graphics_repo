// ==========================
// PLANETA
// ==========================

export const vsPlanet = `#version 300 es
precision highp float;

in vec4 a_position;
in vec3 a_normal;

uniform mat4 u_viewProjection;
uniform mat4 u_world;

uniform float u_baseRadius;
uniform float u_noiseAmp;
uniform float u_noiseFreq;
uniform float u_seed;
uniform int   u_octaves;

out vec3 v_worldPos;
out vec3 v_worldNormal;
out float v_height;

// ---------- Noise ----------

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);

  float n000 = hash31(i + vec3(0,0,0));
  float n100 = hash31(i + vec3(1,0,0));
  float n010 = hash31(i + vec3(0,1,0));
  float n110 = hash31(i + vec3(1,1,0));
  float n001 = hash31(i + vec3(0,0,1));
  float n101 = hash31(i + vec3(1,0,1));
  float n011 = hash31(i + vec3(0,1,1));
  float n111 = hash31(i + vec3(1,1,1));

  float nx00 = mix(n000, n100, u.x);
  float nx10 = mix(n010, n110, u.x);
  float nx01 = mix(n001, n101, u.x);
  float nx11 = mix(n011, n111, u.x);

  float nxy0 = mix(nx00, nx10, u.y);
  float nxy1 = mix(nx01, nx11, u.y);

  return mix(nxy0, nxy1, u.z);
}

float fbm(vec3 p, float seed, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  vec3 off = vec3(seed, seed*1.37, seed*2.11);

  for(int i=0;i<12;i++){
    if(i>=octaves) break;
    sum += (valueNoise(p*freq + off)*2.0 - 1.0) * amp;
    freq *= 2.0;
    amp  *= 0.5;
  }
  return sum;
}

void main() {
  vec3 nLocal = normalize(a_normal);
  float n = fbm(nLocal * u_noiseFreq, u_seed, u_octaves);

  float radius = u_baseRadius + n * u_noiseAmp;
  vec3 posLocal = nLocal * radius;

  vec4 worldPos4 = u_world * vec4(posLocal,1.0);
  v_worldPos = worldPos4.xyz;
  v_worldNormal = normalize(mat3(u_world)*nLocal);
  v_height = radius;

  gl_Position = u_viewProjection * worldPos4;
}
`;

export const fsPlanet = `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_worldNormal;
in float v_height;

uniform float u_baseRadius;
uniform float u_ocean;
uniform float u_beach;
uniform float u_mountain;
uniform float u_snow;

out vec4 outColor;

float band(float a,float b,float x){ return smoothstep(a,b,x); }

void main() {

  vec3 n = normalize(v_worldNormal);
  vec3 lightDir = normalize(vec3(1.0,1.0,1.0));
  float light = dot(n,lightDir)*0.5 + 0.5;

  float h = v_height - u_baseRadius;

  vec3 oceanCol = vec3(0.05,0.25,0.55);
  vec3 beachCol = vec3(0.85,0.80,0.55);
  vec3 grassCol = vec3(0.12,0.55,0.20);
  vec3 rockCol  = vec3(0.45);
  vec3 snowCol  = vec3(0.92);

  float tOcean = band(u_ocean-0.5, u_ocean+0.5, h);
  float tBeach = band(u_beach-0.5, u_beach+0.5, h);
  float tMount = band(u_mountain-0.5, u_mountain+0.5, h);
  float tSnow  = band(u_snow-0.5, u_snow+0.5, h);

  vec3 col = oceanCol;
  col = mix(col, beachCol, tOcean);
  col = mix(col, grassCol, tBeach);
  col = mix(col, rockCol,  tMount);
  col = mix(col, snowCol,  tSnow);

  outColor = vec4(col*light,1.0);
}
`;


// ==========================
// ÁGUA
// ==========================

export const vsWater = `#version 300 es
precision highp float;

in vec4 a_position;
in vec3 a_normal;

uniform mat4 u_viewProjection;
uniform mat4 u_world;

uniform float u_baseRadius;
uniform float u_waterOffset;
uniform float u_time;

out vec3 v_worldPos;
out vec3 v_worldNormal;

void main() {

  vec3 nLocal = normalize(a_normal);

  float wave = sin(dot(nLocal, vec3(1.0,0.0,0.5))*10.0 + u_time*2.0)*0.3;
  float radius = u_baseRadius + u_waterOffset + wave;

  vec3 posLocal = nLocal * radius;

  vec4 worldPos4 = u_world * vec4(posLocal,1.0);
  v_worldPos = worldPos4.xyz;
  v_worldNormal = normalize(mat3(u_world)*nLocal);

  gl_Position = u_viewProjection * worldPos4;
}
`;

export const fsWater = `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_worldNormal;

uniform vec3 u_cameraPos;

out vec4 outColor;

void main(){

  vec3 N = normalize(v_worldNormal);
  vec3 V = normalize(u_cameraPos - v_worldPos);

  float fres = pow(1.0 - max(dot(N,V),0.0),3.0);

  vec3 shallow = vec3(0.05,0.35,0.55);
  vec3 deep    = vec3(0.02,0.12,0.25);

  vec3 col = mix(shallow,deep,0.6);
  col = mix(col,vec3(0.8,0.9,1.0),fres*0.3);

  outColor = vec4(col,0.45);
}
`;


export const vsObj = `#version 300 es
in vec4 a_position;
in vec3 a_normal;
in vec2 a_texcoord;

in vec4 a_iWorld0;
in vec4 a_iWorld1;
in vec4 a_iWorld2;
in vec4 a_iWorld3;

uniform mat4 u_viewProjection;
uniform mat4 u_world;          // rotação do planeta (mouse+auto)

out vec3 v_normal;
out vec2 v_uv;

mat4 instanceWorld() {
  return mat4(a_iWorld0, a_iWorld1, a_iWorld2, a_iWorld3);
}

void main() {
  mat4 iw = instanceWorld();

  // world final = planeta(u_world) * instancia(iw)
  mat4 W = u_world * iw;

  vec4 worldPos = W * a_position;
  gl_Position = u_viewProjection * worldPos;

  // normal: só rotação/escala (sem translacao)
  v_normal = mat3(W) * a_normal;
  v_uv = a_texcoord;
}
`;

export const fsObj = `#version 300 es
precision highp float;

in vec3 v_normal;
in vec2 v_uv;

uniform bool u_useTexture;
uniform sampler2D u_texture;

out vec4 outColor;

void main() {
  vec3 n = normalize(v_normal);
  vec3 lightDir = normalize(vec3(0.3, 0.8, 0.4));
  float diff = max(dot(n, lightDir), 0.0);
  float shade = diff * 0.8 + 0.2;

  vec3 baseColor = vec3(0.2, 0.8, 0.3);
  if (u_useTexture) {
    baseColor = texture(u_texture, v_uv).rgb;
  }

  outColor = vec4(baseColor * shade, 1.0);
}
`;

export const vsPick = `#version 300 es
in vec4 a_position;

in vec4 a_iWorld0;
in vec4 a_iWorld1;
in vec4 a_iWorld2;
in vec4 a_iWorld3;

uniform mat4 u_viewProjection;
uniform mat4 u_world;

void main() {
  mat4 instWorld = mat4(a_iWorld0, a_iWorld1, a_iWorld2, a_iWorld3);
  gl_Position = u_viewProjection * u_world * instWorld * a_position;
}
`;

export const fsPick = `#version 300 es
precision highp float;

uniform vec4 u_id;
out vec4 outColor;

void main() {
  outColor = u_id;
}
`;


// -------------------------
// Background (stars + clear halo near planet)
// -------------------------
export const vsBg = `#version 300 es
precision highp float;

// full-screen triangle (sem VBO)
const vec2 pos[3] = vec2[](
  vec2(-1.0, -1.0),
  vec2( 3.0, -1.0),
  vec2(-1.0,  3.0)
);

out vec2 v_uv;

void main() {
  vec2 p = pos[gl_VertexID];
  v_uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}
`;

export const fsBg = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform vec2  u_resolution;
uniform float u_time;

// centro do planeta em tela (normalmente 0.5,0.5)
uniform vec2  u_center;

// raio "claro" ao redor do planeta (em fração da tela)
uniform float u_clearRadius;

// intensidade do clarão no centro
uniform float u_clearStrength;

// densidade de estrelas
uniform float u_starDensity;

// --- hash / noise ---
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float starLayer(vec2 uv, float scale, float density, float twinkle) {
  vec2 gv = uv * scale;
  vec2 id = floor(gv);
  vec2 f  = fract(gv);

  float rnd = hash12(id);
  float m = step(1.0 - density, rnd);    // decide se tem estrela nessa célula

  // posição aleatória da estrela dentro da célula
  vec2 p = vec2(hash12(id + 17.1), hash12(id + 29.7));
  vec2 d = f - p;

  float dist = length(d);

  // tamanho varia com rnd
  float size = mix(0.004, 0.018, pow(rnd, 8.0));

  float core = smoothstep(size, 0.0, dist);
  float glow = smoothstep(size * 6.0, 0.0, dist) * 0.35;

  // twinkle suave
  float t = sin(u_time * (1.2 + rnd * 2.5) + rnd * 10.0) * 0.5 + 0.5;
  float tw = mix(1.0 - twinkle, 1.0 + twinkle, t);

  float star = (core + glow) * m * tw;

  return star;
}

void main() {
  vec2 uv = v_uv;

  // fundo bem escuro (espaço)
  vec3 col = vec3(0.01, 0.012, 0.02);

  // múltiplas camadas: dá profundidade
  float s1 = starLayer(uv, 220.0, u_starDensity * 0.55, 0.25);
  float s2 = starLayer(uv, 120.0, u_starDensity * 0.35, 0.20);
  float s3 = starLayer(uv,  60.0, u_starDensity * 0.20, 0.15);

  // variação de cor sutil entre estrelas
  vec3 starCol1 = vec3(1.00, 0.98, 0.95);
  vec3 starCol2 = vec3(0.90, 0.95, 1.00);
  vec3 starCol3 = vec3(1.00, 0.90, 0.95);

  col += starCol1 * s1 * 1.2;
  col += starCol2 * s2 * 1.0;
  col += starCol3 * s3 * 0.9;

  // "nebulosa" bem leve (ruído grande)
  float neb = hash12(floor(uv * 18.0));
  col += vec3(0.02, 0.01, 0.03) * smoothstep(0.75, 1.0, neb) * 0.35;

  // ✅ clarão ao redor do planeta (centro mais claro)
  // distância em pixels corrigida pelo aspect
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 d = (uv - u_center) * aspect;
  float r = length(d);

  // halo: 1 no centro, 0 fora
  float halo = smoothstep(u_clearRadius, 0.0, r);

  // não "lava" as estrelas demais; só levanta o preto
  col = mix(col, col + vec3(0.12, 0.12, 0.14) * u_clearStrength, halo);

  // leve vignette pra bordas ficarem mais profundas
  float vig = smoothstep(1.15, 0.2, length((uv - 0.5) * aspect));
  col *= mix(0.78, 1.0, vig);

  outColor = vec4(col, 1.0);
}
`;
