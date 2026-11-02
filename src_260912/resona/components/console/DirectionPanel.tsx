'use client';

import { useState } from 'react';
import { Panel } from '@/components/console/Panel';
import { directionManager } from '@/lib/direction/manager';
import { MUSIC_STATE_LABEL } from '@/lib/direction/state';
import { SPEED_MAX } from '@/lib/direction/translate';
import { useFrame } from '@/lib/hooks';
import { MOOD_LABEL } from '@/lib/palette/builtin';
import { useConsoleStore } from '@/lib/store';
import type { DirectionParams, Mood, MusicState } from '@/lib/types';
import { clamp, cx, formatUnit } from '@/lib/util';

type Key = keyof DirectionParams['musicOnly'];

/**
 * 08 패널에 그리는 항목.
 * `hue` 는 빠집니다. 색은 값 하나가 아니라 다섯 개의 묶음이라 막대로 표현할
 * 수 없고, 05 팔레트 패널에서 다룹니다.
 */
const ROWS: Array<{ key: Key; label: string; max: number; reversed?: boolean }> = [
  { key: 'density', label: '밀도', max: 1 },
  { key: 'scale', label: '크기', max: 1 },
  { key: 'speed', label: '속도', max: SPEED_MAX },
  { key: 'brightness', label: '밝기', max: 1 },
  { key: 'expansion', label: '확산', max: 1 },
  { key: 'glitch', label: '교란', max: 1 },
  // 관객이 뜨거울수록 값이 내려갑니다. 청록 층이 흰 층보다 짧습니다 (7-6절).
  { key: 'dreaminess', label: '몽환도', max: 1, reversed: true },
];

interface Snapshot {
  params: DirectionParams;
  state: MusicState;
  mood: Mood;
}

export default function DirectionPanel() {
  const influence = useConsoleStore((s) => s.influence);
  const dreaminessLock = useConsoleStore((s) => s.dreaminessLock);
  const setDreaminessLock = useConsoleStore((s) => s.setDreaminessLock);
  const [v, setV] = useState<Snapshot>({
    params: directionManager.params,
    state: 'SILENT',
    mood: directionManager.mood,
  });

  // 매 프레임이 아니라 4프레임마다 상태로 올립니다.
  useFrame((_dt, frame) => {
    if (frame % 4 !== 0) return;
    setV({
      params: directionManager.params,
      state: directionManager.state,
      mood: directionManager.mood,
    });
  }, 22);

  return (
    <Panel
      index="08"
      title="연출 파라미터"
      hint={`${MUSIC_STATE_LABEL[v.state]} · 영향력 ${Math.round(influence * 100)}%`}
    >
      {/* 지금 곡의 성격. 이름은 표시용이고 연출은 두 실수를 직접 씁니다. */}
      <p className="mb-2 border-b border-rule pb-1.5 text-[10px] uppercase tracking-[0.14em] text-dim">
        <span className="text-bone">{MOOD_LABEL[v.mood.name]}</span>
        {` · 밝기 ${formatUnit(v.mood.valence)} · 격렬함 ${formatUnit(v.mood.arousal)}`}
      </p>

      <div className="space-y-1.5">
        {ROWS.map(({ key, label, max, reversed }) => {
          const music = clamp(v.params.musicOnly[key] / max, 0, 1);
          const withAudience = clamp(v.params[key] / max, 0, 1);
          const locked = reversed && dreaminessLock !== null;
          return (
            <div key={key} className="flex items-center gap-1.5">
              <span className="w-[2.9em] shrink-0 text-[11px] text-bone">{label}</span>
              {/*
                아래층은 음악만으로 나온 값(흰색), 위층은 관객이 더해진
                최종값(청록색)입니다. 두 층의 차이가 곧 관객의 기여분입니다.
              */}
              <span className="relative block h-2.5 flex-1 bg-panel2">
                <span
                  className="absolute inset-y-0 left-0 bg-bone"
                  style={{ width: `${music * 100}%` }}
                />
                <span
                  className="absolute inset-y-0 left-0 border-r border-cyan bg-cyan/25"
                  style={{ width: `${withAudience * 100}%` }}
                />
              </span>
              {/* 방향이 다르다는 것을 막대 옆에서 알립니다. */}
              <span
                className="w-2 shrink-0 text-center text-[10px] leading-none text-cyan"
                title={reversed ? '관객이 뜨거울수록 내려갑니다' : undefined}
              >
                {reversed ? '↓' : ''}
              </span>
              <span className="w-[3.2em] shrink-0 text-right text-[11px] tabular-nums text-cyan">
                {formatUnit(v.params[key])}
              </span>
              {reversed ? (
                <button
                  type="button"
                  onClick={() =>
                    setDreaminessLock(locked ? null : v.params.musicOnly.dreaminess)
                  }
                  title={
                    locked
                      ? '자동 판정으로 되돌립니다'
                      : '지금 값으로 고정합니다 (자동 판정을 무시)'
                  }
                  className={cx(
                    'shrink-0 border px-1 text-[10px] leading-[1.35]',
                    locked
                      ? 'border-alert text-alert'
                      : 'border-rule text-dim hover:text-bone',
                  )}
                >
                  {locked ? '\u{1F512}' : '\u{1F513}'}
                </button>
              ) : (
                <span className="w-[1.1rem] shrink-0" />
              )}
            </div>
          );
        })}
      </div>

      <p
        className={cx(
          'mt-2 text-[9px] leading-relaxed',
          influence === 0 ? 'text-alert' : 'text-dim',
        )}
      >
        {influence === 0
          ? '영향력 0% — 관객이 움직여도 화면이 변하지 않습니다'
          : '흰 층은 음악만, 청록 층은 관객이 더해진 값입니다'}
      </p>
      {dreaminessLock !== null ? (
        <p className="mt-1 text-[9px] leading-relaxed text-alert">
          몽환도 고정 {formatUnit(dreaminessLock)} — 자동 판정을 쓰지 않습니다
        </p>
      ) : null}
    </Panel>
  );
}
