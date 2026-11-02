/**
 * 공통 효과. `docs/03-screens.md` 4절.
 *
 * 잔상·입자·교란·비트 테두리 네 가지입니다. 세기는 연출 파라미터에서 오지만
 * 5단계 전까지는 스토어의 설정값을 그대로 씁니다.
 *
 * 매 프레임 도는 코드이므로 픽셀 단위 반복은 피했습니다. 입자는 잡음 캔버스를
 * 한 번 만들어 두고 위치만 옮기고, 교란은 캔버스를 자기 자신에 몇 조각만
 * 겹쳐 그립니다.
 */
import { clamp } from '@/lib/util';
import { withAlpha } from '@/lib/render/palette';
import type { ConsoleColors } from '@/lib/render/types';

/** 교란을 시작하는 문턱. 이 아래로는 그리지 않습니다. */
const GLITCH_THRESHOLD = 0.12;
const GLITCH_SLICES = 7;
/** 비트 테두리가 사그라지는 시정수(초). */
const BEAT_EDGE_TAU = 0.16;
/** 잡음 캔버스가 화면보다 얼마나 큰가. 남는 만큼 매 프레임 위치를 옮깁니다. */
const NOISE_SLACK = 96;
/** 잡음에서 밝은 점이 차지하는 비율. */
const NOISE_DENSITY = 0.22;
/**
 * 입자의 세기 배율.
 * 잔상 위에 매 프레임 더해지므로 정상 상태에서는 `1/(1-trail)` 배로 쌓입니다.
 * 그만큼을 감안해 낮게 잡았습니다.
 */
const GRAIN_SCALE = 0.09;

/**
 * 잔상. 이전 프레임을 완전히 지우지 않고 반투명하게 덮습니다.
 * `trail` 이 1 에 가까울수록 오래 남습니다.
 */
export function drawTrail(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  trail: number,
): void {
  ctx.fillStyle = `rgba(0, 0, 0, ${clamp(1 - trail, 0.03, 1)})`;
  ctx.fillRect(0, 0, w, h);
}

/** 입자와 비트 테두리처럼 프레임을 넘겨 기억해야 하는 것들. */
export class EffectState {
  private noise: HTMLCanvasElement | null = null;
  private noiseW = 0;
  private noiseH = 0;
  private lastBeat = 0;
  private beatEdge = 0;

  /** 크기가 바뀌면 잡음을 다시 만듭니다. */
  private ensureNoise(w: number, h: number) {
    const nw = Math.ceil(w) + NOISE_SLACK;
    const nh = Math.ceil(h) + NOISE_SLACK;
    if (this.noise && this.noiseW === nw && this.noiseH === nh) return;

    const c = document.createElement('canvas');
    c.width = nw;
    c.height = nh;
    const nctx = c.getContext('2d');
    if (!nctx) return;
    const img = nctx.createImageData(nw, nh);
    const d = img.data;
    // 성긴 잡음입니다. 모든 픽셀을 밝히면 잔상에 얹혀 화면 전체가 뿌예집니다.
    // 대부분을 검게 두고 일부만 튀게 해야 "미세한 잡음"으로 읽힙니다.
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() < NOISE_DENSITY ? (Math.random() * 255) | 0 : 0;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
      d[i + 3] = 255;
    }
    nctx.putImageData(img, 0, 0);
    this.noise = c;
    this.noiseW = nw;
    this.noiseH = nh;
  }

  /** 입자. 미세한 잡음을 얹어 디지털 느낌을 줄입니다. */
  drawGrain(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    grain: number,
  ): void {
    if (grain <= 0.001) return;
    this.ensureNoise(w, h);
    if (!this.noise) return;
    const dx = -Math.floor(Math.random() * NOISE_SLACK);
    const dy = -Math.floor(Math.random() * NOISE_SLACK);
    ctx.save();
    ctx.globalAlpha = clamp(grain * GRAIN_SCALE, 0, 0.3);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this.noise, dx, dy);
    ctx.restore();
  }

  /**
   * 교란. 온셋이나 상태 전이에서 가로 방향으로 화면을 어긋뜨립니다.
   * 캔버스 자신을 몇 조각으로 잘라 좌우로 옮겨 다시 그립니다.
   */
  drawGlitch(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    amount: number,
  ): void {
    if (amount < GLITCH_THRESHOLD) return;
    const canvas = ctx.canvas;
    const strength = clamp(amount, 0, 1);

    // 캔버스를 자기 자신에 겹쳐 그립니다. 원본 좌표는 기기 픽셀 기준이므로
    // 변환 행렬을 잠시 풀고 기기 픽셀로 계산합니다. CSS 픽셀로 넘기면
    // devicePixelRatio 가 1 이 아닌 화면에서 엉뚱한 자리를 집어 옵니다.
    const dw = canvas.width;
    const dh = canvas.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; i < GLITCH_SLICES; i += 1) {
      const sh = Math.max(2, (Math.random() * dh) / 14);
      const sy = Math.random() * (dh - sh);
      const shift = (Math.random() - 0.5) * dw * 0.18 * strength;
      ctx.drawImage(canvas, 0, sy, dw, sh, shift, sy, dw, sh);
    }
    ctx.restore();
  }

  /**
   * 비트 테두리. 비트마다 화면 가장자리가 짧게 번집니다.
   * `analysis.beat` 이 오를 때를 비트로 봅니다.
   */
  drawBeatEdge(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    beat: number,
    dt: number,
    intensity: number,
    tokens: ConsoleColors,
  ): void {
    if (beat !== this.lastBeat) {
      this.lastBeat = beat;
      this.beatEdge = 1;
    } else {
      this.beatEdge *= Math.exp(-dt / BEAT_EDGE_TAU);
    }
    if (this.beatEdge < 0.02) return;

    const alpha = clamp(this.beatEdge * 0.5 * intensity, 0, 0.6);
    const band = Math.max(6, Math.min(w, h) * 0.06);
    const hot = withAlpha(tokens.bone, alpha);
    const clear = withAlpha(tokens.bone, 0);

    /** 가장자리에서 안쪽으로 사그라지는 띠 하나. */
    const edge = (
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      rx: number,
      ry: number,
      rw: number,
      rh: number,
    ) => {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, hot);
      g.addColorStop(1, clear);
      ctx.fillStyle = g;
      ctx.fillRect(rx, ry, rw, rh);
    };

    ctx.save();
    edge(0, 0, 0, band, 0, 0, w, band); // 위
    edge(0, h, 0, h - band, 0, h - band, w, band); // 아래
    edge(0, 0, band, 0, 0, 0, band, h); // 왼쪽
    edge(w, 0, w - band, 0, w - band, 0, band, h); // 오른쪽
    ctx.restore();
  }

  reset(): void {
    this.lastBeat = 0;
    this.beatEdge = 0;
  }
}
