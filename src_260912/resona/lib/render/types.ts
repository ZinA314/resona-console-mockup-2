/**
 * 씬 렌더링의 공통 계약.
 *
 * 씬은 React 컴포넌트가 아니라 순수 그리기 함수입니다. 매 프레임 도는 코드가
 * 리렌더를 일으키면 안 되기 때문입니다. 상태가 필요한 씬은 클래스로 만들어
 * 자기 안에 들고 있습니다.
 *
 * 콘솔과 출력 창이 같은 씬 코드를 씁니다. 콘솔은 엔진에서 직접 값을 읽고,
 * 출력 창은 `BroadcastChannel` 로 받은 값을 넣습니다. 그래서 씬은 엔진을
 * 알지 못하고 `SceneInput` 만 받습니다.
 */
import type {
  AudienceState,
  DirectionParams,
  LyricCue,
  MusicAnalysis,
  MusicState,
  SceneKind,
  SceneParams,
} from '@/lib/types';

/**
 * 팔레트 역할 다섯. `05-signal-processing.md` 8-1절.
 * 씬은 색을 직접 쓰지 않고 이 다섯으로만 그립니다. 그래야 팔레트를 갈아
 * 끼워도 씬 코드를 고칠 일이 없습니다.
 */
export interface PaletteRoles {
  bg: string;
  deep: string;
  base: string;
  accent: string;
  hot: string;
}

/**
 * `03-screens.md` 2절의 콘솔 색 토큰. globals.css 에서 한 번 읽어 옵니다.
 *
 * 무대 화면의 색이 아닙니다. 콘솔 UI 는 어두운 회색과 청록·빨강으로 고정하고,
 * 씬이 그리는 색은 `PaletteRoles` 에서 옵니다. 두 체계를 섞지 마십시오.
 */
export interface ConsoleColors {
  void: string;
  panel: string;
  panel2: string;
  rule: string;
  bone: string;
  dim: string;
  alert: string;
  cyan: string;
}

/** 사용자가 조작하는 값. 5단계에서 `DirectionParams` 로 대체됩니다. */
export interface StageSettings {
  scene: SceneKind;
  intensity: number;
  trail: number;
  grain: number;
  glitch: number;
  blackout: boolean;
}

/**
 * 스펙트럼 배열의 가로축 해석.
 * 엔진은 선형(빈 번호 × binHz)으로 주고, 출력 창으로 보낼 때는 화면 축과 같은
 * 로그 간격으로 다시 뜹니다. 선형인 채로 줄이면 저역에 점이 두세 개만 남습니다.
 */
export type SpectrumScale = 'linear' | 'log';

export interface SceneInput {
  analysis: MusicAnalysis;
  spectrumScale: SpectrumScale;
  /** 씬이 쓰는 색. 5-B 에서 분위기에 따라 갈아 끼웁니다. */
  roles: PaletteRoles;
  /** 연출 번역 엔진의 출력. 씬은 이것을 읽어 그립니다. */
  params: DirectionParams;
  /** 지금의 음악 상태. */
  musicState: MusicState;
  /**
   * 씬이 쓰는 초 단위 시각. **`AudioContext.currentTime` 입니다** (#16).
   * rAF 로 누적하면 창이 가려진 동안 멈춰, 다시 열었을 때 그만큼 뒤처집니다.
   */
  time: number;
  /** 스펙트럼 씬이 아래에 겹쳐 그리는 파형. */
  waveform: Float32Array;
  /** 주파수 축을 Hz 로 환산하는 데 씁니다. */
  sampleRate: number;
  /** 관객 에너지 0~1. 입력이 없으면 0 입니다. */
  audience: number;
  /** 관객 상태 이름. 관객 씬이 표시합니다. */
  audienceState: AudienceState;
  /** 카메라 64×36 격자. 신호가 없으면 전부 0 입니다. */
  audienceField: Float32Array;
  /** 관객 입력이 붙어 있는가. 관객 씬의 안내 문구를 가릅니다. */
  audienceLive: boolean;
  /** 07 패널의 씬별 조절 값 (F-508). */
  sceneParams: SceneParams;
  /**
   * 가사 큐 (F-602). 가사 씬과 합성 씬이 씁니다.
   *
   * 곡 안의 위치에서 뽑은 값입니다. 씬은 `time` 으로 이것을 다시 계산할 수
   * 없습니다 — `time` 은 `AudioContext.currentTime` 이라 곡의 위치가 아닙니다.
   */
  lyrics: LyricCue;
  settings: StageSettings;
}

export interface SceneFrame {
  ctx: CanvasRenderingContext2D;
  /** CSS 픽셀 기준 크기. `devicePixelRatio` 는 변환 행렬이 처리합니다. */
  w: number;
  h: number;
  /** 무대 씬이 점 크기와 렌더 타깃 크기를 잡는 데 씁니다. */
  dpr: number;
  dt: number;
  /** 초 단위 시각. `AudioContext.currentTime` 에서 옵니다. */
  time: number;
  tokens: ConsoleColors;
  input: SceneInput;
}

export interface Scene {
  draw(f: SceneFrame): void;
  /** 소스가 바뀌면 쌓아 둔 것을 비웁니다. */
  reset(): void;
}
