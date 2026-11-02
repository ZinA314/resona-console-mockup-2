/**
 * 온셋 검출. `docs/05-signal-processing.md` 3-1절.
 *
 * 고정 임계값은 곡의 음량에 따라 무너집니다. 최근 이력의 중앙값을 기준으로
 * 잡는 적응 임계값을 씁니다.
 *
 * 여기 숫자는 기존 프로토타입에서 실제로 동작하던 값입니다. 바꾸지 마십시오.
 */

/** 최근 몇 프레임의 flux 를 기억하는가. */
const HIST = 52;
/** 정렬한 이력에서 임계값의 기준을 어디서 뽑는가. */
const PERCENTILE = 0.55;
const THR_SCALE = 1.5;
const THR_OFFSET = 0.022;
/** 사람이 별개의 타격으로 구분하는 최소 간격에 가깝습니다. */
const MIN_INTERVAL = 0.085;
/** 무음 구간의 오검출 차단. */
const MIN_RMS = 0.035;

export class OnsetDetector {
  private hist = new Float32Array(HIST);
  private scratch = new Float32Array(HIST);
  private filled = 0;
  private cursor = 0;
  private lastOnsetT = Number.NEGATIVE_INFINITY;

  /** 진단용으로 밖에서 읽습니다. */
  median = 0;
  threshold = 0;

  /**
   * @param flux 이번 프레임의 스펙트럴 플럭스
   * @param rms  이번 프레임의 RMS
   * @param now  초 단위 시각 (`AudioContext.currentTime`)
   */
  detect(flux: number, rms: number, now: number): boolean {
    this.hist[this.cursor] = flux;
    this.cursor = (this.cursor + 1) % HIST;
    if (this.filled < HIST) this.filled += 1;

    const n = this.filled;
    for (let i = 0; i < n; i += 1) this.scratch[i] = this.hist[i];
    const window = this.scratch.subarray(0, n);
    window.sort();

    this.median = window[Math.floor(n * PERCENTILE)];
    this.threshold = this.median * THR_SCALE + THR_OFFSET;

    // 세 조건을 모두 만족해야 온셋으로 인정합니다.
    const isOnset =
      flux > this.threshold && now - this.lastOnsetT > MIN_INTERVAL && rms > MIN_RMS;

    if (isOnset) this.lastOnsetT = now;
    return isOnset;
  }

  reset(): void {
    this.hist.fill(0);
    this.filled = 0;
    this.cursor = 0;
    this.lastOnsetT = Number.NEGATIVE_INFINITY;
    this.median = 0;
    this.threshold = 0;
  }
}
