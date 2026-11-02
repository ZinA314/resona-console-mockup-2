/**
 * 출력 창으로 상태를 보냅니다 (F-506).
 *
 * 출력 창은 오디오를 갖고 있지 않습니다. AudioContext 는 콘솔 쪽에만 있으므로
 * 분석값을 통째로 넘겨야 합니다. 매 프레임 2048개짜리 스펙트럼을 보내면
 * 초당 500KB 가 넘어가므로, 표시에 필요한 만큼만 줄여 초당 30회로 보냅니다.
 * 출력 창은 마지막으로 받은 값으로 자기 화면 주기에 맞춰 그립니다.
 */
import type { MusicAnalysis } from '@/lib/types';
import type {
  PaletteRoles,
  SpectrumScale,
  StageSettings,
} from '@/lib/render/types';
import type { SceneParams } from '@/lib/types';
import type {
  AudienceState,
  DirectionParams,
  LyricCue,
  MusicState,
} from '@/lib/types';

/** 관객 격자를 보내지 않을 때 쓰는 빈 배열. */
const EMPTY_FIELD = new Float32Array(0);

/** 로그 재표본이 덮는 범위. 스펙트럼 씬의 가로축과 같아야 합니다. */
const HZ_MIN = 20;
const HZ_MAX = 16000;

export const STAGE_CHANNEL = 'resona-stage';

/** 보내는 스펙트럼과 파형의 길이. 화면 가로 해상도보다 촘촘할 이유가 없습니다. */
export const WIRE_BINS = 256;

export interface StageMessage {
  analysis: MusicAnalysis;
  spectrumScale: SpectrumScale;
  roles: PaletteRoles;
  waveform: Float32Array;
  sampleRate: number;
  audience: number;
  audienceState: AudienceState;
  audienceField: Float32Array;
  audienceLive: boolean;
  params: DirectionParams;
  musicState: MusicState;
  /** `AudioContext.currentTime`. 출력 창은 자기 rAF 로 그리되 시각은 이것을 씁니다. */
  time: number;
  sceneParams: SceneParams;
  /** 가사 큐 (F-602). 출력 창에는 곡의 위치가 없으므로 결과를 실어 보냅니다. */
  lyrics: LyricCue;
  settings: StageSettings;
}

/**
 * 파형을 `WIRE_BINS` 개로 줄입니다.
 * 구간에서 절대값이 가장 큰 표본을 부호째 남겨 봉우리와 골을 함께 살립니다.
 */
function shrinkWaveform(src: Float32Array, out: Float32Array): Float32Array {
  const n = out.length;
  const per = src.length / n;
  for (let i = 0; i < n; i += 1) {
    const lo = Math.floor(i * per);
    const hi = Math.min(src.length, Math.floor((i + 1) * per));
    let acc = src[lo] ?? 0;
    for (let j = lo; j < hi; j += 1) {
      if (Math.abs(src[j]) > Math.abs(acc)) acc = src[j];
    }
    out[i] = acc;
  }
  return out;
}

/**
 * 선형 스펙트럼을 화면 가로축과 같은 로그 간격으로 다시 뜹니다.
 * 구간 최대값을 남겨 봉우리를 살립니다.
 */
function toLogSpectrum(
  src: Float32Array,
  out: Float32Array,
  sampleRate: number,
): Float32Array {
  const bins = src.length;
  if (bins === 0) return out;
  const binHz = sampleRate / 2 / bins;
  const logMin = Math.log10(HZ_MIN);
  const logMax = Math.log10(HZ_MAX);
  const n = out.length;

  for (let i = 0; i < n; i += 1) {
    const hzLo = 10 ** (logMin + ((logMax - logMin) * i) / n);
    const hzHi = 10 ** (logMin + ((logMax - logMin) * (i + 1)) / n);
    const lo = Math.max(1, Math.floor(hzLo / binHz));
    const hi = Math.min(bins, Math.max(lo + 1, Math.ceil(hzHi / binHz)));
    let peak = 0;
    for (let j = lo; j < hi; j += 1) {
      if (src[j] > peak) peak = src[j];
    }
    out[i] = peak;
  }
  return out;
}

/** 콘솔 쪽. 초당 30회로 제한해 보냅니다. */
export class StageBroadcaster {
  private channel: BroadcastChannel | null = null;
  private last = 0;
  private spectrum = new Float32Array(WIRE_BINS);
  private waveform = new Float32Array(WIRE_BINS);

  open(): void {
    if (this.channel || typeof BroadcastChannel === 'undefined') return;
    this.channel = new BroadcastChannel(STAGE_CHANNEL);
  }

  close(): void {
    this.channel?.close();
    this.channel = null;
  }

  /** @param now `AudioContext.currentTime`. rAF 가 아니라 오디오 시계입니다. */
  send(now: number, message: StageMessage): void {
    if (!this.channel) return;
    if (now - this.last < 1 / 30) return;
    this.last = now;

    const a = message.analysis;
    const payload: StageMessage = {
      analysis: {
        ...a,
        // 원본은 그대로 두고 줄인 사본을 보냅니다.
        bands: [...a.bands] as MusicAnalysis['bands'],
        stems: [...a.stems] as MusicAnalysis['stems'],
        stemPeak: [...a.stemPeak] as MusicAnalysis['stemPeak'],
        spectrum: toLogSpectrum(a.spectrum, this.spectrum, message.sampleRate),
      },
      spectrumScale: 'log',
      roles: { ...message.roles },
      waveform: shrinkWaveform(message.waveform, this.waveform),
      sampleRate: message.sampleRate,
      audience: message.audience,
      audienceState: message.audienceState,
      // 격자는 2,304칸이라 관객 씬을 그릴 때만 보냅니다.
      // 합성 씬은 격자를 겹치지 않습니다. 관객은 그 씬에도 값으로만 들어오고,
      // 바탕이 되는 씬이 이미 `expansion` 으로 관객을 받고 있습니다.
      audienceField:
        message.settings.scene === 'faces' ? message.audienceField : EMPTY_FIELD,
      audienceLive: message.audienceLive,
      params: {
        ...message.params,
        musicOnly: { ...message.params.musicOnly },
      },
      musicState: message.musicState,
      time: message.time,
      sceneParams: {
        common: { ...message.sceneParams.common },
        weave: { ...message.sceneParams.weave },
        bloom: { ...message.sceneParams.bloom },
        composite: { ...message.sceneParams.composite },
      },
      // 줄 객체는 그대로 실어 보냅니다. 구조적 복제가 알아서 사본을 만들고,
      // 두 줄이면 몇백 바이트라 초당 30회에도 부담이 없습니다.
      lyrics: { ...message.lyrics },
      settings: { ...message.settings },
    };

    try {
      this.channel.postMessage(payload);
    } catch {
      // 창이 닫히는 중이면 실패할 수 있습니다. 화면을 멈추게 하지 않습니다.
    }
  }
}

/** 출력 창 쪽. 마지막으로 받은 값을 들고 있습니다. */
export function subscribeStage(
  onMessage: (m: StageMessage) => void,
): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const channel = new BroadcastChannel(STAGE_CHANNEL);
  channel.onmessage = (e: MessageEvent<StageMessage>) => {
    try {
      onMessage(e.data);
    } catch (err) {
      console.error('[stage] 수신 처리에서 오류가 났습니다.', err);
    }
  };
  return () => channel.close();
}
