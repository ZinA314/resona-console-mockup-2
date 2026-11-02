'use client';

/**
 * 분위기 2축 평면. `docs/03-screens.md` 05 팔레트 패널.
 *
 * **이 위젯 하나로 "지금 왜 이 색인가" 가 설명됩니다.** 숫자만 나열하면
 * 리허설에서 조정할 수가 없습니다.
 *
 * 가로축 밝기(valence), 세로축 격렬함(arousal). 지금 곡의 자리를 청록 점으로
 * 찍고 최근 30초의 자취를 옅게 남깁니다. 팔레트 앵커는 끌어서 옮깁니다.
 */
import { useEffect, useRef } from 'react';
import { directionManager } from '@/lib/direction/manager';
import { useFrame } from '@/lib/hooks';
import { readConsoleColors, withAlpha } from '@/lib/render/palette';
import { useConsoleStore } from '@/lib/store';
import type { ConsoleColors } from '@/lib/render/types';
import type { Palette } from '@/lib/types';
import { clamp } from '@/lib/util';

/** 자취의 길이와 표본 간격. 30초를 4Hz 로 담습니다. */
const TRAIL_SECONDS = 30;
const TRAIL_HZ = 4;
const TRAIL_MAX = TRAIL_SECONDS * TRAIL_HZ;

/** 이 거리(픽셀) 안에서 누르면 앵커를 잡은 것으로 봅니다. */
const GRAB_PX = 14;

const ANCHOR_R = 4.5;

export default function MoodPlane() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tokensRef = useRef<ConsoleColors | null>(null);
  const trailRef = useRef<Float32Array>(new Float32Array(TRAIL_MAX * 2));
  const trailLenRef = useRef(0);
  const trailHeadRef = useRef(0);
  const sinceRef = useRef(0);
  const draggingRef = useRef<string | null>(null);

  useEffect(() => {
    tokensRef.current = readConsoleColors();
  }, []);

  // 리드아웃과 같은 자리입니다. 실시간 값은 상태로 올리지 않고 직접 그립니다.
  useFrame((dt) => {
    const canvas = canvasRef.current;
    const tokens = tokensRef.current;
    if (!canvas || !tokens) return;

    const mood = directionManager.mood;

    // 자취 표본. 매 프레임 담으면 30초에 1,800점이라 볼 것이 없습니다.
    sinceRef.current += dt;
    if (sinceRef.current >= 1 / TRAIL_HZ) {
      sinceRef.current = 0;
      const t = trailRef.current;
      const head = trailHeadRef.current;
      t[head * 2] = mood.valence;
      t[head * 2 + 1] = mood.arousal;
      trailHeadRef.current = (head + 1) % TRAIL_MAX;
      if (trailLenRef.current < TRAIL_MAX) trailLenRef.current += 1;
    }

    draw(canvas, tokens, {
      valence: mood.valence,
      arousal: mood.arousal,
      trail: trailRef.current,
      trailLen: trailLenRef.current,
      trailHead: trailHeadRef.current,
    });
  }, 18);

  /** 캔버스 좌표를 `(valence, arousal)` 로. 세로축은 위가 1 입니다. */
  const toMood = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      valence: clamp((e.clientX - rect.left) / rect.width, 0, 1),
      arousal: clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1),
    };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const at = toMood(e);
    const { palettes } = useConsoleStore.getState();
    let best: Palette | null = null;
    let bestPx = GRAB_PX;
    for (const p of palettes) {
      if (!p.auto) continue;
      const dx = (p.anchor.valence - at.valence) * rect.width;
      const dy = (p.anchor.arousal - at.arousal) * rect.height;
      const d = Math.hypot(dx, dy);
      if (d <= bestPx) {
        bestPx = d;
        best = p;
      }
    }
    if (!best) return;
    // 포인터 잡기가 실패해도 끌기는 계속돼야 합니다. 공연 중에 쓰는 도구입니다.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 잡을 수 없는 포인터. 그대로 진행합니다 */
    }
    draggingRef.current = best.id;
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const id = draggingRef.current;
    if (!id) return;
    const at = toMood(e);
    // 기본 팔레트를 옮기면 사본이 만들어지므로 이후 프레임은 사본을 잡습니다.
    const before = useConsoleStore.getState().palettes;
    useConsoleStore.getState().moveAnchor(id, at.valence, at.arousal);
    const after = useConsoleStore.getState().palettes;
    if (after.length !== before.length) {
      const made = after.find((p) => !before.some((q) => q.id === p.id));
      if (made) draggingRef.current = made.id;
    }
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* 이미 놓았습니다 */
    }
    draggingRef.current = null;
  };

  return (
    <canvas
      ref={canvasRef}
      className="block aspect-square w-full cursor-crosshair touch-none border border-rule bg-panel2"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      aria-label="분위기 평면. 가로축 밝기, 세로축 격렬함"
    />
  );
}

interface DrawInput {
  valence: number;
  arousal: number;
  trail: Float32Array;
  trailLen: number;
  trailHead: number;
}

function draw(canvas: HTMLCanvasElement, tokens: ConsoleColors, input: DrawInput) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const x = (v: number) => v * w;
  const y = (a: number) => (1 - a) * h;

  // ── 눈금 ──
  ctx.lineWidth = 1;
  ctx.strokeStyle = withAlpha(tokens.rule, 0.9);
  ctx.beginPath();
  for (let i = 1; i < 4; i += 1) {
    ctx.moveTo(Math.round(x(i / 4)) + 0.5, 0);
    ctx.lineTo(Math.round(x(i / 4)) + 0.5, h);
    ctx.moveTo(0, Math.round(y(i / 4)) + 0.5);
    ctx.lineTo(w, Math.round(y(i / 4)) + 0.5);
  }
  ctx.stroke();

  // 7-5절의 구역 경계. 이름이 갈리는 자리를 옅게 보여 줍니다.
  ctx.strokeStyle = withAlpha(tokens.dim, 0.35);
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(0, Math.round(y(0.38)) + 0.5);
  ctx.lineTo(w, Math.round(y(0.38)) + 0.5);
  ctx.moveTo(0, Math.round(y(0.62)) + 0.5);
  ctx.lineTo(w, Math.round(y(0.62)) + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);

  const { palettes } = useConsoleStore.getState();
  const candidates = palettes.filter((p) => p.auto);

  // ── 가장 가까운 두 앵커를 잇는 선 ──
  const ranked = candidates
    .map((p) => ({
      p,
      d: Math.hypot(p.anchor.valence - input.valence, p.anchor.arousal - input.arousal),
    }))
    .sort((a, b) => a.d - b.d);

  if (ranked.length >= 2) {
    const [a, b] = ranked;
    const sum = a.d + b.d;
    const w2 = sum < 1e-9 ? 0.5 : a.d / sum;
    ctx.strokeStyle = withAlpha(tokens.cyan, 0.45);
    ctx.beginPath();
    ctx.moveTo(x(a.p.anchor.valence), y(a.p.anchor.arousal));
    ctx.lineTo(x(input.valence), y(input.arousal));
    ctx.lineTo(x(b.p.anchor.valence), y(b.p.anchor.arousal));
    ctx.stroke();

    // 선 위에 섞이는 비율을 적습니다.
    ctx.font = '9px var(--font-mono), monospace';
    ctx.fillStyle = withAlpha(tokens.cyan, 0.9);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    label(ctx, `${Math.round((1 - w2) * 100)}%`, x(a.p.anchor.valence), y(a.p.anchor.arousal), w, h);
    label(ctx, `${Math.round(w2 * 100)}%`, x(b.p.anchor.valence), y(b.p.anchor.arousal), w, h);
  }

  // ── 자취 ──
  const t = input.trail;
  for (let i = 0; i < input.trailLen; i += 1) {
    // 오래된 것부터. 최신에 가까울수록 진하게.
    const idx = (input.trailHead - input.trailLen + i + TRAIL_MAX * 2) % TRAIL_MAX;
    const age = i / Math.max(input.trailLen - 1, 1);
    ctx.fillStyle = withAlpha(tokens.cyan, 0.05 + age * 0.2);
    ctx.fillRect(x(t[idx * 2]) - 1, y(t[idx * 2 + 1]) - 1, 2, 2);
  }

  // ── 앵커 ──
  for (const p of palettes) {
    if (!p.auto) continue;
    const cx = x(p.anchor.valence);
    const cy = y(p.anchor.arousal);
    ctx.beginPath();
    ctx.arc(cx, cy, ANCHOR_R, 0, Math.PI * 2);
    ctx.fillStyle = p.chips.base;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = withAlpha(tokens.void, 0.9);
    ctx.stroke();
  }

  // ── 지금 곡의 자리 ──
  const cx = x(input.valence);
  const cy = y(input.arousal);
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = tokens.cyan;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 7.5, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = withAlpha(tokens.cyan, 0.5);
  ctx.stroke();

  // ── 축 이름 ──
  ctx.font = '9px var(--font-mono), monospace';
  ctx.fillStyle = withAlpha(tokens.dim, 0.9);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('밝기 →', 3, h - 3);
  ctx.save();
  ctx.translate(3, 3);
  ctx.textBaseline = 'top';
  ctx.fillText('↑ 격렬함', 0, 0);
  ctx.restore();
}

/** 앵커 옆에 비율을 적습니다. 화면 밖으로 나가지 않게 붙는 쪽을 고릅니다. */
function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  ax: number,
  ay: number,
  w: number,
  h: number,
) {
  const dx = ax > w / 2 ? -14 : 14;
  const dy = ay > h / 2 ? -6 : 12;
  ctx.fillText(text, Math.min(w - 12, Math.max(12, ax + dx)), Math.min(h - 2, Math.max(10, ay + dy)));
}
