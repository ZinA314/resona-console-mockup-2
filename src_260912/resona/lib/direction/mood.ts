/**
 * 곡의 성격을 두 실수로 잽니다. `docs/05-signal-processing.md` 7-3 ~ 7-6절.
 *
 * 6절의 `MusicState` 가 "지금 이 순간이 얼마나 센가" 라면 이쪽은 "이 곡이
 * 어떤 성격인가" 입니다. 발라드의 후렴과 댄스곡의 후렴은 둘 다 `PEAK` 으로
 * 판정되지만 같은 화면이면 안 됩니다.
 *
 *   valence  밝음 ↔ 어두움   **색**을 정합니다. 느리게 (6초)
 *   arousal  격렬함 ↔ 잔잔함  **결**을 정합니다. 빠르게 (3초)
 */
import { ChromaAnalyzer } from '@/lib/audio/chroma';
import { clamp, mapRange } from '@/lib/util';
import { BAND, type Mood, type MoodName, type MusicAnalysis } from '@/lib/types';

// ── 7-3·7-4절의 시상수 ──────────────────────────────────────────
/** 한 곡의 색은 대체로 하나여야 합니다. 바뀌더라도 알아채지 못할 만큼 천천히. */
const VALENCE_TAU = 6;
/** 후렴에 들어가면 화면이 세져야 합니다. 6초 늦으면 후렴이 끝난 뒤 세집니다. */
const AROUSAL_TAU = 3;

/** 7-3절. 화음을 이만큼 확신해야 그 항을 온전히 씁니다. */
const CHROMA_FULL = 0.55;
/** 7-4절. BPM 을 이만큼 확신해야 그 항을 온전히 씁니다. */
const BPM_FULL = 0.45;

/** 7-3절 네 항의 가중치. 화음 항이 절반입니다. */
const W_CHROMA = 0.5;
const W_CENTROID = 0.28;
const W_AIR = 0.12;
const W_SUB = 0.1;

/** 7-4절 네 항의 가중치. */
const W_RMS = 0.34;
const W_BPM = 0.24;
const W_ONSET = 0.24;
const W_HI = 0.18;

/** 7-4절이 요구하는 두 창. */
const RMS_WINDOW = 6;
const ONSET_WINDOW = 4;

// ── 7-5절의 구역 경계 ───────────────────────────────────────────
const A_CALM = 0.38;
const A_HOT = 0.62;
/** 잔잔한 쪽의 밝기 경계 (침잠 ↔ 평온) */
const V_CALM = 0.5;
/** 격렬한 쪽의 밝기 경계 (격정 ↔ 희망) */
const V_HOT = 0.55;

/** 경계를 넘을 때의 여유. 나갈 때의 경계가 들어올 때보다 멀리 있습니다. */
const MARGIN = 0.06;
/** 한 번 판정한 이름은 이만큼 유지합니다. */
const MIN_HOLD = 8;

const FOUR: readonly MoodName[] = ['DEEP', 'SERENE', 'FERVENT', 'RADIANT'];

/**
 * `(v, a)` 가 `name` 구역 안에 있는가. `m` 만큼 구역을 넓혀 봅니다.
 * 나가는 판정에는 `+MARGIN`, 들어오는 판정에는 0 을 씁니다.
 */
function inRegion(name: MoodName, v: number, a: number, m: number): boolean {
  switch (name) {
    case 'DEEP':
      return a < A_CALM + m && v < V_CALM + m;
    case 'SERENE':
      return a < A_CALM + m && v >= V_CALM - m;
    case 'FERVENT':
      return a >= A_HOT - m && v < V_HOT + m;
    case 'RADIANT':
      return a >= A_HOT - m && v >= V_HOT - m;
    case 'NEUTRAL':
      // 나머지. 중립을 넓히는 것은 나머지 넷을 좁히는 것과 같습니다.
      return !FOUR.some((n) => inRegion(n, v, a, -m));
  }
}

function classify(v: number, a: number): MoodName {
  for (const n of FOUR) {
    if (inRegion(n, v, a, 0)) return n;
  }
  return 'NEUTRAL';
}

/**
 * 시간으로 가중한 이동평균. 프레임 간격이 들쭉날쭉해도 창의 길이가 유지됩니다.
 * 표본 수로 세면 프레임이 떨어질 때 창이 저절로 길어집니다.
 */
class MovingMean {
  private t: number[] = [];
  private dt: number[] = [];
  private wv: number[] = [];
  private sumV = 0;
  private sumT = 0;

  constructor(private span: number) {}

  push(value: number, dt: number, now: number): void {
    if (dt <= 0) return;
    this.t.push(now);
    this.dt.push(dt);
    this.wv.push(value * dt);
    this.sumV += value * dt;
    this.sumT += dt;

    let drop = 0;
    while (drop < this.t.length - 1 && now - this.t[drop] > this.span) {
      this.sumV -= this.wv[drop];
      this.sumT -= this.dt[drop];
      drop += 1;
    }
    if (drop > 0) {
      this.t.splice(0, drop);
      this.dt.splice(0, drop);
      this.wv.splice(0, drop);
    }
  }

  get mean(): number {
    return this.sumT > 1e-9 ? this.sumV / this.sumT : 0;
  }

  reset(): void {
    this.t.length = 0;
    this.dt.length = 0;
    this.wv.length = 0;
    this.sumV = 0;
    this.sumT = 0;
  }
}

export class MoodDetector {
  private chroma = new ChromaAnalyzer();
  private rms6s = new MovingMean(RMS_WINDOW);
  /** 최근 `ONSET_WINDOW` 초 안에 난 온셋의 시각. */
  private onsets: number[] = [];
  private now = 0;

  private valence = 0.5;
  private arousal = 0;
  private name: MoodName = 'NEUTRAL';
  private nameFor = MIN_HOLD;

  private value: Mood = {
    valence: 0.5,
    arousal: 0,
    name: 'NEUTRAL',
    chromaConf: 0,
  };

  get mood(): Mood {
    return this.value;
  }

  /**
   * @param binHz 스펙트럼 빈 하나가 덮는 주파수 폭. 크로마가 씁니다
   */
  update(a: MusicAnalysis, binHz: number, dt: number): Mood {
    this.now += dt;

    this.rms6s.push(a.rms, dt, this.now);
    if (a.onset === 1) this.onsets.push(this.now);
    while (this.onsets.length > 0 && this.now - this.onsets[0] > ONSET_WINDOW) {
      this.onsets.shift();
    }

    const chroma = this.chroma.update(a.spectrum, binHz);

    // ── 7-3절. valence ──
    // 화음을 못 읽는 구간에서 무조건 어둡게 판정하면 안 되므로, 줄어든 몫을
    // 나머지 세 항에 비례 배분합니다. 가중치의 합은 언제나 1 입니다.
    const chromaWeight = clamp(chroma.chromaConf / CHROMA_FULL, 0, 1);
    const vRest = (1 - W_CHROMA * chromaWeight) / (W_CENTROID + W_AIR + W_SUB);
    const vTarget = clamp(
      W_CHROMA * chroma.majorness * chromaWeight +
        vRest *
          (W_CENTROID * mapRange(a.centroid, 300, 3500, 0, 1) +
            W_AIR * mapRange(a.bands[BAND.AIR], 0, 0.6, 0, 1) +
            W_SUB * (1 - mapRange(a.bands[BAND.SUB], 0, 0.7, 0, 1))),
      0,
      1,
    );
    this.valence += (vTarget - this.valence) * (1 - Math.exp(-dt / VALENCE_TAU));

    // ── 7-4절. arousal ──
    // 근거 없는 BPM 을 그대로 넣으면 곡 시작 몇 초 동안 분위기가 튑니다.
    const bpmWeight = clamp(a.bpmConf / BPM_FULL, 0, 1);
    const aRest = (1 - W_BPM * bpmWeight) / (W_RMS + W_ONSET + W_HI);
    const onsetRate = this.onsets.length / ONSET_WINDOW;
    const aTarget = clamp(
      W_BPM * mapRange(a.bpm, 60, 150, 0, 1) * bpmWeight +
        aRest *
          (W_RMS * this.rms6s.mean +
            W_ONSET * mapRange(onsetRate, 0, 6, 0, 1) +
            W_HI * mapRange(a.bands[BAND.HI], 0, 0.55, 0, 1)),
      0,
      1,
    );
    this.arousal += (aTarget - this.arousal) * (1 - Math.exp(-dt / AROUSAL_TAU));

    // ── 7-5절. 이름 ──
    this.nameFor += dt;
    if (this.nameFor >= MIN_HOLD && !inRegion(this.name, this.valence, this.arousal, MARGIN)) {
      const next = classify(this.valence, this.arousal);
      if (next !== this.name) {
        this.name = next;
        this.nameFor = 0;
      }
    }

    this.value.valence = this.valence;
    this.value.arousal = this.arousal;
    this.value.name = this.name;
    this.value.chromaConf = chroma.chromaConf;
    return this.value;
  }

  /** 곡이 바뀌면 이전 곡의 성격을 끌고 가지 않습니다. */
  reset(): void {
    this.chroma.reset();
    this.rms6s.reset();
    this.onsets.length = 0;
    this.now = 0;
    this.valence = 0.5;
    this.arousal = 0;
    this.name = 'NEUTRAL';
    // 새 곡의 첫 판정은 8초를 기다리지 않습니다.
    this.nameFor = MIN_HOLD;
    this.value.valence = 0.5;
    this.value.arousal = 0;
    this.value.name = 'NEUTRAL';
    this.value.chromaConf = 0;
  }
}
