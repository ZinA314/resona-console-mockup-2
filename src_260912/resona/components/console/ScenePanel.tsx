'use client';

import { useSyncExternalStore } from 'react';
import { Panel } from '@/components/console/Panel';
import { webgl2Supported } from '@/components/stage/scenes/bloom/gl';
import { useConsoleStore } from '@/lib/store';
import type { SceneKind } from '@/lib/types';
import { cx } from '@/lib/util';

/**
 * 06 씬. `docs/03-screens.md` 06 절.
 *
 * **용도가 같은 것끼리 묶어 두 줄로 배열합니다.** 섞어 놓으면 공연 중에
 * 진단용 씬을 관객에게 띄우는 사고가 납니다.
 *
 * `1` 이 무대인 것은 의도한 것입니다. 공연 중에 손이 가장 자주 가는 자리이고,
 * 급할 때 누르면 무대로 돌아옵니다.
 */
const GROUPS: Array<{
  title: string;
  scenes: Array<{ key: SceneKind; label: string; what: string }>;
}> = [
  {
    title: '무대용',
    scenes: [
      { key: 'bloom', label: '무대', what: '공연 본편' },
      { key: 'composite', label: '합성', what: '무대+가사' },
      { key: 'type', label: '가사', what: '가사 크게' },
    ],
  },
  {
    title: '진단용',
    scenes: [
      { key: 'weave', label: '직조', what: '분석 확인' },
      { key: 'spectrum', label: '스펙트럼', what: '주파수' },
      { key: 'faces', label: '관객', what: '관객 신호' },
    ],
  },
];

export default function ScenePanel() {
  const scene = useConsoleStore((s) => s.scene);
  const setScene = useConsoleStore((s) => s.setScene);
  /*
   * 서버 렌더에서는 캔버스를 만들 수 없어 판정할 수 없습니다. 서버에서는
   * 있다고 보고, 클라이언트에서 실제로 재 봅니다.
   */
  const gl2 = useSyncExternalStore(
    () => () => {},
    webgl2Supported,
    () => true,
  );

  return (
    <Panel index="06" title="씬" hint="1–6">
      {GROUPS.map((group, gi) => (
        <div key={group.title} className="mt-2 first:mt-0">
          <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-dim">
            {group.title}
          </p>
          <div className="grid grid-cols-3 gap-px bg-rule">
            {group.scenes.map((s, si) => {
              // 숫자키는 배열 순서 그대로입니다.
              const key = gi * group.scenes.length + si + 1;
              const blocked = s.key === 'bloom' && !gl2;
              const active = scene === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setScene(s.key)}
                  disabled={blocked}
                  aria-pressed={active}
                  title={
                    blocked
                      ? '이 브라우저는 WebGL2 를 지원하지 않습니다'
                      : `숫자키 ${key}`
                  }
                  className={cx(
                    'flex flex-col items-center gap-0.5 px-0.5 py-1.5',
                    active ? 'bg-bone text-void' : 'bg-panel text-dim enabled:hover:text-bone',
                    blocked && 'opacity-40',
                  )}
                >
                  <span className="text-[11px] tracking-[0.04em]">{s.label}</span>
                  {/* 그 씬이 무엇을 보여 주는지 한 줄. 용도는 머리말이 말합니다. */}
                  <span
                    className={cx(
                      'text-[8px] tracking-[0.02em]',
                      active ? 'text-void/60' : 'text-dim/70',
                    )}
                  >
                    {s.what}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {!gl2 ? (
        <p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-alert">
          WebGL2 없음 — 무대 씬을 쓸 수 없습니다
        </p>
      ) : null}
    </Panel>
  );
}
