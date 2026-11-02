'use client';

import { useState } from 'react';
import { Panel } from '@/components/console/Panel';
import { useAuth, useEngineState, useLibrary } from '@/lib/hooks';
import { library } from '@/lib/supabase/library';
import { supabaseConfigured } from '@/lib/supabase/client';
import { useConsoleStore } from '@/lib/store';
import { cx } from '@/lib/util';

/**
 * 12 프리셋 (F-700). `docs/03-screens.md` 12 절.
 *
 * **저장은 언제나 먼저 로컬에 남습니다.** 로그인하지 않았거나 인터넷이
 * 끊겼어도 새로 고침한 뒤 불러오면 같은 상태가 됩니다. 연결이 돌아오면
 * 그때 올라갑니다 (`lib/supabase/library.ts`).
 *
 * 저장 실패는 이 패널의 글자로만 나타납니다. 렌더 루프를 건드리지 않습니다.
 *
 * **가사는 담지 않습니다.** 프리셋은 콘솔의 조작 상태이고, 가사 큐는 곡에
 * 묶인 별개의 것이라 03 패널이 따로 저장합니다.
 */
export default function PresetPanel() {
  const engine = useEngineState();
  const auth = useAuth();
  const lib = useLibrary();
  const trackKey = useConsoleStore((s) => s.trackKey);
  const capturePreset = useConsoleStore((s) => s.capturePreset);
  const applyPreset = useConsoleStore((s) => s.applyPreset);

  const [name, setName] = useState('');

  function onSave() {
    const label = name.trim() || engine.fileName?.replace(/\.[^.]+$/, '') || '이름 없는 프리셋';
    void library.savePreset(capturePreset(label), trackKey);
    setName('');
  }

  const hint = lib.syncing
    ? '동기화 중'
    : lib.pending > 0
      ? `대기 ${lib.pending}`
      : `${lib.presets.length}개`;

  return (
    <Panel index="12" title="프리셋" hint={hint}>
      {/*
        F-703. 방금 연 곡에 묶어 둔 프리셋이 있으면 제안합니다. 자동으로
        걸지 않습니다 — 리허설에서 손봐 둔 값이 곡을 다시 여는 순간
        사라지면 안 됩니다.
      */}
      {lib.suggestion ? (
        <div className="mb-2 border border-cyan/40 bg-panel2 px-2 py-1.5">
          <p className="text-[10px] leading-relaxed text-cyan">
            이 곡의 프리셋이 있습니다 — {lib.suggestion.preset.name}
          </p>
          <div className="mt-1 flex gap-px bg-rule">
            <button
              type="button"
              onClick={() => {
                if (lib.suggestion) applyPreset(lib.suggestion.preset);
                library.dismissSuggestion();
              }}
              className="flex-1 bg-panel px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-bone hover:bg-panel2"
            >
              적용
            </button>
            <button
              type="button"
              onClick={() => library.dismissSuggestion()}
              className="bg-panel px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-dim hover:text-bone"
            >
              닫기
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex gap-px bg-rule">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSave();
          }}
          placeholder={engine.fileName?.replace(/\.[^.]+$/, '') ?? '프리셋 이름'}
          aria-label="프리셋 이름"
          className="min-w-0 flex-1 bg-panel2 px-2 py-1.5 text-[11px] text-bone placeholder:text-dim focus:outline-none"
        />
        <button
          type="button"
          onClick={onSave}
          title="지금 콘솔 상태를 남깁니다. 가사는 03 패널에서 따로 저장합니다"
          className="shrink-0 bg-panel px-2 py-1.5 text-[10px] uppercase tracking-[0.12em] text-bone hover:bg-panel2"
        >
          프리셋 저장
        </button>
      </div>

      {/*
        저장 버튼이 두 곳에 있습니다. 이름이 같으면 하나를 누르고 둘 다
        저장된 줄 압니다. 실제로 검수에서 그 일이 있었습니다.
      */}
      <p className="text-[9px] leading-tight text-dim">
        씬 · 슬라이더 · 관객 영향력 · 팔레트 · 템포 잠금을 담습니다.
        <span className="text-bone"> 가사는 담기지 않습니다</span> — 03 가사 큐의{' '}
        <span className="text-bone">가사 저장</span> 이 따로 있습니다.
      </p>

      {lib.presets.length > 0 ? (
        <ul className="mt-2 max-h-40 divide-y divide-rule overflow-y-auto border border-rule">
          {lib.presets.map((p) => (
            <li key={p.preset.id} className="flex items-center gap-1 px-1 py-0.5">
              <button
                type="button"
                onClick={() => applyPreset(p.preset)}
                title="이 프리셋을 지금 적용합니다"
                className="min-w-0 flex-1 truncate text-left text-[11px] text-dim hover:text-bone"
              >
                {p.preset.name}
                {p.trackTitle ? (
                  <span className="ml-1 text-[9px] text-dim/70">· {p.trackTitle}</span>
                ) : null}
              </button>
              {/* 아직 못 보낸 것. 로컬에는 이미 있습니다 */}
              {!p.remote ? (
                <span className="shrink-0 text-[9px] text-alert" title="아직 올리지 못했습니다">
                  ●
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => void library.deletePreset(p.preset.id)}
                aria-label={`${p.preset.name} 삭제`}
                className="shrink-0 px-0.5 text-[11px] leading-none text-dim hover:text-alert"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[10px] leading-relaxed text-dim">
          저장한 프리셋이 없습니다. 지금 콘솔 상태를 이름 붙여 남겨 두십시오.
        </p>
      )}

      <p
        className={cx(
          'mt-2 text-[10px] leading-relaxed',
          lib.error ? 'text-alert' : 'text-dim',
        )}
      >
        {!supabaseConfigured
          ? '이 브라우저에만 남습니다. Supabase 를 연결하면 계정에 올라갑니다.'
          : !auth.userId
            ? '이 브라우저에만 남습니다. 로그인하면 계정으로 올라갑니다.'
            : (lib.error ?? '계정에 저장됩니다.')}
      </p>
    </Panel>
  );
}
