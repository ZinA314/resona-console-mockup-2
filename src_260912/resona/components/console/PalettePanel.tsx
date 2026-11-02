'use client';

/**
 * 05 팔레트. `docs/03-screens.md` 05 절, `05-signal-processing.md` 8절.
 *
 * 색을 다루는 자리입니다. 원본 프로토타입은 톤 세 가지 중 하나를 고르는
 * 방식이었는데, 여기서는 색 다섯 개를 묶은 팔레트를 고르거나 직접 만듭니다.
 *
 * **관객은 이 패널 어디에도 나오지 않습니다** (8-6절). 관객이 색까지 바꾸면
 * 연출가가 곡마다 잡아 둔 색채 계획이 무너집니다.
 */
import { useState } from 'react';
import ChipEditor from '@/components/console/ChipEditor';
import MoodPlane from '@/components/console/MoodPlane';
import { Panel } from '@/components/console/Panel';
import { directionManager } from '@/lib/direction/manager';
import { useFrame } from '@/lib/hooks';
import { MONO_PALETTE_ID, ROLE_ROWS } from '@/lib/palette/builtin';
import { useConsoleStore } from '@/lib/store';
import { cx } from '@/lib/util';

export default function PalettePanel() {
  const palettes = useConsoleStore((s) => s.palettes);
  const paletteId = useConsoleStore((s) => s.paletteId);
  const auto = useConsoleStore((s) => s.paletteAuto);
  const fade = useConsoleStore((s) => s.paletteFade);
  const selectPalette = useConsoleStore((s) => s.selectPalette);
  const togglePaletteAuto = useConsoleStore((s) => s.togglePaletteAuto);
  const setPaletteFade = useConsoleStore((s) => s.setPaletteFade);
  const togglePaletteCandidate = useConsoleStore((s) => s.togglePaletteCandidate);
  const createPalette = useConsoleStore((s) => s.createPalette);
  const duplicatePalette = useConsoleStore((s) => s.duplicatePalette);
  const deletePalette = useConsoleStore((s) => s.deletePalette);
  const renamePalette = useConsoleStore((s) => s.renamePalette);

  const [editing, setEditing] = useState(false);
  // 섞임 비율은 매 프레임 바뀝니다. 4프레임마다 한 번만 보고, 그마저도 글자가
  // 실제로 달라졌을 때만 올립니다. 같은 글자로 리렌더하면 카드 아홉 개를
  // 초당 열다섯 번 다시 그리게 됩니다.
  const [blendText, setBlendText] = useState('—');
  useFrame((_dt, frame) => {
    if (frame % 4 !== 0) return;
    const blend = directionManager.params.palette.blend;
    const next =
      blend.length === 0
        ? '—'
        : blend.map((b) => `${b.name} ${Math.round(b.weight * 100)}%`).join(' + ');
    setBlendText((prev) => (prev === next ? prev : next));
  }, 20);

  const selected = palettes.find((p) => p.id === paletteId) ?? palettes[0];

  return (
    <Panel index="05" title="팔레트" hint={auto ? '자동' : '수동'}>
      {/* ── 자동 스위치 ── */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          // 끌 때 직전 섞임의 우세 팔레트를 넘깁니다 (8-5절).
          onClick={() => togglePaletteAuto(directionManager.dominantPaletteId)}
          className={cx(
            'border px-2 py-0.5 text-[11px]',
            auto ? 'border-cyan text-cyan' : 'border-rule text-dim hover:text-bone',
          )}
        >
          자동 {auto ? '켬' : '끔'}
        </button>
        {/* 색이 왜 이렇게 나왔는지 오퍼레이터가 납득할 수 있어야 합니다. */}
        <span className="min-w-0 flex-1 truncate text-[10px] text-dim" title={blendText}>
          {blendText}
        </span>
      </div>

      <Slider
        label="전환"
        value={fade}
        min={0.5}
        max={8}
        step={0.1}
        display={`${fade.toFixed(1)}초`}
        onChange={setPaletteFade}
      />

      {/* ── 분위기 평면 ── */}
      <div className="mt-2">
        <MoodPlane />
        <p className="mt-1 text-[9px] leading-tight text-dim">
          앵커를 끌어 옮기면 그 팔레트가 어떤 곡에서 뽑힐지 바뀝니다. 기본
          팔레트를 옮기면 사본이 만들어집니다.
        </p>
      </div>

      {/* ── 팔레트 목록 ── */}
      <div className="mt-2 space-y-1">
        {palettes.map((p) => {
          // 8-5절. **자동이 켜져 있으면 어느 카드에도 선택 표시가 없습니다.**
          // 표시가 있으면 그 색이 지금 나가는 색이라고 오해합니다. 자동일 때
          // 나가는 색은 카드 하나가 아니라 둘의 혼합이고, 섞임 표시가 말합니다.
          const active = !auto && p.id === paletteId;
          return (
            <div
              key={p.id}
              className={cx(
                'flex items-center gap-1.5 border px-1.5 py-1',
                active ? 'border-cyan bg-panel2' : 'border-rule',
              )}
            >
              <button
                type="button"
                onClick={() => selectPalette(p.id)}
                onDoubleClick={() => {
                  selectPalette(p.id);
                  setEditing(true);
                }}
                title="한 번 눌러 선택, 두 번 눌러 편집"
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                <span className="flex shrink-0">
                  {ROLE_ROWS.map(({ role }) => (
                    <span
                      key={role}
                      className="h-3 w-2.5 border-y border-l border-rule last:border-r"
                      style={{ backgroundColor: p.chips[role] }}
                    />
                  ))}
                </span>
                <span
                  className={cx(
                    'min-w-0 flex-1 truncate text-[11px]',
                    active ? 'text-bone' : 'text-dim',
                  )}
                >
                  {p.name}
                  {p.id === MONO_PALETTE_ID && p.builtin ? (
                    <span className="text-dim"> (기본값)</span>
                  ) : null}
                </span>
              </button>
              <button
                type="button"
                onClick={() => togglePaletteCandidate(p.id)}
                title="자동 선택 후보에 넣거나 뺍니다"
                className={cx(
                  'shrink-0 border px-1 text-[9px] leading-[1.4]',
                  p.auto ? 'border-cyan text-cyan' : 'border-rule text-dim',
                )}
              >
                자동 후보
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-1.5 flex gap-1">
        <SmallButton onClick={createPalette}>새로 만들기</SmallButton>
        <SmallButton onClick={() => duplicatePalette(paletteId)}>복제</SmallButton>
        <SmallButton
          onClick={() => deletePalette(paletteId)}
          disabled={selected?.builtin !== false}
          title={
            selected?.builtin
              ? '기본 제공 팔레트는 지울 수 없습니다'
              : undefined
          }
        >
          삭제
        </SmallButton>
      </div>

      {/* ── 컬러칩 편집기 ── */}
      {selected ? (
        <div className="mt-2 border-t border-rule pt-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setEditing(!editing)}
              className="border border-rule px-1.5 py-0.5 text-[10px] text-dim hover:text-bone"
            >
              {editing ? '접기' : '색 편집'}
            </button>
            {editing && !selected.builtin ? (
              <input
                value={selected.name}
                onChange={(e) => renamePalette(selected.id, e.target.value)}
                className="min-w-0 flex-1 border border-rule bg-panel2 px-1 py-0.5 text-[10px] text-bone outline-none focus:border-cyan"
                aria-label="팔레트 이름"
              />
            ) : (
              <span className="min-w-0 flex-1 truncate text-[10px] text-dim">
                {auto ? '편집 대상 ' : ''}
                {selected.name}
                {selected.builtin ? ' · 고치면 사본이 만들어집니다' : ''}
              </span>
            )}
          </div>
          {editing ? (
            <div className="mt-2">
              <ChipEditor palette={selected} />
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className={cx('mt-1.5 flex items-center gap-1.5', disabled && 'opacity-50')}>
      <span className="w-[3.6em] shrink-0 text-[10px] text-dim">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 min-w-0 flex-1 accent-cyan"
      />
      <span className="w-[2.9em] shrink-0 text-right text-[10px] tabular-nums text-bone">
        {display}
      </span>
    </label>
  );
}

function SmallButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex-1 border border-rule px-1 py-0.5 text-[10px] text-dim enabled:hover:text-bone disabled:opacity-40"
    >
      {children}
    </button>
  );
}
