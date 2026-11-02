/**
 * 스펙트럼 (SPECTRUM). `docs/03-screens.md` 4절.
 *
 * 주파수 스펙트럼을 가로축에 로그 스케일로 펼치고, 6밴드 경계에 눈금을
 * 긋습니다. 아래에는 파형을 겹칩니다. 진단 목적이 커서 먼저 만들면
 * 다른 씬을 볼 때 기준이 됩니다.
 */
import { clamp } from '@/lib/util';
import { withAlpha } from '@/lib/render/palette';
import type { Scene, SceneFrame } from '@/lib/render/types';

/** 가로축이 덮는 범위. 20Hz 아래와 16kHz 위는 볼 것이 없습니다. */
const HZ_MIN = 20;
const HZ_MAX = 16000;

/** 6밴드 경계. `05-signal-processing.md` 2-5절의 표와 같습니다. */
const BAND_EDGES: ReadonlyArray<[number, string]> = [
  [20, 'SUB'],
  [60, 'LOW'],
  [250, 'LMID'],
  [500, 'MID'],
  [2000, 'HI'],
  [6000, 'AIR'],
  [16000, ''],
];

/** 파형이 차지하는 아래쪽 높이 비율. */
const WAVE_AREA = 0.28;

export class SpectrumScene implements Scene {
  reset(): void {
    // 쌓아 두는 상태가 없습니다.
  }

  draw(f: SceneFrame): void {
    const { ctx, w, h, tokens, input } = f;
    const a = input.analysis;
    // 데이터를 그리는 색은 팔레트에서, 눈금과 글자는 콘솔 토큰에서 옵니다.
    // 눈금이 곡마다 색을 바꾸면 값을 읽기 어려워집니다 (03-screens 2절).
    const roles = input.roles;
    // 밝기는 연출 파라미터에서 옵니다. 값이 0 이어도 눈금은 읽혀야 하므로
    // 바닥을 둡니다.
    const intensity =
      clamp(0.35 + input.params.brightness * 1.1, 0.35, 2) * input.settings.intensity;

    const specH = h * (1 - WAVE_AREA);
    const nyquist = input.sampleRate / 2;
    const bins = a.spectrum.length;
    const binHz = bins > 0 ? nyquist / bins : 0;

    const logMin = Math.log10(HZ_MIN);
    const logMax = Math.log10(HZ_MAX);
    const xOf = (hz: number) =>
      ((Math.log10(clamp(hz, HZ_MIN, HZ_MAX)) - logMin) / (logMax - logMin)) * w;

    // ── 6밴드 경계 눈금 ──
    ctx.font = '9px ui-monospace, monospace';
    ctx.textBaseline = 'top';
    for (let i = 0; i < BAND_EDGES.length; i += 1) {
      const [hz, label] = BAND_EDGES[i];
      const x = xOf(hz);
      ctx.fillStyle = withAlpha(tokens.rule, 0.9);
      ctx.fillRect(x, 0, 1, specH);
      if (label) {
        // 밴드 이름은 그 구간의 왼쪽 끝에 붙입니다.
        ctx.fillStyle = withAlpha(tokens.dim, 0.85);
        ctx.fillText(label, x + 3, 4);
        const level = clamp(a.bands[i], 0, 1);
        if (level > 0.02) {
          // 밴드 값을 구간 위쪽에 짧은 막대로 겹칩니다.
          const next = xOf(BAND_EDGES[i + 1]?.[0] ?? HZ_MAX);
          ctx.fillStyle = withAlpha(roles.accent, level * 0.3 * intensity);
          ctx.fillRect(x + 1, 0, Math.max(1, next - x - 2), 3 + level * 10);
        }
      }
    }

    // ── 스펙트럼 ──
    if (bins > 0 && (binHz > 0 || input.spectrumScale === 'log')) {
      ctx.beginPath();
      ctx.moveTo(0, specH);
      let prevX = -1;
      for (let i = 1; i < bins; i += 1) {
        // 출력 창으로 온 배열은 이미 화면 축과 같은 로그 간격입니다.
        const x =
          input.spectrumScale === 'log' ? (i / (bins - 1)) * w : xOf(i * binHz);
        if (input.spectrumScale === 'linear') {
          const hz = i * binHz;
          if (hz < HZ_MIN) continue;
          if (hz > HZ_MAX) break;
        }
        // 로그 축에서는 고역의 빈이 한 픽셀에 여럿 몰립니다. 같은 열은 건너뜁니다.
        if (x - prevX < 0.5) continue;
        prevX = x;
        const v = clamp(a.spectrum[i] * intensity, 0, 1);
        ctx.lineTo(x, specH - v * specH * 0.92);
      }
      ctx.lineTo(w, specH);
      ctx.closePath();
      ctx.fillStyle = withAlpha(roles.base, 0.16);
      ctx.fill();
      ctx.strokeStyle = withAlpha(roles.base, 0.75);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // ── 아래에 파형 ──
    const wave = input.waveform;
    if (wave.length > 1) {
      const mid = specH + (h - specH) / 2;
      const amp = (h - specH) * 0.42;
      ctx.strokeStyle = withAlpha(roles.base, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < w; x += 1) {
        const idx = Math.min(wave.length - 1, Math.floor((x / w) * wave.length));
        const y = mid - clamp(wave[idx], -1, 1) * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.fillStyle = withAlpha(tokens.rule, 0.8);
      ctx.fillRect(0, specH, w, 1);
    }
  }
}
