/**
 * OKLab 색공간. `docs/05-signal-processing.md` 8-3절.
 *
 * **색은 반드시 이 공간에서 섞습니다.** sRGB 값을 그대로 선형 보간하면
 * 파랑과 노랑 사이가 탁한 회색을 지나갑니다. OKLab 에서 섞으면 중간이
 * 초록 계열로 지나가 눈에 자연스럽습니다.
 *
 * 세 가지 표현을 오갑니다.
 *
 *   hex      '#rrggbb'   사용자가 입력하고 캔버스 2D 가 그리는 형식
 *   linear   0~1 세 값   감마를 없앤 선형 RGB. `ResolvedPalette` 가 이것입니다
 *   oklab    L a b       섞을 때만 쓰는 중간 표현
 */

/** 선형 RGB 0~1. 감마가 없습니다. */
export type Rgb = [number, number, number];

/** OKLab. `L` 은 0~1 근처, `a` `b` 는 0 을 중심으로 ±0.4 정도입니다. */
export type Oklab = [number, number, number];

// ── 감마 ────────────────────────────────────────────────────────

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function toGamma(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

// ── hex ↔ 선형 RGB ──────────────────────────────────────────────

export function hexToLinear(hex: string): Rgb {
  const h = hex.replace('#', '').trim();
  const n =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h.padEnd(6, '0').slice(0, 6);
  const v = (i: number) => {
    const parsed = Number.parseInt(n.slice(i, i + 2), 16);
    return Number.isFinite(parsed) ? toLinear(parsed / 255) : 0;
  };
  return [v(0), v(2), v(4)];
}

export function linearToHex(c: Rgb): string {
  const part = (v: number) => {
    const byte = Math.round(Math.min(1, Math.max(0, toGamma(v))) * 255);
    return byte.toString(16).padStart(2, '0');
  };
  return `#${part(c[0])}${part(c[1])}${part(c[2])}`;
}

// ── 선형 RGB ↔ OKLab ────────────────────────────────────────────

/** 음수에서도 부호를 지키는 세제곱근. 색역 밖의 중간값을 통과시킵니다. */
function cbrt(x: number): number {
  return x < 0 ? -((-x) ** (1 / 3)) : x ** (1 / 3);
}

export function linearToOklab([r, g, b]: Rgb): Oklab {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = cbrt(l);
  const m_ = cbrt(m);
  const s_ = cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

/** 8-3절이 "함께 둔다"고 한 역변환 계수입니다. */
export function oklabToLinear([L, a, b]: Oklab): Rgb {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

// ── 섞기 ────────────────────────────────────────────────────────

/** OKLab 세 축을 그대로 선형 보간합니다. */
export function oklabMix(a: Oklab, b: Oklab, t: number): Oklab {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/** 같은 배열에 결과를 써 넣습니다. 매 프레임 도는 자리에서 씁니다. */
export function oklabMixInto(out: Oklab, a: Oklab, b: Oklab, t: number): Oklab {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

export function hexToOklab(hex: string): Oklab {
  return linearToOklab(hexToLinear(hex));
}

export function oklabToHex(c: Oklab): string {
  return linearToHex(oklabToLinear(c));
}

/** 두 hex 를 OKLab 에서 섞어 hex 로 돌려줍니다. 편집기 미리보기가 씁니다. */
export function mixOklabHex(a: string, b: string, t: number): string {
  return oklabToHex(oklabMix(hexToOklab(a), hexToOklab(b), t));
}
