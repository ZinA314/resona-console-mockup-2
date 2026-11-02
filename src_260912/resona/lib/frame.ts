/**
 * 프레임 루프.
 *
 * `docs/04-flows.md` 4절의 순서를 지키기 위해 구독자마다 `order` 를 둡니다.
 * 낮은 순서가 먼저 돕니다. 분석(-100) → 관객 → 연출 → 렌더 → 리드아웃 순으로
 * 붙여 나갑니다.
 *
 * 한 구독자가 던진 오류가 루프를 멈추지 않게 각각 감쌉니다. 공연 중에 쓰는
 * 도구이므로 한 부분이 실패해도 화면은 계속 돌아야 합니다.
 */
import { clamp, lerp } from '@/lib/util';

type FrameFn = (dt: number, frame: number) => void;

interface Entry {
  fn: FrameFn;
  order: number;
}

const entries: Entry[] = [];
let rafId = 0;
let last = 0;
let frameIndex = 0;

/** 화면에 표시할 프레임 통계. 실시간 값이므로 React 상태에 넣지 않습니다. */
export const frameStats = { fps: 0, dt: 0 };

function tick(now: number) {
  rafId = requestAnimationFrame(tick);

  const dt = last === 0 ? 0 : clamp((now - last) / 1000, 0, 0.1);
  last = now;
  frameIndex += 1;
  frameStats.dt = dt;
  if (dt > 0) {
    const inst = 1 / dt;
    frameStats.fps = frameStats.fps === 0 ? inst : lerp(frameStats.fps, inst, 0.1);
  }

  // 콜백 안에서 구독을 해제할 수 있으므로 복사본을 돕니다.
  for (const entry of entries.slice()) {
    try {
      entry.fn(dt, frameIndex);
    } catch (err) {
      console.error('[frame] 구독자에서 오류가 났습니다. 루프는 계속합니다.', err);
    }
  }
}

export function subscribeFrame(fn: FrameFn, order = 0): () => void {
  const entry: Entry = { fn, order };
  entries.push(entry);
  entries.sort((a, b) => a.order - b.order);

  if (rafId === 0) {
    last = 0;
    frameStats.fps = 0;
    rafId = requestAnimationFrame(tick);
  }

  return () => {
    const i = entries.indexOf(entry);
    if (i >= 0) entries.splice(i, 1);
    if (entries.length === 0 && rafId !== 0) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };
}
