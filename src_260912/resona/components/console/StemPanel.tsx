'use client';

import { useRef, useState } from 'react';
import { Panel } from '@/components/console/Panel';
import { audioEngine } from '@/lib/audio/engine';
import { useFrame } from '@/lib/hooks';
import { formatUnit } from '@/lib/util';

const STEMS = [
  { name: 'DRUMS', from: '트랜지언트 · 2–8k' },
  { name: 'BASS', from: '20–250Hz' },
  { name: 'VOCAL', from: 'MID 채널 · 200–4k' },
  { name: 'OTHER', from: 'SIDE 채널 · 잔여' },
] as const;

export default function StemPanel() {
  const [values, setValues] = useState<number[]>([0, 0, 0, 0]);
  // 막대는 상태를 거치지 않고 매 프레임 DOM 에 직접 씁니다.
  const barRefs = useRef<Array<HTMLDivElement | null>>([null, null, null, null]);
  const peakRefs = useRef<Array<HTMLDivElement | null>>([null, null, null, null]);

  useFrame((_dt, frame) => {
    const a = audioEngine.analysis;
    for (let k = 0; k < 4; k += 1) {
      const bar = barRefs.current[k];
      if (bar) bar.style.transform = `scaleX(${a.stems[k]})`;
      const peak = peakRefs.current[k];
      if (peak) peak.style.transform = `scaleX(${a.stemPeak[k]})`;
    }
    if (frame % 4 !== 0) return;
    setValues([...a.stems]);
  }, 12);

  return (
    <Panel index="02" title="스템" hint="의사분리">
      <div className="grid grid-cols-2 gap-px bg-rule">
        {STEMS.map((s, k) => (
          <div key={s.name} className="bg-panel2 px-2 py-1.5">
            <div className="text-[16px] tabular-nums text-bone">
              {formatUnit(values[k])}
            </div>
            <div className="font-condensed text-[11px] uppercase tracking-[0.14em] text-bone">
              {s.name}
            </div>
            <div className="mt-0.5 text-[9px] leading-tight text-dim">{s.from}</div>
            <div className="mt-1 h-1 overflow-hidden bg-void">
              <div
                ref={(el) => {
                  barRefs.current[k] = el;
                }}
                className="h-full origin-left bg-bone"
                style={{ transform: 'scaleX(0)' }}
              />
            </div>
            <div className="mt-px h-px overflow-hidden bg-void">
              <div
                ref={(el) => {
                  peakRefs.current[k] = el;
                }}
                className="h-full origin-left bg-dim"
                style={{ transform: 'scaleX(0)' }}
              />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
