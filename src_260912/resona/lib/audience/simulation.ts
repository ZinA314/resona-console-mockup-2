/**
 * 관객 시뮬레이션 (F-303).
 *
 * 카메라와 마이크 없이 기능을 확인하기 위한 가상 입력입니다.
 * **이것부터 만드는 이유는 카메라 없이도 이후 개발을 진행할 수 있어야 하기
 * 때문입니다.**
 *
 * 느리게 변하는 기저 에너지와 약 128 BPM 의 맥동을 합성하고, 사용자가
 * 슬라이더로 직접 밀어 올릴 수 있습니다.
 */
import { clamp } from '@/lib/util';
import { AudienceCalibrator, SAMPLE_HZ } from '@/lib/audience/calibration';
import type { ManagedAudienceSource } from '@/lib/audience/types';

/** 맥동 주기. 128 BPM. */
const PULSE_HZ = 128 / 60;

export class SimulationSource implements ManagedAudienceSource {
  readonly kind = 'simulation' as const;

  // 값이 이미 0~1 로 만들어지므로 보정을 건너뜁니다. 20초를 기다리게 하면
  // 카메라 없이 개발한다는 목적에 어긋납니다. 어택·릴리스는 그대로 겁니다.
  private cal = new AudienceCalibrator(true);
  private t = 0;
  private acc = 0;
  /** 슬라이더로 직접 밀어 올리는 몫 0~1. */
  private manual = 0;

  async start(): Promise<void> {
    this.cal.reset();
    this.t = 0;
    this.acc = 0;
  }

  stop(): void {
    this.cal.reset();
  }

  recalibrate(): void {
    this.cal.reset();
  }

  setManual(v: number): void {
    this.manual = clamp(v, 0, 1);
  }

  read(dt: number): number {
    this.t += dt;

    // 원값은 측정 주기(30Hz)로만 새로 만듭니다. 카메라와 같은 리듬입니다.
    this.acc += dt;
    if (this.acc >= 1 / SAMPLE_HZ) {
      this.acc = 0;
      const base =
        0.25 + Math.sin(this.t * 0.11) * 0.2 + Math.sin(this.t * 0.29) * 0.1;
      const beat = Math.sin(this.t * PULSE_HZ * Math.PI * 2) * 0.5 + 0.5;
      const pulse = beat ** 3;
      this.cal.push(clamp(base * 0.7 + pulse * 0.3 + this.manual, 0, 1));
    }

    return this.cal.advance(dt);
  }

  get calibration(): number {
    return this.cal.progress;
  }
}
