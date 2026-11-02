'use client';

/**
 * WebSocket 송출 (F-801). 원본 `resona.html` 의 `wsConnect()` · `wsTick()` 을
 * 옮긴 것입니다.
 *
 * **송출은 분석 루프 안에서 누적 시간으로 솎아 냅니다.** 원본의 `wsTick(dt)`
 * 방식 그대로입니다. 별도 타이머를 두면 프레임과 어긋난 값이 나갑니다.
 * 우리 쪽 루프는 rAF 가 아니라 오디오 스레드의 시계(#16)라, 콘솔을
 * 최소화해도 계속 나갑니다 — 공연 중에 필요한 성질입니다.
 *
 * **연결 실패가 렌더 루프를 건드리지 않습니다.** 이 파일의 함수는 던지지
 * 않고, `tick()` 은 소켓이 없거나 열려 있지 않으면 곧바로 돌아옵니다.
 *
 * 원본에서 바꾼 것: **자동 재연결.** 원본은 `onclose` 에서 상태 표시만 바꾸고
 * 다시 붙지 않아, 공연 중에 TouchDesigner 를 껐다 켜면 사람이 연결 버튼을
 * 다시 눌러야 했습니다. 무대 뒤에서 그 버튼을 찾게 만들지 않습니다.
 */
import { toJson, toOsc, type RoutingContext } from '@/lib/routing/channels';

export type RoutingFormat = 'json' | 'osc';
export type RoutingState = 'OFFLINE' | 'CONNECTING' | 'LIVE';

export const DEFAULT_URL = 'ws://localhost:9980';
/** 송출 주기(Hz). 원본에서 실제로 쓰던 범위와 기본값입니다. */
export const RATE_MIN = 5;
export const RATE_MAX = 120;
export const RATE_DEFAULT = 60;

/** 재연결 간격. 1초에서 시작해 두 배씩, 10초에서 멈춥니다. */
const RETRY_MIN = 1000;
const RETRY_MAX = 10_000;

export interface RoutingStatus {
  state: RoutingState;
  url: string;
  format: RoutingFormat;
  rate: number;
  /** 지금까지 보낸 횟수. 실제로 나가고 있는지 화면에서 확인하는 값입니다 */
  sent: number;
  /** 몇 번째 재연결 시도인가. 0 이면 시도 중이 아닙니다 */
  attempt: number;
  error: string | null;
}

export const INITIAL_ROUTING: RoutingStatus = {
  state: 'OFFLINE',
  url: DEFAULT_URL,
  format: 'json',
  rate: RATE_DEFAULT,
  sent: 0,
  attempt: 0,
  error: null,
};

const HTTPS_WARNING =
  '배포된 주소(https)에서는 보안 정책상 로컬 소켓 연결이 차단됩니다. 외부 연동은 로컬 실행에서 사용하세요.';

class RoutingClient {
  private status: RoutingStatus = INITIAL_ROUTING;
  private listeners = new Set<() => void>();

  private ws: WebSocket | null = null;
  /** 사람이 `해제` 를 눌렀는가. 그때는 다시 붙지 않습니다 */
  private manual = false;
  private retryTimer = 0;
  private retryDelay = RETRY_MIN;
  /** 누적 시간(초). 원본의 `wsAcc` 입니다 */
  private acc = 0;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): RoutingStatus => this.status;

  private patch(next: Partial<RoutingStatus>) {
    this.status = { ...this.status, ...next };
    for (const fn of this.listeners) fn();
  }

  // ── 설정 ──────────────────────────────────────────────────────

  setUrl(url: string): void {
    this.patch({ url });
  }

  setFormat(format: RoutingFormat): void {
    this.patch({ format });
  }

  setRate(rate: number): void {
    this.patch({ rate: Math.min(RATE_MAX, Math.max(RATE_MIN, Math.round(rate))) });
  }

  // ── 연결 ──────────────────────────────────────────────────────

  /** https 페이지에서 ws:// 로 나가려는 상황인가. 미리 알려 줍니다. */
  get blockedByHttps(): boolean {
    if (typeof window === 'undefined') return false;
    return (
      window.location.protocol === 'https:' && this.status.url.startsWith('ws://')
    );
  }

  connect(): void {
    this.manual = false;
    this.retryDelay = RETRY_MIN;
    this.open();
  }

  private open(): void {
    if (typeof WebSocket === 'undefined') return;
    this.clearRetry();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* 이미 닫혔을 수 있습니다. */
      }
      this.ws = null;
    }

    if (this.blockedByHttps) {
      this.patch({ state: 'OFFLINE', error: HTTPS_WARNING, attempt: 0 });
      return;
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.status.url.trim());
    } catch {
      this.patch({ state: 'OFFLINE', error: 'WebSocket 을 만들지 못했습니다 — 주소를 확인하세요.' });
      this.scheduleRetry();
      return;
    }

    this.ws = socket;
    this.acc = 0;
    this.patch({ state: 'CONNECTING', error: null });

    socket.onopen = () => {
      if (this.ws !== socket) return;
      this.retryDelay = RETRY_MIN;
      this.patch({ state: 'LIVE', attempt: 0, error: null });
    };
    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.ws = null;
      if (this.manual) {
        this.patch({ state: 'OFFLINE', attempt: 0, error: null });
        return;
      }
      // 원본과 다른 자리. 상태만 바꾸지 않고 다시 붙습니다.
      this.patch({ state: 'CONNECTING' });
      this.scheduleRetry();
    };
    socket.onerror = () => {
      if (this.ws !== socket) return;
      this.patch({
        error:
          '연결 실패 — TouchDesigner 의 WebSocket DAT 가 켜져 있는지, 포트가 맞는지 확인하세요.',
      });
    };
  }

  /** 사람이 끊습니다. 다시 붙지 않습니다. */
  disconnect(): void {
    this.manual = true;
    this.clearRetry();
    const socket = this.ws;
    this.ws = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        /* 이미 닫혔을 수 있습니다. */
      }
    }
    this.patch({ state: 'OFFLINE', attempt: 0, error: null });
  }

  toggle(): void {
    if (this.status.state === 'OFFLINE') this.connect();
    else this.disconnect();
  }

  private scheduleRetry(): void {
    if (this.manual || typeof window === 'undefined') return;
    this.clearRetry();
    const delay = this.retryDelay;
    this.patch({ attempt: this.status.attempt + 1 });
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = 0;
      this.open();
    }, delay);
    this.retryDelay = Math.min(RETRY_MAX, this.retryDelay * 2);
  }

  private clearRetry(): void {
    if (this.retryTimer !== 0) {
      clearTimeout(this.retryTimer);
      this.retryTimer = 0;
    }
  }

  // ── 송출 ──────────────────────────────────────────────────────

  /**
   * 분석 루프에서 매 틱 부릅니다. 원본의 `wsTick(dt)` 입니다.
   * **던지지 않습니다.** 부르는 쪽이 렌더 루프와 붙어 있습니다.
   */
  tick(dt: number, ctx: () => RoutingContext): void {
    const socket = this.ws;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    this.acc += dt;
    const period = 1 / this.status.rate;
    if (this.acc < period) return;
    this.acc = 0;
    try {
      const c = ctx();
      socket.send(this.status.format === 'json' ? JSON.stringify(toJson(c)) : toOsc(c));
      // 화면에 보이는 숫자라 상태를 갱신하지만, 리렌더는 구독한 패널 하나뿐입니다.
      this.status = { ...this.status, sent: this.status.sent + 1 };
      for (const fn of this.listeners) fn();
    } catch {
      // 보내다 실패해도 다음 틱에 다시 시도합니다. 루프를 멈추지 않습니다.
    }
  }

  /** 지금 값 한 벌. 채널 표가 씁니다. */
  get isLive(): boolean {
    return this.status.state === 'LIVE';
  }
}

export const routingClient = new RoutingClient();
