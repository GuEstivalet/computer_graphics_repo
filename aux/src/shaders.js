// planeta

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
uniform mat4 u_lightVP;

out vec3 v_worldPos;
out vec3 v_worldNormal;
out float v_height;
out vec3 v_localPos;
out vec4 v_shadowPos;

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
  v_localPos = posLocal;

  vec4 worldPos4 = u_world * vec4(posLocal,1.0);
  v_worldPos = worldPos4.xyz;
  v_worldNormal = normalize(mat3(u_world)*nLocal);
  v_height = radius - u_baseRadius;

  gl_Position = u_viewProjection * worldPos4;
  v_shadowPos = u_lightVP * worldPos4;
}
`;

export const fsPlanet = `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_worldNormal;
in float v_height;
in vec3 v_localPos; // se você estiver usando pro triplanar fixo no planeta

uniform float u_ocean;
uniform float u_beach;
uniform float u_mountain;
uniform float u_snow;

uniform sampler2D u_texGrass;
uniform sampler2D u_texRock;
uniform float u_texScale;

// --- sombras ---
uniform sampler2D u_shadowMap;   // depth texture (R)
uniform mat4 u_lightVP;          // lightViewProj
uniform vec3 u_lightDir;         // direção da luz (normalizada)

// iluminação
uniform float u_ambient;         // ex: 0.05
uniform float u_diffuse;         // ex: 1.10

out vec4 outColor;

float band(float a,float b,float x){ return smoothstep(a,b,x); }

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// triplanar (use v_localPos para ficar "fixo" no planeta)
vec3 triplanarSample(sampler2D tex, vec3 P, vec3 N, float scale) {
  vec3 n = normalize(N);
  vec3 w = pow(abs(n), vec3(4.0));
  w /= (w.x + w.y + w.z + 1e-6);

  vec2 uvX = P.yz * scale;
  vec2 uvY = P.xz * scale;
  vec2 uvZ = P.xy * scale;

  vec3 cx = texture(tex, uvX).rgb;
  vec3 cy = texture(tex, uvY).rgb;
  vec3 cz = texture(tex, uvZ).rgb;

  return cx * w.x + cy * w.y + cz * w.z;
}

float shadowFactor(vec3 worldPos, vec3 worldN) {
  vec4 lp = u_lightVP * vec4(worldPos, 1.0);

  // NDC
  vec3 ndc = lp.xyz / lp.w;

  // UV em 0..1
  vec2 uv = ndc.xy * 0.5 + 0.5;

  // depth em 0..1  ESSA LINHA É O PONTO-CRÍTICO
  float cur = ndc.z * 0.5 + 0.5;

  // fora do frustum da luz => não sombreia
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;
  if (cur < 0.0 || cur > 1.0) return 1.0;

  // depth gravado no shadow map (0..1)
  float dep = texture(u_shadowMap, uv).r;

  // bias simples (evita acne). Ajuste se precisar.
  float bias = max(0.0015, 0.0025 * (1.0 - dot(normalize(worldN), normalize(u_lightDir))));

  // se cur está "atrás" do depth gravado -> em sombra
  return (cur - bias > dep) ? 0.0 : 1.0;
}

void main() {
  vec3 n = normalize(v_worldNormal);

  // altura relativa (v_height já é relativo no seu setup atual)
  float h = v_height;

  // máscaras bioma
  float tOcean = band(u_ocean-0.5,    u_ocean+0.5,    h);
  float tBeach = band(u_beach-0.5,    u_beach+0.5,    h);
  float tMount = band(u_mountain-0.5, u_mountain+0.5, h);
  float tSnow  = band(u_snow-0.5,     u_snow+0.5,     h);

  // cores base
  vec3 oceanCol = vec3(0.05,0.25,0.55);
  vec3 beachCol = vec3(0.85,0.80,0.55);
  vec3 grassBase = vec3(0.12,0.55,0.20);
  vec3 rockBase  = vec3(0.45);
  vec3 snowCol   = vec3(0.92);

  // textura como detalhe (use v_localPos pra ficar "fixa" ao planeta)
  vec3 grassTex = triplanarSample(u_texGrass, v_localPos, n, u_texScale);
  vec3 rockTex  = triplanarSample(u_texRock,  v_localPos, n, u_texScale);

  float g = mix(0.7, 1.3, luma(grassTex));
  float r = mix(0.7, 1.3, luma(rockTex));

  vec3 col = oceanCol;
  col = mix(col, beachCol, tOcean);

  vec3 grassCol = grassBase * g;
  col = mix(col, grassCol, tBeach);

  vec3 rockCol = rockBase * r;
  col = mix(col, rockCol, tMount);

  col = mix(col, snowCol, tSnow);

  float ndl = max(dot(n, normalize(u_lightDir)), 0.0);
  float sh  = shadowFactor(v_worldPos, n);

  // sombra só afeta o difuso; o ambiente fica sempre
  float lightTerm = u_ambient + (u_diffuse * ndl) * sh;

  outColor = vec4(col * lightTerm, 1.0);
  }
`;





// água oceano

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


uniform float u_time;
uniform float u_isFish;      // 0.0 = árvore, 1.0 = peixe
uniform float u_swimAmp;     // amplitude (força)
uniform float u_swimFreq;    // frequência ao longo do corpo
uniform float u_swimSpeed;   // velocidade do ciclo

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

  // normal: só rotação
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

uniform vec3 u_lightDir; 

out vec4 outColor;

void main() {
  vec3 n = normalize(v_normal);

  // usa a direção da luz vinda do JS
  vec3 lightDir = normalize(u_lightDir);

  // difuso físico
  float ndl = max(dot(n, lightDir), 0.0);

  // quase escuro no lado oposto
  float shade = 0.08 + ndl * 0.92;

  vec3 baseColor = vec3(0.2, 0.8, 0.3);

  if (u_useTexture) {
    baseColor = texture(u_texture, v_uv).rgb;
  }

  outColor = vec4(baseColor * shade, 1.0);
}
`;


export const vsPick = `#version 300 es
precision highp float;

in vec4 a_position;

in vec4 a_iWorld0;
in vec4 a_iWorld1;
in vec4 a_iWorld2;
in vec4 a_iWorld3;

uniform mat4 u_viewProjection;
uniform mat4 u_world;

flat out int v_id;

void main() {
  // monta matrix da instância
  mat4 iWorld = mat4(a_iWorld0, a_iWorld1, a_iWorld2, a_iWorld3);

  // id único por instância
  v_id = gl_InstanceID + 1;

  // posição
  vec4 worldPos = u_world * (iWorld * a_position);
  gl_Position = u_viewProjection * worldPos;
}
`;
export const fsPick = `#version 300 es
precision highp float;

flat in int v_id;
out vec4 outColor;

vec3 encodeId(int id) {
  int r =  id        & 255;
  int g = (id >> 8)  & 255;
  int b = (id >> 16) & 255;
  return vec3(float(r), float(g), float(b)) / 255.0;
}

void main() {
  outColor = vec4(encodeId(v_id), 1.0);
}
`;


// background estrelas + universo:


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

// centro do planeta em tela 
uniform vec2  u_center;

// raio ao redor do planeta
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

  // fundo escuro
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

  // simula uma nebulosidade
  float neb = hash12(floor(uv * 18.0));
  col += vec3(0.02, 0.01, 0.03) * smoothstep(0.75, 1.0, neb) * 0.35;

  // distância em pixels corrigida pelo aspect
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 d = (uv - u_center) * aspect;
  float r = length(d);

  float halo = smoothstep(u_clearRadius, 0.0, r);

  col = mix(col, col + vec3(0.12, 0.12, 0.14) * u_clearStrength, halo);

  // para bordas ficarem mais profundas
  float vig = smoothstep(1.15, 0.2, length((uv - 0.5) * aspect));
  col *= mix(0.78, 1.0, vig);

  outColor = vec4(col, 1.0);
}
`;

// animação pólem

export const vsPollen = `#version 300 es
precision highp float;

in vec3 a_up;        // direção unitária (local do planeta)
in float a_phase;    // fase 0..1
in float a_speed;    // velocidade do ciclo (mesma de antes)
in float a_size;     // tamanho base

uniform mat4 u_viewProjection;
uniform mat4 u_world;

uniform float u_time;
uniform float u_baseRadius;
uniform float u_waterOffset;

out float v_alpha;

vec3 basisRight(vec3 up){
  vec3 a = abs(up.y) < 0.999 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
  return normalize(cross(a, up));
}

void main() {
  vec3 up = normalize(a_up);

  float surfaceR = u_baseRadius + u_waterOffset;
  float spawnR   = surfaceR + 10.0;   // "céu"
  float endR     = surfaceR + 0.12;   // quase na superfície

  //  t cresce com u_time*a_speed
  float t = fract(u_time * a_speed + a_phase);

  // queda radial
  float r = mix(spawnR, endR, t);

  // base tangente
  vec3 right = basisRight(up);
  vec3 fwd   = normalize(cross(up, right));

  // espiral
  float turns = 3.0; // ajuste: 1.0 suave, 5.0 bem espiralado
  float angle = (u_time * 3.0 + a_phase * 6.283) + t * (turns * 6.283);

  // raio da espiral (quanto "abre" lateralmente)
  // cresce um pouco no meio e some perto do final
  float spiralRadius = 0.35; // ajuste: 0.15..0.6
  float life = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.80, 1.0, t));
  float spiral = spiralRadius * life;

  vec3 spiralOffset = (cos(angle) * right + sin(angle) * fwd) * spiral;

  vec3 posLocal = up * r + spiralOffset;

  vec4 worldPos = u_world * vec4(posLocal, 1.0);
  gl_Position = u_viewProjection * worldPos;

  // tamanho em pixels
  float tw = sin(u_time * 6.0 + a_phase * 20.0) * 0.5 + 0.5;
  gl_PointSize = a_size * (0.75 + 0.6 * tw);

  // alpha: forte no meio, some no final
  v_alpha = life;
}
`;

export const fsPollen = `#version 300 es
precision highp float;

in float v_alpha;
out vec4 outColor;

void main() {
  // sprite circular suave
  vec2 p = gl_PointCoord - vec2(0.5);
  float d = length(p);
  float core = smoothstep(0.5, 0.0, d);

  // cor de pólen (amarelo bem suave)
  vec3 col = vec3(1.0, 0.92, 0.55);

  float a = core * v_alpha * 0.55; // alpha geral
  if (a < 0.01) discard;

  outColor = vec4(col, a);
}
`;

export const vsShadow = `#version 300 es
precision highp float;

in vec4 a_position;
in vec3 a_normal;

uniform mat4 u_lightVP;
uniform mat4 u_world;

// --- MESMOS UNIFORMS DO PLANETA (pra bater 1:1) ---
uniform float u_baseRadius;
uniform float u_noiseAmp;
uniform float u_noiseFreq;
uniform float u_seed;
uniform int   u_octaves;

// se você estiver usando o “relevo por bioma” no vsPlanet, inclua também:
uniform float u_ocean;
uniform float u_beach;
uniform float u_mountain;
uniform float u_snow;

uniform float u_oceanDepth;
uniform float u_landLift;
uniform float u_mountainLift;
uniform float u_biomeBlend;

// ---------- Noise (igual ao vsPlanet) ----------
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
  float n111 = hash31(i + vec3(1,0,1) + vec3(0,0,1)); // (equivalente ao i+vec3(1,1,1))

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

  for (int i = 0; i < 12; i++) {
    if (i >= octaves) break;
    sum += (valueNoise(p * freq + off) * 2.0 - 1.0) * amp;
    freq *= 2.0;
    amp  *= 0.5;
  }
  return sum;
}

float band(float a, float b, float x) { return smoothstep(a, b, x); }

void main() {
  vec3 nLocal = normalize(a_normal);

  // 1) ruido base igual ao vsPlanet
  float n = fbm(nLocal * u_noiseFreq, u_seed, u_octaves);
  float h = n * u_noiseAmp;          // altura relativa
  float radius = u_baseRadius + h;   // raio final (base)

  // 2) Se no seu vsPlanet você tem relevo por bioma, APLIQUE IGUAL AQUI
  //    (se não tiver, pode deixar que ainda vai corrigir bastante)
  float tOcean = band(u_ocean-0.5,    u_ocean+0.5,    h);
  float tBeach = band(u_beach-0.5,    u_beach+0.5,    h);
  float tMount = band(u_mountain-0.5, u_mountain+0.5, h);

  float biomeLift = 0.0;
  biomeLift += (-u_oceanDepth) * tOcean;
  biomeLift += ( u_landLift)   * tBeach;
  biomeLift += ( u_mountainLift) * tMount;

  radius += biomeLift * u_biomeBlend;

  vec3 posLocal = nLocal * radius;

  vec4 worldPos = u_world * vec4(posLocal, 1.0);
  gl_Position = u_lightVP * worldPos;
}
`;

export const fsShadow = `#version 300 es
precision highp float;
void main() { }
`;

export const vsShadowObj = `#version 300 es
precision highp float;

in vec4 a_position;

in vec4 a_iWorld0;
in vec4 a_iWorld1;
in vec4 a_iWorld2;
in vec4 a_iWorld3;

uniform mat4 u_lightVP;
uniform mat4 u_world;   // rotação do planeta

mat4 instanceWorld() {
  return mat4(a_iWorld0, a_iWorld1, a_iWorld2, a_iWorld3);
}

void main() {
  mat4 iw = instanceWorld();
  mat4 W = u_world * iw;
  vec4 worldPos = W * a_position;
  gl_Position = u_lightVP * worldPos;
}
`;