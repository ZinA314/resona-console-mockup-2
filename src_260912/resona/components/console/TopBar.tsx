'use client';

import { useEffect, useRef, useState } from 'react';
import { audioEngine } from '@/lib/audio/engine';
import { BPM_CONF_FIRM, BPM_CONF_SHOW } from '@/lib/audio/tempo';
import { audienceManager } from '@/lib/audience/manager';
import { useAuth, useAudienceStatus, useEngineState, useFrame, useLibrary } from '@/lib/hooks';
import { authManager } from '@/lib/supabase/auth';
import { supabaseConfigured } from '@/lib/supabase/client';
import { useConsoleStore } from '@/lib/store';
import { cx, formatUnit } from '@/lib/util';

const SOURCE_LABEL: Record<string, string> = {
  none: '신호 없음',
  file: '파일',
  mic: '마이크',
  demo: '데모',
};

function Slot({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex items-baseline gap-2 border-l border-rule px-3', className)}>
      <span className="font-condensed text-[11px] uppercase tracking-[0.18em] text-dim">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * 계정 (7단계). GitHub 로그인으로 프리셋과 가사를 계정에 묶습니다.
 *
 * **설정이 없어도 칸은 남깁니다.** 숨기면 배포된 화면에서 로그인을 찾는
 * 사람이 고장인지 미설정인지 구분할 수 없습니다. 저장이 로컬로만 도는 것은
 * 오류가 아니므로 조용한 색으로 적기만 합니다.
 */
function AccountSlot() {
  const auth = useAuth();
  const lib = useLibrary();

  if (!supabaseConfigured) {
    return (
      <Slot label="계정">
        <span
          className="text-[12px] text-dim"
          title="Supabase 환경 변수가 없습니다. 프리셋과 가사는 이 브라우저에만 남습니다"
        >
          이 브라우저만
        </span>
      </Slot>
    );
  }

  const pending = lib.pending > 0 ? ` · 대기 ${lib.pending}` : '';
  return (
    <Slot label="계정">
      {auth.userId ? (
        <button
          type="button"
          onClick={() => void authManager.signOut()}
          title="로그아웃"
          className="text-[12px] text-bone hover:text-dim"
        >
          {auth.label ?? '로그인됨'}
          <span className={cx('ml-1 text-[11px]', pending ? 'text-alert' : 'text-dim')}>
            {pending || (lib.syncing ? ' · 동기화' : '')}
          </span>
        </button>
      ) : (
        <button
          type="button"
          disabled={!auth.ready || auth.busy}
          onClick={() => void authManager.signIn()}
          className="text-[12px] text-cyan hover:text-bone disabled:text-dim"
        >
          {auth.busy ? '여는 중' : 'GitHub 로그인'}
        </button>
      )}
    </Slot>
  );
}

export default function TopBar() {
  const engine = useEngineState();
  const tempoLocked = useConsoleStore((s) => s.tempoLocked);
  const audience = useAudienceStatus();

  // 표시용 수치는 4프레임마다 한 번만 상태로 올립니다.
  const [readout, setReadout] = useState({
    rms: 0,
    peak: 0,
    bpm: 0,
    bpmConf: 0,
    audience: 0,
  });
  // 막대는 상태를 거치지 않고 매 프레임 DOM 에 직접 씁니다.
  const rmsBarRef = useRef<HTMLDivElement>(null);
  const peakBarRef = useRef<HTMLDivElement>(null);
  // 온셋 LED. `--alert` 는 지금 일어나는 일에 쓰는 색입니다.
  const onsetLedRef = useRef<HTMLSpanElement>(null);
  const audienceBarRef = useRef<HTMLSpanElement>(null);

  useFrame((_dt, frame) => {
    const a = audioEngine.analysis;
    if (rmsBarRef.current) {
      rmsBarRef.current.style.transform = `scaleX(${a.rms})`;
    }
    if (peakBarRef.current) {
      peakBarRef.current.style.transform = `scaleX(${a.peak})`;
    }
    if (onsetLedRef.current) {
      onsetLedRef.current.style.opacity = String(0.18 + a.onsetPulse * 0.82);
    }
    if (audienceBarRef.current) {
      audienceBarRef.current.style.transform = `scaleX(${audienceManager.reading.energy})`;
    }
    if (frame % 4 !== 0) return;
    setReadout({
      rms: a.rms,
      peak: a.peak,
      bpm: a.bpm,
      bpmConf: a.bpmConf,
      audience: audienceManager.reading.energy,
    });
  }, 10);

  // 시계. 서버 렌더와 어긋나지 않도록 마운트 뒤부터 그립니다.
  const [clock, setClock] = useState<string | null>(null);
  useEffect(() => {
    const update = () => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      setClock(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`);
    };
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, []);

  const live = engine.kind !== 'none';

  return (
    <header className="flex h-11 shrink-0 items-stretch border-b border-rule bg-panel">
      <div className="flex items-center px-3">
        <span className="font-condensed text-[18px] font-semibold uppercase tracking-[0.32em] text-bone">
          RESONA
        </span>
      </div>

      <Slot label="입력" className="items-center">
        {/* 온셋마다 밝아집니다. 소리가 나지 않는 동안에는 흐리게 떠 있습니다. */}
        <span
          ref={onsetLedRef}
          aria-hidden
          className={cx('inline-block h-1.5 w-1.5', live ? 'bg-alert' : 'bg-rule')}
          style={{ opacity: 0.18 }}
        />
        <span className={cx('text-[12px]', live ? 'text-bone' : 'text-dim')}>
          {SOURCE_LABEL[engine.kind] ?? engine.kind}
        </span>
      </Slot>

      <Slot label="BPM">
        {/*
          값이 뚜렷이 바뀔 때만 알립니다. 신뢰도가 `BPM_CONF_FIRM` 아래면 흐리게,
          `BPM_CONF_SHOW` 아래면 값 대신 `---` 를 보여 줍니다. 근거가 사라진
          수치를 그대로 두면 읽는 사람이 아직 유효한 값으로 오해합니다.
          09 리드아웃의 마디·박과 같이 비도록 맞춘 것입니다.

          잠금 중에는 이 규칙을 적용하지 않습니다. 사람이 정한 값이므로
          자동 추정의 확신도와 무관하게 그대로 보여 줍니다 (F-303-2).
        */}
        <span
          aria-live="polite"
          className={cx(
            'w-[3ch] text-[16px] tabular-nums',
            tempoLocked || readout.bpmConf >= BPM_CONF_FIRM ? 'text-bone' : 'text-dim',
          )}
        >
          {readout.bpm > 0 && (tempoLocked || readout.bpmConf >= BPM_CONF_SHOW)
            ? Math.round(readout.bpm)
            : '---'}
        </span>
      </Slot>

      <Slot label="RMS">
        <span className="w-[3.2em] text-[16px] text-bone">{formatUnit(readout.rms)}</span>
        <span className="block w-24 self-center">
          <span className="block h-1.5 overflow-hidden bg-panel2">
            <span
              ref={rmsBarRef}
              className="block h-full origin-left bg-bone"
              style={{ transform: 'scaleX(0)' }}
            />
          </span>
          <span className="mt-px block h-px overflow-hidden bg-panel2">
            <span
              ref={peakBarRef}
              className="block h-full origin-left bg-alert"
              style={{ transform: 'scaleX(0)' }}
            />
          </span>
        </span>
      </Slot>

      <Slot label="관객">
        {/* 관객에서 온 값은 청록색으로 그립니다. 03-screens 2절. */}
        <span
          aria-live="polite"
          className={cx(
            'w-[3.2em] text-[16px] tabular-nums',
            audience.kind === 'none' ? 'text-dim' : 'text-cyan',
          )}
        >
          {formatUnit(readout.audience)}
        </span>
        <span className="block h-2 w-16 self-center overflow-hidden bg-panel2">
          <span
            ref={audienceBarRef}
            className="block h-full origin-left bg-cyan"
            style={{ transform: 'scaleX(0)' }}
          />
        </span>
      </Slot>

      <Slot label="연동">
        <span className="text-[12px] text-dim">연결 안 됨</span>
      </Slot>

      <AccountSlot />

      <div className="ml-auto flex items-center border-l border-rule px-3 text-[13px] text-dim">
        {clock ?? '--:--:--'}
      </div>
    </header>
  );
}
