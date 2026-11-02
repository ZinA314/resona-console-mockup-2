/**
 * 관객 (FACES). `docs/03-screens.md` 4절.
 *
 * 관객 입력을 그대로 보여 주는 씬입니다. 카메라 방식이면 64×36 격자를 밝기
 * 타일로 그립니다. 신호가 없으면 안내 문구를 중앙에 적습니다.
 *
 * 격자는 이미 원본을 버리고 남은 변화량입니다. 사람의 형상이 아니라 어디가
 * 움직였는지만 보입니다.
 */
import { clamp } from '@/lib/util';
import { withAlpha } from '@/lib/render/palette';
import { FIELD_H, FIELD_W } from '@/lib/audience/types';
import type { Scene, SceneFrame } from '@/lib/render/types';

const NO_SIGNAL = '관객 신호 없음 — 카메라를 연결하거나 시뮬을 켜세요';

/** 타일 사이 틈. 격자가 한 덩어리로 보이지 않게 합니다. */
const GAP = 0.14;

export class FacesScene implements Scene {
  reset(): void {
    // 쌓아 두는 상태가 없습니다.
  }

  draw(f: SceneFrame): void {
    const { ctx, w, h, tokens, input } = f;

    if (!input.audienceLive) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = withAlpha(tokens.dim, 0.9);
      ctx.font = '13px ui-monospace, monospace';
      ctx.fillText(NO_SIGNAL, w / 2, h / 2);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
      return;
    }

    const field = input.audienceField;
    const p = input.params;
    const intensity =
      clamp(0.4 + p.brightness * 1.2, 0.4, 2) * input.settings.intensity;
    // 객석이 뜨거워지면 타일이 바깥으로 퍼져 나갑니다.
    const spread = 1 + p.expansion * 0.12;

    // 격자 비율을 지키며 화면에 맞춥니다.
    const cell = Math.min(w / FIELD_W, h / FIELD_H) * spread;
    const gridW = cell * FIELD_W;
    const gridH = cell * FIELD_H;
    const ox = (w - gridW) / 2;
    const oy = (h - gridH) / 2;
    const size = cell * (1 - GAP);
    const inset = cell * GAP * 0.5;

    if (field.length >= FIELD_W * FIELD_H) {
      for (let y = 0; y < FIELD_H; y += 1) {
        for (let x = 0; x < FIELD_W; x += 1) {
          // 변화량은 작은 값이라 그대로 그리면 보이지 않습니다.
          const v = clamp(field[y * FIELD_W + x] * 6 * intensity, 0, 1);
          if (v <= 0.02) continue;
          ctx.fillStyle = withAlpha(input.roles.accent, v);
          ctx.fillRect(ox + x * cell + inset, oy + y * cell + inset, size, size);
        }
      }
    }

    // 전체 에너지를 아래쪽 띠로 겹쳐 격자와 값이 함께 읽히게 합니다.
    const energy = clamp(input.audience, 0, 1);
    if (energy > 0.01) {
      const barH = Math.max(2, h * 0.012);
      ctx.fillStyle = withAlpha(input.roles.accent, 0.65);
      ctx.fillRect(ox, oy + gridH + barH, gridW * energy, barH);
    }
  }
}
