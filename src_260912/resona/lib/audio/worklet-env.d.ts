/**
 * AudioWorklet 전역 타입.
 *
 * `lib/dom` 에는 워크렛 스코프의 전역이 없습니다. 워크렛은 메인 스레드가
 * 아니라 오디오 스레드에서 도는 별개의 실행 환경이라 `window` 도 `document`
 * 도 없고, 대신 아래 넷이 있습니다.
 */
declare const sampleRate: number;
declare const currentTime: number;
declare const currentFrame: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  ctor: new (options?: unknown) => AudioWorkletProcessor,
): void;
