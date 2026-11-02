/**
 * 오디오 엔진.
 *
 * `docs/05-signal-processing.md` 1절의 그래프를 만들고, 파일을 디코딩해
 * 재생하며, 매 프레임 RMS 와 피크를 계산합니다.
 *
 *   소스 ─┬─▶ 분석 버스 ─▶ ChannelSplitter ─┬─▶ +0.5 ─┐
 *         │                                │         ├─▶ AnalyserNode(mid)
 *         │                                └─▶ +0.5 ─┘
 *         │                                │
 *         │                                ├─▶ +0.5 ─┐
 *         │                                │         ├─▶ AnalyserNode(side)
 *         │                                └─▶ -0.5 ─┘
 *         └─▶ GainNode(master) ─▶ destination
 *
 * 신호를 먼저 mid / side 로 바꾼 뒤 각각 분석합니다. 좌우를 따로 분석해 크기
 * 스펙트럼끼리 빼면 위상이 반영되지 않아 OTHER 스템이 죽습니다. 2-1절 참고.
 *
 * 분석 버스는 명세의 그래프에 없는 노드입니다. 모노 파일을 그대로 스플리터에
 * 넣으면 오른쪽 출력이 무음이 되어 side 가 mid 와 같아집니다. 2채널로 업믹스만
 * 하는 통과 노드를 하나 두어 막았습니다.
 *
 * 채우는 값은 2절(mid/side · 플럭스 · RMS · 센트로이드 · 6밴드), 3절(온셋 ·
 * 엔벨로프 · BPM · 비트 트래킹), 4절(스템 추정) 전부입니다.
 */
import { clamp, lerp } from '@/lib/util';
import { BAND, type MusicAnalysis } from '@/lib/types';
import { DemoSynth } from '@/lib/audio/demo';
import { OnsetDetector } from '@/lib/audio/onset';
import { StemEstimator, STEM_COEF } from '@/lib/audio/stems';
import { TapTempo, TempoTracker, scaleTempo } from '@/lib/audio/tempo';

/** 48kHz 기준 주파수 해상도 약 11.7Hz. 저역 구분에 필요합니다. */
const FFT_SIZE = 4096;
/** 평활은 상위 단계에서 하므로 여기서는 원값을 씁니다. */
const SMOOTHING = 0.0;
/** 일반적인 공연 음원의 RMS 를 0~1 로 펼치기 위한 배율. */
const RMS_GAIN = 3.2;
const RMS_SMOOTH = 0.35;
/**
 * 상태 판정용 평활 RMS 의 시정수(초). 2-3절.
 * `rms`(40ms)는 킥마다 오르내려 "이 구간이 센가"를 물을 수 없고,
 * `peak`(홀드)는 한 번 세게 친 뒤 내려오지 않습니다. 그 사이 값입니다.
 */
const RMS_SLOW_TAU = 0.4;
/** 피크가 천천히 떨어지게 하는 감쇠 계수. */
const PEAK_DECAY = 0.985;
/** 탐색 막대에 깔 파형 개요의 가로 해상도. */
const PEAK_BUCKETS = 1024;
/** 반복 구간의 최소 길이(초). 이보다 짧으면 되감기만 하다가 소리가 안 납니다. */
const LOOP_MIN = 0.2;
/** 플럭스를 0~1 대역으로 끌어올리기 위한 배율. 2-2절. */
const FLUX_GAIN = 42;
/** 6밴드 정규화 배율과 평활 계수. 2-5절. */
const BAND_GAIN = 1.55;
const BAND_SMOOTH = 0.4;
/** 6밴드 경계. 2-5절의 표 그대로입니다. */
const BAND_HZ: ReadonlyArray<readonly [number, number]> = [
  [20, 60],      // SUB  초저역
  [60, 250],     // LOW  킥과 베이스
  [250, 500],    // LMID 두께
  [500, 2000],   // MID  보컬 기본음
  [2000, 6000],  // HI   명료도, 어택
  [6000, 16000], // AIR  공기감, 심벌
];
/**
 * 온셋 펄스가 사그라지는 시정수(초).
 * 명세에 값이 없어 정했습니다. 5단계의 `glitch` 가 이 값을 읽습니다.
 */
const ONSET_PULSE_TAU = 0.12;

export type SourceKind = 'none' | 'file' | 'mic' | 'demo';

/**
 * 실시간이 아닌 엔진 상태. 사용자 조작이나 파일 로드처럼 드물게 바뀌므로
 * React 가 구독해도 됩니다. 매 프레임 바뀌는 값은 `analysis` 에 있습니다.
 */
export interface EngineState {
  kind: SourceKind;
  fileName: string | null;
  duration: number;
  playing: boolean;
  loading: boolean;
  /** 재생할 수 있는 소스가 준비된 상태 */
  ready: boolean;
  error: string | null;
  peaks: Float32Array | null;
  /** 탐색 막대가 다시 그릴 시점을 알기 위한 눈금 수. */
  beatCount: number;
  /** 파일을 새로 디코딩할 때마다 오릅니다. 같은 파일을 다시 열어도 바뀝니다. */
  loadId: number;
  /** F-202 구간 반복. 둘 다 정해져야 반복이 걸립니다. */
  loopA: number | null;
  loopB: number | null;
  /**
   * 오디오 입력 장치 목록 (F-102). 오디오 인터페이스가 여럿 붙는 현장이 있습니다.
   * **권한을 받은 뒤에야 이름이 채워집니다** — 그전에는 브라우저가 빈 문자열을
   * 돌려줍니다. 그래서 `getUserMedia` 가 성공한 다음에 다시 훑습니다.
   */
  inputDevices: Array<{ id: string; label: string }>;
  /** 지금 쓰는 입력 장치. 고르지 않았으면 null(브라우저 기본) 입니다. */
  inputDeviceId: string | null;
}

export const INITIAL_ENGINE_STATE: EngineState = {
  kind: 'none',
  fileName: null,
  duration: 0,
  playing: false,
  loading: false,
  ready: false,
  error: null,
  peaks: null,
  beatCount: 0,
  loadId: 0,
  loopA: null,
  loopB: null,
  inputDevices: [],
  inputDeviceId: null,
};

export function createEmptyAnalysis(): MusicAnalysis {
  return {
    rms: 0,
    rmsSlow: 0,
    peak: 0,
    flux: 0,
    centroid: 0,
    bands: [0, 0, 0, 0, 0, 0],
    stems: [0, 0, 0, 0],
    stemPeak: [0, 0, 0, 0],
    bpm: 0,
    bpmConf: 0,
    beat: 0,
    bar: 0,
    beatInBar: 1,
    phase: 0,
    onset: 0,
    onsetPulse: 0,
    transitionPulse: 0,
    spectrum: new Float32Array(FFT_SIZE / 2),
  };
}

/** 파형 개요. 버킷마다 절대값의 최대치를 남깁니다. */
function computePeaks(buffer: AudioBuffer, buckets = PEAK_BUCKETS): Float32Array {
  const out = new Float32Array(buckets);
  const channels = Math.min(buffer.numberOfChannels, 2);
  const len = buffer.length;
  const per = Math.max(1, Math.floor(len / buckets));

  for (let c = 0; c < channels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let b = 0; b < buckets; b += 1) {
      const start = b * per;
      const end = Math.min(start + per, len);
      let max = 0;
      for (let i = start; i < end; i += 1) {
        const v = data[i] < 0 ? -data[i] : data[i];
        if (v > max) max = v;
      }
      if (max > out[b]) out[b] = max;
    }
  }
  return out;
}

class AudioEngine {
  /** 매 프레임 갱신되는 분석값. 캔버스와 리드아웃이 직접 읽습니다. */
  readonly analysis: MusicAnalysis = createEmptyAnalysis();

  private state: EngineState = INITIAL_ENGINE_STATE;
  private listeners = new Set<() => void>();

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bus: GainNode | null = null;
  private analyserMid: AnalyserNode | null = null;
  private analyserSide: AnalyserNode | null = null;
  private timeMid = new Float32Array(FFT_SIZE);
  private timeSide = new Float32Array(FFT_SIZE);

  // 주파수 영역. 크기는 컨텍스트를 만들 때 정해집니다.
  private freqMid = new Uint8Array(0);
  private freqSide = new Uint8Array(0);
  private mid = new Float32Array(0);
  private prevMid = new Float32Array(0);
  private side = new Float32Array(0);
  /** 배율과 클램프를 거치기 전의 밴드 평균. 4절의 `bassRaw` 가 이것을 씁니다. */
  private bandsRaw = new Float64Array(6);
  /** 각 빈이 속한 밴드 번호. 어느 밴드도 아니면 -1. */
  private bandOfBin = new Int8Array(0);
  private bandBinCount = new Int32Array(6);
  /** [lo, hi) 빈 구간. 2-2절의 부분 플럭스와 4절의 스템 구간입니다. */
  private range = {
    hiAir: [0, 0] as [number, number],
    subLow: [0, 0] as [number, number],
    vocal: [0, 0] as [number, number],
    other: [0, 0] as [number, number],
  };
  /** 센트로이드의 빈 → Hz 환산 계수, `sampleRate / 2 / N`. */
  private binHz = 0;
  private bandSum = new Float64Array(6);

  private onsetDetector = new OnsetDetector();
  private stemEstimator = new StemEstimator();
  private tempo = new TempoTracker();
  private tapTempo = new TapTempo();
  private demo: DemoSynth | null = null;

  /**
   * 분석 루프의 시계 (#16). 콘솔의 rAF 가 아니라 오디오 스레드가 몰아야
   * 창을 최소화해도 무대가 멈추지 않습니다.
   */
  private clockNode: AudioWorkletNode | null = null;
  private clockSink: GainNode | null = null;
  private tickListeners = new Set<(dt: number) => void>();
  private clockKind: 'none' | 'raf' | 'worklet' = 'none';
  private rafId = 0;
  private rafLast = 0;
  /** 탐색 막대에 찍을 비트 눈금. 재생 위치 기준입니다. */
  private beatMarks: Array<{ t: number; bar: boolean }> = [];
  /** `readSpectrum` 이 모아 `readStems` 가 쓰는 중간값들. */
  private fluxHi = 0;
  private fluxKick = 0;
  private vocRaw = 0;
  private othRaw = 0;
  private stemRaw = new Float32Array(4);

  /** 반복 구간의 이음매를 지나는 중인가. 다음 한 프레임의 플럭스를 버립니다. */
  private loopSeam = false;

  /** F-102 라인/마이크. 스트림과 노드를 함께 들고 있어야 끊을 수 있습니다. */
  private micStream: MediaStream | null = null;
  private micNode: MediaStreamAudioSourceNode | null = null;
  /** 마이크는 끝나는 시각이 없으므로 경과 시간을 셉니다. */
  private micStartedAt = 0;

  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private offset = 0;
  private peakDecay = 0;

  // ── React 구독 ────────────────────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): EngineState => this.state;

  private patch(next: Partial<EngineState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  // ── 오디오 그래프 ──────────────────────────────────────────────

  /**
   * AudioContext 를 사용자 조작 시점에 만듭니다. 브라우저 정책상 자동 시작이
   * 막혀 있으므로 반드시 클릭·드롭 같은 조작 핸들러 안에서 부르십시오.
   * 이미 있으면 `resume()` 을 호출합니다.
   */
  ensureContext(): AudioContext {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });

      const master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);

      // 모노 소스도 좌우 두 채널로 펼쳐 스플리터에 넣습니다.
      const bus = ctx.createGain();
      bus.channelCount = 2;
      bus.channelCountMode = 'explicit';
      bus.channelInterpretation = 'speakers';

      const splitter = ctx.createChannelSplitter(2);

      // 신호 영역에서 mid = (L+R)×0.5, side = (L-R)×0.5 를 만듭니다.
      // GainNode 는 음수 이득을 받으므로 오른쪽에 -0.5 를 걸어 같은 노드로
      // 합류시키면 뺄셈이 됩니다. 합류 노드는 GainNode 가 그대로 맡습니다.
      const mk = (gain: number) => {
        const g = ctx.createGain();
        g.gain.value = gain;
        return g;
      };
      const midL = mk(0.5);
      const midR = mk(0.5);
      const sideL = mk(0.5);
      const sideR = mk(-0.5);

      const analyserMid = ctx.createAnalyser();
      const analyserSide = ctx.createAnalyser();
      for (const a of [analyserMid, analyserSide]) {
        a.fftSize = FFT_SIZE;
        a.smoothingTimeConstant = SMOOTHING;
      }

      bus.connect(splitter);
      splitter.connect(midL, 0);
      splitter.connect(midR, 1);
      splitter.connect(sideL, 0);
      splitter.connect(sideR, 1);
      midL.connect(analyserMid);
      midR.connect(analyserMid);
      sideL.connect(analyserSide);
      sideR.connect(analyserSide);

      this.ctx = ctx;
      this.master = master;
      this.bus = bus;
      this.analyserMid = analyserMid;
      this.analyserSide = analyserSide;
      this.allocateSpectralBuffers(analyserMid.frequencyBinCount, ctx.sampleRate);
      void this.startWorkletClock(ctx);
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {
        /* 조작 시점이 아니면 거절될 수 있습니다. 다음 조작에서 다시 시도합니다. */
      });
    }
    return this.ctx;
  }

  /**
   * 주파수 영역 버퍼와 밴드 경계를 한 번만 계산합니다.
   * 빈 하나의 폭은 `sampleRate / fftSize` 입니다.
   */
  private allocateSpectralBuffers(bins: number, sampleRate: number) {
    this.freqMid = new Uint8Array(bins);
    this.freqSide = new Uint8Array(bins);
    this.mid = new Float32Array(bins);
    this.prevMid = new Float32Array(bins);
    this.side = new Float32Array(bins);

    const nyquist = sampleRate / 2;
    this.binHz = nyquist / bins;
    const toBin = (hz: number) => clamp(Math.round(hz / this.binHz), 0, bins);

    this.bandOfBin = new Int8Array(bins).fill(-1);
    this.bandBinCount.fill(0);
    const edges: Array<[number, number]> = [];
    for (let b = 0; b < BAND_HZ.length; b += 1) {
      const lo = toBin(BAND_HZ[b][0]);
      const hi = Math.max(lo + 1, toBin(BAND_HZ[b][1]));
      edges.push([lo, hi]);
      for (let i = lo; i < hi && i < bins; i += 1) {
        this.bandOfBin[i] = b;
        this.bandBinCount[b] += 1;
      }
    }

    // 부분 플럭스: HI·AIR 는 하이햇과 스네어, SUB·LOW 는 킥의 지표입니다.
    this.range.hiAir = [edges[BAND.HI][0], edges[BAND.AIR][1]];
    this.range.subLow = [edges[BAND.SUB][0], edges[BAND.LOW][1]];
    this.range.vocal = [toBin(STEM_COEF.VOCAL_LO_HZ), toBin(STEM_COEF.VOCAL_HI_HZ)];
    this.range.other = [toBin(STEM_COEF.OTHER_LO_HZ), toBin(STEM_COEF.OTHER_HI_HZ)];

    if (this.analysis.spectrum.length !== bins) {
      this.analysis.spectrum = new Float32Array(bins);
    }
  }

  /**
   * 스펙트럼 씬이 아래에 겹쳐 그리는 파형.
   * `MusicAnalysis` 에 넣지 않은 것은 06-data-model 4절의 타입을 건드리지
   * 않기 위해서입니다. 표시 전용이라 분석 결과가 아닙니다.
   */
  // ── 분석 시계 (#16) ─────────────────────────────────────────

  /**
   * 분석 한 바퀴를 돌 때마다 부릅니다.
   *
   * 구동원은 오디오 스레드의 워크렛입니다. 콘솔 창이 최소화되거나 뒤로 가도
   * 계속 돌므로, 여기에 매단 것들은 창 상태와 무관하게 갱신됩니다. 콘솔의
   * `requestAnimationFrame` 은 미리보기와 수치 표시에만 씁니다.
   */
  subscribeTick(fn: (dt: number) => void): () => void {
    this.tickListeners.add(fn);
    // 아직 오디오를 켜지 않았어도 화면은 돌아야 하므로 rAF 로 시작합니다.
    if (this.clockKind === 'none') this.startRafClock();
    return () => {
      this.tickListeners.delete(fn);
      if (this.tickListeners.size === 0) this.stopRafClock();
    };
  }

  /** 지금 시계가 무엇인가. 09 리드아웃이 표시합니다. */
  get clockSource(): 'raf' | 'worklet' | 'none' {
    return this.clockKind;
  }

  private emitTick(dt: number) {
    // 구간 반복은 여기서 봅니다 (F-202). 콘솔의 rAF 에 매달면 창을 가린 동안
    // B 지점을 지나쳐 버려, 다시 열었을 때 반복 구간 밖에서 재생 중입니다.
    this.checkLoop();
    // 탭이 오래 가려져 있다 돌아오면 dt 가 크게 튑니다. 한 프레임에 몰아서
    // 따라잡으면 값이 폭발하므로 프레임 루프와 같은 상한을 겁니다.
    const d = clamp(dt, 0, 0.1);
    for (const fn of [...this.tickListeners]) {
      try {
        fn(d);
      } catch (err) {
        // 하나가 실패해도 나머지는 돌아야 합니다. 공연 중에 쓰는 도구입니다.
        console.error('[engine] 분석 구독자에서 오류가 났습니다.', err);
      }
    }
  }

  /**
   * 워크렛을 올립니다. 실패하면 rAF 로 물러섭니다 — 창을 가리면 멈추지만
   * 아무것도 안 도는 것보다는 낫습니다.
   */
  private async startWorkletClock(ctx: AudioContext): Promise<void> {
    if (this.clockNode) return;
    try {
      await ctx.audioWorklet.addModule(
        new URL('./analyser.worklet.js', import.meta.url),
      );
      const node = new AudioWorkletNode(ctx, 'resona-clock', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      // 그래프에 매달려 있어야 `process()` 가 불립니다. 이득 0 이라 소리는
      // 나가지 않습니다.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      node.connect(sink);
      sink.connect(ctx.destination);
      node.port.onmessage = (e: MessageEvent<{ dt: number }>) => {
        this.emitTick(e.data.dt);
      };
      this.clockNode = node;
      this.clockSink = sink;
      this.clockKind = 'worklet';
      // 두 시계가 겹쳐 돌면 dt 가 반토막 납니다.
      this.stopRafClock();
    } catch (err) {
      console.error(
        '[engine] 분석 워크렛을 올리지 못했습니다. rAF 로 돕니다 — 창을 가리면 멈춥니다.',
        err,
      );
      if (this.tickListeners.size > 0) this.startRafClock();
    }
  }

  private startRafClock() {
    if (this.rafId !== 0 || this.clockKind === 'worklet') return;
    if (typeof requestAnimationFrame === 'undefined') return;
    this.clockKind = 'raf';
    this.rafLast = 0;
    const step = (now: number) => {
      this.rafId = requestAnimationFrame(step);
      const dt = this.rafLast === 0 ? 0 : (now - this.rafLast) / 1000;
      this.rafLast = now;
      this.emitTick(dt);
    };
    this.rafId = requestAnimationFrame(step);
  }

  private stopRafClock() {
    if (this.rafId === 0) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    if (this.clockKind === 'raf') this.clockKind = 'none';
  }

  /**
   * 씬이 쓰는 시각. **`AudioContext.currentTime` 입니다.**
   * rAF 로 누적하면 창이 가려진 동안 시간이 멈춰, 콘솔을 다시 열었을 때
   * 멈춰 있던 만큼 뒤처집니다.
   */
  get now(): number {
    return this.ctx ? this.ctx.currentTime : performance.now() / 1000;
  }

  /** 스펙트럼 빈 하나가 덮는 주파수 폭. 크로마(7-1절)가 씁니다. */
  get spectrumBinHz(): number {
    return this.binHz;
  }

  getWaveform(): Float32Array {
    return this.timeMid;
  }

  get sampleRate(): number {
    return this.ctx ? this.ctx.sampleRate : 44100;
  }

  get contextState(): AudioContextState | 'none' {
    return this.ctx ? this.ctx.state : 'none';
  }

  // ── 소스 ──────────────────────────────────────────────────────

  /**
   * 음원 파일을 브라우저 안에서 디코딩합니다. 서버 업로드는 하지 않습니다.
   * 조작 핸들러에서 직접 부르십시오. 첫 `await` 전에 컨텍스트를 만듭니다.
   */
  async loadFile(file: File): Promise<void> {
    let ctx: AudioContext;
    try {
      ctx = this.ensureContext();
    } catch {
      this.patch({
        error: '이 브라우저에서 오디오를 시작하지 못했습니다.',
        loading: false,
      });
      return;
    }

    this.patch({ loading: true, error: null });

    try {
      const bytes = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(bytes);

      // 소스를 전환할 때 이전 노드를 반드시 끊습니다.
      this.stopSource();
      this.stopMic();
      this.demo?.stop();

      this.buffer = decoded;
      this.offset = 0;
      this.beatMarks = [];
      this.resetAnalysis();
      this.patch({
        kind: 'file',
        fileName: file.name,
        duration: decoded.duration,
        peaks: computePeaks(decoded),
        beatCount: 0,
        loadId: this.state.loadId + 1,
        playing: false,
        ready: true,
        loading: false,
        error: null,
        // 곡이 바뀌면 A·B 는 다른 곡의 위치가 됩니다.
        loopA: null,
        loopB: null,
      });
    } catch {
      this.patch({
        loading: false,
        error: `${file.name} 을 디코딩하지 못했습니다. MP3 · WAV · FLAC · OGG 를 지원합니다.`,
      });
    }
  }

  private startSource(ctx: AudioContext, offset: number) {
    const buffer = this.buffer;
    if (!buffer || !this.bus || !this.master) return;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.bus);
    src.connect(this.master);
    src.onended = () => {
      // 우리가 끊은 노드의 뒤늦은 통지는 무시합니다. 자연 종료만 처리합니다.
      if (this.source !== src) return;
      this.source = null;
      this.offset = buffer.duration;
      // 3-5절. 끝까지 재생된 뒤에도 마디·박이 계속 오르지 않도록 비웁니다.
      this.resetAnalysis();
      this.patch({ playing: false });
    };

    src.start(0, clamp(offset, 0, buffer.duration));
    this.source = src;
    this.startedAt = ctx.currentTime;
  }

  /** 재생 중인 노드를 끊습니다. 끊지 않으면 소리가 겹치고 분석값이 오염됩니다. */
  private stopSource() {
    const src = this.source;
    if (!src) return;
    this.source = null; // onended 가 자연 종료로 오인하지 않도록 먼저 비웁니다.
    try {
      src.stop();
    } catch {
      /* 아직 시작되지 않았을 수 있습니다. */
    }
    src.disconnect();
  }

  // ── 트랜스포트 ────────────────────────────────────────────────

  get isPlaying(): boolean {
    return this.state.playing;
  }

  get duration(): number {
    return this.buffer ? this.buffer.duration : 0;
  }

  get currentTime(): number {
    // 마이크는 끝나는 시각이 없습니다. 켠 뒤 흐른 시간을 돌려줍니다.
    if (this.state.kind === 'mic') {
      return this.ctx ? Math.max(0, this.ctx.currentTime - this.micStartedAt) : 0;
    }
    if (!this.buffer) return 0;
    if (this.state.playing && this.ctx && this.source) {
      return clamp(
        this.offset + (this.ctx.currentTime - this.startedAt),
        0,
        this.buffer.duration,
      );
    }
    return clamp(this.offset, 0, this.buffer.duration);
  }

  // ── 라인 / 마이크 (F-102) ─────────────────────────────────────

  /**
   * 스트림과 노드를 끊고 장치를 놓습니다.
   *
   * 원본 `resona.html` 의 `disconnectSource()` 가 하던 일입니다. 트랙을
   * `stop()` 하지 않으면 브라우저 탭에 녹음 표시가 남고 장치가 잡혀 있습니다.
   */
  private stopMic(): void {
    if (this.micNode) {
      try {
        this.micNode.disconnect();
      } catch {
        /* 이미 끊겼을 수 있습니다. */
      }
      this.micNode = null;
    }
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) track.stop();
      this.micStream = null;
    }
  }

  /**
   * 오디오 입력 장치 목록을 다시 훑습니다.
   * 권한 전에는 이름이 비어 있으므로 `startMic` 성공 뒤에 부릅니다.
   */
  async refreshInputDevices(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const inputs = list
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `입력 ${i + 1}` }));
      this.patch({ inputDevices: inputs });
    } catch {
      /* 목록을 못 받아도 기본 장치로 동작합니다. */
    }
  }

  /**
   * 라인/마이크 입력을 켭니다 (F-102). 원본의 `startMic()` 을 옮긴 것입니다.
   * 조작 핸들러 안에서 직접 부르십시오 — 권한 요청이 사용자 조작을 요구합니다.
   *
   * **브라우저 기본 처리 셋을 끕니다.** 에코 제거·잡음 억제·자동 이득 조절
   * 입니다. 특히 AGC 가 켜지면 곡의 셈여림이 뭉개져 `arousal` 판정이
   * 망가집니다 (`05-signal-processing.md` 7절).
   *
   * **스피커로 되돌리지 않습니다.** `master` 가 아니라 분석 버스에만 물립니다.
   * 되돌리면 하울링이 납니다.
   */
  async startMic(deviceId?: string): Promise<void> {
    const ctx = this.ensureContext();

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.patch({
        loading: false,
        error:
          typeof location !== 'undefined' && location.protocol === 'file:'
            ? 'file:// 로 직접 열면 브라우저가 오디오 입력을 막습니다. localhost 로 접속하십시오.'
            : '이 환경은 오디오 입력 API 를 지원하지 않습니다.',
      });
      return;
    }

    this.patch({ loading: true, error: null });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        },
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      this.patch({
        loading: false,
        error:
          name === 'NotAllowedError'
            ? '오디오 입력 권한이 거부됐습니다. 주소창 자물쇠 → 마이크 허용 후 새로고침하거나, 음원 파일이나 데모 신스를 쓰십시오.'
            : name === 'NotFoundError'
              ? '입력 장치를 찾지 못했습니다. 오디오 인터페이스 연결을 확인하십시오.'
              : `오디오 입력 연결에 실패했습니다 (${name || '알 수 없는 오류'}).`,
      });
      return;
    }

    /*
     * 소스 전환은 **전체 초기화**입니다 (3-5절). 탐색과 달리 부분 초기화가
     * 아닙니다 — 이전 소스에서 쌓인 엔벨로프와 BPM 이 남아 있으면 새 입력의
     * 앞부분과 섞여 엉뚱한 템포가 잡힙니다.
     */
    this.stopSource();
    this.stopMic();
    this.demo?.stop();
    this.buffer = null;
    this.offset = 0;
    this.beatMarks = [];
    this.resetAnalysis();

    this.micStream = stream;
    const node = ctx.createMediaStreamSource(stream);
    // 분석 버스에만. `master` 로 보내면 하울링이 납니다.
    node.connect(this.bus!);
    this.micNode = node;
    this.micStartedAt = ctx.currentTime;

    const track = stream.getAudioTracks()[0];
    this.patch({
      kind: 'mic',
      fileName: track?.label || 'LINE IN',
      inputDeviceId: track?.getSettings().deviceId ?? deviceId ?? null,
      duration: 0,
      peaks: null,
      beatCount: 0,
      loadId: this.state.loadId + 1,
      playing: true,
      ready: true,
      loading: false,
      error: null,
      // 끝나는 시각이 없는 입력이라 구간 반복을 걸 수 없습니다.
      loopA: null,
      loopB: null,
    });

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        /* 사용자 조작 밖이면 실패할 수 있습니다. 다음 조작에서 다시 시도됩니다. */
      }
    }
    void this.refreshInputDevices();
  }

  /**
   * 데모 신스로 전환합니다 (F-103). 이전 소스는 정리합니다.
   * 조작 핸들러 안에서 직접 부르십시오.
   */
  startDemo(): void {
    const ctx = this.ensureContext();
    this.stopSource();
    this.stopMic();
    this.buffer = null;
    this.offset = 0;
    this.beatMarks = [];
    this.resetAnalysis();

    if (!this.demo) {
      this.demo = new DemoSynth(ctx);
      this.demo.output.connect(this.bus!);
      this.demo.output.connect(this.master!);
    }
    this.demo.start();

    this.patch({
      kind: 'demo',
      fileName: null,
      duration: 0,
      peaks: null,
      beatCount: 0,
      ready: true,
      playing: true,
      loading: false,
      error: null,
      loopA: null,
      loopB: null,
    });
  }

  play(): void {
    // 라인/마이크는 흐르는 입력이라 멈추거나 되감을 것이 없습니다.
    if (this.state.kind === 'mic') return;
    if (this.state.playing) return;
    const ctx = this.ensureContext();

    if (this.state.kind === 'demo') {
      this.demo?.start();
      this.patch({ playing: true });
      return;
    }

    if (!this.buffer) return;
    if (this.offset >= this.buffer.duration - 1e-3) this.offset = 0;
    this.startSource(ctx, this.offset);
    this.patch({ playing: true });
  }

  pause(): void {
    if (this.state.kind === 'mic') return;
    if (!this.state.playing) return;

    if (this.state.kind === 'demo') {
      this.demo?.stop();
      this.patch({ playing: false });
      return;
    }

    this.offset = this.currentTime;
    this.stopSource();
    this.patch({ playing: false });
  }

  stop(): void {
    if (this.state.kind === 'mic') {
      // `정지` 는 장치를 놓는 것입니다. 탭의 녹음 표시도 이때 사라집니다.
      this.stopMic();
      this.resetAnalysis();
      this.patch({
        kind: 'none',
        fileName: null,
        playing: false,
        ready: false,
        beatCount: 0,
        inputDeviceId: null,
      });
      return;
    }
    if (this.state.kind === 'demo') {
      this.demo?.stop();
      this.resetAnalysis();
      if (this.state.playing) this.patch({ playing: false });
      return;
    }

    this.stopSource();
    this.offset = 0;
    this.beatMarks = [];
    this.resetAnalysis();
    if (this.state.playing) this.patch({ playing: false, beatCount: 0 });
    else this.patch({ beatCount: 0 });
  }

  /**
   * 분석 상태 초기화. `docs/05-signal-processing.md` 3-5절.
   *
   * 새 파일 로드 · 정지 · 자연 종료(ended) · 소스 전환에서 부릅니다.
   * 탐색은 `resetForSeek()` 로 템포를 남깁니다.
   * **일시정지에서는 부르지 않습니다.** 같은 위치에서 이어지므로 버퍼가 유효합니다.
   *
   * 비우지 않으면 이전 재생에서 쌓인 엔벨로프가 새 곡의 앞부분과 섞여, 같은
   * 곡인데도 실행마다 다른 BPM 이 나옵니다.
   */
  private resetForSeek(): void {
    this.onsetDetector.reset();
    this.tempo.resetForSeek();
    this.prevMid.fill(0);
    this.mid.fill(0);
  }

  private resetAnalysis(): void {
    this.peakDecay = 0;
    this.onsetDetector.reset();
    this.stemEstimator.reset();
    this.tempo.reset();
    this.prevMid.fill(0);
    this.mid.fill(0);
  }

  toggle(): void {
    if (this.state.playing) this.pause();
    else this.play();
  }

  seek(t: number): void {
    if (this.state.kind === 'mic') return;
    if (!this.buffer) return;
    const target = clamp(t, 0, this.buffer.duration);
    // 3-5절. 탐색은 부분 초기화입니다. 버퍼와 비트 위상만 비우고 템포는 둡니다.
    this.resetForSeek();
    if (this.state.playing && this.ctx) {
      this.stopSource();
      this.offset = target;
      this.startSource(this.ctx, target);
    } else {
      this.offset = target;
    }
  }

  // ── 구간 반복 (F-202) ─────────────────────────────────────────

  /**
   * A 지점을 찍습니다. **A 가 B 보다 뒤면 B 를 버립니다.**
   *
   * 뒤바뀐 구간을 그대로 두면 재생 위치가 영영 B 에 닿지 않아 "반복이 걸렸다"
   * 는 표시만 남고 아무 일도 일어나지 않습니다. 어느 쪽을 버릴지는 명세에
   * 없어, 방금 찍은 쪽을 남기는 것으로 정했습니다.
   */
  setLoopA(t: number): void {
    const a = clamp(t, 0, this.duration || t);
    const b = this.state.loopB;
    this.patch({ loopA: a, loopB: b !== null && b <= a + LOOP_MIN ? null : b });
  }

  setLoopB(t: number): void {
    const b = clamp(t, 0, this.duration || t);
    const a = this.state.loopA;
    this.patch({ loopB: b, loopA: a !== null && a >= b - LOOP_MIN ? null : a });
  }

  clearLoop(): void {
    if (this.state.loopA === null && this.state.loopB === null) return;
    this.patch({ loopA: null, loopB: null });
  }

  /** 두 지점이 다 찍혔는가. 트랜스포트가 표시에 씁니다. */
  get looping(): boolean {
    return this.state.loopA !== null && this.state.loopB !== null;
  }

  /**
   * B 를 넘었으면 A 로 되돌립니다. 매 틱 부릅니다.
   * 데모 신스에는 걸지 않습니다 — 위치라는 것이 없는 소스입니다.
   *
   * **`seek()` 을 쓰지 않습니다.** 반복은 탐색과 다릅니다. 탐색은 "다른
   * 자리로 건너뛴다" 라서 온셋 엔벨로프와 비트 위상을 비우는 것이 맞지만,
   * 반복은 같은 곡의 같은 구간을 계속 도는 것입니다. 매 바퀴 비우면 비트
   * 트래커가 매번 다시 물어야 해서, 열 몇 초짜리 구간을 돌리는 내내 박이
   * 잡히다 풀리기를 되풀이합니다 (3-4절). 재생 위치만 되돌립니다.
   */
  private checkLoop(): void {
    const { loopA, loopB, playing, kind } = this.state;
    if (loopA === null || loopB === null) return;
    if (!playing || kind !== 'file' || !this.ctx) return;
    if (this.currentTime < loopB) return;

    this.stopSource();
    this.offset = loopA;
    this.startSource(this.ctx, loopA);
    // B 에서 A 로 건너뛴 자리는 스펙트럼이 한 번 크게 튑니다. 그대로 두면
    // 매 바퀴 없는 온셋이 하나씩 잡히므로 그 프레임의 플럭스만 버립니다.
    this.loopSeam = true;
  }

  // ── 분석 ──────────────────────────────────────────────────────

  /**
   * 매 프레임 부릅니다. `docs/04-flows.md` 4절의 2번 자리입니다.
   * 순서는 RMS → 스펙트럼 한 바퀴 → 밴드 → 온셋 → 스템 입니다.
   * 온셋이 RMS 를 게이트로 쓰고, 스템이 밴드와 부분 플럭스를 쓰기 때문입니다.
   */
  analyze(dt: number): void {
    const a = this.analysis;

    if (!this.analyserMid || !this.analyserSide || !this.ctx) {
      this.decay(dt);
      return;
    }

    this.readLevel();
    // 2-3절. 세 값의 쓰임이 다릅니다. 섞어 쓰면 안 됩니다.
    a.rmsSlow += (a.rms - a.rmsSlow) * (1 - Math.exp(-dt / RMS_SLOW_TAU));
    this.readSpectrum();
    this.readBands();

    // ── 온셋. 3-1절 ──
    const now = this.ctx.currentTime;
    const isOnset = this.onsetDetector.detect(a.flux, a.rms, now);
    a.onset = isOnset ? 1 : 0;
    a.onsetPulse = isOnset
      ? 1
      : a.onsetPulse * Math.exp(-dt / ONSET_PULSE_TAU);

    // ── 엔벨로프 · BPM · 비트. 3-2 ~ 3-4절 ──
    this.tempo.update(a.flux, this.onsetDetector.median, isOnset, a.rms, now, dt);
    a.bpm = this.tempo.bpm;
    a.bpmConf = this.tempo.conf;
    a.beat = this.tempo.beat;
    a.bar = this.tempo.bar;
    a.beatInBar = this.tempo.beatInBar;
    a.phase = this.tempo.phase;
    if (this.tempo.beatFired) this.markBeat();

    this.readStems();
  }

  /** 비트가 난 재생 위치를 남깁니다. 되감아 다시 들을 때 겹쳐 쌓지 않습니다. */
  private markBeat() {
    if (this.state.kind !== 'file' || !this.buffer) return;
    const t = this.currentTime;
    for (let i = this.beatMarks.length - 1; i >= 0; i -= 1) {
      const d = t - this.beatMarks[i].t;
      if (d > 0.2) break;
      if (d > -0.2) return; // 이미 찍힌 자리
    }
    this.beatMarks.push({ t, bar: this.tempo.beatInBar === 1 });
    if (this.beatMarks.length > 4096) this.beatMarks.shift();
    this.patch({ beatCount: this.beatMarks.length });
  }

  // ── 템포 수동 확정 (F-303-2) ────────────────────────────────

  /** 현재 표시 중인 BPM. 배수 보정의 기준값입니다. */
  get currentBpm(): number {
    return this.analysis.bpm;
  }

  /**
   * `T` 키를 두드릴 때마다 부릅니다.
   * @returns 네 번째부터 확정된 BPM, 그 전에는 null
   */
  tap(): number | null {
    const now = this.ctx ? this.ctx.currentTime : performance.now() / 1000;
    return this.tapTempo.tap(now);
  }

  get tapCount(): number {
    return this.tapTempo.count;
  }

  resetTap(): void {
    this.tapTempo.reset();
  }

  /** 배수 보정 버튼. 지금 값에 계수를 곱한 결과를 돌려줍니다. */
  scaledBpm(factor: number): number {
    return scaleTempo(this.analysis.bpm, factor);
  }

  /** 확정값과 자물쇠를 템포 추적기에 넘깁니다. */
  applyTempoOverride(bpm: number | null, locked: boolean): void {
    this.tempo.setOverride(bpm, locked);
  }

  /** 탐색 막대가 읽습니다. 매 프레임이 아니라 눈금 수가 바뀔 때만 다시 그립니다. */
  getBeatMarks(): ReadonlyArray<{ t: number; bar: boolean }> {
    return this.beatMarks;
  }

  /** 2-3절. 시간 영역 샘플을 두 칸씩 건너뛰며 계산합니다. */
  private readLevel() {
    const a = this.analysis;
    this.analyserMid!.getFloatTimeDomainData(this.timeMid);
    this.analyserSide!.getFloatTimeDomainData(this.timeSide);

    const n = this.timeMid.length;
    let sum = 0;
    let count = 0;
    let max = 0;

    for (let i = 0; i < n; i += 2) {
      // L = m + s, R = m - s 이므로 두 채널의 에너지 평균 (l²+r²)/2 는
      // 그대로 m² + s² 입니다. 좌우를 더해 재는 방식은 위상이 어긋난
      // 스테레오에서 상쇄되므로 쓰지 않습니다.
      const m = this.timeMid[i];
      const sd = this.timeSide[i];
      sum += m * m + sd * sd;
      count += 1;
      // max(|L|, |R|) = |m| + |s|
      const av = (m < 0 ? -m : m) + (sd < 0 ? -sd : sd);
      if (av > max) max = av;
    }

    const rms = Math.sqrt(sum / Math.max(count, 1));
    a.rms = lerp(a.rms, clamp(rms * RMS_GAIN, 0, 1), RMS_SMOOTH);

    this.peakDecay = Math.max(this.peakDecay * PEAK_DECAY, max);
    a.peak = clamp(this.peakDecay, 0, 1);
  }

  /**
   * 주파수 영역을 한 번만 훑으면서 2-1·2-2·2-4절과 스템 원값을 함께 모읍니다.
   * 빈 2048개를 여러 번 도는 것을 피하려고 한 반복문에 합쳤습니다.
   */
  private readSpectrum() {
    const a = this.analysis;
    this.analyserMid!.getByteFrequencyData(this.freqMid);
    this.analyserSide!.getByteFrequencyData(this.freqSide);

    const n = this.freqMid.length;
    const mid = this.mid;
    const prev = this.prevMid;
    const side = this.side;
    const [hiLo, hiHi] = this.range.hiAir;
    const [kickLo, kickHi] = this.range.subLow;
    const [vocLo, vocHi] = this.range.vocal;
    const [othLo, othHi] = this.range.other;

    let flux = 0;
    let fluxHi = 0;
    let fluxKick = 0;
    let centroidNum = 0;
    let centroidDen = 0;
    let vocSum = 0;
    let othSum = 0;
    this.bandSum.fill(0);

    for (let i = 0; i < n; i += 1) {
      // 2-1절. 1절 그래프에서 만든 두 신호의 크기를 0~1 로 정규화해 그대로 씁니다.
      const m = this.freqMid[i] / 255;
      const sd = this.freqSide[i] / 255;
      mid[i] = m;
      side[i] = sd;

      // 2-2절. 증가분만 더합니다. 감소는 무시합니다.
      const rise = m - prev[i];
      if (rise > 0) {
        flux += rise;
        if (i >= hiLo && i < hiHi) fluxHi += rise;
        if (i >= kickLo && i < kickHi) fluxKick += rise;
      }

      // 2-4절. 주파수 크기의 무게중심.
      centroidNum += m * i;
      centroidDen += m;

      const b = this.bandOfBin[i];
      if (b >= 0) this.bandSum[b] += m;

      // 4절. 보컬은 중앙에서 벌어진 몫을 뺀 것, 기타는 벌어진 쪽 그대로.
      if (i >= vocLo && i < vocHi) {
        const v = m - sd * STEM_COEF.VOCAL_SIDE;
        if (v > 0) vocSum += v;
      }
      if (i >= othLo && i < othHi) othSum += sd;
    }

    // 반복 구간의 이음매(F-202). B 에서 A 로 건너뛴 프레임은 곡의 변화가 아니라
    // 잘라 붙인 자리라 플럭스가 통째로 거짓입니다. 한 프레임만 버립니다.
    if (this.loopSeam) {
      this.loopSeam = false;
      flux = 0;
      fluxHi = 0;
      fluxKick = 0;
    }

    a.flux = (flux / n) * FLUX_GAIN;
    a.centroid = centroidDen > 1e-6 ? (centroidNum / centroidDen) * this.binHz : 0;
    a.spectrum.set(mid);

    this.fluxHi = fluxHi;
    this.fluxKick = fluxKick;
    this.vocRaw = vocSum / Math.max(vocHi - vocLo, 1);
    this.othRaw = (othSum / Math.max(othHi - othLo, 1)) * STEM_COEF.OTHER_SCALE;

    // 다음 프레임의 비교 대상으로 쓰기 위해 두 버퍼를 맞바꿉니다. 복사하지 않습니다.
    this.mid = prev;
    this.prevMid = mid;
  }

  /**
   * 2-5절. 밴드 평균을 정규화하고 평활합니다.
   * 배율과 클램프를 거치기 전의 평균은 `bandsRaw` 에 따로 남깁니다.
   * 4절의 `bassRaw` 가 표시용 값이 아니라 이쪽을 써야 하기 때문입니다.
   */
  private readBands() {
    const a = this.analysis;
    for (let b = 0; b < 6; b += 1) {
      const raw = this.bandSum[b] / Math.max(this.bandBinCount[b], 1);
      this.bandsRaw[b] = raw;
      const target = clamp(raw * BAND_GAIN, 0, 1);
      a.bands[b] = lerp(a.bands[b], target, BAND_SMOOTH);
    }
  }

  /** 4절. 원값 네 개를 만들어 자동 이득 조절에 넘깁니다. */
  private readStems() {
    const a = this.analysis;
    const n = this.freqMid.length;

    const drumRaw =
      ((this.fluxHi * STEM_COEF.DRUM_HI) / n) * STEM_COEF.DRUM_SCALE +
      ((this.fluxKick * STEM_COEF.DRUM_KICK) / n) * STEM_COEF.DRUM_SCALE;
    // `bands` 가 아니라 `bandsRaw` 입니다. 표시용 값은 이미 1.55 배율과 클램프를
    // 거쳐 요즘 마스터링된 음원에서 저역이 상시 1.00 에 붙습니다.
    const bassRaw =
      (this.bandsRaw[BAND.SUB] * STEM_COEF.BASS_SUB + this.bandsRaw[BAND.LOW]) *
      STEM_COEF.BASS_SCALE;

    this.stemRaw[0] = drumRaw;
    this.stemRaw[1] = bassRaw;
    this.stemRaw[2] = this.vocRaw;
    this.stemRaw[3] = this.othRaw;
    // 전체 레벨이 낮으면 스템을 0 으로 둡니다 (4절). 조용한 *곡*과 조용한
    // *입력*은 다른 것이고, 이 둘을 가르는 것은 절대 레벨입니다.
    this.stemEstimator.update(this.stemRaw, a.stems, a.stemPeak, a.rmsSlow);
  }

  /** 소스가 없을 때 값이 제자리에 얼어붙지 않도록 같은 계수로 흘려보냅니다. */
  private decay(dt: number) {
    const a = this.analysis;
    a.rms = lerp(a.rms, 0, RMS_SMOOTH);
    a.rmsSlow += (0 - a.rmsSlow) * (1 - Math.exp(-dt / RMS_SLOW_TAU));
    this.peakDecay *= PEAK_DECAY;
    a.peak = this.peakDecay;
    a.flux = lerp(a.flux, 0, RMS_SMOOTH);
    a.onset = 0;
    a.onsetPulse *= Math.exp(-dt / ONSET_PULSE_TAU);
    a.phase = 0;
    for (let b = 0; b < 6; b += 1) {
      a.bands[b] = lerp(a.bands[b], 0, BAND_SMOOTH);
      this.bandsRaw[b] = 0;
    }
    this.stemRaw.fill(0);
    this.stemEstimator.update(this.stemRaw, a.stems, a.stemPeak, a.rmsSlow);
  }

  dispose(): void {
    this.stopRafClock();
    this.clockNode?.port.close();
    this.clockNode?.disconnect();
    this.clockSink?.disconnect();
    this.clockNode = null;
    this.clockSink = null;
    this.clockKind = 'none';
    this.stopSource();
    this.demo?.stop();
    this.demo = null;
    this.buffer = null;
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.master = null;
    this.bus = null;
    this.analyserMid = null;
    this.analyserSide = null;
  }
}

/** 콘솔과 출력 창이 같은 엔진을 씁니다. 생성자는 브라우저 API 를 만지지 않습니다. */
export const audioEngine = new AudioEngine();
