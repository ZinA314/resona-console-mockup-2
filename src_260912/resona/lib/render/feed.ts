'use client';

/**
 * 씬에 넘길 값 한 벌을 만듭니다.
 *
 * 콘솔은 이것을 두 군데서 씁니다. 중앙 무대가 그릴 때와, 출력 창으로 보낼
 * 때입니다. 두 곳이 각자 모으면 한쪽만 고쳐져 화면이 갈립니다.
 *
 * **매 호출마다 같은 객체를 갱신해 돌려줍니다.** 초당 수십 번 도는 자리라
 * 새 객체를 만들면 쓰레기 수집이 프레임을 먹습니다.
 */
import { audienceManager } from '@/lib/audience/manager';
import { audioEngine } from '@/lib/audio/engine';
import { directionManager } from '@/lib/direction/manager';
import { LyricsCursor } from '@/lib/lyrics/cue';
import { MONO_ROLES } from '@/lib/render/palette';
import { useConsoleStore } from '@/lib/store';
import { DEFAULT_SCENE_PARAMS } from '@/lib/types';
import type { SceneInput } from '@/lib/render/types';

/**
 * 가사 커서 (F-602).
 *
 * 곡 안의 위치(`audioEngine.currentTime`)를 씁니다. `SceneInput.time` 은
 * `AudioContext.currentTime` 이라 곡의 위치가 아니므로, 씬 쪽에서 이것을 다시
 * 계산할 방법이 없습니다. 여기서 뽑아 실어 보냅니다.
 */
const cursor = new LyricsCursor();

const input: SceneInput = {
  analysis: audioEngine.analysis,
  spectrumScale: 'linear',
  roles: MONO_ROLES,
  params: directionManager.params,
  musicState: 'SILENT',
  time: 0,
  waveform: new Float32Array(0),
  sampleRate: 44100,
  audience: 0,
  audienceState: 'DORMANT',
  audienceField: audienceManager.field,
  audienceLive: false,
  sceneParams: DEFAULT_SCENE_PARAMS,
  lyrics: cursor.cue,
  settings: {
    scene: 'weave',
    intensity: 1,
    trail: 0.62,
    grain: 0.22,
    glitch: 0.18,
    blackout: false,
  },
};

export function readStageInput(): SceneInput {
  // 구독하지 않고 그 순간의 값을 읽습니다. 매 프레임 리렌더를 피합니다.
  const s = useConsoleStore.getState();
  input.analysis = audioEngine.analysis;
  input.waveform = audioEngine.getWaveform();
  input.sampleRate = audioEngine.sampleRate;
  // 씬의 시각은 `AudioContext.currentTime` 입니다. rAF 로 누적하면 창이
  // 가려진 동안 시간이 멈춰, 다시 열었을 때 그만큼 뒤처집니다.
  input.time = audioEngine.now;
  input.audience = audienceManager.reading.energy;
  input.audienceState = audienceManager.reading.state;
  input.audienceField = audienceManager.field;
  input.audienceLive = audienceManager.hasSignal;
  input.sceneParams = s.sceneParams;
  input.lyrics = cursor.update(
    s.lyrics,
    audioEngine.currentTime,
    audioEngine.duration,
  );
  input.params = directionManager.params;
  input.musicState = directionManager.state;
  input.roles = directionManager.roles;
  input.settings.scene = s.scene;
  input.settings.intensity = s.sceneParams.common.intensity;
  input.settings.trail = s.sceneParams.common.trail;
  input.settings.grain = s.sceneParams.common.grain;
  input.settings.glitch = s.sceneParams.common.glitch;
  input.settings.blackout = s.blackout;
  return input;
}
