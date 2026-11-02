'use client';

import { useEffect, useRef, useState } from 'react';
import StageCanvas from '@/components/stage/StageCanvas';
import { subscribeStage, type StageMessage } from '@/lib/render/broadcast';
import type { SceneInput } from '@/lib/render/types';

/**
 * 출력 창 (F-506).
 *
 * 중앙 무대만 전체 화면으로 띄운 것입니다. 조작 요소가 없습니다.
 *
 * **자기 `requestAnimationFrame` 으로 그립니다** (#16). 값은 콘솔이
 * `BroadcastChannel` 로 보내 주고, 그 값을 자기 창의 프레임 주기에 맞춰
 * 그립니다. 그래서 콘솔이 최소화되거나 뒤로 가도 이 창이 앞에 있는 한
 * 화면은 계속 움직입니다.
 */

/** 이만큼 값을 못 받으면 콘솔이 멎은 것으로 보고 시각만 스스로 굴립니다. */
const STARVED_AFTER = 0.5;

export default function OutputPage() {
  const latest = useRef<StageMessage | null>(null);
  /** 마지막으로 값을 받은 시각(초). 콘솔이 멎었는지 재는 데만 씁니다. */
  const receivedAt = useRef(0);
  const lastFrameRef = useRef(0);
  const [everConnected, setEverConnected] = useState(false);

  useEffect(() => {
    const stop = subscribeStage((m) => {
      latest.current = m;
      receivedAt.current = performance.now() / 1000;
      setEverConnected((prev) => (prev ? prev : true));
    });
    document.title = 'RESONA — 출력';
    return stop;
  }, []);

  const read = (): SceneInput | null => {
    const m = latest.current;
    if (!m) return null;

    const now = performance.now() / 1000;
    const since = now - receivedAt.current;
    const dt = lastFrameRef.current === 0 ? 0 : now - lastFrameRef.current;
    lastFrameRef.current = now;

    /*
     * 콘솔이 0.5초 넘게 조용하면 마지막으로 받은 값을 그대로 계속 그립니다.
     * **화면에는 아무것도 표시하지 않습니다.** 관객이 보는 화면이라 오류
     * 표시가 뜨면 안 됩니다.
     *
     * 다만 시각만은 스스로 굴립니다. 시각까지 얼어붙이면 잔상과 입자가 멎어
     * 화면이 정지 사진처럼 보입니다. 분석값은 마지막 것 그대로입니다.
     */
    if (since > STARVED_AFTER) {
      m.time += Math.min(dt, 0.1);
    }
    return m;
  };

  return (
    <main className="relative h-dvh w-full bg-void">
      <StageCanvas className="absolute inset-0" read={read} />
      {/*
        아직 한 번도 값을 받지 못했을 때만 안내합니다. 한 번이라도 연결되면
        다시 뜨지 않습니다 — 공연 중에 관객이 보는 화면입니다.
      */}
      {!everConnected ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
          <p className="font-condensed text-[15px] uppercase tracking-[0.24em] text-dim">
            콘솔을 기다리는 중
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-dim">
            같은 브라우저에서 콘솔 탭이 열려 있어야 합니다.
          </p>
        </div>
      ) : null}
    </main>
  );
}
