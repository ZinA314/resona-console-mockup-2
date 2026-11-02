'use client';

/**
 * 관객 입력을 한 곳에서 관리합니다.
 *
 * 방식을 바꿀 때 이전 소스를 반드시 정리합니다. 카메라를 켠 채 다른 방식으로
 * 넘어가면 촬영 표시등이 켜진 채로 남습니다.
 *
 * **관객이 없어도 모든 기능이 동작해야 합니다.** 권한이 거부되거나 장치가
 * 없으면 사유만 적고 `none` 으로 돌아갑니다. 다른 기능은 계속 돕니다.
 */
import { audienceState } from '@/lib/audience/calibration';
import { CameraSource } from '@/lib/audience/camera';
import { SimulationSource } from '@/lib/audience/simulation';
import {
  FIELD_SIZE,
  type AudienceSource,
  type ManagedAudienceSource,
} from '@/lib/audience/types';
import type { AudienceState } from '@/lib/types';

export type AudienceKind = AudienceSource['kind'];

/** 실시간이 아닌 상태. 사용자 조작 때만 바뀌므로 React 가 구독해도 됩니다. */
export interface AudienceStatus {
  kind: AudienceKind;
  /** 권한을 요청하는 중인가. */
  starting: boolean;
  error: string | null;
}

export const INITIAL_AUDIENCE_STATUS: AudienceStatus = {
  kind: 'none',
  starting: false,
  error: null,
};

/** 매 프레임 바뀌는 값. React 상태에 넣지 않습니다. */
export interface AudienceReading {
  energy: number;
  calibration: number;
  state: AudienceState;
}

class AudienceManager {
  readonly reading: AudienceReading = {
    energy: 0,
    calibration: 0,
    state: 'DORMANT',
  };
  /** 카메라 격자. 미리보기와 관객 씬이 읽습니다. 신호가 없으면 전부 0 입니다. */
  readonly field = new Float32Array(FIELD_SIZE);

  private status: AudienceStatus = INITIAL_AUDIENCE_STATUS;
  private listeners = new Set<() => void>();
  private source: ManagedAudienceSource | null = null;
  private simulation: SimulationSource | null = null;
  private camera: CameraSource | null = null;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  getSnapshot = (): AudienceStatus => this.status;

  private patch(next: Partial<AudienceStatus>) {
    this.status = { ...this.status, ...next };
    for (const l of this.listeners) l();
  }

  /**
   * 방식을 바꿉니다. 조작 핸들러에서 직접 부르십시오.
   * 권한 요청이 있으므로 사용자 조작 시점이어야 합니다.
   */
  async select(kind: AudienceKind): Promise<void> {
    // 이전 소스를 반드시 정리합니다.
    this.source?.stop();
    this.source = null;
    this.field.fill(0);
    this.reading.energy = 0;
    this.reading.calibration = 0;
    this.reading.state = 'DORMANT';

    if (kind === 'none') {
      this.patch({ kind: 'none', starting: false, error: null });
      return;
    }

    if (kind === 'microphone') {
      // F-302 는 「이후 과제」입니다. 여기서 막지 않으면 조용히 아무 일도
      // 일어나지 않아 고장으로 보입니다.
      this.patch({
        kind: 'none',
        starting: false,
        error: '마이크 방식은 아직 구현하지 않았습니다. 카메라나 시뮬을 쓰십시오.',
      });
      return;
    }

    this.patch({ kind, starting: true, error: null });

    try {
      if (kind === 'simulation') {
        this.simulation ??= new SimulationSource();
        await this.simulation.start();
        this.source = this.simulation;
      } else {
        this.camera ??= new CameraSource();
        await this.camera.start();
        this.source = this.camera;
      }
      this.patch({ kind, starting: false, error: null });
    } catch (err) {
      this.source = null;
      this.patch({
        kind: 'none',
        starting: false,
        error: describeError(err),
      });
    }
  }

  /** 시뮬레이션 슬라이더. */
  setSimulationGain(v: number): void {
    this.simulation?.setManual(v);
  }

  /**
   * 보정 다시 시작. `R` 키와 재보정 버튼이 부릅니다.
   * 소스를 새로 시작하지 않고 이력만 비웁니다. 재시작하면 카메라 권한을
   * 다시 묻고 스트림도 새로 잡아야 합니다.
   */
  recalibrate(): void {
    this.source?.recalibrate();
    this.field.fill(0);
    this.reading.energy = 0;
    this.reading.calibration = 0;
    this.reading.state = 'DORMANT';
  }

  /**
   * 매 프레임 부릅니다. `04-flows.md` 4절의 3번 자리입니다.
   * 관객이 없으면 0 입니다. 그래도 나머지는 그대로 돕니다.
   */
  read(dt: number): number {
    if (!this.source) {
      this.reading.energy = 0;
      this.reading.calibration = 0;
      this.reading.state = 'DORMANT';
      return 0;
    }

    let energy = 0;
    try {
      energy = this.source.read(dt);
    } catch (err) {
      // 한 부분이 실패해도 화면은 계속 돌아야 합니다.
      console.error('[audience] 읽기에서 오류가 났습니다.', err);
    }

    this.reading.energy = energy;
    this.reading.calibration = this.source.calibration;
    this.reading.state = audienceState(energy);

    if (this.camera && this.source === this.camera) {
      this.field.set(this.camera.field);
    }
    return energy;
  }

  get hasSignal(): boolean {
    return this.source !== null;
  }
}

function describeError(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError') {
    return '카메라 권한이 거부됐습니다. 시뮬을 켜면 관객 없이 확인할 수 있습니다.';
  }
  if (name === 'NotFoundError') {
    return '카메라를 찾지 못했습니다. 시뮬을 켜면 관객 없이 확인할 수 있습니다.';
  }
  return '관객 입력을 시작하지 못했습니다. 시뮬을 켜면 관객 없이 확인할 수 있습니다.';
}

export const audienceManager = new AudienceManager();
