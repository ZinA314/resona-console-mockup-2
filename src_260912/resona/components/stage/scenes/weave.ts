/**
 * 직조 (WEAVE). `docs/03-screens.md` 4절.
 *
 * 곡이 흐르는 동안 천이 짜입니다. 가로실과 세로실이 교차하며, 음악이 센
 * 구간은 넓은 띠로, 약한 구간은 촘촘한 결로 남습니다. **두 방향 실의 교차가
 * 핵심이므로 가로줄만 쌓이면 이 씬이 성립하지 않습니다.**
 *
 * 여섯 층을 순서대로 그립니다. 순서를 지켜야 겹침이 자연스럽습니다.
 *   1) 가로실(위사) 2) 세로실(경사) 3) 매듭
 *   4) 평직 교차 덧실 5) 셀비지(마디 번호) 6) 직구 빔 라인
 *
 * 계수는 원본 실측값을 그대로 옮겼습니다. 바꾸면 천의 결이 달라집니다.
 */
import { clamp } from '@/lib/util';
import { mixHex, withAlpha } from '@/lib/render/palette';
import type { PaletteRoles, Scene, SceneFrame } from '@/lib/render/types';

/** 격자 파라미터. */
/*
 * 격자 파라미터는 07 씬 파라미터 패널에서 옵니다 (F-508). 기본값은
 * `lib/types.ts` 의 `DEFAULT_SCENE_PARAMS.weave` 이고 원본 프로토타입의
 * 값 그대로입니다 — 경사 48, 위사 30, 장력 0.52, 속도 2, 스템 분리 켬.
 *
 * 아래 둘은 배열 크기를 잡는 상한이라 슬라이더 범위와 같아야 합니다.
 */
const MAX_WARP = 96;
const MAX_WEFT = 60;

/** 여백. 가로 5.5%, 세로 7.5%. */
const PAD_X = 0.055;
const PAD_Y = 0.075;

/** 스템별 실 굵기. 베이스가 가장 굵고 기타 성분이 가장 가늡니다. */
const WGT = [1.1, 1.55, 0.8, 0.58];

/** 매듭이 생기는 문턱과 폭. */
const KNOT_MIN = 0.58;
const KNOT_SPAN = 0.42;

/** 방금 짜인 부분이 아직 살아 움직이는 행 수. */
const LIVE_ROWS = 3;

/** 비트 섬광의 감쇠 속도. 약 0.29초에 0 이 됩니다. */
const FLASH_DECAY = 3.4;

/**
 * 가로실이 쓰는 색 인덱스. **스템별로 갈리지 않고 1(베이스) 고정입니다.**
 * 덧실도 같습니다.
 */
const WEFT_TONE = 1;

/**
 * 셀비지와 빔 라인은 진단용 글자·눈금이라 무대에 걸 그림이 아닙니다.
 * 팔레트 역할이 아닌 고정색을 쓰는 유일한 자리입니다.
 */
const SELVAGE_RGB = '110, 107, 100';
const BEAM_RGB = '232, 228, 220';

/**
 * 이 씬의 모든 색이 이 함수 하나에서 나옵니다.
 * 팔레트 역할 다섯 개만 읽으므로 팔레트를 갈아 끼워도 씬 코드는 그대로입니다.
 */
function toneCol(roles: PaletteRoles, g: number, v: number, hot: boolean): string {
  const alpha = clamp(0.1 + v * 0.9, 0, 1);
  if (hot) return withAlpha(roles.hot, alpha);
  if (g === 2) return withAlpha(roles.accent, alpha);
  if (g === 3) return withAlpha(mixHex(roles.deep, roles.base, 0.5), alpha);
  return withAlpha(roles.base, alpha);
}

interface Row {
  /**
   * 쌓일 때의 세로실 개수. **행마다 따로 들고 있습니다.**
   * 경사를 바꿀 때 이미 쌓인 행까지 다시 계산하면 천이 한 번에 뒤틀립니다
   * (03-screens 07 절). 새로 쌓이는 행부터 새 값을 씁니다.
   */
  warp: number;
  /** 그 행의 스템 네 값. */
  s: [number, number, number, number];
  /** 쌓는 시점에 구한 네 스템의 최댓값. 그리는 시점에 다시 구하지 않습니다. */
  lv: number;
  rms: number;
  centroid: number;
  bar: number;
  beatInBar: number;
  /** 쌓인 시각. 가로실의 세로 흔들림과 셀비지에 씁니다. */
  t: number;
}

export class WeaveScene implements Scene {
  /**
   * 셀비지(마디 번호)와 빔 라인을 그릴지. 진단 씬에서는 켜고, 합성 씬의
   * 바탕으로 쓸 때는 끕니다. 글자와 눈금은 무대에 걸 그림이 아닙니다.
   */
  constructor(private readonly diagnostic = true) {}

  private rows: Row[] = [];
  private lastSlot = -1;
  private lastBeat = 0;
  /** 비트에 1 로 서고 `dt × 3.4` 로 감쇠합니다. 온셋이 아니라 비트입니다. */
  private flash = 0;

  // 교차점은 층마다 다시 쓰므로 프레임마다 한 번만 계산해 둡니다.
  private gx = new Float32Array(MAX_WARP * MAX_WEFT);
  private gy = new Float32Array(MAX_WARP * MAX_WEFT);
  /** 행마다의 합성 레벨과 가로실 굵기. 층 1·4·5 가 함께 씁니다. */
  private lvOf = new Float32Array(MAX_WEFT);
  private widthOf = new Float32Array(MAX_WEFT);

  reset(): void {
    this.rows.length = 0;
    this.lastSlot = -1;
    this.lastBeat = 0;
    this.flash = 0;
  }

  draw(f: SceneFrame): void {
    const { w, h, dt, time, input } = f;
    const a = input.analysis;

    // 비트 섬광. 온셋으로 하면 최근 행이 거의 항상 굵어져 강조의 뜻이 없어집니다.
    if (a.beat !== this.lastBeat) {
      this.lastBeat = a.beat;
      this.flash = 1;
    } else {
      this.flash = Math.max(0, this.flash - dt * FLASH_DECAY);
    }

    this.collect(f);

    const padX = w * PAD_X;
    const padY = h * PAD_Y;
    const usableW = w - padX * 2;
    const usableH = h - padY * 2;
    const wp = input.sceneParams.weave;
    // 세로실 간격은 행마다 다릅니다. 아래 각 층이 행의 `warp` 로 다시 구합니다.
    const cw = usableW / (wp.warp - 1);
    const ch = usableH / wp.weft;
    // 연출 파라미터가 결정합니다. `intensity` 는 그 위에 얹는 사용자 배율입니다.
    // 관객 에너지는 `expansion` 을 통해서만 들어옵니다 (05 6-3절).
    const p = input.params;
    const intensity = clamp(p.brightness * 1.6, 0.15, 2) * input.settings.intensity;
    const tension = wp.tension * (1 + p.expansion);

    const n = this.rows.length;
    if (n < 2) {
      this.drawEmptyLoom(f, padX, padY, usableH, cw, wp.warp);
      return;
    }

    this.layout(time, a, padX, padY, usableW, usableH, ch, tension, intensity, wp.split);

    this.drawWeft(f, n);
    this.drawWarp(f, n, a, wp.split);
    this.drawKnots(f, n, wp.split);
    this.drawPlain(f, n, usableW);
    if (this.diagnostic) {
      this.drawSelvage(f, n, w, padX, wp.rate);
      this.drawBeam(f, w, h, padY, ch);
    }
  }

  // ── 줄 쌓기 ────────────────────────────────────────────────

  /** `floor((beat + phase) × rate)` 가 바뀔 때마다 한 줄. */
  private collect(f: SceneFrame): void {
    const a = f.input.analysis;
    if (a.beat <= 0) return;

    const wp = f.input.sceneParams.weave;
    const slot = Math.floor((a.beat + clamp(a.phase, 0, 0.999)) * wp.rate);
    if (slot === this.lastSlot) return;
    this.lastSlot = slot;

    const s: [number, number, number, number] = [
      a.stems[0],
      a.stems[1],
      a.stems[2],
      a.stems[3],
    ];
    this.rows.push({
      warp: Math.round(clamp(wp.warp, 2, MAX_WARP)),
      s,
      lv: Math.max(s[0], s[1], s[2], s[3]),
      rms: a.rms,
      centroid: a.centroid,
      bar: a.bar,
      beatInBar: a.beatInBar,
      t: f.time,
    });
    while (this.rows.length > Math.min(Math.round(wp.weft), MAX_WEFT)) {
      this.rows.shift();
    }
  }

  // ── 격자 ──────────────────────────────────────────────────

  /**
   * 행 높이는 세기에 비례합니다. 균등 간격이 아닙니다.
   * 교차점의 가로 좌표는 사인파 두 개로 흔듭니다.
   */
  private layout(
    time: number,
    a: SceneFrame['input']['analysis'],
    padX: number,
    padY: number,
    usableW: number,
    usableH: number,
    ch: number,
    tension: number,
    intensity: number,
    split: boolean,
  ): void {
    const n = this.rows.length;

    // k = 0 이 가장 최근 행입니다. 아래에서부터 쌓아 올립니다.
    let total = 0;
    for (let k = 0; k < n; k += 1) {
      total += 0.55 + this.rows[n - 1 - k].lv * 1.15;
    }

    const bottom = padY + usableH;
    let acc = 0;
    for (let k = 0; k < n; k += 1) {
      const row = this.rows[n - 1 - k];
      acc += 0.55 + row.lv * 1.15;
      const y0 = bottom - (acc / total) * usableH;

      // `lv` 는 단순한 RMS 가 아닙니다. 최대 스템값과 RMS 를 섞고 바닥값을
      // 더한 합성값입니다. 바닥값이 없으면 조용한 구간에서 가로실이 거의
      // 사라져 천이 끊긴 것처럼 보입니다.
      const lv = clamp(row.lv * 0.8 + row.rms * 0.5 + 0.16, 0, 1);
      this.lvOf[k] = lv;
      let width = clamp(0.55 + lv * 1.7, 0.5, 2.6);
      if (k === 0) width *= 1.5 + this.flash;
      this.widthOf[k] = width;

      // 행이 쌓일 때의 세로실 개수로 그립니다.
      const cw = usableW / (row.warp - 1);
      for (let i = 0; i < row.warp; i += 1) {
        const g = split ? i % 4 : 0;
        const lvl = row.s[g];
        // 최근 세 행에만 현재 스템값을 더해, 방금 짜인 부분이 살아 움직입니다.
        const liveLvl = k < LIVE_ROWS ? a.stems[g] : 0;

        const ph = time * (1.1 + g * 0.23) + i * 0.55 + k * 0.31;
        const d =
          Math.sin(ph) * lvl +
          Math.sin(ph * 1.7 + 1.2) * lvl * 0.42 +
          Math.sin(time * 3.1 + i * 0.9) * liveLvl * 0.45;

        const idx = k * MAX_WARP + i;
        this.gx[idx] =
          padX + i * cw + clamp(d, -1.5, 1.5) * (tension * intensity) * cw * 0.52;
        // 가로실은 세로로도 흔듭니다.
        this.gy[idx] = y0 + Math.sin(i * 0.42 + row.t * 2.0) * ch * 0.2 * lv;
      }
    }
  }

  // ── 1) 가로실(위사) ────────────────────────────────────────

  private drawWeft(f: SceneFrame, n: number): void {
    const { ctx, input } = f;

    for (let k = 0; k < n; k += 1) {
      const row = this.rows[n - 1 - k];
      const age = 0.35 + 0.65 * (1 - k / n);
      // 드럼이 세게 난 최근 두 행만 강조색입니다.
      const hot = row.s[0] > 0.78 && k < 2;

      ctx.beginPath();
      const rowWarp = this.rows[this.rows.length - 1 - k].warp;
      for (let i = 0; i < rowWarp; i += 1) {
        const idx = k * MAX_WARP + i;
        if (i === 0) ctx.moveTo(this.gx[idx], this.gy[idx]);
        else ctx.lineTo(this.gx[idx], this.gy[idx]);
      }
      ctx.lineWidth = this.widthOf[k];
      ctx.strokeStyle = toneCol(input.roles, WEFT_TONE, this.lvOf[k] * age, hot);
      ctx.stroke();
    }
  }

  // ── 2) 세로실(경사) ────────────────────────────────────────

  private drawWarp(
    f: SceneFrame,
    n: number,
    a: SceneFrame['input']['analysis'],
    split: boolean,
  ): void {
    const { ctx, input } = f;

    for (let i = 0; i < this.rows[this.rows.length - 1].warp; i += 1) {
      const g = split ? i % 4 : 0;

      let sum = 0;
      for (let k = 0; k < n; k += 1) sum += this.rows[n - 1 - k].s[g];
      const mlv = clamp((sum / n) * 1.3, 0, 1);
      const cur = a.stems[g];
      const v = (mlv * 0.5 + cur * 0.5) ** 1.45;

      ctx.beginPath();
      for (let k = 0; k < n; k += 1) {
        const idx = k * MAX_WARP + i;
        if (k === 0) ctx.moveTo(this.gx[idx], this.gy[idx]);
        else ctx.lineTo(this.gx[idx], this.gy[idx]);
      }
      ctx.lineWidth = clamp((0.34 + v * v * 1.9) * WGT[g], 0.35, 3.0);
      ctx.strokeStyle = toneCol(input.roles, g, v, cur > 0.86 && g === 0);
      ctx.stroke();
    }
  }

  // ── 3) 매듭 ───────────────────────────────────────────────

  /** 그 스템이 배치된 세로실에만 찍습니다. */
  private drawKnots(f: SceneFrame, n: number, split: boolean): void {
    const { ctx, input } = f;
    const step = split ? 4 : 3;

    for (let k = 0; k < n; k += 1) {
      const row = this.rows[n - 1 - k];
      const boost = k < 3 ? 1.25 : 1;

      for (let g = 0; g < 4; g += 1) {
        const value = row.s[g];
        if (value <= KNOT_MIN) continue;
        const kn = (value - KNOT_MIN) / KNOT_SPAN;
        const size = (1.6 + kn * 3.4) * boost;
        ctx.fillStyle =
          g === 0 || kn > 0.72
            ? `rgba(255, 42, 0, ${clamp(0.3 + kn * 0.62, 0, 1)})`
            : toneCol(input.roles, g, 0.45 + kn * 0.55, false);

        for (let i = split ? g : 0; i < row.warp; i += step) {
          const idx = k * MAX_WARP + i;
          ctx.fillRect(this.gx[idx] - size / 2, this.gy[idx] - size / 2, size, size);
        }
        if (!split) break;
      }
    }
  }

  // ── 4) 평직 교차 덧실 ──────────────────────────────────────

  /** 가로실이 위로 올라오는 지점에 짧은 덧실을 찍습니다. */
  private drawPlain(f: SceneFrame, n: number, usableW: number): void {
    const { ctx, input } = f;

    for (let k = 0; k < n; k += 1) {
      const row = this.rows[n - 1 - k];
      // 덧실 길이는 그 행의 세로실 간격을 따릅니다.
      const len = (usableW / (row.warp - 1)) * 0.62;
      const age = 0.35 + 0.65 * (1 - k / n);
      ctx.lineWidth = this.widthOf[k];
      ctx.beginPath();
      // 행마다 한 칸씩 어긋나게 찍어 평직의 결이 생깁니다.
      for (let i = k % 2; i < row.warp; i += 2) {
        const idx = k * MAX_WARP + i;
        ctx.moveTo(this.gx[idx] - len / 2, this.gy[idx]);
        ctx.lineTo(this.gx[idx] + len / 2, this.gy[idx]);
      }
      ctx.strokeStyle = toneCol(input.roles, WEFT_TONE, this.lvOf[k] * age, false);
      ctx.stroke();
    }
  }

  // ── 5) 셀비지(마디 번호) ───────────────────────────────────

  /** `rate × 4` 행마다 왼쪽에 마디 번호, 오른쪽에 시각을 적습니다. */
  private drawSelvage(
    f: SceneFrame,
    n: number,
    w: number,
    padX: number,
    rate: number,
  ): void {
    const { ctx } = f;
    ctx.font = '9px ui-monospace, monospace';
    ctx.textBaseline = 'middle';

    for (let k = 0; k < n; k += Math.max(1, Math.round(rate)) * 4) {
      const row = this.rows[n - 1 - k];
      const idx = k * MAX_WARP;
      const y = this.gy[idx];
      ctx.fillStyle = `rgba(${SELVAGE_RGB}, ${clamp(0.85 - (k / n) * 0.6, 0, 1)})`;

      ctx.textAlign = 'right';
      ctx.fillText(String(row.bar).padStart(3, '0'), padX - 3, y);

      ctx.textAlign = 'left';
      const m = Math.floor(row.t / 60);
      const sec = Math.floor(row.t % 60);
      ctx.fillText(`${m}:${String(sec).padStart(2, '0')}`, w - padX + 3, y);
    }
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  // ── 6) 직구 빔 라인 ────────────────────────────────────────

  /** 지금 실이 짜이고 있는 자리를 표시합니다. */
  private drawBeam(
    f: SceneFrame,
    w: number,
    h: number,
    padY: number,
    ch: number,
  ): void {
    const { ctx, input } = f;
    const y = h - padY + ch * 0.55;
    ctx.lineWidth = 1;
    ctx.strokeStyle =
      this.flash > 0.2
        ? withAlpha(input.roles.hot, 0.35)
        : `rgba(${BEAM_RGB}, 0.35)`;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // ── 대기 화면 ─────────────────────────────────────────────

  /** 행이 두 개 미만이면 빈 베틀입니다. 세로실만 가늘게 세워 둡니다. */
  private drawEmptyLoom(
    f: SceneFrame,
    padX: number,
    padY: number,
    usableH: number,
    cw: number,
    warp: number,
  ): void {
    const { ctx, input } = f;
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = withAlpha(input.roles.base, 0.14);
    ctx.beginPath();
    for (let i = 0; i < warp; i += 1) {
      const x = padX + i * cw;
      ctx.moveTo(x, padY);
      ctx.lineTo(x, padY + usableH);
    }
    ctx.stroke();
  }
}
