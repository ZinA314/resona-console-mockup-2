'use client';

/**
 * 컬러칩 편집기. `docs/03-screens.md` 05 팔레트 패널 (F-1001).
 *
 * 역할 다섯 개를 세로로 놓고 각 줄에 컬러칩과 HEX 입력 칸을 둡니다.
 * **역할마다 무엇에 쓰이는지 한 줄로 적습니다.** 이름만 보고는 어디에
 * 칠해지는지 알 수 없습니다.
 *
 * 편집하는 동안 저장 버튼을 기다리게 하지 않습니다. 값을 고치는 즉시
 * 스토어에 들어가고 다음 프레임부터 화면이 그 색을 따라갑니다.
 */
import { useEffect, useRef, useState } from 'react';
import { ROLE_ROWS } from '@/lib/palette/builtin';
import { useConsoleStore } from '@/lib/store';
import type { Palette, PaletteRole } from '@/lib/types';
import { clamp, cx } from '@/lib/util';

/** 색상환의 굵기 비율. */
const RING = 0.28;

export default function ChipEditor({ palette }: { palette: Palette }) {
  const updateChip = useConsoleStore((s) => s.updateChip);
  const recentColors = useConsoleStore((s) => s.recentColors);
  const [open, setOpen] = useState<PaletteRole | null>(null);

  return (
    <div className="space-y-1.5">
      {ROLE_ROWS.map(({ role, label, hint }) => {
        const hex = palette.chips[role];
        return (
          <div key={role}>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setOpen(open === role ? null : role)}
                title="색상환 열기"
                className={cx(
                  'h-5 w-5 shrink-0 border',
                  open === role ? 'border-cyan' : 'border-rule',
                )}
                style={{ backgroundColor: hex }}
                aria-label={`${label} 색 고르기`}
              />
              <span className="w-[2.2em] shrink-0 text-[11px] text-bone">{label}</span>
              <HexInput
                value={hex}
                onCommit={(next) => updateChip(palette.id, role, next)}
              />
            </div>
            <p className="ml-[1.85rem] mt-0.5 text-[9px] leading-tight text-dim">{hint}</p>
            {open === role ? (
              <Wheel
                hex={hex}
                onChange={(next) => updateChip(palette.id, role, next)}
              />
            ) : null}
          </div>
        );
      })}

      {recentColors.length > 0 ? (
        <div>
          <p className="mt-2 text-[9px] uppercase tracking-[0.12em] text-dim">최근 색</p>
          <div className="mt-1 flex gap-1">
            {recentColors.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                onClick={() => {
                  if (open) updateChip(palette.id, open, c);
                }}
                disabled={!open}
                className={cx(
                  'h-4 w-4 border border-rule',
                  open ? 'cursor-pointer' : 'cursor-default opacity-60',
                )}
                style={{ backgroundColor: c }}
                aria-label={`최근 색 ${c}`}
              />
            ))}
          </div>
          {!open ? (
            <p className="mt-1 text-[9px] text-dim">역할을 먼저 고르십시오</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 입력 중에는 자기 값을 들고 있다가, 여섯 자리가 맞을 때만 위로 올립니다.
 * 한 글자 지울 때마다 화면 색이 바뀌면 편집을 할 수가 없습니다.
 */
function HexInput({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  const commit = (raw: string) => {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(raw.trim());
    if (m) onCommit(`#${m[1].toUpperCase()}`);
    else setDraft(value);
  };

  return (
    <input
      value={draft}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={(e) => {
        focused.current = false;
        commit(e.target.value);
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        const m = /^#?([0-9a-fA-F]{6})$/.exec(e.target.value.trim());
        if (m) onCommit(`#${m[1].toUpperCase()}`);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
      }}
      spellCheck={false}
      className="min-w-0 flex-1 border border-rule bg-panel2 px-1 py-0.5 text-[10px] uppercase tabular-nums text-bone outline-none focus:border-cyan"
      aria-label="HEX 색값"
    />
  );
}

/** 색상환과 밝기·채도 슬라이더. */
function Wheel({ hex, onChange }: { hex: string; onChange: (hex: string) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const dragging = useRef(false);
  const hsv = hexToHsv(hex);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = canvas.clientWidth;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const r = size / 2;
    const inner = r * (1 - RING);
    // 1도씩 부채꼴로 채웁니다. 원뿔 그라디언트가 없는 브라우저를 피합니다.
    for (let deg = 0; deg < 360; deg += 1) {
      const a0 = ((deg - 0.7) * Math.PI) / 180;
      const a1 = ((deg + 0.7) * Math.PI) / 180;
      ctx.beginPath();
      ctx.arc(r, r, r, a0, a1);
      ctx.arc(r, r, inner, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = hsvToHex(deg / 360, 1, 1);
      ctx.fill();
    }

    // 지금 색상의 자리.
    const ang = (hsv.h * 360 * Math.PI) / 180;
    const mid = (r + inner) / 2;
    ctx.beginPath();
    ctx.arc(r + Math.cos(ang) * mid, r + Math.sin(ang) * mid, 4, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000000';
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
  }, [hsv.h]);

  const pick = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - rect.left - rect.width / 2;
    const dy = e.clientY - rect.top - rect.height / 2;
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    onChange(hsvToHex(deg / 360, hsv.s, hsv.v));
  };

  return (
    <div className="mt-1.5 border border-rule bg-panel2 p-2">
      <canvas
        ref={ref}
        className="mx-auto block h-24 w-24 cursor-crosshair touch-none"
        onPointerDown={(e) => {
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* 잡을 수 없는 포인터. 그대로 진행합니다 */
          }
          dragging.current = true;
          pick(e);
        }}
        onPointerMove={(e) => {
          if (dragging.current) pick(e);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        aria-label="색상환"
      />
      <Slider
        label="채도"
        value={hsv.s}
        onChange={(v) => onChange(hsvToHex(hsv.h, v, hsv.v))}
      />
      <Slider
        label="밝기"
        value={hsv.v}
        onChange={(v) => onChange(hsvToHex(hsv.h, hsv.s, v))}
      />
    </div>
  );
}

function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="mt-1.5 flex items-center gap-1.5">
      <span className="w-[2.2em] shrink-0 text-[10px] text-dim">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 min-w-0 flex-1 accent-cyan"
      />
      <span className="w-[2.4em] shrink-0 text-right text-[10px] tabular-nums text-dim">
        {Math.round(value * 100)}
      </span>
    </label>
  );
}

// ── HSV. 색상환에서만 씁니다. 색을 섞는 것은 OKLab 이 합니다 ────────

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const n = hex.replace('#', '').padEnd(6, '0');
  const r = Number.parseInt(n.slice(0, 2), 16) / 255;
  const g = Number.parseInt(n.slice(2, 4), 16) / 255;
  const b = Number.parseInt(n.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h, s: max < 1e-6 ? 0 : d / max, v: max };
}

function hsvToHex(h: number, s: number, v: number): string {
  const hh = (clamp(h, 0, 1) * 6) % 6;
  const c = clamp(v, 0, 1) * clamp(s, 0, 1);
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = clamp(v, 0, 1) - c;
  const [r, g, b] =
    hh < 1
      ? [c, x, 0]
      : hh < 2
        ? [x, c, 0]
        : hh < 3
          ? [0, c, x]
          : hh < 4
            ? [0, x, c]
            : hh < 5
              ? [x, 0, c]
              : [c, 0, x];
  const part = (u: number) =>
    Math.round(clamp(u + m, 0, 1) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}
