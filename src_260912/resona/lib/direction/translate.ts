/**
 * ★ 연출 번역 — 두 신호가 합쳐지는 곳.
 * `docs/05-signal-processing.md` 6-2·6-3절.
 *
 * **이 파일이 이 프로젝트의 주장입니다.**
 *
 *   음악이 "무엇을 연출할지" 를 정하고,
 *   관객 반응이 "그것을 얼마나 강하게 할지" 를 정한다.
 *
 * 관객 값이 곱해지는 자리는 아래 `amplify` 한 곳뿐입니다. 여기저기 흩어지면
 * 나중에 읽는 사람이 어디서 합쳐지는지 찾을 수 없습니다. 새 파라미터를
 * 더하더라도 결합은 반드시 이 함수를 지나게 하십시오.
 */
import { clamp } from '@/lib/util';
import { hueOf } from '@/lib/render/palette';
import { DENSITY_BY_STATE } from '@/lib/direction/state';
import {
  BAND,
  type DirectionParams,
  type Mood,
  type MusicAnalysis,
  type MusicState,
  type ResolvedPalette,
} from '@/lib/types';
import type { PaletteRoles } from '@/lib/render/types';

/** 6-3절의 관객 증폭 폭. 각 파라미터가 관객에게 얼마나 열려 있는지입니다. */
const GAIN = {
  /** 관객이 많이 반응할수록 요소가 늘어납니다. */
  density: 0.8,
  /** 저역과 관객이 함께 크기를 키웁니다. */
  scale: 0.5,
  /** 속도는 음악이 거의 결정합니다. */
  speed: 0.15,
  brightness: 0.6,
  /** **관객이 주도하는 유일한 파라미터입니다.** */
  expansion: 1.5,
  glitch: 0.4,
  /**
   * **유일한 음수입니다** (7-6절). 관객이 뜨거울수록 화면이 날카로워지므로
   * 몽환도는 내려갑니다. 08 패널에서 이 항목만 두 층의 방향이 반대인 이유가
   * 이 부호 하나입니다.
   */
  dreaminess: -0.35,
  /**
   * 색은 관객이 바꾸지 않습니다. 관객이 색까지 바꾸면 연출가가 곡마다 잡아 둔
   * 색채 계획이 무너집니다. 관객은 강도를 바꾸고 색은 음악이 정합니다.
   */
  hue: 0,
} as const;

type MusicOnly = DirectionParams['musicOnly'];

export interface TranslateContext {
  music: MusicAnalysis;
  state: MusicState;
  /** 관객 에너지 0~1. 입력이 없으면 0 입니다 */
  audienceEnergy: number;
  /** 관객 영향력 0~1. 0 이면 음악만으로 동작합니다 */
  influence: number;
  /** 지금 곡의 성격. 분위기가 `dreaminess` 와 색을 정합니다 */
  mood: Mood;
  /** 씬이 쓰는 색 hex 다섯. `hue` 를 뽑는 데 씁니다 */
  roles: PaletteRoles;
  /** 씬에 그대로 넘길 선형 RGB */
  palette: ResolvedPalette;
  /** F-405. 오퍼레이터가 몽환도를 고정했다면 그 값. 없으면 null */
  dreaminessLock: number | null;
}

/** 음악과 관객을 결합해 연출 파라미터를 만듭니다. */
export function translate(c: TranslateContext): DirectionParams {
  // ── 두 신호가 만나는 단 한 줄 ──
  // `influence` 가 0 이면 `audEff` 도 0 이 되어 음악만으로 동작합니다.
  // 관객 입력이 없거나 믿을 수 없을 때 안전하게 물러설 수 있어야 합니다.
  const audEff = clamp(c.audienceEnergy, 0, 1) * clamp(c.influence, 0, 1);

  return {
    ...derive(c, audEff),
    // 8-6절. **색과 분위기는 관객을 지나지 않습니다.** `musicOnly` 에 이 둘이
    // 없는 것이 그 원칙이고, 타입이 그것을 막고 있습니다.
    palette: c.palette,
    mood: c.mood,
    // 08 패널이 두 층으로 그리려면 관객을 뺀 값도 필요합니다.
    // 같은 함수를 `audEff = 0` 으로 한 번 더 부릅니다. 식을 복사해 두면
    // 한쪽만 고쳐져 두 층의 차이가 거짓말이 됩니다.
    musicOnly: derive(c, 0),
  };
}

/**
 * 결합의 실제 계산.
 *
 * 기본 형태는 **곱이 아니라 가산 증폭**입니다.
 *
 *   final = base × (1 + audEff × gain)
 *
 * 곱으로 하면 관객이 조용할 때 화면이 꺼져 버립니다. 음악만으로도 기본
 * 연출은 성립하고, 관객이 그 위에 얹히는 구조여야 합니다.
 */
function derive(c: TranslateContext, audEff: number): MusicOnly {
  const { music, state } = c;
  const amplify = (base: number, gain: number) =>
    clamp(base * (1 + audEff * gain), 0, 1);

  // 7-6절. 고정하면 자동 판정을 무시합니다. 다만 관객은 그대로 태웁니다 —
  // 고정은 "이 곡의 결을 내가 정하겠다" 는 뜻이지 관객을 끄겠다는 뜻이 아니고,
  // 08 패널의 몽환도 행은 언제나 두 층의 방향이 반대여야 하기 때문입니다.
  const dreamBase = c.dreaminessLock ?? 1 - c.mood.arousal;

  return {
    density: amplify(DENSITY_BY_STATE[state] * (0.4 + music.rms * 0.6), GAIN.density),
    scale: amplify(0.3 + music.bands[BAND.LOW] * 0.7, GAIN.scale),
    // 속도만 0~1 이 아닙니다. 0.5 배에서 2 배 사이의 배속입니다.
    speed: clamp(music.bpm / 120, 0.5, 2.0) * (1 + audEff * GAIN.speed),
    brightness: amplify(0.25 + music.rms * 0.75, GAIN.brightness),
    expansion: amplify(0.1, GAIN.expansion),
    glitch: amplify(
      music.onsetPulse * 0.6 + music.transitionPulse * 0.4,
      GAIN.glitch,
    ),
    dreaminess: amplify(clamp(dreamBase, 0, 1), GAIN.dreaminess),
    // 팔레트 accent 의 색상각. 외부 연동 하위 호환용이라 화면은 쓰지 않습니다.
    // 씬은 색을 팔레트 역할에서 직접 가져옵니다.
    hue: hueOf(c.roles.accent),
  };
}

/** `speed` 가 닿을 수 있는 최대치. 08 패널이 막대 길이를 맞추는 데 씁니다. */
export const SPEED_MAX = 2.0 * (1 + GAIN.speed);
