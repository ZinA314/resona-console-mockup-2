/**
 * 분석 루프의 시계. `issues/14-output-window-resilience.md`.
 *
 * **특징 추출은 하지 않습니다.** `AnalyserNode` 를 버리면 2단계에서 어렵게
 * 맞춘 값들(온셋 임계값 `중앙값 × 1.5 + 0.022`, BPM 빗살 가중치, 밴드 정규화
 * 배율)이 전부 흔들립니다. 전부 `AnalyserNode` 의 출력 스케일에 맞춰 정한
 * 값입니다. 이 워크렛은 창 상태와 무관하게 도는 시계 역할만 합니다.
 *
 * 브라우저는 보이지 않는 창의 `requestAnimationFrame` 을 멈춥니다. 분석이
 * 거기에 얹혀 있으면 오퍼레이터가 콘솔을 최소화하는 순간 무대가 정지합니다.
 * 오디오 스레드는 창 상태와 무관하게 돌고, 메시지 포트 콜백은 백그라운드
 * 절전의 대상이 아닙니다.
 *
 * **확장자가 `.js` 인 것은 의도한 것입니다.** 워크렛은 번들러를 거치지 않고
 * 브라우저가 직접 파싱하는 별도 모듈이라, `.ts` 를 그대로 내보내면 로드에
 * 실패합니다 (실측: `AbortError: Unable to load a worklet's module`).
 */

/**
 * `process()` 는 128 표본마다 불립니다. 44.1kHz 에서 약 344Hz 이므로 여섯
 * 번에 한 번이면 약 57Hz 입니다. **정확히 60Hz 가 아니므로** 받는 쪽이
 * 고정값을 가정하지 않도록 `dt` 를 실어 보냅니다.
 */
const EVERY = 6;

class ResonaClockProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.n = 0;
    this.last = currentTime;
  }

  process() {
    this.n += 1;
    if (this.n % EVERY === 0) {
      const now = currentTime;
      this.port.postMessage({ dt: now - this.last, time: now });
      this.last = now;
    }
    // 소리를 내지 않지만 계속 살아 있어야 합니다.
    return true;
  }
}

registerProcessor('resona-clock', ResonaClockProcessor);
