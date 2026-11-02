'use client';

import { useEffect, useRef, useState } from 'react';
import { audioEngine } from '@/lib/audio/engine';
import {
  NO_STAMP,
  countUndated,
  distributeEvenly,
  formatStamp,
  parseLrc,
  toLrc,
} from '@/lib/lyrics/lrc';
import { useAuth, useEngineState, useLibrary } from '@/lib/hooks';
import { library } from '@/lib/supabase/library';
import { supabaseConfigured } from '@/lib/supabase/client';
import { useConsoleStore } from '@/lib/store';
import { cx } from '@/lib/util';

/**
 * 03 가사 큐의 `편집` 탭 — LRC 편집기 (F-603~F-605).
 * `docs/03-screens.md` 03 절.
 *
 * **원문 영역은 지금 큐를 비춥니다.** 둘이 따로 놀면 불러온 가사 아래에 한
 * 줄 적고 `파싱` 을 눌렀을 때 스무 줄이 그 한 줄로 바뀝니다. 비추는 규칙은
 * 스토어에 모여 있습니다 — 손대지 않았으면 큐를 따라가고, 손댔으면 그대로
 * 두되 파일 로드만은 갈아 끼웁니다.
 *
 * **키를 듣지 않습니다.** 탭 모드의 `Space` 와 `ESC` 는 전역 단축키
 * 처리기(`Console.tsx`)가 갈라 스토어를 부릅니다. 인라인 편집 중에는 초점이
 * `input` 에 있어 그 처리기의 `isTyping` 갈림이 먼저 막습니다.
 *
 * `가사 저장` 은 곡과 묶어 Supabase 의 `lyrics` 에 넣습니다 (F-605). **시각 미정
 * 줄도 그대로 저장합니다** — 빼는 것은 `.lrc` 내보내기뿐입니다.
 *
 * **씬과 슬라이더는 담지 않습니다.** 그쪽은 12 프리셋의 몫입니다. 버튼 이름을
 * 둘 다 `저장` 으로 두었더니 하나만 누르고 둘 다 됐다고 읽는 일이 있었습니다. 저장이
 * 실패하면 로컬 대기열에 쌓이고 연결이 돌아올 때 올라갑니다.
 */
export default function LyricsEditor({ currentIndex }: { currentIndex: number }) {
  const engine = useEngineState();
  const lines = useConsoleStore((s) => s.lyrics);
  const draft = useConsoleStore((s) => s.lyricsDraft);
  const dirty = useConsoleStore((s) => s.lyricsDirty);
  const lyricsOffset = useConsoleStore((s) => s.lyricsOffset);
  const tapMode = useConsoleStore((s) => s.tapMode);
  const tapIndex = useConsoleStore((s) => s.tapIndex);
  const setLyrics = useConsoleStore((s) => s.setLyrics);
  const setDraft = useConsoleStore((s) => s.setLyricsDraft);
  const revertDraft = useConsoleStore((s) => s.revertLyricsDraft);
  const setLyricTime = useConsoleStore((s) => s.setLyricTime);
  const setLyricText = useConsoleStore((s) => s.setLyricText);
  const removeLyricLine = useConsoleStore((s) => s.removeLyricLine);
  const addLyricLineHere = useConsoleStore((s) => s.addLyricLineHere);
  const shiftLyrics = useConsoleStore((s) => s.shiftLyrics);
  const setTapMode = useConsoleStore((s) => s.setTapMode);
  const setTapIndex = useConsoleStore((s) => s.setTapIndex);

  const auth = useAuth();
  const lib = useLibrary();
  const trackKey = useConsoleStore((s) => s.trackKey);
  const setLyricsFromStore = useConsoleStore((s) => s.setLyrics);

  const [note, setNote] = useState<string | null>(null);
  /** 지금 글자를 고치고 있는 줄. 한 번에 하나입니다. */
  const [editing, setEditing] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // 찍는 줄이 목록 밖으로 밀려나면 다음에 무엇을 찍는지 보이지 않습니다.
  useEffect(() => {
    if (!tapMode) return;
    listRef.current
      ?.querySelector(`[data-row="${tapIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [tapMode, tapIndex]);

  const undated = countUndated(lines);

  function onParse() {
    const parsed = parseLrc(draft);
    if (parsed.lines.length === 0) {
      setNote('큐로 만들 줄이 없습니다.');
      return;
    }
    setLyrics(parsed.lines, parsed.title ?? '직접 입력');
    setNote(
      parsed.undated > 0
        ? `${parsed.lines.length} 줄. 그중 ${parsed.undated} 줄은 시각 미정입니다.`
        : `${parsed.lines.length} 줄을 큐로 만들었습니다.`,
    );
  }

  function onDistribute() {
    const d = audioEngine.duration;
    if (d <= 0) {
      // 라인/마이크는 끝나는 시각이 없어 나눌 길이가 없습니다 (F-102).
      setNote(
        engine.kind === 'mic'
          ? '라인/마이크는 끝나는 시각이 없어 길이에 나눌 수 없습니다. 탭 모드로 찍으십시오.'
          : '곡 길이를 알 수 없습니다. 01 소스 입력에 음원을 먼저 올리십시오.',
      );
      return;
    }
    if (undated === 0) {
      setNote('시각 미정 줄이 없습니다. 나눌 대상이 없습니다.');
      return;
    }
    setLyrics(distributeEvenly(lines, d), useConsoleStore.getState().lyricsName);
    setNote(`시각 미정 ${undated} 줄에만 시각을 채웠습니다. 탭 모드로 다듬으십시오.`);
  }

  function onExport() {
    const body = toLrc(lines);
    if (body.length === 0) {
      setNote('내보낼 줄이 없습니다. 시각이 붙은 줄이 하나도 없습니다.');
      return;
    }
    const base = (engine.fileName ?? 'resona').replace(/\.[^.]+$/, '');
    const blob = new Blob([`${body}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}.lrc`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 바로 회수하면 저장 대화상자가 뜨기 전에 사라지는 브라우저가 있습니다.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setNote(
      undated > 0
        ? `${base}.lrc 로 내려받았습니다. 시각 미정 ${undated} 줄은 뺐습니다.`
        : `${base}.lrc 로 내려받았습니다.`,
    );
  }

  /** `mm:ss.cc` 또는 초 단위 숫자. 읽지 못하면 null 입니다. */
  function parseStamp(raw: string): number | null {
    const v = raw.trim();
    const m = /^(\d+):([0-5]?\d)(?:[.:](\d{1,3}))?$/.exec(v);
    if (m) {
      const frac = m[3] ? Number(m[3]) / 10 ** m[3].length : 0;
      return Number(m[1]) * 60 + Number(m[2]) + frac;
    }
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function onSaveRemote() {
    if (!trackKey) {
      setNote('곡을 먼저 여십시오. 가사는 곡에 묶여 저장됩니다.');
      return;
    }
    // 시각 미정 줄까지 그대로 넘깁니다. 내보내기에서만 뺍니다.
    void library.saveLyrics(lines, trackKey);
    setNote(
      auth.userId
        ? `${lines.length} 줄을 ${trackKey.title} 에 묶어 저장했습니다.`
        : '로그인하면 올라갑니다. 그때까지 이 브라우저에 남습니다.',
    );
  }

  async function onLoadRemote() {
    if (!trackKey) {
      setNote('곡을 먼저 여십시오.');
      return;
    }
    const got = await library.loadLyrics(trackKey);
    if (!got || got.length === 0) {
      setNote('이 곡에 저장해 둔 가사가 없습니다.');
      return;
    }
    setLyricsFromStore(got, trackKey.title);
    setNote(`${got.length} 줄을 받아 왔습니다.`);
  }

  const ready = lines.length > 0;
  const canStore = supabaseConfigured;

  return (
    <div className="space-y-2">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        rows={5}
        placeholder={'[00:12.30] 가사 한 줄\n또는 시각 없는 가사를 줄마다'}
        aria-label="가사 원문"
        className="w-full resize-y bg-panel2 px-2 py-1.5 text-[11px] leading-relaxed text-bone placeholder:text-dim focus:outline-none focus:ring-1 focus:ring-rule"
      />

      <div className="flex items-stretch gap-px bg-rule">
        <button
          type="button"
          onClick={onParse}
          className="flex-1 bg-panel px-2 py-1.5 text-[10px] uppercase tracking-[0.12em] text-bone hover:bg-panel2"
        >
          파싱
        </button>
        {/*
          손댄 상태 표시. 원문과 큐가 어긋나 있다는 것을 이 자리에서만
          알립니다. 표시가 없으면 `파싱` 을 눌러야 하는지 알 수 없습니다.
        */}
        {dirty ? (
          <>
            <span className="flex items-center bg-panel px-1.5 text-[9px] leading-tight text-alert">
              미반영
            </span>
            <button
              type="button"
              onClick={() => {
                revertDraft();
                setNote(null);
              }}
              title="원문 영역을 지금 큐의 내용으로 되돌립니다"
              className="bg-panel px-2 py-1.5 text-[10px] uppercase tracking-[0.12em] text-dim hover:bg-panel2 hover:text-bone"
            >
              되돌리기
            </button>
          </>
        ) : null}
        <button
          type="button"
          onClick={onDistribute}
          title={
            engine.kind === 'mic'
              ? '라인/마이크는 끝나는 시각이 없어 쓸 수 없습니다. 탭 모드로 찍으십시오'
              : '시각 미정 줄에만 시각을 채웁니다. 이미 있는 줄은 건드리지 않습니다'
          }
          className={cx(
            'flex-1 bg-panel px-2 py-1.5 text-[10px] uppercase tracking-[0.12em] hover:bg-panel2',
            engine.kind === 'mic' ? 'text-dim' : 'text-bone',
          )}
        >
          균등 배분
        </button>
      </div>

      {/*
        탭 모드. 켜면 `Space` 의 뜻이 바뀌므로 화면 상단에 배너가 함께 뜹니다
        (`Console.tsx`). 배너는 선택 사항이 아닙니다.
      */}
      <button
        type="button"
        disabled={!ready}
        aria-pressed={tapMode}
        onClick={(e) => {
          // 눌러서 켜면 초점이 이 버튼에 남습니다. 그대로 두면 첫 `Space` 가
          // 타임스탬프가 아니라 버튼을 다시 눌러 모드를 꺼 버립니다.
          e.currentTarget.blur();
          setTapMode(!tapMode);
        }}
        className={cx(
          'flex w-full items-center justify-between px-2 py-1.5 text-[10px] uppercase tracking-[0.12em] disabled:cursor-not-allowed',
          tapMode
            ? 'bg-alert text-void'
            : ready
              ? 'border border-rule text-bone hover:bg-panel2'
              : 'border border-rule text-dim',
        )}
      >
        <span>탭 모드</span>
        <span className="tabular-nums">
          {tapMode
            ? `${Math.min(tapIndex + 1, lines.length)} / ${lines.length}`
            : 'Space 로 찍기'}
        </span>
      </button>

      {ready ? (
        <>
          <ul
            ref={listRef}
            className="max-h-44 divide-y divide-rule overflow-y-auto border border-rule"
          >
            {lines.map((l, i) => {
              const isNext = tapMode && i === tapIndex;
              const isNow = !tapMode && i === currentIndex;
              return (
                <li
                  key={`${i}-${l.text}`}
                  data-row={i}
                  className={cx(
                    'flex items-center gap-1 px-1 py-0.5',
                    isNext ? 'bg-alert/20' : isNow ? 'bg-panel2' : '',
                  )}
                >
                  {/*
                    탐색은 이 버튼 하나만 합니다. 글자를 눌러 고치려다 재생
                    위치가 튀면 리허설에서 쓸 수 없습니다.
                  */}
                  <button
                    type="button"
                    disabled={l.t === null}
                    onClick={() => {
                      if (l.t !== null) audioEngine.seek(l.t);
                      setTapIndex(i);
                    }}
                    title="그 시각으로 탐색하고, 탭 모드에서는 이 줄부터 찍습니다"
                    className="shrink-0 px-0.5 text-[9px] leading-none text-dim hover:text-bone disabled:cursor-not-allowed disabled:opacity-30"
                    aria-label={`${i + 1}번째 줄로 탐색`}
                  >
                    ▸
                  </button>
                  <input
                    type="text"
                    defaultValue={l.t === null ? '' : formatStamp(l.t)}
                    placeholder={NO_STAMP}
                    key={`t-${i}-${l.t}`}
                    aria-label={`${i + 1}번째 줄 시각`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                    onBlur={(e) => {
                      const v = parseStamp(e.target.value);
                      if (v === null) {
                        e.target.value = l.t === null ? '' : formatStamp(l.t);
                      } else if (l.t === null || Math.abs(v - l.t) > 1e-4) {
                        setLyricTime(i, v);
                      }
                    }}
                    className="w-[58px] shrink-0 bg-transparent text-[10px] tabular-nums text-dim placeholder:text-dim/50 focus:bg-panel2 focus:text-bone focus:outline-none"
                  />
                  {editing === i ? (
                    <input
                      type="text"
                      autoFocus
                      defaultValue={l.text}
                      aria-label={`${i + 1}번째 줄 가사`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        // 취소. 되돌린 뒤 blur 가 새 값을 쓰지 않게 원값을 넣습니다.
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          e.currentTarget.value = l.text;
                          e.currentTarget.blur();
                        }
                      }}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v !== l.text) setLyricText(i, v);
                        setEditing(null);
                      }}
                      className="min-w-0 flex-1 bg-panel2 px-1 text-[11px] text-bone focus:outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditing(i)}
                      title="눌러서 가사를 고칩니다. Enter 확정 · ESC 취소"
                      className={cx(
                        'min-w-0 flex-1 truncate text-left text-[11px]',
                        isNext || isNow ? 'text-bone' : 'text-dim hover:text-bone',
                      )}
                    >
                      {l.text || <span className="italic opacity-60">(빈 줄)</span>}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeLyricLine(i)}
                    title="이 줄을 지웁니다"
                    aria-label={`${i + 1}번째 줄 삭제`}
                    className="shrink-0 px-0.5 text-[11px] leading-none text-dim hover:text-alert"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
          {undated > 0 ? (
            <p className="text-[9px] leading-tight text-dim">
              시각 미정 {undated} 줄 — 재생과 내보내기에서 건너뜁니다
            </p>
          ) : null}
        </>
      ) : null}

      <button
        type="button"
        onClick={() => setEditing(addLyricLineHere())}
        className="w-full border border-rule px-2 py-1.5 text-[10px] uppercase tracking-[0.12em] text-bone hover:bg-panel2"
      >
        현재 시각에 줄 추가
      </button>

      <div className="flex items-center gap-px bg-rule">
        <span className="flex-1 bg-panel px-2 py-1.5 text-[10px] uppercase tracking-[0.12em] text-dim">
          전체 오프셋
        </span>
        {([-0.1, 0.1] as const).map((d) => (
          <button
            key={d}
            type="button"
            disabled={!ready}
            onClick={() => shiftLyrics(d)}
            title={
              d > 0
                ? '가사를 늦게 띄웁니다. 타임스탬프 자체를 밉니다'
                : '가사를 일찍 띄웁니다'
            }
            className="bg-panel px-2 py-1.5 text-[10px] tabular-nums text-bone hover:bg-panel2 disabled:cursor-not-allowed disabled:text-dim"
          >
            {d > 0 ? '+0.1s' : '−0.1s'}
          </button>
        ))}
        <span className="w-16 bg-panel2 px-2 py-1.5 text-right text-[10px] tabular-nums text-bone">
          {lyricsOffset === 0
            ? '0.00s'
            : `${lyricsOffset > 0 ? '+' : '−'}${Math.abs(lyricsOffset).toFixed(2)}s`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-px bg-rule">
        <button
          type="button"
          disabled={!ready}
          onClick={onExport}
          className="bg-panel px-2 py-1.5 text-[10px] uppercase tracking-[0.12em] text-bone hover:bg-panel2 disabled:cursor-not-allowed disabled:text-dim"
        >
          LRC 내보내기
        </button>
        {/*
          F-605 저장. 곡과 묶어 `lyrics` 에 넣습니다. 실패해도 던지지
          않습니다 — 대기열에 쌓아 두고 연결이 돌아오면 올라갑니다.
        */}
        <button
          type="button"
          disabled={!ready || !canStore}
          onClick={onSaveRemote}
          title={
            canStore
              ? '가사 큐만 곡과 묶어 저장합니다. 씬·슬라이더는 12 프리셋에서 따로 저장합니다'
              : 'Supabase 를 연결하면 쓸 수 있습니다'
          }
          className="bg-panel px-2 py-1.5 text-[10px] uppercase tracking-[0.12em] text-bone hover:bg-panel2 disabled:cursor-not-allowed disabled:text-dim"
        >
          가사 저장
          {lib.pending > 0 ? <span className="ml-1 text-alert">●</span> : null}
        </button>
      </div>

      {canStore && auth.userId ? (
        <button
          type="button"
          onClick={() => void onLoadRemote()}
          className="w-full border border-rule px-2 py-1.5 text-[10px] uppercase tracking-[0.12em] text-dim hover:bg-panel2 hover:text-bone"
        >
          이 곡의 저장된 가사 불러오기
        </button>
      ) : null}

      {note ? (
        <p role="status" className="text-[10px] leading-relaxed text-dim">
          {note}
        </p>
      ) : null}

      <p className="text-[10px] leading-relaxed text-dim">
        {canStore ? (
          <>
            가사 큐만 곡에 묶어 저장합니다.
            <span className="text-bone"> 씬과 슬라이더는 담기지 않습니다</span> — 12
            프리셋의 <span className="text-bone">프리셋 저장</span> 이 따로 있습니다.
          </>
        ) : (
          'Supabase 를 연결하지 않아 저장이 꺼져 있습니다. 만든 큐는 .lrc 로 내려받아 두십시오.'
        )}
      </p>
    </div>
  );
}
