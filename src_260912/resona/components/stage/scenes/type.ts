/**
 * 가사 (TYPE). `docs/03-screens.md` 4절.
 *
 * 현재 가사를 화면 중앙에 큰 활자로 놓고, 진행률에 따라 단어를 하나씩
 * 밝힙니다. 온셋이 오면 활자가 미세하게 흔들리고, 관객 에너지는 활자 크기에
 * 반영됩니다.
 *
 * 그리는 일은 `LyricLayer` 가 합니다. 합성 씬과 같은 코드를 크기와 자리만
 * 바꿔 쓰기 위해서입니다.
 */
import { LyricLayer, type LyricStyle } from '@/components/stage/scenes/lyrics';
import type { Scene, SceneFrame } from '@/lib/render/types';
import { clamp } from '@/lib/util';

/**
 * 화면 높이에 대한 활자 크기. 1080 에서 약 140px 입니다.
 * `03-screens.md` 에 수치가 정해져 있지 않아 화면을 보고 잡았습니다.
 */
const SIZE = 0.13;

const STYLE: LyricStyle = {
  size: SIZE,
  y: 0.46,
  maxWidth: 0.82,
  maxRows: 3,
  alpha: 1,
  // 검은 바탕이라 아직 안 부른 단어를 많이 눌러도 읽힙니다.
  pending: 0.34,
  // 검은 바탕이라 번짐이 필요 없습니다. 합성 씬만 켭니다.
  shadow: false,
  showNext: true,
  emptyNote: true,
};

export class TypeScene implements Scene {
  private layer = new LyricLayer();
  private style: LyricStyle = { ...STYLE };

  reset(): void {
    this.layer.reset();
  }

  draw(f: SceneFrame): void {
    this.style.alpha = clamp(f.input.settings.intensity, 0, 1);
    this.layer.draw(f, this.style);
  }
}
