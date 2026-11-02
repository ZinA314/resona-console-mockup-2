/**
 * 가사 층. 가사 씬(TYPE)과 합성 씬(COMPOSITE)이 함께 씁니다.
 * `docs/03-screens.md` 4절.
 *
 * 두 씬이 같은 그림을 크기와 자리만 바꿔 씁니다. 각자 그리게 두면 한쪽만
 * 고쳐져 "합성에서만 단어가 안 밝아진다" 같은 일이 생깁니다.
 *
 * **색은 `accent` 와 `hot` 둘뿐입니다.** 이미 부른 단어와 아직 안 부른 단어는
 * `accent` 의 불투명도로 가르고, 지금 부르는 단어만 `hot` 으로 밝힙니다.
 */
import { withAlpha } from '@/lib/render/palette';
import type { SceneFrame } from '@/lib/render/types';
import { clamp } from '@/lib/util';

/**
 * 글자 폭을 재는 기준 크기(px).
 *
 * 활자 크기는 관객 에너지를 타고 매 프레임 바뀝니다. 그때마다 `measureText`
 * 를 부르면 줄 하나에 열댓 번씩 폰트 셰이핑이 돌아 프레임을 먹습니다. 한 번만
 * 재 두고 비례로 늘립니다 — 같은 글꼴에서는 폭이 크기에 정비례합니다.
 */
const REF_PX = 100;

/** 한글이 섞인 곡이 많아 압축체 뒤에 시스템 산세리프를 받쳐 둡니다. */
const FALLBACK_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif';

let cachedFamily: string | null = null;

/**
 * 콘솔이 쓰는 압축체를 캔버스에서도 씁니다. `globals.css` 를 유일한 출처로
 * 두려는 것이라 `readConsoleColors()` 와 같은 방식입니다.
 */
function lyricFamily(): string {
  if (cachedFamily !== null) return cachedFamily;
  if (typeof window === 'undefined') return FALLBACK_FAMILY;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue('--font-condensed')
    .trim();
  cachedFamily = v.length > 0 ? `${v}, ${FALLBACK_FAMILY}` : FALLBACK_FAMILY;
  return cachedFamily;
}

export interface LyricStyle {
  /** 현재 줄의 글자 크기. 화면 높이에 대한 비율 */
  size: number;
  /** 현재 줄 덩어리의 세로 중심 0~1 */
  y: number;
  /** 글자가 쓸 수 있는 가로 폭. 화면 폭에 대한 비율 */
  maxWidth: number;
  /** 현재 줄이 접힐 수 있는 최대 줄 수. 넘으면 활자를 줄입니다 */
  maxRows: number;
  /** 층 전체의 불투명도. 합성 씬은 바탕을 가리지 않게 낮춥니다 */
  alpha: number;
  /** 글자 뒤에 어두운 번짐을 깝니다. 바탕 위에 얹을 때만 켭니다 */
  shadow: boolean;
  /**
   * 아직 부르지 않은 단어의 불투명도 (0~1, `accent` 에 곱합니다).
   *
   * 이 값이 낮을수록 "단어가 하나씩 밝아진다" 가 또렷해지지만, 바탕이 있는
   * 화면에서는 글자가 묻힙니다. 그래서 씬마다 다르게 잡습니다.
   */
  pending: number;
  /** 다음 줄을 아래에 작게 보여 줄지 */
  showNext: boolean;
  /** 가사가 아예 없을 때 안내를 띄울지. 가사 씬만 켭니다 */
  emptyNote: boolean;
}

/** 한 번 재 둔 줄 하나의 폭. 기준 크기 `REF_PX` 에서의 값입니다. */
interface Measured {
  text: string;
  words: string[];
  /** 단어별 폭 */
  widths: number[];
  /** 공백 한 칸의 폭 */
  space: number;
}

/** 접힌 결과 한 줄. `[시작 단어, 끝 단어), 폭] */
interface Row {
  from: number;
  to: number;
  width: number;
}

/**
 * 가사 층 하나. 씬마다 하나씩 들고 있습니다.
 * 잰 값을 캐시하므로 상태가 있고, 그래서 함수가 아니라 클래스입니다.
 */
export class LyricLayer {
  private measured: Measured | null = null;
  private measuredKey = '';
  private nextMeasured: Measured | null = null;
  private nextKey = '';

  reset(): void {
    this.measured = null;
    this.measuredKey = '';
    this.nextMeasured = null;
    this.nextKey = '';
  }

  /** 기준 크기에서 단어 폭을 잽니다. 줄이 바뀔 때만 돕니다. */
  private measure(
    ctx: CanvasRenderingContext2D,
    text: string,
    words: string[],
  ): Measured {
    ctx.font = `600 ${REF_PX}px ${lyricFamily()}`;
    const widths = words.map((word) => ctx.measureText(word).width);
    return { text, words, widths, space: ctx.measureText(' ').width };
  }

  /**
   * 단어를 폭에 맞춰 접습니다. 잰 값이 있으므로 산술만 합니다.
   * 한 단어가 통째로 폭을 넘으면 그 줄에 혼자 둡니다 — 글자 단위로 자르면
   * 단어 강조가 어긋납니다.
   */
  private wrap(m: Measured, scale: number, maxWidth: number): Row[] {
    const rows: Row[] = [];
    const space = m.space * scale;
    let from = 0;
    let width = 0;
    for (let i = 0; i < m.words.length; i += 1) {
      const w = m.widths[i] * scale;
      const add = i === from ? w : width + space + w;
      if (i > from && add > maxWidth) {
        rows.push({ from, to: i, width });
        from = i;
        width = w;
      } else {
        width = add;
      }
    }
    if (m.words.length > 0) rows.push({ from, to: m.words.length, width });
    return rows;
  }

  draw(f: SceneFrame, style: LyricStyle): void {
    const { ctx, w, h, input } = f;
    const cue = input.lyrics;
    const roles = input.roles;
    const alpha = clamp(style.alpha, 0, 1);
    if (alpha <= 0.01) return;

    if (cue.total === 0) {
      if (style.emptyNote) this.drawNote(f);
      return;
    }

    // 아직 첫 줄 전이면 다음 줄만 보여 줍니다. 검은 화면보다 낫습니다.
    const current = cue.line ?? cue.next;
    const showingNext = cue.line === null;
    if (!current) return;

    /*
     * 활자 크기에 관객이 들어오는 자리입니다 (03-screens 가사 절).
     * 관객 에너지를 직접 읽지 않고 `scale` 을 씁니다 — 그 값이 이미 6-3절의
     * 증폭을 지나온 것이고, 관객이 곱해지는 자리는 `translate.ts` 한 곳뿐입니다.
     */
    const px = h * style.size * (0.85 + input.params.scale * 0.35);
    const maxWidth = w * style.maxWidth;

    // 온셋에 미세하게 흔듭니다. 진폭은 글자 크기의 4% 를 넘지 않습니다.
    const shake = input.analysis.onsetPulse * px * 0.04;
    const sx = Math.sin(f.time * 37.1) * shake;
    const sy = Math.cos(f.time * 53.7) * shake;

    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    if (style.shadow) {
      // 바탕 위에 얹을 때만. 불투명한 판을 깔면 바탕을 가립니다.
      ctx.shadowColor = 'rgba(0,0,0,0.85)';
      ctx.shadowBlur = px * 0.28;
    }

    // 접었을 때 줄 수가 많으면 활자를 줄여 다시 접습니다.
    const key = `${current.text}|${w}`;
    if (this.measuredKey !== key) {
      this.measured = this.measure(ctx, current.text, current.words);
      this.measuredKey = key;
    }
    const m = this.measured!;
    let fontPx = px;
    let rows = this.wrap(m, fontPx / REF_PX, maxWidth);
    let guard = 0;
    while (rows.length > style.maxRows && guard < 8) {
      fontPx *= 0.86;
      rows = this.wrap(m, fontPx / REF_PX, maxWidth);
      guard += 1;
    }

    const lineH = fontPx * 1.16;
    const cy = h * style.y + sy;
    const top = cy - ((rows.length - 1) * lineH) / 2;

    ctx.font = `600 ${fontPx}px ${lyricFamily()}`;
    const scale = fontPx / REF_PX;
    const space = m.space * scale;
    // 첫 줄이 시작하기 전이면 다음 줄을 미리 보여 주는 것이라 눌러 둡니다.
    const bodyAlpha = alpha * (showingNext ? 0.45 : 1);

    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r];
      let x = w / 2 - row.width / 2 + sx;
      const y = top + r * lineH;
      for (let i = row.from; i < row.to; i += 1) {
        const done = !showingNext && i < cue.word;
        const now = !showingNext && i === cue.word;
        if (now) {
          ctx.fillStyle = withAlpha(roles.hot, bodyAlpha);
        } else {
          // 아직 안 부른 단어는 눌러 둡니다. 부른 단어는 그대로 남습니다.
          ctx.fillStyle = withAlpha(
            roles.accent,
            bodyAlpha * (done ? 0.92 : style.pending),
          );
        }
        ctx.fillText(m.words[i], x, y);
        x += m.widths[i] * scale + space;
      }
    }

    // 다음 줄. 지금 줄 아래에 작게 깝니다.
    if (style.showNext && !showingNext && cue.next && cue.next.text.length > 0) {
      const nkey = `${cue.next.text}|${w}`;
      if (this.nextKey !== nkey) {
        this.nextMeasured = this.measure(ctx, cue.next.text, cue.next.words);
        this.nextKey = nkey;
      }
      const nm = this.nextMeasured!;
      const nPx = fontPx * 0.52;
      const nRows = this.wrap(nm, nPx / REF_PX, maxWidth);
      ctx.font = `600 ${nPx}px ${lyricFamily()}`;
      const nScale = nPx / REF_PX;
      const nSpace = nm.space * nScale;
      const nTop = top + (rows.length - 1) * lineH + lineH * 0.92;
      // 다음 줄이 다가올수록 밝아집니다. 넘어갈 자리를 미리 보여 줍니다.
      const near = alpha * (0.2 + cue.progress * 0.22);
      ctx.fillStyle = withAlpha(roles.accent, near);
      for (let r = 0; r < nRows.length; r += 1) {
        const row = nRows[r];
        let x = w / 2 - row.width / 2 + sx;
        const y = nTop + r * nPx * 1.16;
        for (let i = row.from; i < row.to; i += 1) {
          ctx.fillText(nm.words[i], x, y);
          x += nm.widths[i] * nScale + nSpace;
        }
      }
    }

    ctx.restore();
  }

  /** 가사가 없을 때. 관객 씬의 안내와 같은 자리, 같은 톤입니다. */
  private drawNote(f: SceneFrame): void {
    const { ctx, w, h, tokens } = f;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = withAlpha(tokens.dim, 0.75);
    ctx.font = '13px ui-monospace, monospace';
    ctx.fillText('가사 없음 — 03 가사 큐에 LRC 파일을 놓으십시오', w / 2, h / 2);
    ctx.restore();
  }
}
