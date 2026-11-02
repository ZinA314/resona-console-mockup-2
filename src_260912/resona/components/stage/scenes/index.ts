/** 씬 여섯 가지. `03-screens.md` 4절. */
import { BloomScene } from '@/components/stage/scenes/bloom';
import { CompositeScene } from '@/components/stage/scenes/composite';
import { FacesScene } from '@/components/stage/scenes/faces';
import { SpectrumScene } from '@/components/stage/scenes/spectrum';
import { TypeScene } from '@/components/stage/scenes/type';
import { WeaveScene } from '@/components/stage/scenes/weave';
import type { Scene } from '@/lib/render/types';
import type { SceneKind } from '@/lib/types';

export function createScenes(): Record<SceneKind, Scene> {
  const bloom = new BloomScene();
  return {
    weave: new WeaveScene(),
    spectrum: new SpectrumScene(),
    faces: new FacesScene(),
    bloom,
    type: new TypeScene(),
    // 합성의 바탕은 07 패널에서 고릅니다. 직조를 바탕으로 쓸 때는 셀비지와
    // 빔 라인을 뺍니다 — 진단용 글자·눈금이라 무대에 걸 그림이 아닙니다.
    composite: new CompositeScene(new WeaveScene(false), bloom),
  };
}
