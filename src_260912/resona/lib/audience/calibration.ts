/**
 * 자동 보정과 어택·릴리스 평활.
 * `docs/05-signal-processing.md` 5-3·5-4·5-5절.
 *
 * 공연장마다 기준이 다르므로 최근 60초의 분포로 정규화합니다. 카메라와
 * 마이크가 같은 것을 씁니다.
 */
import { clamp } from '@/lib/util';
import type { AudienceState } from '@/lib/types';

/** 30fps 기준 60초. */
const HISTORY = 1800;
/** 몇 샘플마다 퍼센타일을 다시 구하는가. */
const UPDATE_EVERY = 15;
/** 이만큼은 쌓여야 퍼센타일을 씁니다. */
const MIN_SAMPLES = 60;
/** 이만큼(20초) 쌓이면 보정 완료로 표시합니다. */
const READY_SAMPLES = 600;

const LO_PCT = 0.05;
const HI_PCT = 0.95;

/**
 * 관객 반응은 빠르게 오르고 천천히 식습니다.
 * 이 비대칭이 중요합니다. 같은 시정수를 쓰면 박수가 끝나자마자 화면이 꺼져
 * 어색합니다.
 */
const ATTACK_TAU = 1.5;
const RELEASE_TAU = 3.0;

/** 원값을 받는 주기. `04-flows.md` 6절의 관객 측정 주기입니다. */
export const SAMPLE_HZ = 30;

export class AudienceCalibrator {
  private history = new Float32Array(HISTORY);
  private scratch = new Float32Array(HISTORY);
  private idx = 0;
  private filled = 0;
  private sinceUpdate = 0;

  private lo = 0;
  private hi = 1;
  private lastRaw = 0;
  private smooth = 0;

  /** 보정을 건너뛰는 입력(시뮬)은 원값을 그대로 목표로 씁니다. */
  constructor(private readonly bypass = false) {}

  /** 30Hz 로 새 원값이 들어올 때 부릅니다. */
  push(raw: number): void {
    this.lastRaw = raw;
    if (this.bypass) return;

    this.history[this.idx] = raw;
    this.idx = (this.idx + 1) % HISTORY;
    if (this.filled < HISTORY) this.filled += 1;

    this.sinceUpdate += 1;
    if (this.sinceUpdate < UPDATE_EVERY || this.filled < MIN_SAMPLES) return;
    this.sinceUpdate = 0;

    const n = this.filled;
    for (let i = 0; i < n; i += 1) this.scratch[i] = this.history[i];
    const window = this.scratch.subarray(0, n);
    window.sort();
    this.lo = window[Math.floor(n * LO_PCT)];
    this.hi = window[Math.min(n - 1, Math.floor(n * HI_PCT))];
  }

  /** 매 프레임 부릅니다. 어택·릴리스 평활을 거친 0~1 값을 돌려줍니다. */
  advance(dt: number): number {
    const target = this.bypass
      ? clamp(this.lastRaw, 0, 1)
      : clamp((this.lastRaw - this.lo) / Math.max(this.hi - this.lo, 1e-5), 0, 1);

    const tau = target > this.smooth ? ATTACK_TAU : RELEASE_TAU;
    this.smooth += (target - this.smooth) * (1 - Math.exp(-dt / tau));
    return clamp(this.smooth, 0, 1);
  }

  /** 0~1. 1 이면 보정 완료입니다. */
  get progress(): number {
    return this.bypass ? 1 : clamp(this.filled / READY_SAMPLES, 0, 1);
  }

  get energy(): number {
    return clamp(this.smooth, 0, 1);
  }

  reset(): void {
    this.history.fill(0);
    this.idx = 0;
    this.filled = 0;
    this.sinceUpdate = 0;
    this.lo = 0;
    this.hi = 1;
    this.lastRaw = 0;
    this.smooth = 0;
  }
}

/** 5-5절의 상태 구간. */
export function audienceState(energy: number): AudienceState {
  if (energy < 0.25) return 'DORMANT';
  if (energy < 0.5) return 'STIRRING';
  if (energy < 0.75) return 'ACTIVE';
  return 'SURGE';
}
