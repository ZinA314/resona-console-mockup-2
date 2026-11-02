'use client';

import { useEffect, useRef } from 'react';
import { createScenes } from '@/components/stage/scenes';
import { EffectState, drawTrail } from '@/lib/render/effects';
import { readConsoleColors } from '@/lib/render/palette';
import type { ConsoleColors, Scene, SceneInput } from '@/lib/render/types';
import { useFrame } from '@/lib/hooks';
import type { SceneKind } from '@/lib/types';
import { clamp } from '@/lib/util';

/**
 * 몽환도로 교란을 누르는 씬 (`03-screens.md` 4절).
 *
 * ```
 * glitchEff = glitch × (1 − dreaminess × 0.85)
 * ```
 *
 * **이 식은 무대 씬만의 규칙이 아니라 씬 공통입니다.** 활자가 찢어지는 것은
 * 무대 화면에서 의도한 표현이고, 몽환적인 구간에서 그것이 눌리는 이유도
 * 무대 씬과 같습니다. 발라드 도중에 화면이 찢어지면 곡과 어긋납니다.
 *
 * 합성 씬은 바탕이 무대든 직조든 걸립니다. 무대에 거는 화면인지가 기준이지
 * 바탕이 무엇인지가 기준이 아닙니다.
 *
 * 이 셋이 곧 06 씬 패널의 `무대용` 줄입니다.
 */
const GLITCH_SUPPRESSED: ReadonlySet<SceneKind> = new Set<SceneKind>([
  'bloom',
  'composite',
  'type',
]);

/**
 * 교란을 아예 걸지 않는 씬 — **진단용 셋** (`03-screens.md` 4절의 표).
 *
 * 분석이 제대로 도는지, 관객 신호가 들어오는지 확인하는 화면입니다. 값을
 * 읽는 화면을 어긋뜨리면 읽을 수가 없습니다. 무대에 걸 그림이 아니므로
 * 연출 효과를 얹을 이유도 없습니다.
 *
 * 갈림의 기준은 씬의 **용도**입니다. 그리는 방식(Canvas 2D / WebGL)이나
 * 바탕이 무엇인지가 아닙니다.
 */
const GLITCH_NONE: ReadonlySet<SceneKind> = new Set<SceneKind>([
  'weave',
  'spectrum',
  'faces',
]);

/**
 * 캔버스 컨테이너. 콘솔의 중앙 무대와 출력 창이 같은 것을 씁니다.
 *
 * `devicePixelRatio` 를 반영하고 컨테이너 크기 변화에 대응합니다. 그리는 값은
 * `read()` 가 매 프레임 돌려주므로, 이 컴포넌트는 어디서 값이 오는지 모릅니다.
 * 콘솔은 엔진에서, 출력 창은 BroadcastChannel 에서 읽습니다.
 */
export default function StageCanvas({
  read,
  onFrame,
  className,
}: {
  read: () => SceneInput | null;
  /** 그린 뒤에 부릅니다. 콘솔이 출력 창으로 상태를 보내는 자리입니다. */
  onFrame?: (time: number, input: SceneInput) => void;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scenesRef = useRef<Record<SceneKind, Scene> | null>(null);
  const effectsRef = useRef<EffectState | null>(null);
  const tokensRef = useRef<ConsoleColors | null>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const lastSceneRef = useRef<SceneKind | null>(null);

  // 크기 대응. 컨테이너가 바뀔 때만 캔버스를 다시 잡습니다.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    scenesRef.current = createScenes();
    effectsRef.current = new EffectState();
    tokensRef.current = readConsoleColors();

    const resize = () => {
      const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      const w = Math.max(1, Math.floor(wrap.clientWidth));
      const h = Math.max(1, Math.floor(wrap.clientHeight));
      if (sizeRef.current.w === w && sizeRef.current.h === h && sizeRef.current.dpr === dpr) {
        return;
      }
      sizeRef.current = { w, h, dpr };
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      // 크기를 바꾸면 변환 행렬이 초기화되므로 다시 겁니다.
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx?.clearRect(0, 0, w, h);
    };

    resize();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useFrame((dt) => {
    const canvas = canvasRef.current;
    const scenes = scenesRef.current;
    const effects = effectsRef.current;
    const tokens = tokensRef.current;
    if (!canvas || !scenes || !effects || !tokens) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { w, h, dpr } = sizeRef.current;
    if (w === 0 || h === 0) return;

    const input = read();
    if (!input) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      return;
    }

    // 시각은 rAF 누적이 아니라 오디오 시계에서 옵니다 (#16). 창이 가려진
    // 동안 rAF 가 멈춰도 시간은 흘러야 다시 열었을 때 뒤처지지 않습니다.
    const time = input.time;

    // 블랙아웃은 어떤 상태에서도 즉시 반응해야 합니다. 공연 사고 시의 조작입니다.
    if (input.settings.blackout) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      onFrame?.(time, input);
      return;
    }

    const kind = input.settings.scene;
    // 씬이 바뀌면 앞 씬이 쌓아 둔 것을 비웁니다.
    if (lastSceneRef.current !== kind) {
      lastSceneRef.current = kind;
      scenes[kind]?.reset();
      effects.reset();
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
    }

    /*
     * 1) 잔상 — 지우는 대신 반투명하게 덮습니다.
     * 관객이 뜨거울수록 잔상이 길어집니다 (03-screens 직조 절).
     *
     * 무대 씬은 건너뜁니다. 그 씬은 WebGL 안에서 배경 유체의 알파로 잔상을
     * 직접 만들고 화면을 불투명하게 덮어 오므로, 여기서 한 번 더 걸면
     * 아무 효과 없이 반투명 사각형만 그리게 됩니다.
     */
    const usesOwnTrail =
      kind === 'bloom' ||
      (kind === 'composite' && input.sceneParams.composite.base === 'bloom');
    if (!usesOwnTrail) {
      drawTrail(
        ctx,
        w,
        h,
        clamp(input.settings.trail + input.params.expansion * 0.12, 0, 0.95),
      );
    }

    // 2) 씬
    const scene = scenes[kind];
    if (scene) {
      try {
        scene.draw({ ctx, w, h, dpr, dt, time, tokens, input });
      } catch (err) {
        // 씬 하나가 실패해도 화면은 계속 돌아야 합니다.
        console.error('[stage] 씬 그리기에서 오류가 났습니다.', err);
      }
    }

    // 3) 공통 효과
    const a = input.analysis;
    effects.drawBeatEdge(
      ctx,
      w,
      h,
      a.beat,
      dt,
      input.params.brightness * input.settings.intensity,
      tokens,
    );
    /*
     * 교란의 세기는 연출 파라미터에서 옵니다. 온셋과 상태 전이가 이미 그 안에
     * 들어 있으므로 여기서 다시 섞지 않습니다. 씬별 규칙은 위의 두 집합에
     * 적어 두었습니다.
     */
    const glitchEff = GLITCH_NONE.has(kind)
      ? 0
      : GLITCH_SUPPRESSED.has(kind)
        ? input.params.glitch * (1 - input.params.dreaminess * 0.85)
        : input.params.glitch;
    effects.drawGlitch(ctx, w, h, glitchEff * input.settings.glitch * 4);
    effects.drawGrain(ctx, w, h, input.settings.grain);

    onFrame?.(time, input);
  }, 0);

  return (
    <div ref={wrapRef} className={className}>
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}
