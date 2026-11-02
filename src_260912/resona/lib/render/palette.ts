/**
 * 색 토큰을 CSS 변수에서 읽어 옵니다.
 * `globals.css` 를 유일한 출처로 두기 위해서입니다. 캔버스는 CSS 변수를
 * 직접 쓸 수 없으므로 마운트할 때 한 번 풀어 둡니다.
 */
import { BUILTIN_PALETTES, MONO_PALETTE_ID } from '@/lib/palette/builtin';
import type { ConsoleColors, PaletteRoles } from '@/lib/render/types';

/**
 * 색이 아직 정해지기 전에 쓰는 자리. 기본 팔레트 `MONO` 그대로입니다.
 *
 * 색값을 여기에 다시 적지 않고 8-2절 표(`lib/palette/builtin.ts`)에서
 * 가져옵니다. 두 곳에 적어 두면 한쪽만 고쳐집니다.
 */
export const MONO_ROLES: PaletteRoles = {
  ...(BUILTIN_PALETTES.find((p) => p.id === MONO_PALETTE_ID) ?? BUILTIN_PALETTES[0])
    .chips,
};

const FALLBACK: ConsoleColors = {
  void: '#000000',
  panel: '#0a0a0a',
  panel2: '#111110',
  rule: '#222220',
  bone: '#e8e4dc',
  dim: '#6e6b64',
  alert: '#ff2a00',
  cyan: '#7fd7d0',
};

export function readConsoleColors(): ConsoleColors {
  if (typeof window === 'undefined') return FALLBACK;
  const style = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) => {
    const v = style.getPropertyValue(name).trim();
    return v.length > 0 ? v : fallback;
  };
  return {
    void: pick('--void', FALLBACK.void),
    panel: pick('--panel', FALLBACK.panel),
    panel2: pick('--panel2', FALLBACK.panel2),
    rule: pick('--rule', FALLBACK.rule),
    bone: pick('--bone', FALLBACK.bone),
    dim: pick('--dim', FALLBACK.dim),
    alert: pick('--alert', FALLBACK.alert),
    cyan: pick('--cyan', FALLBACK.cyan),
  };
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  return [
    Number.parseInt(n.slice(0, 2), 16),
    Number.parseInt(n.slice(2, 4), 16),
    Number.parseInt(n.slice(4, 6), 16),
  ];
}

/** 두 색을 섞습니다. 기타 성분의 실색이 `deep` 과 `base` 의 중간입니다. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `#${[m(ar, br), m(ag, bg), m(ab, bb)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * 색상각을 0~1 로 돌려줍니다.
 * `DirectionParams.hue` 는 외부 연동 하위 호환용이라 이 하나만 필요합니다.
 */
export function hueOf(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h / 360;
}

/** `#rrggbb` 를 `rgba(...)` 로. 캔버스에 투명도를 줄 때 씁니다. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
