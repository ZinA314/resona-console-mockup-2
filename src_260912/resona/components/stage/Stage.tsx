'use client';

import StageCanvas from '@/components/stage/StageCanvas';
import { readStageInput } from '@/lib/render/feed';
import { useAudienceStatus, useEngineState } from '@/lib/hooks';
import { useConsoleStore } from '@/lib/store';
import type { SceneKind } from '@/lib/types';

const SCENE_LABEL: Record<SceneKind, string> = {
  weave: '직조',
  type: '가사',
  faces: '관객',
  spectrum: '스펙트럼',
  composite: '합성',
  bloom: '무대',
};

/**
 * 콘솔 안의 중앙 무대.
 *
 * **여기는 미리보기일 뿐입니다.** 분석과 출력 창 송출은 오디오 스레드의
 * 시계가 몰고(#16), 이 캔버스는 콘솔의 rAF 로 그립니다. 콘솔을 최소화하면
 * 이 미리보기만 멈추고 출력 창은 계속 돕니다.
 */
export default function Stage() {
  const engine = useEngineState();
  const scene = useConsoleStore((s) => s.scene);
  const blackout = useConsoleStore((s) => s.blackout);
  const audience = useAudienceStatus();

  return (
    <div className="relative flex min-h-0 flex-1 flex-col border border-rule bg-void">
      <StageCanvas className="absolute inset-0" read={readStageInput} />

      <div className="pointer-events-none absolute left-2 top-2 font-condensed text-[11px] uppercase tracking-[0.2em] text-dim">
        {SCENE_LABEL[scene]}
        {blackout ? ' · 블랙아웃' : ''}
      </div>

      {/*
        음원이 없을 때만 안내합니다. 다만 관객 씬은 음원 없이도 그릴 것이
        있으므로, 그때는 가리지 않습니다. 화면에 그림이 있는데 "소스 없음" 이
        떠 있으면 고장으로 읽힙니다.
      */}
      {!engine.ready && !(scene === 'faces' && audience.kind !== 'none') ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
          <p className="font-condensed text-[15px] uppercase tracking-[0.24em] text-dim">
            소스 없음
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-dim">
            01 소스 입력에 음원 파일을 끌어다 놓거나 데모 신스를 켜십시오.
          </p>
        </div>
      ) : null}
    </div>
  );
}
