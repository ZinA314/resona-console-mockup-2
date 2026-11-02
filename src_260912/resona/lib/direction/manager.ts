'use client';

/**
 * 연출 번역을 프레임 루프에 붙입니다.
 * `docs/04-flows.md` 4절의 4·5번 자리입니다.
 *
 * 계산 자체는 `state.ts` · `mood.ts` · `translate.ts` 와 `lib/palette/` 에
 * 있습니다. 이 파일은 값을 모아 넘기고 결과를 들고 있을 뿐입니다.
 */
import { audienceManager } from '@/lib/audience/manager';
import { audioEngine } from '@/lib/audio/engine';
import { MoodDetector } from '@/lib/direction/mood';
import { MusicStateDetector } from '@/lib/direction/state';
import { translate } from '@/lib/direction/translate';
import { PaletteResolver } from '@/lib/palette/resolve';
import { useConsoleStore } from '@/lib/store';
import type { PaletteRoles } from '@/lib/render/types';
import type { DirectionParams, Mood, MusicState, ResolvedPalette } from '@/lib/types';

function emptyPalette(): ResolvedPalette {
  return {
    bg: [0, 0, 0],
    deep: [0, 0, 0],
    base: [0, 0, 0],
    accent: [0, 0, 0],
    hot: [0, 0, 0],
    blend: [],
  };
}

function emptyMood(): Mood {
  return { valence: 0.5, arousal: 0, name: 'NEUTRAL', chromaConf: 0 };
}

function emptyParams(): DirectionParams {
  const zero = {
    density: 0,
    scale: 0,
    speed: 1,
    brightness: 0,
    expansion: 0,
    glitch: 0,
    dreaminess: 1,
    hue: 0,
  };
  return {
    ...zero,
    palette: emptyPalette(),
    mood: emptyMood(),
    musicOnly: { ...zero },
  };
}

class DirectionManager {
  private detector = new MusicStateDetector();
  private moodDetector = new MoodDetector();
  private resolver = new PaletteResolver();
  private current: DirectionParams = emptyParams();
  state: MusicState = 'SILENT';

  /** 이번 프레임의 연출 파라미터. 씬과 08 패널이 읽습니다. */
  get params(): DirectionParams {
    return this.current;
  }

  /** 지금 곡의 성격. 05 팔레트 패널의 2축 평면이 읽습니다. */
  get mood(): Mood {
    return this.moodDetector.mood;
  }

  /** 씬이 쓰는 hex 다섯. 캔버스 2D 는 문자열만 받습니다. */
  get roles(): PaletteRoles {
    return this.resolver.roles;
  }

  /**
   * 지금 섞임에서 우세한 팔레트. `자동` 을 토글로 끌 때 이것이 선택됩니다
   * (8-5절). 스토어가 이 값을 직접 읽으면 순환 참조가 되므로, 부르는 쪽이
   * 읽어서 넘깁니다.
   */
  get dominantPaletteId(): string {
    return this.resolver.dominantId;
  }

  /** 매 프레임 부릅니다. 분석과 관객을 읽은 **뒤**, 씬을 그리기 **전**입니다. */
  update(dt: number): void {
    const analysis = audioEngine.analysis;
    const settings = useConsoleStore.getState();

    // 4) 음악 상태 판정
    this.state = this.detector.update(analysis, dt);
    // 상태 전이 펄스는 분석값의 한 자리입니다(06-data-model 4절). 판정이
    // 여기서 나므로 되돌려 써 둡니다. `glitch` 가 이 값을 읽습니다.
    analysis.transitionPulse = this.detector.transitionPulse;

    // 4-2) 곡의 성격. 상태가 순간이라면 이쪽은 곡 단위입니다 (7절)
    const mood = this.moodDetector.update(analysis, audioEngine.spectrumBinHz, dt);

    // 4-3) 색. **관객은 이 계산에 들어가지 않습니다** (8-6절)
    this.resolver.update(dt, {
      palettes: settings.palettes,
      selectedId: settings.paletteId,
      auto: settings.paletteAuto,
      fade: settings.paletteFade,
      valence: mood.valence,
      arousal: mood.arousal,
    });

    // 5) 연출 파라미터 산출 — 두 신호가 합쳐지는 지점
    this.current = translate({
      music: analysis,
      state: this.state,
      audienceEnergy: audienceManager.reading.energy,
      influence: settings.influence,
      mood,
      roles: this.resolver.roles,
      palette: this.resolver.resolved,
      dreaminessLock: settings.dreaminessLock,
    });
  }

  /**
   * 새 곡을 로드하면 부릅니다. 곡이 바뀌면 성격도 바뀌므로 `valence` 의
   * 6초짜리 평활이 이전 곡을 끌고 가지 않게 비웁니다.
   *
   * **팔레트 보간기는 비우지 않습니다.** 색은 곡을 건너 이어져야 합니다.
   * 여기서 비우면 곡을 바꾸는 순간 색이 한 프레임에 튀고, 그것이 8-4절이
   * 막으려는 바로 그 장면입니다.
   */
  reset(): void {
    this.detector.reset();
    this.moodDetector.reset();
    this.current = emptyParams();
    this.state = 'SILENT';
  }
}

export const directionManager = new DirectionManager();
