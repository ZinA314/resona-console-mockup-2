'use client';

/**
 * 07 씬 파라미터 (F-508). `docs/03-screens.md` 07 절.
 *
 * **지금 선택된 씬의 조절 값만 보여 줍니다.** 씬을 바꾸면 목록이 통째로
 * 바뀝니다. 쓰지 않는 씬의 손잡이를 늘어놓으면 리허설에서 헷갈립니다.
 */
import { Panel } from '@/components/console/Panel';
import { useConsoleStore } from '@/lib/store';
import { DEFAULT_SCENE_PARAMS } from '@/lib/types';
import { cx } from '@/lib/util';

export default function SceneParamsPanel() {
  const scene = useConsoleStore((s) => s.scene);
  const sp = useConsoleStore((s) => s.sceneParams);
  const setCommon = useConsoleStore((s) => s.setCommonParam);
  const setWeave = useConsoleStore((s) => s.setWeaveParam);
  const setBloom = useConsoleStore((s) => s.setBloomParam);
  const setBase = useConsoleStore((s) => s.setCompositeBase);
  const reset = useConsoleStore((s) => s.resetSceneParams);
  const dreaminessLock = useConsoleStore((s) => s.dreaminessLock);
  const setDreaminessLock = useConsoleStore((s) => s.setDreaminessLock);

  const d = DEFAULT_SCENE_PARAMS;
  // 합성 씬은 바탕으로 고른 씬의 손잡이를 그대로 보여 줍니다.
  const base = scene === 'composite' ? sp.composite.base : scene;

  return (
    <Panel index="07" title="씬 파라미터" hint={SCENE_LABEL[scene]}>
      <Group label="공통" onReset={() => reset('common')}>
        <Row
          label="강도" min={0} max={2} step={0.01}
          value={sp.common.intensity} def={d.common.intensity}
          onChange={(v) => setCommon('intensity', v)}
        />
        <Row
          label="잔상" min={0} max={0.95} step={0.01}
          value={sp.common.trail} def={d.common.trail}
          onChange={(v) => setCommon('trail', v)}
        />
        <Row
          label="그레인" min={0} max={1} step={0.01}
          value={sp.common.grain} def={d.common.grain}
          onChange={(v) => setCommon('grain', v)}
        />
        <Row
          label="교란" min={0} max={1} step={0.01}
          value={sp.common.glitch} def={d.common.glitch}
          onChange={(v) => setCommon('glitch', v)}
        />
        {/*
          몽환도 고정은 씬 파라미터가 아니라 연출 파라미터(F-405)이지만,
          손이 가는 자리가 여기라 07 패널에 둡니다. **공통입니다** — 이 값이
          무대 씬의 결만이 아니라 무대·합성·가사 씬의 교란까지 정하므로,
          무대 씬을 골랐을 때만 보이면 가사 씬에서 손댈 방법이 없습니다.
        */}
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="w-[6.2em] shrink-0 text-[10px] text-dim">몽환도 고정</span>
          <input
            type="range" min={0} max={1} step={0.01}
            value={dreaminessLock ?? 0.5}
            disabled={dreaminessLock === null}
            onChange={(e) => setDreaminessLock(Number(e.target.value))}
            className={cx(
              'h-1 min-w-0 flex-1',
              dreaminessLock === null ? 'accent-dim opacity-40' : 'accent-cyan',
            )}
          />
          <button
            type="button"
            onClick={() => setDreaminessLock(dreaminessLock === null ? 0.5 : null)}
            className={cx(
              'shrink-0 border px-1 text-[9px] leading-[1.4]',
              dreaminessLock === null
                ? 'border-rule text-dim hover:text-bone'
                : 'border-alert text-alert',
            )}
          >
            {dreaminessLock === null ? '끔' : dreaminessLock.toFixed(2)}
          </button>
        </div>
      </Group>

      {scene === 'composite' ? (
        <div className="mt-2 border-t border-rule pt-2">
          <p className="mb-1 text-[10px] uppercase tracking-[0.12em] text-dim">바탕</p>
          <div className="grid grid-cols-2 gap-px bg-rule">
            {(['weave', 'bloom'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setBase(k)}
                className={cx(
                  'py-1 text-[11px]',
                  sp.composite.base === k
                    ? 'bg-bone text-void'
                    : 'bg-panel text-dim hover:text-bone',
                )}
              >
                {k === 'weave' ? '직조' : '무대'}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {base === 'weave' ? (
        <Group label="직조" onReset={() => reset('weave')}>
          <Row
            label="경사" min={16} max={96} step={1} digits={0}
            value={sp.weave.warp} def={d.weave.warp}
            onChange={(v) => setWeave('warp', Math.round(v))}
          />
          <Row
            label="위사" min={10} max={60} step={1} digits={0}
            value={sp.weave.weft} def={d.weave.weft}
            onChange={(v) => setWeave('weft', Math.round(v))}
          />
          <Row
            label="장력" min={0} max={1} step={0.01}
            value={sp.weave.tension} def={d.weave.tension}
            onChange={(v) => setWeave('tension', v)}
          />
          <Row
            label="직조 속도" min={1} max={4} step={1} digits={0}
            value={sp.weave.rate} def={d.weave.rate}
            onChange={(v) => setWeave('rate', Math.round(v))}
          />
          <label className="mt-1.5 flex items-center gap-1.5">
            <span className="w-[6.2em] shrink-0 text-[10px] text-dim">스템 분리</span>
            <input
              type="checkbox"
              checked={sp.weave.split}
              onChange={(e) => setWeave('split', e.target.checked)}
              className="accent-cyan"
            />
          </label>
          <p className="mt-1 text-[9px] leading-tight text-dim">
            이미 쌓인 행은 그대로 두고 새로 쌓이는 행부터 적용합니다.
          </p>
        </Group>
      ) : null}

      {base === 'bloom' ? (
        <Group label="무대" onReset={() => reset('bloom')}>
          <Row
            label="입자 수 상한" min={800} max={8000} step={100} digits={0}
            value={sp.bloom.maxParticles} def={d.bloom.maxParticles}
            onChange={(v) => setBloom('maxParticles', Math.round(v))}
          />
          <Row
            label="유체 워핑" min={0} max={2} step={0.01}
            value={sp.bloom.warpScale} def={d.bloom.warpScale}
            onChange={(v) => setBloom('warpScale', v)}
          />
          <Row
            label="블룸 반경" min={0} max={2} step={0.01}
            value={sp.bloom.bloomRadius} def={d.bloom.bloomRadius}
            onChange={(v) => setBloom('bloomRadius', v)}
          />
          <Row
            label="블룸 세기" min={0} max={2} step={0.01}
            value={sp.bloom.bloomStrength} def={d.bloom.bloomStrength}
            onChange={(v) => setBloom('bloomStrength', v)}
          />
        </Group>
      ) : null}

      {base !== 'weave' && base !== 'bloom' ? (
        <p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-dim">
          이 씬은 공통 값만 씁니다
        </p>
      ) : null}
    </Panel>
  );
}

const SCENE_LABEL: Record<string, string> = {
  weave: '직조',
  type: '가사',
  faces: '관객',
  spectrum: '스펙트럼',
  composite: '합성',
  bloom: '무대',
};

function Group({
  label,
  onReset,
  children,
}: {
  label: string;
  onReset: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2 border-t border-rule pt-2 first:mt-0 first:border-0 first:pt-0">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.12em] text-dim">{label}</span>
        <button
          type="button"
          onClick={onReset}
          className="border border-rule px-1 text-[9px] leading-[1.4] text-dim hover:text-bone"
        >
          자동
        </button>
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  min,
  max,
  step,
  value,
  def,
  digits = 2,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  def: number;
  digits?: number;
  onChange: (v: number) => void;
}) {
  // 자동에서 벗어난 손잡이는 청록으로 칠해, 어느 것을 손댔는지 한눈에 보입니다.
  const touched = Math.abs(value - def) > 1e-6;
  return (
    <label className="mt-1.5 flex items-center gap-1.5">
      <span className="w-[6.2em] shrink-0 text-[10px] text-dim">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cx('h-1 min-w-0 flex-1', touched ? 'accent-cyan' : 'accent-dim')}
      />
      <span
        className={cx(
          'w-[3em] shrink-0 text-right text-[10px] tabular-nums',
          touched ? 'text-cyan' : 'text-bone',
        )}
      >
        {value.toFixed(digits)}
      </span>
    </label>
  );
}
