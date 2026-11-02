/**
 * 템포 추정과 비트 트래킹. `docs/05-signal-processing.md` 3-2·3-3·3-4절.
 *
 * 화면 갱신 주기는 기기마다 다르므로, 온셋 세기를 100Hz 고정 주기 버퍼에 따로
 * 쌓고 그 버퍼에서만 주기를 찾습니다. 이렇게 하지 않으면 같은 곡이 기기에 따라
 * 다른 BPM 으로 잡힙니다.
 *
 * 자기상관의 단일 최대값만 쓰면 8분음표 주기나 2마디 주기에 걸립니다. 배음까지
 * 함께 보는 빗살 점수와 옥타브 접기가 그것을 막는 장치입니다. 가중치를 바꾸면
 * 절반·두 배 오검출이 돌아옵니다.
 */
import { clamp, lerp } from '@/lib/util';

/** 온셋 엔벨로프의 고정 적재 주기. */
const ENV_HZ = 100;
const ENV_PERIOD = 1 / ENV_HZ;
/** 약 10초. 최대 지연 400 샘플의 자기상관을 낼 만큼은 되어야 합니다. */
const ENV_LEN = 1024;
/** 누적값을 줄여 다음 구간에 번지지 않게 합니다. */
const ENV_DECAY = 0.4;

/** 60~200 BPM 에 해당하는 지연 구간. lag = 60 × ENV_HZ / BPM */
const LAG_MIN = Math.round((60 * ENV_HZ) / 200); // 30
const LAG_MAX = Math.round((60 * ENV_HZ) / 60); //  100
/** 배음 확인을 위해 최대 지연의 4배까지 미리 구합니다. */
const LAG_HARMONIC = 4;

/** 추정 주기와 최소 적재량. */
const ESTIMATE_INTERVAL = 0.4;
const MIN_SAMPLES = 400;

/** 빗살 점수의 배음 가중치. */
const COMB = [1, 0.62, 0.38, 0.22];
const COMB_SUM = COMB[0] + COMB[1] + COMB[2] + COMB[3];


/**
 * 템포 연속성 가중. 곡 중간에 템포가 튀는 것을 막습니다.
 * 가중에 `bpmConf` 를 곱하는 것이 중요합니다. 이것이 빠지면 분석 창이 짧은
 * 초반에 우연히 앞선 후보가 자기 자신을 계속 강화해, 같은 곡을 틀어도 실행마다
 * 다른 BPM 에 고착됩니다.
 */
const CONTINUITY_GAIN = 0.3;
const CONTINUITY_WIDTH = 5.5;

/** 옥타브 접기 범위. */
const BPM_LO = 72;
const BPM_HI = 182;

/** 갱신 폭. 큰 차이는 빠르게, 작은 차이는 천천히 따라갑니다. */
const JUMP_THRESHOLD = 2.2;
const FOLLOW_FAST = 0.3;
const FOLLOW_SLOW = 0.1;

/** 위상 스냅을 허용하는 범위(주기 대비). */
const SNAP_WINDOW = 0.3;
/** BPM 이 아직 없을 때 온셋을 비트로 취급하는 최소 간격. */
const FALLBACK_BEAT_GAP = 0.28;

/**
 * 무음 게이트. 3-4절.
 * 예측만으로 박을 찍는 구조라 그대로 두면 곡이 끝난 뒤에도 마디가 계속 오릅니다.
 * 2.0초는 곡 중간의 브레이크(보통 4초 이하)에서는 BPM 을 유지하면서,
 * 소리가 없는 동안 화면이 혼자 박자를 치는 것만 막는 기준입니다.
 */
const SILENCE_RMS = 0.02;
const SILENCE_HOLD = 2.0;

/** 신뢰도 평활. */
const CONF_SMOOTH = 0.3;

/**
 * 화면에 BPM 을 숫자로 내놓는 최소 신뢰도. `docs/03-screens.md` 2절.
 *
 * 이 아래에서는 `---` 입니다. 마디·박이 비어 있는데 BPM 만 숫자로 떠 있으면
 * 읽는 사람이 아직 유효한 값으로 오해합니다.
 *
 * 실측 — 조용한 방을 마이크로 받으면 0.06~0.12 가 나옵니다. 잡음에서도 추정기가
 * 돌기 때문입니다. 타악이 있는 음악은 0.64~0.79, 데모 신스는 0.74 였습니다.
 * 그 사이가 넓어 0.20 은 어디에 두어도 같게 동작하는 자리입니다.
 *
 * 잠금 중에는 적용하지 않습니다. 사람이 정한 값이기 때문입니다 (F-303-2).
 */
export const BPM_CONF_SHOW = 0.2;

/** 이 아래는 숫자를 흐리게 씁니다. 값은 있으나 근거가 얕다는 표시입니다. */
export const BPM_CONF_FIRM = 0.45;

/**
 * 탭 템포 (F-303-2). 네 번 이상 두드려야 값을 냅니다.
 * 세 번은 간격이 둘뿐이라 중앙값이 평균과 같아져, 한 번 삐끗한 탭을 걸러내지
 * 못합니다.
 */
const TAP_MIN = 4;
/** 이 간격을 넘겨 두드리면 새로 세기 시작합니다. */
const TAP_TIMEOUT = 2.0;
/** 손으로 두드릴 수 있는 범위. 옥타브 접기는 하지 않습니다. */
const TEMPO_MIN = 30;
const TEMPO_MAX = 300;

/**
 * 두드린 간격의 중앙값으로 BPM 을 냅니다.
 * 평균이 아니라 중앙값을 쓰는 이유는, 한 번 늦게 친 탭이 전체를 끌지 않게
 * 하기 위해서입니다.
 */
export class TapTempo {
  private taps: number[] = [];

  /** @returns 확정된 BPM. 아직 네 번이 안 됐으면 null. */
  tap(now: number): number | null {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && now - last > TAP_TIMEOUT) this.taps.length = 0;
    this.taps.push(now);
    if (this.taps.length > 8) this.taps.shift();
    if (this.taps.length < TAP_MIN) return null;

    const gaps: number[] = [];
    for (let i = 1; i < this.taps.length; i += 1) {
      gaps.push(this.taps[i] - this.taps[i - 1]);
    }
    gaps.sort((a, b) => a - b);
    const mid =
      gaps.length % 2 === 1
        ? gaps[(gaps.length - 1) / 2]
        : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2;
    if (mid <= 0) return null;
    return clamp(60 / mid, TEMPO_MIN, TEMPO_MAX);
  }

  /** 몇 번째 탭인지. 화면에 진행을 보여 주는 데 씁니다. */
  get count(): number {
    return this.taps.length;
  }

  reset(): void {
    this.taps.length = 0;
  }
}

/** 배수 보정 버튼이 쓰는 계수. */
export const TEMPO_SCALES = [2, 0.5, 1.5, 1 / 1.5] as const;

export function scaleTempo(bpm: number, factor: number): number {
  return clamp(bpm * factor, TEMPO_MIN, TEMPO_MAX);
}

export class TempoTracker {
  // ── 3-2. 온셋 엔벨로프 ──
  private envBuf = new Float32Array(ENV_LEN);
  private scratch = new Float32Array(ENV_LEN);
  private corr = new Float32Array(LAG_MAX * LAG_HARMONIC + 1);
  private envIdx = 0;
  private envFilled = 0;
  private envAcc = 0;
  private nextEnvT = 0;

  // ── 3-3. BPM ──
  private lastEstimateT = 0;
  bpm = 0;
  conf = 0;
  /**
   * 잠금 중에도 계속 갱신되는 자동 추정값. 화면에는 쓰이지 않습니다.
   * 이것이 없으면 잠금을 푸는 순간 잠글 당시의 낡은 값이 그대로 남아
   * 자동 추정이 죽은 것처럼 보입니다.
   */
  private autoBpm = 0;
  private autoConf = 0;

  // ── 3-4. 비트 ──
  private nextBeatT = 0;
  private lastBeatT = Number.NEGATIVE_INFINITY;
  beat = 0;
  bar = 1;
  beatInBar: 1 | 2 | 3 | 4 = 1;
  phase = 0;
  /** 이번 프레임에 비트가 났는가. 화면 표시에 씁니다. */
  beatFired = false;
  private silenceT = 0;
  private wasSilent = false;
  /** 오퍼레이터가 확정한 값. 자동 추정이 건드리지 못합니다 (F-303-2). */
  private locked = false;
  private overrideBpm: number | null = null;

  /**
   * 매 프레임 부릅니다.
   * @param flux   이번 프레임의 스펙트럴 플럭스
   * @param median 온셋 검출이 쓰는 적응 임계값의 중앙값
   * @param isOnset 이번 프레임에 온셋이 났는가
   * @param rms    이번 프레임의 RMS. 무음 게이트에 씁니다
   * @param now    초 단위 시각 (`AudioContext.currentTime`)
   * @param dt     이전 프레임과의 시간 차
   */
  update(
    flux: number,
    median: number,
    isOnset: boolean,
    rms: number,
    now: number,
    dt: number,
  ): void {
    this.accumulate(flux, median, now);

    // 잠겨 있어도 추정은 계속 돕니다. 결과를 화면 값에 적용만 하지 않습니다.
    if (
      now - this.lastEstimateT >= ESTIMATE_INTERVAL &&
      this.envFilled >= MIN_SAMPLES
    ) {
      this.lastEstimateT = now;
      this.estimate();
    }

    this.track(isOnset, now, rms, dt);
  }

  /** 3-2절. 100Hz 고정 주기로 원형 버퍼에 쌓습니다. */
  private accumulate(flux: number, median: number, now: number) {
    this.envAcc = Math.max(this.envAcc, Math.max(0, flux - median));

    if (this.nextEnvT === 0) {
      this.nextEnvT = now + ENV_PERIOD;
      return;
    }
    // 탐색이나 탭 전환으로 시각이 크게 튀면 따라잡지 않고 다시 맞춥니다.
    if (now - this.nextEnvT > 1) {
      this.nextEnvT = now + ENV_PERIOD;
      return;
    }

    while (now >= this.nextEnvT) {
      this.envBuf[this.envIdx] = this.envAcc;
      this.envIdx = (this.envIdx + 1) % ENV_LEN;
      if (this.envFilled < ENV_LEN) this.envFilled += 1;
      this.envAcc *= ENV_DECAY;
      this.nextEnvT += ENV_PERIOD;
    }
  }

  /** 3-3절. 자기상관 → 빗살 점수 → 연속성 가중 → 옥타브 접기. */
  private estimate() {
    const n = this.envFilled;
    const e = this.scratch;

    // 원형 버퍼를 시간순으로 펼칩니다.
    const start = (this.envIdx - n + ENV_LEN) % ENV_LEN;
    let mean = 0;
    for (let i = 0; i < n; i += 1) {
      const v = this.envBuf[(start + i) % ENV_LEN];
      e[i] = v;
      mean += v;
    }
    mean /= n;
    for (let i = 0; i < n; i += 1) e[i] -= mean;

    // 1단계 — 평균 제거 후 자기상관
    const maxLag = Math.min(LAG_MAX * LAG_HARMONIC, n - 1);
    const r = this.corr;
    for (let lag = 0; lag <= maxLag; lag += 1) {
      let sum = 0;
      for (let i = lag; i < n; i += 1) sum += e[i] * e[i - lag];
      r[lag] = sum / (n - lag);
    }
    if (r[0] <= 1e-9) {
      this.autoConf = lerp(this.autoConf, 0, CONF_SMOOTH);
      this.conf = this.autoConf;
      return;
    }

    // 2·3단계 — 빗살 점수와 템포 연속성 가중
    let bestLag = 0;
    let bestWeighted = -Infinity;
    let bestRaw = 0;

    for (let lag = LAG_MIN; lag <= LAG_MAX; lag += 1) {
      let raw = 0;
      for (let h = 0; h < LAG_HARMONIC; h += 1) {
        const l = lag * (h + 1);
        if (l > maxLag) break;
        raw += r[l] * COMB[h];
      }

      let weighted = raw;
      if (this.autoBpm > 0) {
        const cand = (60 * ENV_HZ) / lag;
        // 신뢰도가 낮은 동안에는 가중이 거의 걸리지 않아 순수 점수로 판정하고,
        // 값이 안정된 뒤에야 연속성이 힘을 갖습니다.
        weighted *=
          1 +
          CONTINUITY_GAIN *
            this.autoConf *
            Math.exp(-Math.abs(cand - this.autoBpm) / CONTINUITY_WIDTH);
      }

      if (weighted > bestWeighted) {
        bestWeighted = weighted;
        bestRaw = raw;
        bestLag = lag;
      }
    }

    if (bestLag === 0) return;

    // 4단계 — 옥타브 접기
    let bpm = (60 * ENV_HZ) / bestLag;
    while (bpm < BPM_LO) bpm *= 2;
    while (bpm > BPM_HI) bpm /= 2;

    this.autoBpm = this.follow(this.autoBpm, bpm);

    // 신뢰도는 명세에 산출식이 없어 정했습니다. 빗살 점수를 자기상관의 0 지연
    // 값(신호의 분산)으로 나눈 값입니다. 완전히 주기적이면 1 에 가까워집니다.
    // 연속성 가중을 걸기 전의 점수를 씁니다. 가중값을 쓰면 자기 확신이 됩니다.
    const conf = clamp(bestRaw / (r[0] * COMB_SUM), 0, 1);
    this.autoConf = lerp(this.autoConf, conf, CONF_SMOOTH);

    // 신뢰도는 잠금과 무관하게 자동 추정의 실제 값을 유지합니다.
    // 잠금 중임을 화면에 알리는 일은 09 분석 리드아웃의 `수동` 표시가 맡습니다.
    this.conf = this.autoConf;
    // 잠겨 있으면 BPM 만 건드리지 않습니다.
    if (this.locked) return;
    this.bpm = this.follow(this.bpm, this.autoBpm);
  }

  /** 4단계 갱신 폭. 큰 차이는 빠르게, 작은 차이는 천천히 따라갑니다. */
  private follow(current: number, target: number): number {
    if (current === 0) return target;
    if (Math.abs(target - current) > JUMP_THRESHOLD) {
      return lerp(current, target, FOLLOW_FAST);
    }
    return lerp(current, target, FOLLOW_SLOW);
  }

  /**
   * 오퍼레이터가 확정한 템포를 적용합니다 (F-303-2).
   * @param bpm    확정값. null 이면 자동 추정에 맡깁니다
   * @param locked 자물쇠 상태
   */
  setOverride(bpm: number | null, locked: boolean): void {
    this.locked = locked;
    this.overrideBpm = bpm;

    if (bpm !== null && Math.abs(bpm - this.bpm) > 1e-6) {
      this.bpm = bpm;
      this.nextBeatT = 0; // 다음 온셋에서 위상을 다시 잡습니다
    }

    // 신뢰도는 건드리지 않습니다. 잠금 중에도 자동 추정의 실제 확신도를
    // 그대로 두고, 화면에서는 숫자 대신 `수동` 을 보여 줍니다.
  }

  get isLocked(): boolean {
    return this.locked;
  }

  /** 3-4절. 주기를 예측하고 온셋이 가까이 오면 위상을 맞춥니다. */
  private track(isOnset: boolean, now: number, rms: number, dt: number) {
    this.beatFired = false;

    // 무음에서는 박을 찍지 않습니다. BPM 값 자체는 유지합니다.
    this.silenceT = rms < SILENCE_RMS ? this.silenceT + dt : 0;
    if (this.silenceT > SILENCE_HOLD) {
      this.wasSilent = true;
      return; // phase 도 갱신하지 않습니다
    }
    if (this.wasSilent) {
      this.wasSilent = false;
      // 소리가 돌아오면 현재 시각 기준으로 다시 잡고 이어서 찍습니다.
      this.nextBeatT = this.bpm > 0 ? now + 60 / this.bpm : 0;
    }

    if (this.bpm <= 0) {
      // BPM 이 아직 없으면 온셋이 올 때마다 비트로 취급합니다.
      if (isOnset && now - this.lastBeatT > FALLBACK_BEAT_GAP) this.fireBeat(now);
      this.phase = 0;
      return;
    }

    const per = 60 / this.bpm;
    if (this.nextBeatT === 0) this.nextBeatT = now + per;

    if (isOnset && Math.abs(now - this.nextBeatT) < per * SNAP_WINDOW) {
      this.nextBeatT = now; // 위상 스냅
    }

    if (now >= this.nextBeatT) {
      this.fireBeat(now);
      this.nextBeatT += per;
      if (now - this.nextBeatT > per) {
        this.nextBeatT = now + per; // 너무 밀렸으면 재동기화
      }
    }

    this.phase = clamp(1 - (this.nextBeatT - now) / per, 0, 1);
  }

  private fireBeat(now: number) {
    this.beat += 1;
    // 4박마다 마디가 올라갑니다.
    this.beatInBar = (((this.beat - 1) % 4) + 1) as 1 | 2 | 3 | 4;
    this.bar = Math.floor((this.beat - 1) / 4) + 1;
    this.lastBeatT = now;
    this.beatFired = true;
  }

  /**
   * 탐색용 부분 초기화. 3-5절.
   *
   * 시간이 건너뛰면 엔벨로프가 불연속이 되므로 버퍼와 비트 위상은 비웁니다.
   * 그러나 같은 곡 안에서 위치만 옮긴 것이므로 **템포는 그대로 둡니다.**
   * `bpm` 까지 지우면 리허설에서 구간 반복으로 A·B 를 찍을 때마다 템포를
   * 처음부터 다시 찾느라 그때그때 다른 값이 나옵니다.
   */
  resetForSeek(): void {
    this.envBuf.fill(0);
    this.envIdx = 0;
    this.envFilled = 0;
    this.envAcc = 0;
    this.nextEnvT = 0;
    this.nextBeatT = 0;
    this.lastBeatT = Number.NEGATIVE_INFINITY;
    this.phase = 0;
    this.beatFired = false;
    this.silenceT = 0;
    this.wasSilent = false;
    // bpm · conf · beat · bar · beatInBar 는 유지합니다.
  }

  reset(): void {
    this.envBuf.fill(0);
    this.envIdx = 0;
    this.envFilled = 0;
    this.envAcc = 0;
    this.nextEnvT = 0;
    this.lastEstimateT = 0;
    // 잠겨 있으면 확정값을 되살립니다. 비워 버리면 자동 추정도 막혀 있어
    // BPM 이 0 에 머뭅니다.
    this.bpm = this.locked && this.overrideBpm !== null ? this.overrideBpm : 0;
    this.conf = 0;
    this.autoBpm = 0;
    this.autoConf = 0;
    this.nextBeatT = 0;
    this.lastBeatT = Number.NEGATIVE_INFINITY;
    this.beat = 0;
    this.bar = 1;
    this.beatInBar = 1;
    this.phase = 0;
    this.beatFired = false;
    this.silenceT = 0;
    this.wasSilent = false;
    // `locked` 는 비우지 않습니다. 자물쇠는 오퍼레이터가 끄기 전까지 유지됩니다.
  }
}
