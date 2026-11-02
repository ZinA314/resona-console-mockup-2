'use client';

import { useState } from 'react';
import { Panel } from '@/components/console/Panel';
import { audienceManager } from '@/lib/audience/manager';
import { audioEngine } from '@/lib/audio/engine';
import {
  CHANNELS,
  CHANNEL_GROUPS,
  readChannel,
  type RoutingContext,
} from '@/lib/routing/channels';
import {
  RATE_MAX,
  RATE_MIN,
  routingClient,
  type RoutingState,
} from '@/lib/routing/client';
import { TD_SNIPPET } from '@/lib/routing/snippet';
import { readStageInput } from '@/lib/render/feed';
import { useFrame, useRouting } from '@/lib/hooks';
import { useConsoleStore } from '@/lib/store';
import { cx } from '@/lib/util';

/**
 * 10 외부 연동 (F-800). `docs/03-screens.md` 10 절.
 *
 * 원본 프로토타입의 「08 · TouchDesigner 라우팅」 패널을 옮긴 자리입니다.
 *
 * **채널 표는 초당 네 번만 다시 그립니다.** 눈으로 확인하기에 충분하고,
 * 송출 자체와는 무관합니다. 매 프레임 오십 몇 개를 다시 그리면 표를 그리느라
 * 프레임을 잃습니다.
 *
 * **연결하지 않아도 콘솔은 그대로 돕니다.** 이 패널은 무대 밖으로 값을 보내는
 * 통로일 뿐이고, 송출은 분석 루프(`Console.tsx`)가 누적 시간으로 솎아 냅니다.
 */
const STATE_LABEL: Record<RoutingState, string> = {
  OFFLINE: 'OFFLINE',
  CONNECTING: 'CONNECTING',
  LIVE: 'LIVE',
};

/** 표 갱신 주기. 초당 네 번입니다. */
const TABLE_EVERY = 15;

function ctxNow(): RoutingContext {
  return {
    input: readStageInput(),
    trackTime: audioEngine.currentTime,
    influence: useConsoleStore.getState().influence,
    calibration: audienceManager.reading.calibration,
  };
}

export default function RoutingPanel() {
  const st = useRouting();
  const [open, setOpen] = useState<Record<string, boolean>>({ 연출: true });
  const [values, setValues] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  /*
   * 표는 초당 네 번만. 펼친 묶음이 없으면 아예 읽지 않습니다.
   * `useFrame` 이 매 렌더 콜백을 갈아 끼우므로 여기의 `open` 은 늘 최신입니다.
   */
  useFrame((_dt, frame) => {
    if (frame % TABLE_EVERY !== 0) return;
    const labels = CHANNEL_GROUPS.filter((g) => open[g.label]);
    if (labels.length === 0) return;
    const c = ctxNow();
    const next: Record<string, string> = {};
    for (const g of labels) {
      for (const ch of g.channels) {
        const v = readChannel(ch, c);
        next[ch[0]] = typeof v === 'number' ? v.toFixed(ch[2] ?? 3) : String(v);
      }
    }
    setValues(next);
  }, 24);

  function copy(text: string, label: string) {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(label);
        window.setTimeout(() => setCopied(null), 2000);
      },
      () => setCopied('복사하지 못했습니다'),
    );
  }

  const live = st.state === 'LIVE';
  const busy = st.state === 'CONNECTING';

  return (
    <Panel index="10" title="외부 연동" hint={STATE_LABEL[st.state]}>
      <div className="flex gap-px bg-rule">
        <input
          type="text"
          value={st.url}
          onChange={(e) => routingClient.setUrl(e.target.value)}
          aria-label="송출 주소"
          className="min-w-0 flex-1 bg-panel2 px-2 py-1 text-[11px] text-bone focus:outline-none"
        />
        <button
          type="button"
          onClick={() => routingClient.toggle()}
          className={cx(
            'shrink-0 px-2 py-1 text-[10px] uppercase tracking-[0.12em]',
            st.state === 'OFFLINE'
              ? 'bg-panel text-bone hover:bg-panel2'
              : 'bg-alert text-void',
          )}
        >
          {st.state === 'OFFLINE' ? '연결' : '해제'}
        </button>
      </div>

      {/* 상태 램프와 재연결 시도 횟수. 사람이 끊은 것과 상대가 죽은 것을 가릅니다. */}
      <div className="mt-1.5 flex items-center gap-1.5">
        <span
          aria-hidden
          className={cx(
            'h-2 w-2 shrink-0',
            live ? 'bg-cyan' : busy ? 'bg-alert' : 'bg-rule',
          )}
        />
        <span className={cx('text-[10px]', live ? 'text-cyan' : 'text-dim')}>
          {STATE_LABEL[st.state]}
        </span>
        {busy && st.attempt > 0 ? (
          <span className="text-[9px] text-dim">재연결 {st.attempt}회째</span>
        ) : null}
        {live ? (
          <span className="ml-auto text-[9px] tabular-nums text-dim">
            {st.sent.toLocaleString()} 회 송출
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => routingClient.setFormat(st.format === 'json' ? 'osc' : 'json')}
          className="shrink-0 border border-rule px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-bone hover:bg-panel2"
        >
          {st.format === 'json' ? 'JSON' : 'OSC-TXT'}
        </button>
        <span className="shrink-0 text-[10px] text-dim">송출 레이트</span>
        <input
          type="range"
          min={RATE_MIN}
          max={RATE_MAX}
          step={1}
          value={st.rate}
          onChange={(e) => routingClient.setRate(Number(e.target.value))}
          className="h-1 min-w-0 flex-1 accent-cyan"
          aria-label="송출 레이트"
        />
        <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-bone">
          {st.rate}
        </span>
      </div>

      {/* 채널 표. 오십 개가 넘어 한 번에 펴 두면 레일을 다 먹습니다. */}
      <div className="mt-2 border border-rule">
        {CHANNEL_GROUPS.map((g) => (
          <div key={g.label} className="border-b border-rule last:border-0">
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [g.label]: !o[g.label] }))}
              aria-expanded={!!open[g.label]}
              className="flex w-full items-center justify-between px-1.5 py-1 text-[10px] text-dim hover:text-bone"
            >
              <span>
                {open[g.label] ? '▾' : '▸'} {g.label}
              </span>
              <span className="tabular-nums">{g.channels.length}</span>
            </button>
            {open[g.label] ? (
              <ul className="border-t border-rule bg-panel2 px-1.5 py-1">
                {g.channels.map((ch) => (
                  <li key={ch[0]} className="flex items-baseline gap-1">
                    <span className="min-w-0 flex-1 truncate text-[9px] text-dim">
                      {ch[0].replace('/resona/', '')}
                    </span>
                    <span className="shrink-0 text-[9px] tabular-nums text-bone">
                      {values[ch[0]] ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-px bg-rule">
        <button
          type="button"
          onClick={() => copy(CHANNELS.map((c) => c[0]).join('\n'), `채널맵 ${CHANNELS.length}개`)}
          className="bg-panel px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-bone hover:bg-panel2"
        >
          채널맵 복사
        </button>
        <button
          type="button"
          onClick={() => copy(TD_SNIPPET, 'TD 스니펫')}
          className="bg-panel px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-bone hover:bg-panel2"
        >
          TD 스니펫 복사
        </button>
      </div>
      {copied ? (
        <p role="status" className="mt-1 text-[9px] text-cyan">
          {copied} 복사됨
        </p>
      ) : null}

      {st.error ? (
        <p role="alert" className="mt-2 text-[9px] leading-relaxed text-alert">
          {st.error}
        </p>
      ) : null}

      <p className="mt-2 text-[9px] leading-relaxed text-dim">
        TouchDesigner 쪽은 WebSocket DAT(포트 9980) → JSON DAT → CHOP Execute 순으로
        구성합니다. 숫자는 Constant CHOP, 문자열은 Table DAT 으로 갈라 받습니다.
      </p>
      <p className="mt-1 text-[9px] leading-relaxed text-dim">
        배포된 주소(https)에서는 보안 정책상 로컬 소켓 연결이 차단됩니다. 외부 연동은
        로컬 실행에서 사용하십시오.
      </p>
    </Panel>
  );
}
