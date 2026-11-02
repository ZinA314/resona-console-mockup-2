/**
 * 무대 씬의 셰이더. `docs/03-screens.md` 무대 씬 절.
 *
 * GLSL 을 별도 `.glsl` 파일로 두지 않고 문자열로 둡니다. 번들러가 `.glsl` 을
 * 그대로 내보내면 로더를 붙여야 하고, 워크렛과 같은 이유로 빌드 단계가 늘면
 * 실패 방식이 생깁니다. 여기서는 문자열 하나가 그만큼의 값을 합니다.
 */

/** 전체 화면 사각형. 정점 버퍼 없이 정점 ID 만으로 삼각형 하나를 만듭니다. */
export const QUAD_VERT = `#version 300 es
void main() {
  // 화면을 덮는 큰 삼각형 하나. 사각형 두 장보다 이음매가 없습니다.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** 값 노이즈와 fbm. 층 1과 입자가 함께 씁니다. */
const NOISE = `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 4옥타브. 5 이상은 프레임만 먹고 눈에 띄지 않습니다.
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}`;

/**
 * 층 1 — 배경 유체. 노이즈를 노이즈로 한 번 더 밀어 유기적인 흐름을 만듭니다.
 *
 * **매 프레임 불투명하게 다시 그립니다.** 여기에 잔상을 걸면 배경까지 번져
 * 흐름이 뭉개집니다. 잔상은 입자 버퍼에만 겁니다.
 */
export const FLUID_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2 uRes;
uniform float uTime;
uniform float uWarp;
uniform float uBrightness;
uniform vec3 uBg;
uniform vec3 uDeep;
uniform vec3 uBase;
${NOISE}

void main() {
  // 짧은 변을 기준으로 잡아 화면 비율이 바뀌어도 무늬가 늘어나지 않습니다.
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);
  vec2 p = uv * 2.2;
  float t = uTime;

  vec2 q = vec2(fbm(p + t * 0.10),
                fbm(p + vec2(5.2, 1.3) + t * 0.12));
  vec2 r = vec2(fbm(p + uWarp * q + vec2(1.7, 9.2) + t * 0.15),
                fbm(p + uWarp * q + vec2(8.3, 2.8) + t * 0.13));
  float f = fbm(p + uWarp * r);

  vec3 col = mix(uBg, uDeep, smoothstep(0.35, 0.75, f));
  col += uBase * pow(f, 3.0) * uBrightness * 0.45;
  // 비네트. 무대 스크린은 가장자리가 어두워야 화면의 경계가 눈에 띄지 않습니다.
  col *= 1.0 - 0.55 * pow(length(uv), 2.2);

  fragColor = vec4(col, 1.0);
}`;

/**
 * 층 2 — 입자. **상태를 저장하지 않습니다.**
 * 위치를 프레임 사이에 들고 다니면 텍스처 두 장을 번갈아 쓰는 구조가 필요하고
 * 코드가 세 배로 늘어납니다. 인덱스와 시각만으로 매 프레임 새로 계산합니다.
 */
export const PARTICLE_VERT = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uSpeed;
uniform float uExpansion;
uniform float uScale;
uniform float uDreaminess;
uniform float uBeatPulse;
uniform float uDpr;
uniform float uAspect;
uniform vec3 uBase;
uniform vec3 uAccent;
uniform vec3 uHot;

out vec3 vColor;
${NOISE}

/*
 * 정수 해시. fract(sin(n) * 43758.5) 를 쓰면 인덱스가 커질수록 sin 의
 * 정밀도가 떨어져 이웃한 입자끼리 값이 상관됩니다. 실측에서 입자 수천 개가
 * 가닥으로 뭉쳐 실뭉치처럼 보였습니다. 비트 섞기는 그 문제가 없습니다.
 */
uint hashU(uint x) {
  x ^= x >> 16;
  x *= 0x7feb352du;
  x ^= x >> 15;
  x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}

float rnd(uint x) {
  return float(hashU(x) & 0xffffffu) / 16777216.0;
}

/*
 * 회전장. 노이즈의 기울기를 90도 돌려 소용돌이를 만듭니다.
 *
 * 기울기를 그대로 (2e 로 나눠) 쓰면 크기가 1 에 가까워 궤도 반경만큼 밀립니다.
 * 그러면 입자들이 같은 흐름선으로 몰려 화면이 실뭉치처럼 보였습니다.
 * 차분만 남겨 크기를 0.1 언저리로 두면 궤도를 흔드는 정도가 됩니다.
 */
vec2 curl(vec2 p) {
  float e = 0.08;
  float n1 = fbm(p + vec2(0.0, e));
  float n2 = fbm(p - vec2(0.0, e));
  float n3 = fbm(p + vec2(e, 0.0));
  float n4 = fbm(p - vec2(e, 0.0));
  return vec2(n1 - n2, n4 - n3) * 2.5;
}

void main() {
  uint id = uint(gl_VertexID);
  float a = rnd(id * 3u);
  float b = rnd(id * 3u + 1u);
  float c = rnd(id * 3u + 2u);

  float age = fract(c + uTime * (0.05 + uSpeed * 0.08));
  // 명세의 (0.55 + age × 0.85) 대신 (0.10 + age × 0.95) 입니다. 앞의 식은
  // 반경에 0.55 의 바닥이 생겨, 비트마다 더해지는 확산과 겹치면 화면 한가운데에
  // 테두리가 뚜렷한 빈 원이 남았습니다. 입자가 안에서 태어나 밖으로 흐르는
  // 편이 그림으로도 자연스럽습니다.
  // 비트마다 바깥으로. 명세의 덧셈(+ beatPulse × 0.18 × scale) 대신 곱셈입니다.
  // 덧셈은 모든 입자를 같은 거리만큼 밀어내 화면 한가운데에 테두리가 뚜렷한
  // 검은 원을 남겼습니다. 비트가 잦은 곡에서는 그 원이 내내 떠 있습니다.
  float rad = (0.12 + a * 0.75)
            * (1.0 + uExpansion * 0.9)
            * (0.10 + age * 0.95)
            * (1.0 + uBeatPulse * 0.18 * uScale);
  float ang = b * 6.283
            + uTime * (0.15 + (1.0 - uDreaminess) * 0.55)
            + rad * 1.8;

  /*
   * 페이드 좌표계는 확산을 빼고 잡습니다 (03-screens 무대 씬 절).
   * rad 를 그대로 넣으면 관객이 뜨거워질수록 바깥으로 밀려난 입자를 페이드가
   * 지워, 확산을 키운 만큼 되돌려 놓습니다. 실측에서 궤도가 +12.4% 넓어졌는데
   * 화면 평균 반경은 +1.8% 만 늘었습니다. expansion 은 관객이 화면에 드러나는
   * 유일한 통로라, 여기서 상쇄되면 이 프로젝트의 명제가 화면에 안 보입니다.
   */
  float radN = rad / (1.0 + uExpansion * 0.9);

  vec2 pos = vec2(cos(ang), sin(ang)) * rad;
  pos += curl(pos * 1.7 + uTime * 0.08) * (0.10 + uDreaminess * 0.22);

  // 짧은 변 기준이라 가로가 긴 화면에서도 궤도가 원을 유지합니다.
  vec2 clip = vec2(pos.x / uAspect, pos.y);
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = (1.5 + a * 4.5)
               * (0.6 + uScale * 1.1)
               * (1.0 + uDreaminess * 0.8)
               * uDpr;

  vec3 col = mix(uBase, uAccent, b);
  col = mix(col, uHot, uBeatPulse * 0.7);
  float alpha = (0.55 - uDreaminess * 0.20)
              * (1.0 - smoothstep(0.75, 1.05, radN))
              // 수명이 한 바퀴 돌 때 입자가 툭 튀어나오지 않게 합니다.
              * smoothstep(0.0, 0.12, age);
  // 가산 블렌딩이라 알파 채널이 쓰이지 않습니다. 색에 미리 곱해 둡니다.
  vColor = col * max(alpha, 0.0);
}`;

export const PARTICLE_FRAG = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 fragColor;

void main() {
  // 사각형 점을 둥글게 깎습니다. 가장자리를 부드럽게 해야 빛처럼 보입니다.
  float d = length(gl_PointCoord - 0.5);
  float m = 1.0 - smoothstep(0.18, 0.5, d);
  fragColor = vec4(vColor * m, 1.0);
}`;

/**
 * 입자 버퍼를 어둡게 깎습니다. 알파 블렌딩으로 검정을 덮으면 남은 색에
 * `uKeep` 이 곱해져, 입자가 지나간 자리가 지수적으로 사그라집니다.
 */
export const FADE_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform float uKeep;
void main() {
  fragColor = vec4(0.0, 0.0, 0.0, 1.0 - uKeep);
}`;

/** 층 3-1 — 밝은 부분만 남깁니다. 1/4 해상도 텍스처에 그립니다. */
export const BRIGHT_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uRes;

void main() {
  vec3 c = texture(uTex, gl_FragCoord.xy / uRes).rgb;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  fragColor = vec4(c * max(0.0, luma - 0.55), 1.0);
}`;

/** 층 3-2 — 9탭 가우시안. 가로와 세로를 나눠 두 번 돕니다. */
export const BLUR_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uDir;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float w[5];
  w[0] = 0.2270270270;
  w[1] = 0.1945945946;
  w[2] = 0.1216216216;
  w[3] = 0.0540540541;
  w[4] = 0.0162162162;
  vec3 sum = texture(uTex, uv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 o = uDir * float(i) / uRes;
    sum += texture(uTex, uv + o).rgb * w[i];
    sum += texture(uTex, uv - o).rgb * w[i];
  }
  fragColor = vec4(sum, 1.0);
}`;

/** 화면으로 옮겨 그립니다. 원본은 그대로, 블룸은 세기를 곱해 가산합니다. */
export const COPY_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uAmount;

void main() {
  fragColor = vec4(texture(uTex, gl_FragCoord.xy / uRes).rgb * uAmount, 1.0);
}`;
