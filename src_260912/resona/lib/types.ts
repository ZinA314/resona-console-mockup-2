/**
 * RESONA 공용 타입.
 * `docs/06-data-model.md` 4절을 옮긴 것입니다. 여기가 타입의 유일한 출처입니다.
 */

/** 오디오 분석 결과. 매 프레임 갱신됩니다. */
export interface MusicAnalysis {
  rms: number; // 0~1
  /** 시정수 0.4초로 평활한 RMS. 상태 판정의 `PEAK` 이 씁니다 (05 2-3절). */
  rmsSlow: number; // 0~1
  peak: number; // 0~1
  flux: number; // 0~1 근사
  centroid: number; // Hz
  bands: [number, number, number, number, number, number]; // SUB LOW LMID MID HI AIR
  stems: [number, number, number, number]; // drums bass vocal other
  stemPeak: [number, number, number, number];

  bpm: number;
  bpmConf: number; // 0~1
  beat: number; // 누적 비트 수
  bar: number; // 마디 번호
  beatInBar: 1 | 2 | 3 | 4;
  phase: number; // 현재 비트 안의 진행 0~1

  onset: 0 | 1;
  onsetPulse: number; // 0~1, 온셋 후 감쇠
  transitionPulse: number; // 0~1, 상태 전이 후 감쇠

  spectrum: Float32Array; // 표시용
}

/** `bands` 의 인덱스. `05-signal-processing.md` 2-5절의 6밴드입니다. */
export const BAND = {
  SUB: 0,
  LOW: 1,
  LMID: 2,
  MID: 3,
  HI: 4,
  AIR: 5,
} as const;

/** `stems` 와 `stemPeak` 의 인덱스. */
export const STEM = {
  DRUMS: 0,
  BASS: 1,
  VOCAL: 2,
  OTHER: 3,
} as const;

export type MusicState =
  | 'SILENT'
  | 'CALM'
  | 'GROOVE'
  | 'BUILD'
  | 'PEAK'
  | 'BREAK';

/**
 * 분위기 다섯 이름. `05-signal-processing.md` 7-5절.
 *
 * **이름은 표시용입니다.** 팔레트 앵커와 화면에 띄우는 글자에만 쓰고, 실제
 * 연출은 `(valence, arousal)` 두 실수를 직접 씁니다. 이름으로 분기해서 화면을
 * 만들면 경계를 넘는 순간 화면이 끊깁니다.
 */
export type MoodName = 'DEEP' | 'SERENE' | 'RADIANT' | 'FERVENT' | 'NEUTRAL';

/** 곡의 성격. `MusicState` 가 순간이라면 이쪽은 곡 단위입니다. */
export interface Mood {
  /** 0~1 밝음. **색**을 정합니다. 시상수 6초 */
  valence: number;
  /** 0~1 격렬함. **결**을 정합니다. 시상수 3초 */
  arousal: number;
  /** 표시용. 연출은 위 두 실수를 직접 씁니다 */
  name: MoodName;
  /** 0~1 화음을 얼마나 확신하는가. 낮으면 `valence` 에서 화음 항의 비중이 줍니다 */
  chromaConf: number;
}

/** 팔레트 역할 다섯. `05-signal-processing.md` 8-1절. */
export type PaletteRole = 'bg' | 'deep' | 'base' | 'accent' | 'hot';

/** 사용자가 고르고 편집하는 팔레트 한 벌. */
export interface Palette {
  id: string;
  /** 화면에 띄우는 이름. `침잠` `평온` 처럼 한글입니다 */
  name: string;
  chips: Record<PaletteRole, string>; // '#RRGGBB'
  /** 자동 선택 후보인가 */
  auto: boolean;
  /** `(valence, arousal)` 평면에서 이 팔레트가 놓인 자리. 끌어서 옮깁니다 */
  anchor: { valence: number; arousal: number };
  /** 기본 제공 여덟 개. 지울 수 없고, 고치면 사본이 만들어집니다 */
  builtin: boolean;
}

/** 보간이 끝나 씬에 넘기는 색. **선형 RGB 0~1** 입니다. */
export interface ResolvedPalette {
  bg: [number, number, number];
  deep: [number, number, number];
  base: [number, number, number];
  accent: [number, number, number];
  hot: [number, number, number];
  /** 화면 표시용 — `[{ name: '침잠', weight: 0.62 }, ...]` */
  blend: { name: string; weight: number }[];
}

export type AudienceState = 'DORMANT' | 'STIRRING' | 'ACTIVE' | 'SURGE';

/** 관객 입력원. 카메라와 마이크가 이 인터페이스를 각각 구현합니다. */
export interface AudienceSource {
  readonly kind: 'camera' | 'microphone' | 'simulation' | 'none';
  start(): Promise<void>;
  stop(): void;
  read(dt: number): number; // 0~1
  readonly calibration: number; // 0~1
}

/** 연출 번역 엔진의 출력 */
export interface DirectionParams {
  density: number;
  scale: number;
  speed: number;
  brightness: number;
  hue: number;
  expansion: number;
  glitch: number;
  /** 0 날카로움 ↔ 1 번짐. 무대 씬의 결을 정합니다 (F-405) */
  dreaminess: number;
  /** 이 프레임의 색 */
  palette: ResolvedPalette;
  /** 지금 곡의 성격 */
  mood: Mood;
  /**
   * 관객 기여분을 화면에 표시하기 위한, 음악만으로 계산한 같은 값들.
   *
   * `palette` 와 `mood` 가 빠져 있는 것이 8-6절의 원칙입니다. **관객은 색을
   * 바꾸지 않으므로** 색에는 "음악만" 판본이 있을 수 없습니다. 타입이 그것을
   * 막고 있으니 여기에 색을 더하지 마십시오.
   */
  musicOnly: Omit<DirectionParams, 'musicOnly' | 'palette' | 'mood'>;
}

export type SceneKind =
  | 'weave'
  | 'type'
  | 'faces'
  | 'spectrum'
  | 'composite'
  | 'bloom';

/** 07 씬 파라미터 패널이 다루는 값 (F-508). `03-screens.md` 07 절. */
export interface SceneParams {
  common: { intensity: number; trail: number; grain: number; glitch: number };
  weave: { warp: number; weft: number; tension: number; rate: number; split: boolean };
  bloom: {
    maxParticles: number;
    warpScale: number;
    bloomRadius: number;
    bloomStrength: number;
  };
  composite: { base: 'weave' | 'bloom' };
}

/** 07 패널의 `자동` 버튼이 되돌리는 자리. `03-screens.md` 07 절의 표 그대로입니다. */
export const DEFAULT_SCENE_PARAMS: SceneParams = {
  common: { intensity: 1.0, trail: 0.62, grain: 0.22, glitch: 0.18 },
  weave: { warp: 48, weft: 30, tension: 0.52, rate: 2, split: true },
  bloom: { maxParticles: 6000, warpScale: 1.0, bloomRadius: 1.0, bloomStrength: 1.0 },
  composite: { base: 'bloom' },
};

export interface Preset {
  id: string;
  name: string;
  trackId: string | null;
  scene: SceneKind;
  influence: number; // 관객 영향력 0~1
  intensity: number;
  trail: number;
  grain: number;
  glitch: number;
  audienceKind: AudienceSource['kind'];
  /** F-303-2. 탭이나 배수 보정으로 확정한 BPM. null 이면 자동 추정에 맡깁니다. */
  lockedBpm: number | null;
  tempoLocked: boolean;
  /** F-1002. 선택한 팔레트와 자동 전환 설정. */
  paletteId: string | null;
  paletteAuto: boolean;
  /** 색 전환 시상수(초) 0.5~8 */
  paletteFade: number;
  /** F-405. null 이면 자동 판정(`1 − arousal`)을 씁니다. */
  dreaminessLock: number | null;
  /** F-508. 씬별 조절 값. */
  sceneParams: SceneParams;
  overrides: Partial<Record<keyof DirectionParams, number>>;
}

export interface LyricLine {
  /**
   * 초. **`null` 이면 시각 미정입니다.**
   *
   * 붙여 넣은 가사에 시각이 아직 안 붙은 줄이 섞입니다. 그런 줄을 파싱에서
   * 버리면 `길이에 균등 배분` 이 나눌 대상이 이미 사라지고, "앞부분만 찍어
   * 두고 뒤는 아직" 이라는 흔한 상태를 다룰 수 없습니다. 큐에 남겨 두고
   * 재생·내보내기에서만 건너뜁니다.
   */
  t: number | null;
  text: string;
  words: string[];
}

/**
 * 지금 어느 줄의 어디를 부르고 있는가 (F-602).
 *
 * 매 프레임 바뀌는 값이라 React 상태에 넣지 않습니다. 씬은 `SceneInput` 으로
 * 받고, 03 패널은 줄이 바뀌는 순간에만 상태로 올립니다.
 */
export interface LyricCue {
  /**
   * 현재 줄. 첫 줄이 시작하기 전이면 −1 입니다.
   * **`lines` 배열의 원래 번호입니다** — 시각 미정 줄을 건너뛴 뒤의 번호가
   * 아닙니다. 편집기의 줄 목록이 이 번호로 행을 강조합니다.
   */
  index: number;
  /**
   * 시각이 붙은 줄만 셌을 때 지금이 몇 번째인가. 첫 줄 전이면 0 입니다.
   *
   * `index` 와 다릅니다. 03 패널 머리의 `n / 총` 은 이 값을 씁니다 — 줄
   * 목록의 행 번호를 쓰면, 시각 미정 줄이 섞여 있을 때 재생 중에 번호가
   * 건너뛰고 끝내 총 줄 수에 닿지 못합니다.
   */
  ordinal: number;
  /** 시각이 붙어 재생에 쓰이는 줄의 수. 시각 미정 줄은 세지 않습니다 */
  total: number;
  line: LyricLine | null;
  /** 다음 줄. 마지막 줄이면 null 입니다 */
  next: LyricLine | null;
  /** 현재 줄 안의 진행 0~1. 다음 줄까지의 실제 간격을 기준으로 합니다 */
  progress: number;
  /** 지금 부르고 있는 단어. 줄이 없거나 빈 줄이면 −1 입니다 */
  word: number;
}
