/**
 * 관객 입력의 공통 계약. `docs/02-features.md` F-300.
 *
 * 카메라와 마이크가 같은 인터페이스를 구현합니다. 공연장 사정에 따라 방식이
 * 달라지므로, 설정 한 줄로 바꿀 수 있어야 합니다.
 *
 * `AudienceSource` 자체는 `lib/types.ts` 에 있습니다(06-data-model 4절).
 * 여기서는 다시 내보내고, 관객 모듈 안에서만 쓰는 것들을 더합니다.
 */
import type { AudienceSource } from '@/lib/types';

export type { AudienceSource } from '@/lib/types';

/**
 * 관객 모듈 안에서 쓰는 확장.
 * 보정만 다시 시작하는 자리가 필요합니다. 소스를 통째로 재시작하면 카메라
 * 권한을 다시 묻고 스트림도 새로 잡아야 합니다.
 * 공개 인터페이스(`06-data-model.md` 4절)는 건드리지 않습니다.
 */
export interface ManagedAudienceSource extends AudienceSource {
  recalibrate(): void;
}

/** 카메라 격자 크기. 2,304칸입니다. */
export const FIELD_W = 64;
export const FIELD_H = 36;
export const FIELD_SIZE = FIELD_W * FIELD_H;

/** 상태 구간. `05-signal-processing.md` 5-5절. */
export const AUDIENCE_STATE_LABEL = {
  DORMANT: '잠잠함',
  STIRRING: '술렁임',
  ACTIVE: '활발함',
  SURGE: '폭발',
} as const;

/** 방식 선택 버튼에 쓰는 표시 이름. */
export const AUDIENCE_KIND_LABEL = {
  camera: '카메라',
  microphone: '마이크',
  simulation: '시뮬',
  none: '끔',
} as const;
