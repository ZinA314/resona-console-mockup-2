/**
 * 크로마 12빈과 장·단 근사. `docs/05-signal-processing.md` 7-1·7-2절.
 *
 * 장조인지 단조인지를 근사해야 곡이 밝은지 어두운지를 판단할 수 있습니다.
 * `valence` 의 가장 큰 항이 여기서 나옵니다.
 *
 * 완벽하지 않습니다. 무조 음악이나 드럼만 나오는 구간에서는 값이 흔들립니다.
 * 그래서 `chromaConf` 를 함께 내보내고, 신뢰도가 낮으면 `valence` 에서 이 항의
 * 비중을 줄입니다 (7-3절).
 */

/** 7-1절. 이 밖은 보지 않습니다. */
const HZ_LO = 100; // 아래는 킥이 모든 계급에 샙니다
const HZ_HI = 2000; // 위는 배음이 원래 음높이를 가립니다

/**
 * 지수 평활 계수. 화음은 마디 단위로 바뀌므로 프레임마다 흔들리면 안 됩니다.
 * 8프레임에 한 번(60fps 에서 7.5Hz) 도니 시상수로 약 1.3초입니다.
 */
const SMOOTH = 0.9;

/** 7-1절. 매 프레임 돌릴 이유가 없습니다. */
const EVERY = 8;

/** Krumhansl-Schmuckler 프로파일. 7-2절 표 그대로입니다. */
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** 프로파일 쪽 통계는 고정이므로 한 번만 구합니다. */
function stats(v: readonly number[]) {
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  let sq = 0;
  for (const x of v) sq += (x - mean) * (x - mean);
  return { mean, sd: Math.sqrt(sq) };
}
const MAJOR_S = stats(MAJOR);
const MINOR_S = stats(MINOR);

export interface ChromaResult {
  /** 0 단조 ↔ 1 장조 */
  majorness: number;
  /** 0~1 화음이 뚜렷할수록 높습니다 */
  chromaConf: number;
  /** 평활이 끝난 12빈. 합이 1 입니다 */
  chroma: Float64Array;
}

export class ChromaAnalyzer {
  private smoothed = new Float64Array(12);
  private raw = new Float64Array(12);
  /** 빈마다 어느 음높이 계급인지. 표본율이 바뀔 때만 다시 만듭니다. */
  private pcOfBin: Int8Array = new Int8Array(0);
  private mappedBins = 0;
  private mappedBinHz = 0;
  private frame = 0;

  private result: ChromaResult = {
    majorness: 0.5,
    chromaConf: 0,
    chroma: this.smoothed,
  };

  /**
   * @param spectrum 크기 스펙트럼 0~1 (`MusicAnalysis.spectrum`)
   * @param binHz    빈 하나가 덮는 주파수 폭
   */
  update(spectrum: Float32Array, binHz: number): ChromaResult {
    this.frame += 1;
    if (this.frame % EVERY !== 0) return this.result;
    if (spectrum.length === 0 || !(binHz > 0)) return this.result;

    if (this.mappedBins !== spectrum.length || this.mappedBinHz !== binHz) {
      this.buildMap(spectrum.length, binHz);
    }

    // 7-1절. 주파수 빈을 12개 음높이 계급으로 접습니다.
    this.raw.fill(0);
    let sum = 0;
    for (let i = 0; i < spectrum.length; i += 1) {
      const pc = this.pcOfBin[i];
      if (pc < 0) continue;
      const mag = spectrum[i];
      this.raw[pc] += mag;
      sum += mag;
    }

    if (sum > 1e-6) {
      for (let k = 0; k < 12; k += 1) this.raw[k] /= sum;
    } else {
      // 무음. 고르게 두면 상관이 0 이 되어 신뢰도가 자연히 떨어집니다.
      this.raw.fill(1 / 12);
    }

    for (let k = 0; k < 12; k += 1) {
      this.smoothed[k] = this.smoothed[k] * SMOOTH + this.raw[k] * (1 - SMOOTH);
    }

    this.correlate();
    return this.result;
  }

  /** 7-2절. 12조성 × 장단 2 = 24개 중 상관이 가장 큰 것을 고릅니다. */
  private correlate(): void {
    const c = this.smoothed;
    let mean = 0;
    for (let k = 0; k < 12; k += 1) mean += c[k];
    mean /= 12;
    let sq = 0;
    for (let k = 0; k < 12; k += 1) sq += (c[k] - mean) * (c[k] - mean);
    const sd = Math.sqrt(sq);

    if (sd < 1e-9) {
      // 고른 크로마. 어느 조성과도 상관이 없습니다.
      this.result.majorness = 0.5;
      this.result.chromaConf = 0;
      return;
    }

    let bestMajor = -1;
    let bestMinor = -1;
    for (let rot = 0; rot < 12; rot += 1) {
      let dotMaj = 0;
      let dotMin = 0;
      for (let i = 0; i < 12; i += 1) {
        const x = c[(rot + i) % 12] - mean;
        dotMaj += x * (MAJOR[i] - MAJOR_S.mean);
        dotMin += x * (MINOR[i] - MINOR_S.mean);
      }
      const rMaj = dotMaj / (sd * MAJOR_S.sd);
      const rMin = dotMin / (sd * MINOR_S.sd);
      if (rMaj > bestMajor) bestMajor = rMaj;
      if (rMin > bestMinor) bestMinor = rMin;
    }

    const m = (bestMajor - bestMinor) * 2.5 + 0.5;
    this.result.majorness = m < 0 ? 0 : m > 1 ? 1 : m;
    const conf = Math.max(bestMajor, bestMinor);
    this.result.chromaConf = conf < 0 ? 0 : conf > 1 ? 1 : conf;
  }

  /**
   * 빈 → 음높이 계급 표. 로그와 반올림을 매 프레임 2,048번 돌지 않으려고
   * 한 번만 만들어 둡니다.
   */
  private buildMap(bins: number, binHz: number): void {
    this.pcOfBin = new Int8Array(bins);
    this.pcOfBin.fill(-1);
    for (let i = 1; i < bins; i += 1) {
      const f = i * binHz;
      if (f < HZ_LO || f > HZ_HI) continue;
      const midi = 69 + 12 * Math.log2(f / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      this.pcOfBin[i] = pc;
    }
    this.mappedBins = bins;
    this.mappedBinHz = binHz;
  }

  reset(): void {
    this.smoothed.fill(0);
    this.frame = 0;
    this.result.majorness = 0.5;
    this.result.chromaConf = 0;
  }
}
