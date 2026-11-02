'use client';

/**
 * 송출 채널 (F-802). `docs/02-features.md` 의 표 그대로입니다.
 *
 * 원본 프로토타입(`resona.html`)의 `CHAN` 을 옮겼습니다. 꼴은 같습니다 —
 * `[경로, 값을 꺼내는 함수, 소수 자릿수]`. 다만 **무엇을 내보내는가가
 * 다릅니다.**
 *
 * 원본은 `/resona/face/count` 와 `/resona/face/max` 로 관객 카메라의 날값을
 * 보냈습니다. 이 프로젝트에서 관객은 0~1 로 정규화되어 연출을 증폭하는
 * 값이고, 그 결과가 `DirectionParams` 입니다. 얼굴 수를 그대로 보내면 받는
 * 쪽이 연출을 다시 계산하게 되고, 결합 규칙이 `lib/direction/translate.ts`
 * 한 곳에만 있어야 한다는 이 프로젝트의 원칙이 무대 밖에서 깨집니다.
 *
 * `/resona/lyric/index` 도 이름을 바꿨습니다. 원본은 배열 번호였는데 우리
 * 큐에는 시각 미정 줄이 섞이므로, 시각이 붙은 줄만 센 `ordinal` 을 씁니다.
 */
import type { SceneInput } from '@/lib/render/types';
import { BAND, STEM } from '@/lib/types';

/** 채널이 값을 꺼낼 때 보는 것. */
export interface RoutingContext {
  input: SceneInput;
  /** 곡 안의 위치(초). `SceneInput.time` 은 AudioContext 시각이라 다릅니다. */
  trackTime: number;
  /** 관객 영향력 0~1 (F-403). */
  influence: number;
  /** 관객 보정 0~1. */
  calibration: number;
}

/** `[경로, 값, 소수 자릿수]`. 자릿수가 `null` 이면 문자열입니다. */
export type Channel = readonly [
  path: string,
  get: (c: RoutingContext) => number | string,
  digits: number | null,
];

/** 표를 접었다 펴는 단위. `03-screens.md` 10 절. */
export interface ChannelGroup {
  label: string;
  channels: Channel[];
}

export const CHANNEL_GROUPS: ChannelGroup[] = [
  {
    label: '시간·박자',
    channels: [
      ['/resona/time', (c) => c.trackTime, 3],
      ['/resona/bpm', (c) => c.input.analysis.bpm, 2],
      ['/resona/bpm_conf', (c) => c.input.analysis.bpmConf, 3],
      ['/resona/beat', (c) => c.input.analysis.beat, 0],
      ['/resona/bar', (c) => c.input.analysis.bar, 0],
      ['/resona/beat_in_bar', (c) => c.input.analysis.beatInBar, 0],
      ['/resona/phase', (c) => c.input.analysis.phase, 3],
    ],
  },
  {
    label: '음량·음색',
    channels: [
      ['/resona/rms', (c) => c.input.analysis.rms, 3],
      ['/resona/peak', (c) => c.input.analysis.peak, 3],
      ['/resona/flux', (c) => c.input.analysis.flux, 3],
      ['/resona/centroid', (c) => c.input.analysis.centroid, 0],
      ['/resona/onset', (c) => c.input.analysis.onset, 0],
      ['/resona/onset_pulse', (c) => c.input.analysis.onsetPulse, 3],
      ['/resona/transition_pulse', (c) => c.input.analysis.transitionPulse, 3],
    ],
  },
  {
    label: '밴드',
    channels: [
      ['/resona/band/sub', (c) => c.input.analysis.bands[BAND.SUB], 3],
      ['/resona/band/low', (c) => c.input.analysis.bands[BAND.LOW], 3],
      ['/resona/band/lmid', (c) => c.input.analysis.bands[BAND.LMID], 3],
      ['/resona/band/mid', (c) => c.input.analysis.bands[BAND.MID], 3],
      ['/resona/band/hi', (c) => c.input.analysis.bands[BAND.HI], 3],
      ['/resona/band/air', (c) => c.input.analysis.bands[BAND.AIR], 3],
    ],
  },
  {
    label: '스템',
    channels: [
      ['/resona/stem/drums', (c) => c.input.analysis.stems[STEM.DRUMS], 3],
      ['/resona/stem/bass', (c) => c.input.analysis.stems[STEM.BASS], 3],
      ['/resona/stem/vocal', (c) => c.input.analysis.stems[STEM.VOCAL], 3],
      ['/resona/stem/other', (c) => c.input.analysis.stems[STEM.OTHER], 3],
    ],
  },
  {
    label: '곡 성격',
    channels: [
      ['/resona/state', (c) => c.input.musicState, null],
      ['/resona/mood/valence', (c) => c.input.params.mood.valence, 3],
      ['/resona/mood/arousal', (c) => c.input.params.mood.arousal, 3],
      ['/resona/mood/conf', (c) => c.input.params.mood.chromaConf, 3],
      ['/resona/mood/name', (c) => c.input.params.mood.name, null],
    ],
  },
  {
    label: '관객',
    channels: [
      ['/resona/audience', (c) => c.input.audience, 3],
      ['/resona/audience/state', (c) => c.input.audienceState, null],
      ['/resona/audience/calibration', (c) => c.calibration, 3],
      ['/resona/influence', (c) => c.influence, 3],
    ],
  },
  {
    /*
     * **이 묶음이 이 기능의 핵심입니다.** 원본에는 아예 없었습니다.
     * 관객 입력을 꺼도 계속 나갑니다 — 관객은 증폭기이지 전제 조건이
     * 아니므로, 음악만으로도 연출값은 성립합니다.
     */
    label: '연출',
    channels: [
      ['/resona/dir/density', (c) => c.input.params.density, 3],
      ['/resona/dir/scale', (c) => c.input.params.scale, 3],
      ['/resona/dir/speed', (c) => c.input.params.speed, 3],
      ['/resona/dir/brightness', (c) => c.input.params.brightness, 3],
      ['/resona/dir/expansion', (c) => c.input.params.expansion, 3],
      ['/resona/dir/glitch', (c) => c.input.params.glitch, 3],
      ['/resona/dir/dreaminess', (c) => c.input.params.dreaminess, 3],
    ],
  },
  {
    label: '색',
    channels: [
      ['/resona/palette/bg', (c) => c.input.roles.bg, null],
      ['/resona/palette/deep', (c) => c.input.roles.deep, null],
      ['/resona/palette/base', (c) => c.input.roles.base, null],
      ['/resona/palette/accent', (c) => c.input.roles.accent, null],
      ['/resona/palette/hot', (c) => c.input.roles.hot, null],
      // 원본에서 색을 각도 하나로 받던 연동을 위해 남겨 둔 자리입니다.
      ['/resona/hue', (c) => c.input.params.hue, 4],
    ],
  },
  {
    label: '가사',
    channels: [
      ['/resona/lyric/ordinal', (c) => c.input.lyrics.ordinal, 0],
      ['/resona/lyric/total', (c) => c.input.lyrics.total, 0],
      ['/resona/lyric/prog', (c) => c.input.lyrics.progress, 3],
      ['/resona/lyric/line', (c) => c.input.lyrics.line?.text ?? '', null],
      ['/resona/lyric/next', (c) => c.input.lyrics.next?.text ?? '', null],
      [
        '/resona/lyric/word',
        (c) => {
          const l = c.input.lyrics;
          return l.line && l.word >= 0 ? (l.line.words[l.word] ?? '') : '';
        },
        null,
      ],
    ],
  },
  {
    label: '화면',
    channels: [
      ['/resona/scene', (c) => c.input.settings.scene, null],
      ['/resona/blackout', (c) => (c.input.settings.blackout ? 1 : 0), 0],
    ],
  },
];

export const CHANNELS: Channel[] = CHANNEL_GROUPS.flatMap((g) => g.channels);

/** 채널 하나를 읽어 형식에 맞게 다듬습니다. 던지지 않습니다. */
export function readChannel(ch: Channel, c: RoutingContext): number | string {
  try {
    const v = ch[1](c);
    if (typeof v !== 'number') return v;
    if (!Number.isFinite(v)) return 0;
    return ch[2] === null ? v : Number(v.toFixed(ch[2]));
  } catch {
    // 값 하나가 실패해도 나머지는 나가야 합니다.
    return ch[2] === null ? '' : 0;
  }
}

/**
 * JSON 형식. 경로의 `/resona/` 를 떼고 나머지 `/` 를 `_` 로 바꿉니다.
 * 원본과 같은 규칙이라, 원본에 붙여 두었던 연동이 그대로 받습니다.
 */
export function toJson(c: RoutingContext): Record<string, number | string> {
  const o: Record<string, number | string> = {};
  for (const ch of CHANNELS) {
    o[ch[0].replace('/resona/', '').replace(/\//g, '_')] = readChannel(ch, c);
  }
  return o;
}

/** OSC 스타일 평문. `경로 값` 을 줄바꿈으로 잇습니다. */
export function toOsc(c: RoutingContext): string {
  const out: string[] = [];
  for (const ch of CHANNELS) {
    const v = readChannel(ch, c);
    out.push(`${ch[0]} ${typeof v === 'number' ? v.toFixed(ch[2] ?? 4) : v}`);
  }
  return out.join('\n');
}
