/**
 * 분위기에서 색을 뽑아냅니다. `docs/05-signal-processing.md` 8-3 ~ 8-6절.
 *
 * 두 단계를 지납니다.
 *
 *   1. 목표 정하기  자동이면 가장 가까운 앵커 두 개를 역거리로 섞고(8-3),
 *                  수동이면 고른 팔레트를 그대로 씁니다. **섞지 않습니다**(8-5)
 *   2. 전환        그 목표를 시상수 `fade` 로 천천히 따라갑니다 (8-4)
 *
 * **관객 값은 이 파일 어디에도 들어오지 않습니다** (8-6). 관객이 색까지
 * 바꾸면 연출가가 곡마다 잡아 둔 색채 계획이 무너집니다. 이 파일이 관객을
 * 아예 모르는 것이 그 원칙을 지키는 방법입니다.
 */
import {
  hexToOklab,
  oklabMixInto,
  oklabToHex,
  oklabToLinear,
  type Oklab,
} from '@/lib/palette/oklab';
import { MONO_PALETTE_ID } from '@/lib/palette/builtin';
import type { PaletteRoles } from '@/lib/render/types';
import type { Palette, PaletteRole, ResolvedPalette } from '@/lib/types';

const ROLES: readonly PaletteRole[] = ['bg', 'deep', 'base', 'accent', 'hot'];

type LabSet = Record<PaletteRole, Oklab>;

function emptyLabSet(): LabSet {
  return {
    bg: [0, 0, 0],
    deep: [0, 0, 0],
    base: [0, 0, 0],
    accent: [0, 0, 0],
    hot: [0, 0, 0],
  };
}

/**
 * hex 다섯을 OKLab 으로 바꾼 결과를 팔레트마다 기억해 둡니다.
 * 매 프레임 세제곱근 열다섯 번을 다시 돌 이유가 없습니다. 칩을 고치면 hex 가
 * 달라지므로 그것을 열쇠로 삼습니다.
 */
class LabCache {
  private map = new Map<string, LabSet>();

  get(p: Palette): LabSet {
    const key = `${p.id}|${p.chips.bg}${p.chips.deep}${p.chips.base}${p.chips.accent}${p.chips.hot}`;
    const hit = this.map.get(key);
    if (hit) return hit;
    const set = emptyLabSet();
    for (const role of ROLES) set[role] = hexToOklab(p.chips[role]);
    // 팔레트 여덟에 사본 몇 개면 충분합니다. 무한정 쌓이지 않게 잘라 둡니다.
    if (this.map.size > 64) this.map.clear();
    this.map.set(key, set);
    return set;
  }
}

export interface ResolveInput {
  palettes: readonly Palette[];
  selectedId: string;
  auto: boolean;
  /** 색 전환 시상수(초) 0.5~8 (8-4) */
  fade: number;
  valence: number;
  arousal: number;
}

export class PaletteResolver {
  private cache = new LabCache();
  private current: LabSet = emptyLabSet();
  private target: LabSet = emptyLabSet();
  private started = false;

  /** 화면 표시용 섞임 비율. `침잠 62% + 평온 38%` 로 나갑니다. */
  private mix: { name: string; weight: number }[] = [];

  /**
   * 지금 섞임에서 우세한 팔레트. `자동` 을 토글로 끌 때 이것이 선택됩니다
   * (8-5절). 그래야 색이 크게 튀지 않고 카드 하나가 실제로 선택됩니다.
   */
  private dominant = '';

  private hex: PaletteRoles = {
    bg: '#000000',
    deep: '#000000',
    base: '#000000',
    accent: '#000000',
    hot: '#000000',
  };

  private resolvedValue: ResolvedPalette = {
    bg: [0, 0, 0],
    deep: [0, 0, 0],
    base: [0, 0, 0],
    accent: [0, 0, 0],
    hot: [0, 0, 0],
    blend: [],
  };

  /** 씬이 쓰는 hex 다섯. 캔버스 2D 는 문자열만 받습니다. */
  get roles(): PaletteRoles {
    return this.hex;
  }

  /** `DirectionParams.palette`. 선형 RGB 라 나중에 셰이더에 그대로 넘어갑니다. */
  get resolved(): ResolvedPalette {
    return this.resolvedValue;
  }

  /** 지금 섞임에서 우세한 팔레트의 식별자. */
  get dominantId(): string {
    return this.dominant;
  }

  update(dt: number, input: ResolveInput): void {
    const { palettes } = input;
    if (palettes.length === 0) return;

    const selected =
      palettes.find((p) => p.id === input.selectedId) ??
      palettes.find((p) => p.id === MONO_PALETTE_ID) ??
      palettes[0];
    const selectedLab = this.cache.get(selected);

    // 8-5절. 자동과 수동은 둘 중 하나입니다. 섞지 않습니다.
    if (input.auto) {
      this.buildAuto(input, selected, selectedLab);
    } else {
      this.copyToTarget(selectedLab);
      this.mix = [{ name: selected.name, weight: 1 }];
      this.dominant = selected.id;
    }

    // 8-4. 목표가 바뀌어도 화면 색을 즉시 갈지 않습니다.
    // 공연 중에 색이 한 프레임에 바뀌면 조명 사고처럼 보입니다.
    if (!this.started) {
      // 앱을 켠 뒤 첫 프레임만 예외입니다. `current` 가 아직 검정이라, 여기서
      // 따라가게 두면 화면이 2.5초에 걸쳐 떠올라 고장으로 읽힙니다.
      // **곡이 바뀔 때는 이 자리를 지나지 않습니다.** 색은 곡을 건너 이어지고,
      // 새 곡의 분위기를 향해 아래 시상수로 넘어갑니다 (8-4절).
      for (const role of ROLES) {
        const [L, a, b] = this.target[role];
        this.current[role][0] = L;
        this.current[role][1] = a;
        this.current[role][2] = b;
      }
      this.started = true;
    } else {
      const k = 1 - Math.exp(-dt / Math.max(input.fade, 0.05));
      for (const role of ROLES) {
        oklabMixInto(this.current[role], this.current[role], this.target[role], k);
      }
    }

    this.publish();
  }

  /** 8-3절. 가장 가까운 앵커 두 개를 역거리로 섞습니다. */
  private buildAuto(input: ResolveInput, selected: Palette, selectedLab: LabSet): void {
    const candidates = input.palettes.filter((p) => p.auto);

    if (candidates.length === 0) {
      // 후보를 모두 꺼 두면 자동이 고를 것이 없습니다. 고른 팔레트에 머뭅니다.
      this.copyToTarget(selectedLab);
      this.mix = [{ name: selected.name, weight: 1 }];
      this.dominant = selected.id;
      return;
    }

    let p1 = candidates[0];
    let d1 = distance(p1, input);
    let p2: Palette | null = null;
    let d2 = Infinity;
    for (let i = 1; i < candidates.length; i += 1) {
      const p = candidates[i];
      const d = distance(p, input);
      if (d < d1) {
        p2 = p1;
        d2 = d1;
        p1 = p;
        d1 = d;
      } else if (d < d2) {
        p2 = p;
        d2 = d;
      }
    }

    const lab1 = this.cache.get(p1);
    // 하나만 고르면 경계에서 색이 툭 바뀝니다. 그래서 둘을 섞습니다.
    // 후보가 하나뿐이면 섞을 상대가 없으니 그대로 씁니다.
    if (!p2) {
      this.copyToTarget(lab1);
      this.mix = [{ name: p1.name, weight: 1 }];
      this.dominant = p1.id;
      return;
    }

    const sum = d1 + d2;
    // 두 앵커가 같은 자리에 있으면 반씩 섞습니다. `d1 = 0` 이면 `w2 = 0` 이라
    // 자연히 첫 팔레트만 남습니다.
    const w2 = sum < 1e-9 ? 0.5 : d1 / sum;
    const lab2 = this.cache.get(p2);
    for (const role of ROLES) {
      oklabMixInto(this.target[role], lab1[role], lab2[role], w2);
    }
    this.mix = [
      { name: p1.name, weight: 1 - w2 },
      { name: p2.name, weight: w2 },
    ];
    // `p1` 이 더 가까우므로 언제나 우세합니다 (`w2 ≤ 0.5`).
    this.dominant = p1.id;
  }

  /** 캐시 배열을 가리키지 않고 값만 옮깁니다. */
  private copyToTarget(lab: LabSet): void {
    for (const role of ROLES) {
      const src = lab[role];
      const dst = this.target[role];
      dst[0] = src[0];
      dst[1] = src[1];
      dst[2] = src[2];
    }
  }

  /** 씬이 읽는 두 형식을 한 번에 만듭니다. */
  private publish(): void {
    for (const role of ROLES) {
      const lab = this.current[role];
      this.hex[role] = oklabToHex(lab);
      const [r, g, b] = oklabToLinear(lab);
      const out = this.resolvedValue[role];
      out[0] = r;
      out[1] = g;
      out[2] = b;
    }
    this.resolvedValue.blend = this.mix;
  }
}

function distance(p: Palette, at: { valence: number; arousal: number }): number {
  const dv = p.anchor.valence - at.valence;
  const da = p.anchor.arousal - at.arousal;
  return Math.hypot(dv, da);
}
