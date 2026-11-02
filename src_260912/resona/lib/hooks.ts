'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { audioEngine, INITIAL_ENGINE_STATE, type EngineState } from '@/lib/audio/engine';
import { subscribeFrame } from '@/lib/frame';
import {
  audienceManager,
  INITIAL_AUDIENCE_STATUS,
  type AudienceStatus,
} from '@/lib/audience/manager';
import { authManager, INITIAL_AUTH, type AuthState } from '@/lib/supabase/auth';
import { library, INITIAL_LIBRARY, type LibraryState } from '@/lib/supabase/library';
import { routingClient, INITIAL_ROUTING, type RoutingStatus } from '@/lib/routing/client';

/** 실시간이 아닌 엔진 상태(파일명·길이·재생 여부·오류)를 구독합니다. */
export function useEngineState(): EngineState {
  return useSyncExternalStore(
    audioEngine.subscribe,
    audioEngine.getSnapshot,
    () => INITIAL_ENGINE_STATE,
  );
}

/** 관객 입력의 실시간이 아닌 상태(방식·오류)를 구독합니다. */
export function useAudienceStatus(): AudienceStatus {
  return useSyncExternalStore(
    audienceManager.subscribe,
    audienceManager.getSnapshot,
    () => INITIAL_AUDIENCE_STATUS,
  );
}

/** 로그인 상태 (7단계). 서버 렌더에서는 로그아웃으로 봅니다. */
export function useAuth(): AuthState {
  return useSyncExternalStore(
    authManager.subscribe,
    authManager.getSnapshot,
    () => INITIAL_AUTH,
  );
}

/** 프리셋 목록과 동기화 상태 (F-700). */
export function useLibrary(): LibraryState {
  return useSyncExternalStore(
    library.subscribe,
    library.getSnapshot,
    () => INITIAL_LIBRARY,
  );
}

/** 외부 연동 상태 (F-801). */
export function useRouting(): RoutingStatus {
  return useSyncExternalStore(
    routingClient.subscribe,
    routingClient.getSnapshot,
    () => INITIAL_ROUTING,
  );
}

/**
 * 프레임 루프 구독. `fn` 이 매 렌더 바뀌어도 다시 구독하지 않습니다.
 * 여기서 setState 를 부를 때는 4프레임에 한 번으로 줄이십시오.
 */
export function useFrame(fn: (dt: number, frame: number) => void, order = 0): void {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => subscribeFrame((dt, frame) => ref.current(dt, frame), order), [order]);
}
