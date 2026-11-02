'use client';

import { useRef, useState } from 'react';
import { Panel } from '@/components/console/Panel';
import { audienceManager } from '@/lib/audience/manager';
import {
  AUDIENCE_KIND_LABEL,
  AUDIENCE_STATE_LABEL,
  FIELD_H,
  FIELD_W,
} from '@/lib/audience/types';
import { useAudienceStatus, useFrame } from '@/lib/hooks';
import { useConsoleStore } from '@/lib/store';
import type { AudienceSource, AudienceState } from '@/lib/types';
import { cx, formatUnit } from '@/lib/util';

const KINDS: Array<AudienceSource['kind']> = [
  'camera',
  'microphone',
  'simulation',
  'none',
];

/** 24칸 LED 막대. */
const LEDS = 24;

/** 카메라 격자 미리보기. 매 프레임 캔버스에 직접 그립니다. */
function FieldPreview({ live }: { live: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useFrame(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, FIELD_W, FIELD_H);
    if (!live) return;

    const field = audienceManager.field;
    const img = ctx.createImageData(FIELD_W, FIELD_H);
    const d = img.data;
    for (let i = 0; i < FIELD_W * FIELD_H; i += 1) {
      // 변화량은 작은 값이라 그대로 그리면 보이지 않습니다.
      const v = Math.min(255, field[i] * 6 * 255);
      const p = i * 4;
      d[p] = 127;
      d[p + 1] = 215;
      d[p + 2] = 208;
      d[p + 3] = v;
    }
    ctx.putImageData(img, 0, 0);
  }, 14);

  return (
    <canvas
      ref={ref}
      width={FIELD_W}
      height={FIELD_H}
      // 격자를 그대로 키웁니다. 보간하면 칸이 뭉개집니다.
      // 창의 비율은 격자와 같은 16:9 입니다. 다른 비율로 두면 화면의 사각형이
      // 실제 객석 배치와 어긋나게 보입니다.
      className="aspect-video w-full bg-panel2 [image-rendering:pixelated]"
    />
  );
}

export default function AudiencePanel() {
  const status = useAudienceStatus();
  const influence = useConsoleStore((s) => s.influence);
  const setInfluence = useConsoleStore((s) => s.setInfluence);
  const simGain = useConsoleStore((s) => s.simGain);
  const setSimGain = useConsoleStore((s) => s.setSimGain);

  // 표시용 수치는 4프레임마다 한 번만 상태로 올립니다.
  const [v, setV] = useState<{
    energy: number;
    calibration: number;
    state: AudienceState;
  }>({ energy: 0, calibration: 0, state: 'DORMANT' });
  const ledRefs = useRef<Array<HTMLSpanElement | null>>([]);

  useFrame((_dt, frame) => {
    const r = audienceManager.reading;
    // LED 는 상태를 거치지 않고 매 프레임 DOM 에 직접 씁니다.
    const lit = Math.round(r.energy * LEDS);
    for (let i = 0; i < LEDS; i += 1) {
      const el = ledRefs.current[i];
      if (el) el.style.opacity = i < lit ? '1' : '0.12';
    }
    if (frame % 4 !== 0) return;
    setV({ energy: r.energy, calibration: r.calibration, state: r.state });
  }, 14);

  const live = status.kind !== 'none';
  const calibrated = v.calibration >= 1;

  return (
    <Panel index="04" title="관객 입력" hint={status.starting ? '권한 요청 중' : undefined}>
      <div className="grid grid-cols-4 gap-px bg-rule">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => void audienceManager.select(k)}
            aria-pressed={status.kind === k}
            className={cx(
              'px-1 py-1.5 text-[11px] uppercase tracking-[0.08em]',
              status.kind === k ? 'bg-bone text-void' : 'bg-panel text-dim hover:text-bone',
            )}
          >
            {AUDIENCE_KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {status.error ? (
        <p role="alert" className="mt-2 text-[11px] leading-relaxed text-alert">
          {status.error}
        </p>
      ) : null}

      <div className="mt-2">
        {status.kind === 'camera' ? (
          <FieldPreview live={live} />
        ) : (
          <div className="flex aspect-video items-center justify-center bg-panel2 text-[10px] text-dim">
            {status.kind === 'simulation' ? '시뮬레이션 동작 중' : '관객 신호 없음'}
          </div>
        )}
      </div>

      <div className="mt-2 flex items-end justify-between">
        <span
          aria-live="polite"
          className={cx('text-[30px] leading-none tabular-nums', live ? 'text-cyan' : 'text-dim')}
        >
          {formatUnit(v.energy)}
        </span>
        <span
          className={cx(
            'font-condensed text-[13px] uppercase tracking-[0.14em]',
            live ? 'text-bone' : 'text-dim',
          )}
        >
          {AUDIENCE_STATE_LABEL[v.state]}
        </span>
      </div>

      {/* 24칸 LED 막대 */}
      <div
        className="mt-2 grid gap-px"
        style={{ gridTemplateColumns: `repeat(${LEDS}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: LEDS }, (_, i) => (
          <span
            key={i}
            ref={(el) => {
              ledRefs.current[i] = el;
            }}
            className="h-2 bg-cyan"
            style={{ opacity: 0.12 }}
          />
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px]">
        <span className={live && calibrated ? 'text-cyan' : 'text-dim'}>
          {!live
            ? '보정 —'
            : calibrated
              ? '보정 완료'
              : `보정 중 ${Math.round(v.calibration * 100)}%`}
        </span>
        <button
          type="button"
          onClick={() => audienceManager.recalibrate()}
          disabled={!live}
          title="R"
          className="border border-rule px-1.5 py-0.5 uppercase tracking-[0.12em] text-bone hover:bg-panel2 disabled:cursor-not-allowed disabled:text-dim"
        >
          재보정
        </button>
      </div>

      {status.kind === 'simulation' ? (
        <div className="mt-2">
          <div className="flex items-baseline justify-between">
            <label htmlFor="simGain" className="text-[10px] uppercase tracking-[0.1em] text-dim">
              시뮬 수동
            </label>
            <span className="text-[11px] tabular-nums text-cyan">
              {Math.round(simGain * 100)}%
            </span>
          </div>
          <input
            id="simGain"
            type="range"
            min={0}
            max={100}
            value={Math.round(simGain * 100)}
            onChange={(e) => {
              const g = Number(e.target.value) / 100;
              setSimGain(g);
              audienceManager.setSimulationGain(g);
            }}
            className="mt-1 w-full accent-[var(--cyan)]"
          />
        </div>
      ) : null}

      <div className="mt-3 border-t border-rule pt-2">
        <div className="flex items-baseline justify-between">
          <label
            htmlFor="influence"
            className="font-condensed text-[12px] uppercase tracking-[0.14em] text-bone"
          >
            관객 영향력
          </label>
          <span className="text-[12px] tabular-nums text-cyan">
            {Math.round(influence * 100)}%
          </span>
        </div>
        <input
          id="influence"
          type="range"
          min={0}
          max={100}
          value={Math.round(influence * 100)}
          onChange={(e) => setInfluence(Number(e.target.value) / 100)}
          className="mt-1 w-full accent-[var(--cyan)]"
        />
        <p className="mt-1 text-[9px] text-dim">5단계에서 연출에 곱해집니다</p>
      </div>

      <p className="mt-2 text-[9px] uppercase tracking-[0.1em] text-dim">
        NO FRAMES STORED — 영상은 저장되지도 전송되지도 않습니다
      </p>
    </Panel>
  );
}
