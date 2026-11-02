'use client';

import { useRef, useState } from 'react';
import LyricsEditor from '@/components/console/LyricsEditor';
import { Panel } from '@/components/console/Panel';
import { audioEngine } from '@/lib/audio/engine';
import { LyricsCursor } from '@/lib/lyrics/cue';
import { parseLrc } from '@/lib/lyrics/lrc';
import { useFrame } from '@/lib/hooks';
import { useConsoleStore } from '@/lib/store';
import { cx } from '@/lib/util';

type Tab = 'show' | 'edit';

/**
 * 03 가사 큐. `docs/03-screens.md` 03 절.
 *
 * `표시` 탭은 여기에, `편집` 탭(LRC 편집기, F-603~605)은 `LyricsEditor` 에
 * 있습니다. 원문 영역의 내용은 스토어가 들고 있습니다 — 큐와 원문을 잇는
 * 규칙이 한 곳에 있어야 해서입니다 (`issues/15`).
 *
 * **줄 안의 진행률은 매 프레임 바뀝니다.** 상태로 올리면 초당 예순 번 리렌더가
 * 일어나므로 진행 막대는 DOM 에 직접 씁니다. 줄이 넘어가는 순간에만 상태를
 * 갱신합니다 — 그때는 글자가 바뀌어야 하니 리렌더가 필요합니다.
 */
export default function LyricsPanel() {
  const lines = useConsoleStore((s) => s.lyrics);
  const lyricsName = useConsoleStore((s) => s.lyricsName);
  const setLyrics = useConsoleStore((s) => s.setLyrics);
  const clearLyrics = useConsoleStore((s) => s.clearLyrics);

  const [tab, setTab] = useState<Tab>('show');
  const [over, setOver] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [index, setIndex] = useState(-1);
  /** 03 머리의 `n / 총`. 재생에 쓰이는 줄만 셉니다 (시각 미정 줄 제외). */
  const [pos, setPos] = useState({ ordinal: 0, total: 0 });

  const inputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  // 패널 자기 몫의 커서입니다. 캔버스 쪽(`lib/render/feed.ts`)과 따로 두는 것은
  // 그쪽이 프레임마다 갱신되는 무대용 값이고, 이쪽은 표시용이기 때문입니다.
  const cursorRef = useRef(new LyricsCursor());

  useFrame(() => {
    const cue = cursorRef.current.update(
      lines,
      audioEngine.currentTime,
      audioEngine.duration,
    );
    if (barRef.current) {
      barRef.current.style.transform = `scaleX(${cue.line ? cue.progress : 0})`;
    }
    // 줄이 넘어갈 때만 상태를 건드립니다.
    setIndex((prev) => (prev === cue.index ? prev : cue.index));
    setPos((prev) =>
      prev.ordinal === cue.ordinal && prev.total === cue.total
        ? prev
        : { ordinal: cue.ordinal, total: cue.total },
    );
  }, 14);

  async function accept(file: File | null | undefined) {
    if (!file) return;
    const text = await file.text();
    const parsed = parseLrc(text);
    if (parsed.lines.length === 0) {
      setNote(`${file.name} 에서 타임스탬프가 붙은 줄을 찾지 못했습니다.`);
      return;
    }
    setLyrics(parsed.lines, file.name);
    cursorRef.current.reset();
    setNote(
      parsed.undated > 0
        ? `${parsed.lines.length} 줄. 그중 ${parsed.undated} 줄은 시각 미정입니다.`
        : null,
    );
  }

  const current = index >= 0 ? lines[index] : null;
  const next = index + 1 < lines.length ? lines[index + 1] : null;

  return (
    <Panel
      index="03"
      title="가사 큐"
      hint={`${pos.ordinal} / ${pos.total}`}
    >
      <div className="mb-2 flex gap-px bg-rule">
        {(['show', 'edit'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={cx(
              'flex-1 px-2 py-1 text-[10px] uppercase tracking-[0.12em]',
              tab === t ? 'bg-bone text-void' : 'bg-panel text-dim hover:bg-panel2',
            )}
          >
            {t === 'show' ? '표시' : '편집'}
          </button>
        ))}
      </div>

      {tab === 'show' ? (
        <>
          <div
            role="button"
            tabIndex={0}
            aria-label="LRC 파일 로드"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void accept(e.dataTransfer.files?.[0]);
            }}
            className={cx(
              'flex h-12 cursor-pointer flex-col items-center justify-center border border-dashed px-2 text-center text-[10px] transition-colors',
              over ? 'border-bone bg-panel2 text-bone' : 'border-rule text-dim hover:border-dim',
            )}
          >
            {lyricsName ? (
              <span className="max-w-full truncate text-bone" title={lyricsName}>
                {lyricsName}
              </span>
            ) : (
              <span>LRC 파일 끌어다 놓기</span>
            )}
            <span className="mt-0.5">{'[mm:ss.xx] 형식'}</span>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".lrc,.txt,text/plain"
            className="sr-only"
            onChange={(e) => {
              void accept(e.target.files?.[0]);
              e.target.value = '';
            }}
          />

          {/*
            현재 줄과 다음 줄. 현재 줄에는 진행 막대를 겹칩니다.
            막대는 `useFrame` 이 DOM 에 직접 씁니다.
          */}
          <div className="mt-2 space-y-1">
            <div className="relative overflow-hidden bg-panel2 px-2 py-1">
              <div
                ref={barRef}
                aria-hidden
                className="absolute inset-y-0 left-0 w-full origin-left bg-bone/12"
                style={{ transform: 'scaleX(0)' }}
              />
              <span
                className={cx(
                  'relative block truncate text-[12px]',
                  current ? 'text-bone' : 'text-dim',
                )}
              >
                {current?.text || '—'}
              </span>
            </div>
            <div className="truncate px-2 text-[11px] text-dim">
              {next?.text || '—'}
            </div>
          </div>

          {note ? (
            <p role="status" className="mt-2 text-[10px] leading-relaxed text-dim">
              {note}
            </p>
          ) : null}

          {lines.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                clearLyrics();
                cursorRef.current.reset();
                setNote(null);
                setIndex(-1);
              }}
              className="mt-2 w-full border border-rule px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-dim hover:bg-panel2 hover:text-bone"
            >
              가사 비우기
            </button>
          ) : null}
        </>
      ) : (
        <LyricsEditor currentIndex={index} />
      )}
    </Panel>
  );
}
