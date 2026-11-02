'use client';

import { useEffect, useRef, useState } from 'react';
import { audioEngine } from '@/lib/audio/engine';
import { useEngineState, useFrame } from '@/lib/hooks';
import { useConsoleStore } from '@/lib/store';
import { cx, formatTime } from '@/lib/util';

/**
 * 파형 개요와 비트 눈금. peaks·눈금 수·크기가 바뀔 때만 다시 그립니다.
 * 매 프레임 그리지 않습니다.
 */
function Waveform({
  peaks,
  duration,
  beatCount,
  loopA,
  loopB,
}: {
  peaks: Float32Array | null;
  duration: number;
  beatCount: number;
  loopA: number | null;
  loopB: number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor(parent.clientWidth));
      const h = Math.max(1, Math.floor(parent.clientHeight));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!peaks || peaks.length === 0) return;

      ctx.fillStyle = '#3a3833';
      const mid = h / 2;
      for (let x = 0; x < w; x += 1) {
        const p = peaks[Math.min(peaks.length - 1, Math.floor((x / w) * peaks.length))];
        const half = Math.max(0.5, p * mid);
        ctx.fillRect(x, mid - half, 1, half * 2);
      }

      // 비트마다 눈금을 찍고, 마디 첫 박은 길게 그립니다.
      if (duration > 0) {
        for (const m of audioEngine.getBeatMarks()) {
          const x = Math.round((m.t / duration) * w);
          ctx.fillStyle = m.bar ? '#e8e4dc' : '#6e6b64';
          ctx.fillRect(x, 0, 1, m.bar ? h * 0.42 : h * 0.2);
        }
      }

      // F-202 구간 반복. 두 지점을 세로선으로 찍고 그 사이를 덮습니다.
      if (duration > 0) {
        const at = (t: number) => Math.round((t / duration) * w);
        if (loopA !== null && loopB !== null) {
          ctx.fillStyle = 'rgba(255, 42, 0, 0.14)';
          ctx.fillRect(at(loopA), 0, Math.max(1, at(loopB) - at(loopA)), h);
        }
        ctx.fillStyle = '#ff2a00';
        if (loopA !== null) ctx.fillRect(at(loopA), 0, 1, h);
        if (loopB !== null) ctx.fillRect(Math.max(0, at(loopB) - 1), 0, 1, h);
      }
    };

    draw();
    const parent = canvas.parentElement;
    if (!parent || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(draw);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [peaks, duration, beatCount, loopA, loopB]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />;
}

/** 자물쇠. 아이콘만 두지 않고 아래에 라벨을 답니다 (03-screens 6절). */
function LockIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 12 14" width="11" height="13" aria-hidden fill="none">
      <rect x="1" y="6" width="10" height="7" fill="currentColor" />
      <path
        d={open ? 'M3.5 6V3.5a2.5 2.5 0 0 1 5 0' : 'M3.5 6V3.5a2.5 2.5 0 0 1 5 0V6'}
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}

/** 아이콘 위, 라벨 아래로 쌓는 조작 버튼. */
function StackButton({
  icon,
  label,
  onClick,
  active = false,
  muted = false,
  title,
  ariaDisabled = false,
  width = 'w-11',
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  muted?: boolean;
  title?: string;
  ariaDisabled?: boolean;
  width?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      aria-disabled={ariaDisabled || undefined}
      className={cx(
        'flex flex-col items-center justify-center gap-0.5 px-1 py-1',
        width,
        active
          ? 'bg-bone text-void'
          : muted
            ? 'bg-panel text-dim'
            : 'bg-panel text-bone hover:bg-panel2',
      )}
    >
      <span className="flex h-3.5 items-center text-[11px] leading-none">{icon}</span>
      <span className="text-[9px] leading-none tracking-tight">{label}</span>
    </button>
  );
}

const SCALES: ReadonlyArray<[string, string, number]> = [
  ['\u00D72', '두 배', 2],
  ['\u00F72', '절반', 0.5],
  ['\u00D71.5', '1.5배', 1.5],
  ['\u00F71.5', '2/3배', 1 / 1.5],
];

const NO_TEMPO_HINT = '먼저 T 를 네 번 두드려 템포를 정하세요';

/**
 * 템포 수동 확정 (F-303-2).
 * 03-screens 에 배치가 정해져 있지 않아 트랜스포트에 두었습니다.
 * 공연 중 손이 가는 조작이라 재생 제어 옆이 맞다고 보았습니다.
 */
function TempoControls() {
  const lockedBpm = useConsoleStore((s) => s.lockedBpm);
  const tempoLocked = useConsoleStore((s) => s.tempoLocked);
  const tapCount = useConsoleStore((s) => s.tapCount);
  const registerTap = useConsoleStore((s) => s.registerTap);
  const applyTempoScale = useConsoleStore((s) => s.applyTempoScale);
  const lockTempoAt = useConsoleStore((s) => s.lockTempoAt);
  const unlockTempo = useConsoleStore((s) => s.unlockTempo);

  // 잠글 대상이 있는지. 실시간 값이라 4프레임마다, 그것도 바뀔 때만 올립니다.
  const [hasTempo, setHasTempo] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useFrame((_dt, frame) => {
    if (frame % 4 !== 0) return;
    const a = audioEngine.analysis;
    const ok = (a.bpm > 0 && a.bpmConf > 0) || lockedBpm !== null;
    setHasTempo((prev) => (prev === ok ? prev : ok));
  }, 16);

  function showHint(message: string) {
    setHint(message);
    window.setTimeout(() => setHint(null), 3000);
  }

  return (
    <div className="relative flex shrink-0 items-stretch gap-px bg-rule">
      {hint ? (
        <span
          role="status"
          className="absolute bottom-full left-0 mb-1 whitespace-nowrap border border-rule bg-panel px-2 py-1 text-[10px] text-alert"
        >
          {hint}
        </span>
      ) : null}

      <StackButton
        icon="TAP"
        label={tapCount > 0 && tapCount < 4 ? `${tapCount} / 4` : 'T 키'}
        onClick={registerTap}
        title="박자에 맞춰 네 번 이상 두드립니다"
        width="w-12"
      />

      <StackButton
        icon={<LockIcon open={!tempoLocked} />}
        label="BPM 잠금"
        active={tempoLocked}
        muted={!hasTempo}
        ariaDisabled={!hasTempo}
        width="w-14"
        title={
          hasTempo ? '자동 추정이 값을 바꾸지 못하게 잠급니다' : NO_TEMPO_HINT
        }
        onClick={() => {
          // 잠글 대상이 없으면 잠기지 않습니다. 무엇이 고정된 것인지 알 수 없어서입니다.
          if (!hasTempo) {
            showHint(NO_TEMPO_HINT);
            return;
          }
          if (tempoLocked) {
            unlockTempo();
            return;
          }
          // 자물쇠는 지금 화면에 보이는 값을 붙잡습니다. 이전 확정값으로
          // 되돌아가면 "자동 추정을 보다가 이 값이 맞네" 하고 잠그는 흐름과
          // 어긋납니다. 확정 BPM 칸도 이때 갱신됩니다.
          lockTempoAt(audioEngine.currentBpm);
        }}
      />

      {SCALES.map(([icon, label, factor]) => (
        <StackButton
          key={label}
          icon={icon}
          label={label}
          width="w-11"
          title="배수 관계 오류를 바로잡습니다. 누르면 잠깁니다"
          onClick={() => {
            if (!hasTempo) {
              showHint(NO_TEMPO_HINT);
              return;
            }
            applyTempoScale(factor);
          }}
        />
      ))}

      <span
        className={cx(
          'flex w-14 flex-col items-center justify-center gap-0.5 bg-panel2 px-1 py-1',
          tempoLocked ? 'text-bone' : 'text-dim',
        )}
      >
        <span className="text-[11px] leading-none tabular-nums">
          {lockedBpm !== null ? lockedBpm.toFixed(1) : '—'}
        </span>
        <span className="text-[9px] leading-none">확정 BPM</span>
      </span>
    </div>
  );
}

/**
 * 구간 반복 (F-202). `03-screens.md` 하단 트랜스포트.
 *
 * 리허설에서 한 구간의 연출을 다듬을 때 씁니다. 단축키를 두지 않았습니다 —
 * `A` 는 11절에서 관객 영향력 토글에 이미 잡혀 있고, 공연 중이 아니라
 * 리허설에서 쓰는 조작이라 버튼으로 충분합니다.
 */
const NO_LOOP_HINT = '라인/마이크는 끝나는 시각이 없어 구간 반복을 걸 수 없습니다';

function LoopControls({ seekable }: { seekable: boolean }) {
  const engine = useEngineState();
  const { loopA, loopB } = engine;
  const armed = loopA !== null && loopB !== null;
  const [hint, setHint] = useState<string | null>(null);

  /** 잠긴 이유를 보여 줍니다. 눌러도 아무 일이 없으면 고장으로 보입니다. */
  function blocked(): boolean {
    if (seekable) return false;
    setHint(engine.kind === 'mic' ? NO_LOOP_HINT : '먼저 음원 파일을 여십시오');
    window.setTimeout(() => setHint(null), 3000);
    return true;
  }

  return (
    <div
      className="relative flex shrink-0 items-stretch gap-px bg-rule"
      title={seekable ? '리허설에서 한 구간만 되풀이해 재생합니다' : NO_LOOP_HINT}
    >
      {hint ? (
        <span
          role="status"
          className="absolute bottom-full right-0 mb-1 whitespace-nowrap border border-rule bg-panel px-2 py-1 text-[10px] text-alert"
        >
          {hint}
        </span>
      ) : null}
      <StackButton
        icon="A"
        label={loopA !== null ? formatTime(loopA).slice(0, 5) : '시작'}
        active={loopA !== null}
        muted={!seekable}
        ariaDisabled={!seekable}
        width="w-12"
        onClick={() => {
          if (blocked()) return;
          audioEngine.setLoopA(audioEngine.currentTime);
        }}
      />
      <StackButton
        icon="B"
        label={loopB !== null ? formatTime(loopB).slice(0, 5) : '끝'}
        active={loopB !== null}
        muted={!seekable}
        ariaDisabled={!seekable}
        width="w-12"
        onClick={() => {
          if (blocked()) return;
          audioEngine.setLoopB(audioEngine.currentTime);
        }}
      />
      <StackButton
        icon="⟲"
        label={armed ? '반복 중' : '해제'}
        muted={!armed}
        ariaDisabled={!armed}
        width="w-12"
        onClick={() => audioEngine.clearLoop()}
      />
    </div>
  );
}

export default function Transport() {
  const engine = useEngineState();
  const [time, setTime] = useState(0);

  const rangeRef = useRef<HTMLInputElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);

  // 진행 위치는 실시간 값이므로 상태를 거치지 않고 DOM 에 직접 씁니다.
  // 표시 시각만 4프레임마다 상태로 올립니다.
  useFrame((_dt, frame) => {
    const t = audioEngine.currentTime;
    const d = audioEngine.duration;
    const ratio = d > 0 ? t / d : 0;
    if (progressRef.current) {
      progressRef.current.style.transform = `scaleX(${ratio})`;
    }
    if (!scrubbing.current && rangeRef.current) {
      rangeRef.current.value = String(t);
    }
    if (frame % 4 !== 0) return;
    setTime(t);
  }, 15);

  function commitSeek() {
    const el = rangeRef.current;
    scrubbing.current = false;
    if (!el) return;
    audioEngine.seek(Number(el.value));
    setTime(audioEngine.currentTime);
  }

  const ready = engine.ready;
  const seekable = ready && engine.duration > 0;

  return (
    <footer className="flex h-14 shrink-0 items-center gap-3 border-t border-rule bg-panel px-3">
      <div className="flex gap-px bg-rule">
        <button
          type="button"
          disabled={!ready || engine.kind === 'mic'}
          onClick={() => audioEngine.toggle()}
          title={
            engine.kind === 'mic'
              ? '라인/마이크는 흐르는 입력이라 멈추거나 되감을 것이 없습니다. 정지는 장치를 놓습니다'
              : undefined
          }
          aria-label={engine.playing ? '일시정지' : '재생'}
          className={cx(
            'w-12 bg-panel py-1.5 text-[12px] uppercase tracking-[0.1em] disabled:cursor-not-allowed disabled:text-dim',
            ready ? 'text-bone hover:bg-panel2' : 'text-dim',
          )}
        >
          {engine.playing ? '⏸' : '▶'}
        </button>
        <button
          type="button"
          disabled={!ready}
          onClick={() => audioEngine.stop()}
          aria-label="정지"
          className="w-12 bg-panel py-1.5 text-[12px] text-bone hover:bg-panel2 disabled:cursor-not-allowed disabled:text-dim"
        >
          ■
        </button>
      </div>

      <div className="relative h-9 min-w-0 flex-1 bg-panel2">
        <Waveform
          peaks={engine.peaks}
          duration={engine.duration}
          beatCount={engine.beatCount}
          loopA={engine.loopA}
          loopB={engine.loopB}
        />
        <div
          ref={progressRef}
          aria-hidden
          className="absolute inset-0 origin-left bg-bone/12"
          style={{ transform: 'scaleX(0)' }}
        />
        <input
          ref={rangeRef}
          type="range"
          min={0}
          max={engine.duration || 0}
          step={0.01}
          defaultValue={0}
          disabled={!seekable}
          aria-label="탐색"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          onPointerDown={() => {
            scrubbing.current = true;
          }}
          onPointerUp={commitSeek}
          onKeyDown={() => {
            scrubbing.current = true;
          }}
          onKeyUp={commitSeek}
          onBlur={() => {
            scrubbing.current = false;
          }}
          onInput={(e) => {
            if (!scrubbing.current || !progressRef.current) return;
            const d = engine.duration || 1;
            progressRef.current.style.transform = `scaleX(${Number(e.currentTarget.value) / d})`;
          }}
        />
      </div>

      <div className="shrink-0 text-[13px] text-bone">
        {formatTime(time)}
        <span className="text-dim"> / {formatTime(engine.duration)}</span>
      </div>

      <TempoControls />

      <LoopControls seekable={seekable} />
    </footer>
  );
}
