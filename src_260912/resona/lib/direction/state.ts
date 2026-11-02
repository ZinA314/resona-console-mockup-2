/**
 * 음악 상태 판정. `docs/05-signal-processing.md` 6-1절.
 *
 * 여섯 상태를 위에서부터 검사해 먼저 맞는 것을 채택합니다. 상태는 최소
 * 1.2초를 유지합니다. 그보다 짧게 바뀌면 화면이 깜빡여 보입니다.
 */
import type { MusicAnalysis, MusicState } from '@/lib/types';

/** 판정 문턱. 6-1절의 표 그대로입니다. */
const SILENT_RMS = 0.04;
const SILENT_HOLD = 0.5;
const BREAK_RATIO = 0.45;
/**
 * PEAK 문턱. 6-1절의 절차대로 실측해 정했습니다.
 * `test-03` 에서 GROOVE 구간 `rmsSlow` 최대 0.423, PEAK 구간 최소 0.444 로
 * 겹치지 않아 그 가운데를 잡았습니다. `knockout.mp3` 의 분포도 중앙 0.238 과
 * p75 0.508 로 갈리는데 이 값이 그 빈 구간에 들어갑니다.
 */
const PEAK_TH = 0.434;
const GROOVE_CONF = 0.45;

/**
 * BUILD 기울기 문턱(초당). 실측으로 정했습니다.
 * `test-03` 에서 GROOVE 중앙 0.003, BUILD 중앙 0.013 으로 겹쳐 가운데를
 * 잡았습니다.
 *
 * **BUILD 조건은 이 하나뿐입니다. 플럭스를 다시 넣지 마십시오.**
 * `flux` 는 온셋의 양이라 곡이 세지는 것이 아니라 음색이 바뀌는 것에
 * 반응합니다. 정점에서 새 악기가 들어오면 오르고, 빌드업 후반은 같은 소리가
 * 커지기만 하므로 오히려 낮습니다. 실측에서 `fluxRise > 1.15` 통과가
 * BUILD 4/12, PEAK 4/8 로 **판별 방향이 반대였습니다.** 기울기가 가장 가파른
 * 구간(slope 0.010→0.046)을 오히려 막습니다. 문턱을 낮춰도 PEAK 에서 함께
 * 통과하므로 소용이 없습니다. 05 6-1절에 근거를 적어 두었습니다.
 */
const SLOPE_TH = 0.008;

/**
 * 상태 최소 유지 시간.
 *
 * **새 후보가 이만큼 이어져야 채택합니다.** 현재 상태를 이만큼 붙잡는 방식이
 * 아닙니다. RMS 는 킥마다 오르내리므로, 붙잡는 방식으로 하면 1.2초 경계마다
 * 그 순간의 값으로 상태가 정해져 고조↔그루브가 계속 뒤집힙니다.
 * 명세의 목적은 깜빡임을 막는 것이므로 후보 쪽에 겁니다.
 */
const MIN_HOLD = 1.2;

/**
 * `BREAK` 은 즉시 채택하되 이만큼은 유지합니다.
 * 음악이 뚝 끊긴 순간이 무대에서 가장 극적이라 1.2초를 기다리면 늦은 티가
 * 납니다. 대신 다음 프레임에 곧바로 되돌아가지 않도록 걸어 둡니다.
 */
const BREAK_MIN_HOLD = 0.8;

/** 이력을 담는 주기와 길이. rmsSlope 가 3초 구간을 보므로 넉넉히 4초분입니다. */
const SAMPLE_HZ = 30;
const HISTORY = SAMPLE_HZ * 4;
/** BREAK 판정이 보는 직전 구간. */
const BREAK_WINDOW = SAMPLE_HZ * 2;
/** rmsSlope 를 재는 구간. */
const SLOPE_WINDOW = SAMPLE_HZ * 3;


/**
 * 상태 전이 펄스가 사그라지는 시정수(초).
 * 명세에 값이 없어 정했습니다. 온셋 펄스(0.12초)보다 길게 둔 것은 상태 전이가
 * 훨씬 드물게 일어나고, 곡의 국면이 바뀌었다는 신호라 화면에 더 오래 남아야
 * 하기 때문입니다.
 */
const TRANSITION_TAU = 0.35;

export class MusicStateDetector {
  state: MusicState = 'SILENT';
  /** 0~1, 상태 전이 후 감쇠. `MusicAnalysis.transitionPulse` 로 나갑니다. */
  transitionPulse = 0;
  /** 초당 RMS 기울기. `rising()` 이 매 프레임 한 번만 구하도록 들고 있습니다. */
  private rmsSlope = 0;

  private rms = new Float32Array(HISTORY);
  private idx = 0;
  private filled = 0;
  private acc = 0;

  private silentFor = 0;
  /** 최근 1.2초의 판정 이력. 어느 후보가 우세한지 재는 데 씁니다. */
  private recent: Array<{ s: MusicState; dt: number }> = [];
  private recentTime = 0;
  private candidate: MusicState = 'SILENT';
  /** 지금 상태로 있은 시간. `BREAK` 최소 유지에 씁니다. */
  private stateFor = 0;

  /** 매 프레임 부릅니다. */
  update(a: MusicAnalysis, dt: number): MusicState {
    this.transitionPulse *= Math.exp(-dt / TRANSITION_TAU);
    this.silentFor = a.rms < SILENT_RMS ? this.silentFor + dt : 0;
    this.stateFor += dt;

    this.acc += dt;
    if (this.acc >= 1 / SAMPLE_HZ) {
      this.acc = 0;
      this.rms[this.idx] = a.rms;
      this.idx = (this.idx + 1) % HISTORY;
      if (this.filled < HISTORY) this.filled += 1;
    }

    this.rmsSlope = this.slope(this.rms, SLOPE_WINDOW) * SAMPLE_HZ;

    const next = this.classify(a);
    this.candidate = next;

    // 최근 1.2초 창을 굴립니다.
    this.recent.push({ s: next, dt });
    this.recentTime += dt;
    // 창이 최소 1.2초는 남도록 앞에서만 덜어냅니다. 1.2초 미만으로 깎으면
    // 아래 `dominates` 가 영영 참이 되지 않습니다.
    while (
      this.recent.length > 1 &&
      this.recentTime - this.recent[0].dt >= MIN_HOLD
    ) {
      this.recentTime -= this.recent.shift()!.dt;
    }
    if (next === this.state) return this.state;

    // BREAK 의 최소 유지가 끝나야 다른 후보로 넘어갈 수 있습니다.
    if (this.state === 'BREAK' && this.stateFor < BREAK_MIN_HOLD) return this.state;

    // SILENT 는 조건 자체에 0.5초 지속이 들어 있어 이미 흔들리지 않습니다.
    // BREAK 은 즉시 반응해야 무대에서 늦은 티가 나지 않습니다.
    if (next === 'SILENT' || next === 'BREAK') {
      this.adopt(next);
      return this.state;
    }

    // 나머지 넷은 두 조건을 함께 겁니다. 우세만 보면 전이 직후에도 뒤 창이
    // 이미 차 있어 0.8초 만에 또 바뀝니다.
    if (this.stateFor >= MIN_HOLD && this.dominates(next)) this.adopt(next);
    return this.state;
  }

  private adopt(next: MusicState): void {
    this.state = next;
    this.stateFor = 0;
    this.transitionPulse = 1;
  }

  /**
   * 그 후보가 최근 1.2초의 절반을 넘게 차지했는가.
   *
   * "1.2초 연속" 으로 읽으면 잡음 한 프레임에 카운터가 되돌아갑니다. 실제
   * 분류기는 우세한 상태 사이사이에 다른 상태를 7~10% 섞어 내므로, 연속을
   * 요구하면 어느 후보도 1.2초를 채우지 못하고 첫 상태에 눌러앉습니다.
   * 깜빡임을 막는다는 목적은 "우세" 로도 그대로 지켜집니다.
   */
  private dominates(next: MusicState): boolean {
    if (this.recentTime < MIN_HOLD) return false;
    let held = 0;
    for (const r of this.recent) if (r.s === next) held += r.dt;
    return held > this.recentTime * 0.5;
  }

  /** 위에서부터 먼저 맞는 것을 채택합니다. */
  private classify(a: MusicAnalysis): MusicState {
    if (this.silentFor >= SILENT_HOLD) return 'SILENT';

    // 직전 2초 평균의 45% 아래로 급락했는가.
    const recent = this.mean(this.rms, BREAK_WINDOW);
    if (recent > SILENT_RMS && a.rms < recent * BREAK_RATIO) return 'BREAK';

    // **BUILD 를 PEAK 보다 먼저 봅니다.** 세기 하나로는 두 구간이 갈리지
    // 않습니다. 빌드업은 정점 직전에 가장 커지므로 BUILD 끝이 PEAK 대부분보다
    // 큽니다. 가르는 것은 기울기 부호입니다 — BUILD 는 오르는 중(+0.013),
    // PEAK 은 이미 올라와 평평하거나 내려가는 중(−0.009)입니다.
    if (this.rising()) return 'BUILD';

    // `rmsSlow`(0.4초 평활) 하나만 봅니다. `bands[HI]` 조건은 뺐습니다 —
    // PEAK 은 "가장 센 구간"이지 "밝은 구간"이 아니고, 음색의 밝기는 7절의
    // `valence` 가 전담합니다.
    if (a.rmsSlow > PEAK_TH) return 'PEAK';

    if (a.bpmConf > GROOVE_CONF && a.bpm > 0) return 'GROOVE';

    return 'CALM';
  }

  /**
   * BUILD 정량 조건. 6-1절.
   *
   *   rmsSlope > 0.008 (초당)
   *
   * 조건은 이 하나뿐입니다. 앞뒤 반쪽 평균을 비교하면 구간 안의 한 번의 튐에
   * 휘둘리므로, 3초 구간 전체의 최소제곱 회귀를 씁니다.
   */
  private rising(): boolean {
    if (this.filled < HISTORY) return false;
    return this.rmsSlope > SLOPE_TH;
  }

  /** 최소제곱 기울기(표본당). 오래된 것부터 최근 순으로 읽습니다. */
  private slope(buf: Float32Array, count: number): number {
    const n = Math.min(count, this.filled);
    const meanX = (n - 1) / 2;
    let meanY = 0;
    for (let i = 0; i < n; i += 1) {
      meanY += buf[(this.idx - n + i + HISTORY * 2) % HISTORY];
    }
    meanY /= n;

    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i += 1) {
      const dx = i - meanX;
      const y = buf[(this.idx - n + i + HISTORY * 2) % HISTORY];
      num += dx * (y - meanY);
      den += dx * dx;
    }
    return den === 0 ? 0 : num / den;
  }

  /**
   * 최근 `count` 개의 평균. `skip` 을 주면 그만큼 더 앞선 구간을 봅니다.
   * 원형 버퍼라 인덱스를 되감아 읽습니다.
   */
  private mean(buf: Float32Array, count: number, skip = 0): number {
    const n = Math.min(count, Math.max(0, this.filled - skip));
    if (n === 0) return 0;
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      const at = (this.idx - 1 - skip - i + HISTORY * 2) % HISTORY;
      sum += buf[at];
    }
    return sum / n;
  }

  reset(): void {
    this.state = 'SILENT';
    this.transitionPulse = 0;
    this.rms.fill(0);
    this.idx = 0;
    this.filled = 0;
    this.acc = 0;
    this.silentFor = 0;
    this.candidate = 'SILENT';
    this.recent.length = 0;
    this.recentTime = 0;
    this.stateFor = 0;
  }
}

/** 화면에 적는 이름. */
export const MUSIC_STATE_LABEL: Record<MusicState, string> = {
  SILENT: '무음',
  CALM: '잔잔함',
  GROOVE: '그루브',
  BUILD: '고조',
  PEAK: '정점',
  BREAK: '브레이크',
};

/** 6-3절의 상태별 `density` 기본값. */
export const DENSITY_BY_STATE: Record<MusicState, number> = {
  SILENT: 0.05,
  CALM: 0.25,
  GROOVE: 0.5,
  BUILD: 0.7,
  PEAK: 0.95,
  BREAK: 0.15,
};
