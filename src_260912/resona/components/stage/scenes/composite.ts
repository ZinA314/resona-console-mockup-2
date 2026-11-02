/**
 * 합성 (COMPOSITE). `docs/03-screens.md` 4절.
 *
 * 바탕 위에 가사를 얹는 씬입니다. **바탕을 고를 수 있습니다** — 07 씬
 * 파라미터에서 `직조` 와 `무대` 중 하나이고 기본은 `무대` 입니다. 원본
 * 프로토타입은 직조를 바탕으로 썼으므로, 원본과 같은 화면을 보려면 직조로
 * 바꾸면 됩니다.
 *
 * 가사는 팔레트의 `accent` 로 그리고, 지금 부르는 단어만 `hot` 으로 밝힙니다.
 * 가사 씬(TYPE)과 같은 `LyricLayer` 를 크기와 자리만 바꿔 씁니다.
 *
 * **관객 격자를 겹치지 않습니다.** 관객은 이 씬에도 값으로만 들어오고,
 * 바탕이 되는 두 씬이 이미 `expansion` 과 `dreaminess` 로 받고 있습니다.
 * 격자를 한 겹 얹으면 같은 값이 두 번 들어갑니다.
 */
import { LyricLayer, type LyricStyle } from '@/components/stage/scenes/lyrics';
import type { Scene, SceneFrame } from '@/lib/render/types';
import { clamp } from '@/lib/util';

/**
 * 가사를 아래쪽 3분의 1 에 눕히고 활자를 가사 씬의 절반으로 줄입니다.
 * 바탕이 이미 화면을 다 쓰고 있으므로 가운데를 비켜 줍니다. `03-screens.md`
 * 에 수치가 정해져 있지 않아 화면을 보고 잡았습니다.
 */
const STYLE: LyricStyle = {
  size: 0.062,
  y: 0.775,
  maxWidth: 0.78,
  maxRows: 2,
  alpha: 0.92,
  // 아직 안 부른 단어를 가사 씬만큼 누르면 입자에 묻혀 읽히지 않습니다.
  // 화면을 보고 0.34 에서 올렸습니다.
  pending: 0.52,
  // 바탕 위에 얹으므로 어두운 번짐을 깝니다. 불투명한 판을 깔면 바탕을 가립니다.
  shadow: true,
  // 다음 줄은 생략합니다. 바탕이 있는 화면에 글자를 한 덩이 더 얹으면
  // 두 층이 서로를 가립니다.
  showNext: false,
  // 가사가 없으면 아무 말도 하지 않습니다. 바탕이 이미 그려지고 있어
  // 화면이 비어 보이지 않습니다.
  emptyNote: false,
};

export class CompositeScene implements Scene {
  private last: 'weave' | 'bloom' | null = null;
  private layer = new LyricLayer();
  private style: LyricStyle = { ...STYLE };

  constructor(
    private readonly weave: Scene,
    private readonly bloom: Scene,
  ) {}

  reset(): void {
    this.weave.reset();
    this.bloom.reset();
    this.layer.reset();
    this.last = null;
  }

  draw(f: SceneFrame): void {
    const base = f.input.sceneParams.composite.base;
    // 바탕을 바꾸면 앞 바탕이 쌓아 둔 것을 비웁니다.
    if (this.last !== base) {
      this.last = base;
      (base === 'weave' ? this.weave : this.bloom).reset();
    }
    (base === 'weave' ? this.weave : this.bloom).draw(f);
    this.style.alpha = STYLE.alpha * clamp(f.input.settings.intensity, 0, 1);
    this.layer.draw(f, this.style);
  }
}
