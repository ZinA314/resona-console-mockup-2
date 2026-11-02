'use client';

import { useRef, useState } from 'react';
import { Panel } from '@/components/console/Panel';
import { audioEngine } from '@/lib/audio/engine';
import { useEngineState } from '@/lib/hooks';
import { library, trackKeyOf } from '@/lib/supabase/library';
import { useConsoleStore } from '@/lib/store';
import { cx, formatTime } from '@/lib/util';

export default function InputPanel() {
  const engine = useEngineState();
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 조작 핸들러 안에서 바로 부릅니다. AudioContext 는 이 시점에 만들어집니다.
  function accept(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    void audioEngine.loadFile(file).then(async () => {
      /*
       * F-703 곡 연결. 순서가 정해져 있습니다.
       *
       *   loadFile → 프리셋 제안 → applyPreset
       *
       * 파일 로드가 템포 잠금을 푸는 동작이므로 프리셋을 먼저 걸면 그 값이
       * 곧바로 지워집니다. 제안만 띄우고 적용은 사람이 누릅니다.
       *
       * 저장 쪽이 실패해도 재생과 분석은 이미 시작됐습니다. 여기서 던지지
       * 않는 것이 중요합니다.
       */
      try {
        const key = await trackKeyOf(file, audioEngine.duration || null);
        useConsoleStore.getState().setTrackKey(key);
        library.suggestFor(key);
      } catch {
        useConsoleStore.getState().setTrackKey(null);
      }
    });
  }

  return (
    <Panel index="01" title="소스 입력" hint={engine.loading ? '디코딩 중' : undefined}>
      <div
        role="button"
        tabIndex={0}
        aria-label="음원 파일 로드"
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
          accept(e.dataTransfer.files);
        }}
        className={cx(
          'flex h-24 cursor-pointer flex-col items-center justify-center border border-dashed px-3 text-center transition-colors',
          over ? 'border-bone bg-panel2' : 'border-rule hover:border-dim',
        )}
      >
        <span className="font-condensed text-[15px] uppercase tracking-[0.14em] text-bone">
          음원 파일 로드
        </span>
        <span className="mt-1 text-[10px] text-dim">
          MP3 · WAV · FLAC · 끌어다 놓거나 클릭
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a"
        className="sr-only"
        onChange={(e) => {
          accept(e.target.files);
          e.target.value = '';
        }}
      />

      {engine.fileName ? (
        <div className="mt-2 flex items-baseline justify-between gap-2 bg-panel2 px-2 py-1.5">
          <span className="truncate text-[11px] text-bone" title={engine.fileName}>
            {engine.kind === 'mic' ? 'LINE IN' : engine.fileName}
          </span>
          <span className="shrink-0 text-[11px] text-dim">
            {/* 마이크는 끝나는 시각이 없습니다. 길이 대신 장치 이름을 답니다. */}
            {engine.kind === 'mic'
              ? (engine.fileName.slice(0, 18) || '입력')
              : formatTime(engine.duration)}
          </span>
        </div>
      ) : null}

      {/*
        입력 장치 고르기 (F-102). 오디오 인터페이스가 여럿 붙는 현장이 있습니다.
        이름은 권한을 받은 뒤에야 채워지므로 마이크가 켜진 뒤에만 보입니다.
      */}
      {engine.kind === 'mic' && engine.inputDevices.length > 1 ? (
        <label className="mt-2 flex items-center gap-1.5">
          <span className="shrink-0 text-[10px] uppercase tracking-[0.1em] text-dim">
            장치
          </span>
          <select
            value={engine.inputDeviceId ?? ''}
            onChange={(e) => void audioEngine.startMic(e.target.value)}
            className="min-w-0 flex-1 bg-panel2 px-1 py-1 text-[11px] text-bone focus:outline-none"
          >
            {engine.inputDevices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {engine.error ? (
        <p role="alert" className="mt-2 text-[11px] leading-relaxed text-alert">
          {engine.error}
        </p>
      ) : null}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            // 권한 요청은 사용자 조작 안에서만 뜹니다. AudioContext 도 이때 열립니다.
            if (engine.kind === 'mic') audioEngine.stop();
            else void audioEngine.startMic();
          }}
          aria-pressed={engine.kind === 'mic'}
          title="라인 출력이나 객석 마이크에서 소리를 받아 분석합니다. 스피커로 되돌리지 않습니다"
          className={cx(
            'border px-2 py-1.5 text-[11px] uppercase tracking-[0.12em]',
            engine.kind === 'mic'
              ? 'border-bone bg-bone text-void'
              : 'border-rule text-bone hover:bg-panel2',
          )}
        >
          라인 / 마이크
        </button>
        <button
          type="button"
          onClick={() => {
            // 조작 핸들러 안에서 바로 부릅니다. AudioContext 는 이 시점에 열립니다.
            if (engine.kind === 'demo' && engine.playing) audioEngine.pause();
            else audioEngine.startDemo();
          }}
          aria-pressed={engine.kind === 'demo'}
          className={cx(
            'border px-2 py-1.5 text-[11px] uppercase tracking-[0.12em]',
            engine.kind === 'demo'
              ? 'border-bone bg-bone text-void'
              : 'border-rule text-bone hover:bg-panel2',
          )}
        >
          데모 신스
        </button>
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-dim">
        파일은 브라우저 안에서만 디코딩됩니다. 서버 업로드·저장 없음.
      </p>
    </Panel>
  );
}
