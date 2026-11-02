/**
 * 스템 추정. `docs/05-signal-processing.md` 4절.
 *
 * 실제로 분리된 스템 파일이 있으면 각 파일의 RMS 를 그대로 씁니다(F-104).
 * 없으면 신호처리로 근사합니다. 딥러닝 분리는 지연 때문에 쓰지 않습니다.
 *
 * 보컬은 중앙 정위 성분에서 좌우로 벌어진 성분을 뺀 것으로, 기타 성분은
 * 반대로 좌우로 벌어진 쪽으로 근사합니다.
 *
 * 계수는 모두 여기 모아 두었습니다. 원값을 모으는 반복문은 스펙트럼 버퍼를
 * 한 번만 훑기 위해 `engine.ts` 안에 있지만, 곱하는 숫자는 이 파일이 정합니다.
 */
import { clamp, lerp } from '@/lib/util';

/** 4절의 원값 계수. */
export const STEM_COEF = {
  /** drumRaw = fluxHi × 1.7 / N × 40 + fluxKick × 2.4 / N × 40 */
  DRUM_HI: 1.7,
  DRUM_KICK: 2.4,
  DRUM_SCALE: 40,
  /** bassRaw = (bands[SUB] × 1.15 + bands[LOW]) × 0.62 */
  BASS_SUB: 1.15,
  BASS_SCALE: 0.62,
  /** vocRaw = mean( max(0, mid[i] - side[i] × 1.05) ), 200~4000Hz */
  VOCAL_SIDE: 1.05,
  VOCAL_LO_HZ: 200,
  VOCAL_HI_HZ: 4000,
  /** othRaw = mean( side[i] ) × 1.6, 150~14000Hz */
  OTHER_SCALE: 1.6,
  OTHER_LO_HZ: 150,
  OTHER_HI_HZ: 14000,
} as const;

/** 채널별 자동 이득 조절. 추정 스템 기준입니다. */
const AGC_DECAY = 0.999;
const AGC_FLOOR = 0.03;

/** 드럼만 빠르게. 순간적인 타격을 놓치면 의미가 없기 때문입니다. */
const SMOOTH_DRUMS = 0.55;
const SMOOTH_REST = 0.28;

/** 레벨 막대에 얹는 피크 표시의 감쇠. RMS 피크와 같은 계수를 씁니다. */
const PEAK_DECAY = 0.985;

/**
 * 전체 레벨이 이보다 낮으면 스템을 0 으로 둡니다 (4절).
 *
 * AGC 는 최근 최댓값 대비 지금 값을 재는 구조라 입력이 조용한지 아닌지를
 * 모릅니다. 마이크로 조용한 방을 받으면 저주파 암소음만 들어오는데도
 * BASS 스템이 0.8 을 넘습니다. 실측에서 조용한 방 `bassRaw` 0.307 ·
 * BASS 스템 0.81~0.87 이었습니다.
 *
 * 값의 근거는 `docs/05-signal-processing.md` 4절의 실측표에 있습니다.
 */
export const STEM_GATE = 0.015;

export class StemEstimator {
  private agc = new Float32Array([AGC_FLOOR, AGC_FLOOR, AGC_FLOOR, AGC_FLOOR]);
  private peak = new Float32Array(4);

  /**
   * 원값 네 개를 받아 0~1 로 정규화하고 평활해 `out` 에 씁니다.
   * @param raw   [drums, bass, vocal, other] 원값
   * @param out   `MusicAnalysis.stems` (제자리 갱신)
   * @param peaks `MusicAnalysis.stemPeak` (제자리 갱신)
   * @param level `MusicAnalysis.rmsSlow`. `STEM_GATE` 미만이면 네 스템을 0 으로
   *   내립니다. 순간값 `rms` 가 아니라 0.4초 평활값을 쓰는 이유는 4절에 있습니다.
   */
  update(
    raw: ArrayLike<number>,
    out: [number, number, number, number],
    peaks: [number, number, number, number],
    level: number,
  ): void {
    const gated = level < STEM_GATE;
    for (let k = 0; k < 4; k += 1) {
      const r = raw[k];
      // 게이트가 걸린 동안에는 원값을 AGC 에 먹이지 않습니다. 먹이면 암소음이
      // 기준을 잡아 버려서, 게이트가 열리는 순간 그 기준으로 음악을 잽니다.
      this.agc[k] = gated
        ? Math.max(this.agc[k] * AGC_DECAY, AGC_FLOOR)
        : Math.max(r, this.agc[k] * AGC_DECAY, AGC_FLOOR);
      const value = gated ? 0 : clamp(r / this.agc[k], 0, 1);
      const smooth = k === 0 ? SMOOTH_DRUMS : SMOOTH_REST;
      out[k] = lerp(out[k], value, smooth);
      this.peak[k] = Math.max(this.peak[k] * PEAK_DECAY, out[k]);
      peaks[k] = this.peak[k];
    }
  }

  reset(): void {
    this.agc.fill(AGC_FLOOR);
    this.peak.fill(0);
  }
}
