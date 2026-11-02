'use client';

/**
 * 못 보낸 쓰기를 로컬에 쌓아 두는 대기열.
 *
 * **공연장에서 인터넷이 끊겨도 콘솔이 멈추면 안 됩니다.** 저장이 실패하면
 * 여기에 넣어 두고 연결이 돌아왔을 때 다시 보냅니다. 이 파일의 함수는 어떤
 * 경우에도 던지지 않습니다 — 던지면 부르는 쪽에서 잡아야 하고, 그 자리가
 * 렌더 루프와 가까울수록 위험합니다.
 *
 * 대기열은 **같은 대상에 대해 마지막 것만** 남깁니다. 프리셋 하나를 열 번
 * 저장했다면 보낼 것은 마지막 한 번입니다.
 */
import type { LyricLine } from '@/lib/types';

const KEY = 'resona.pending.v1';
/** 대기열 상한. 넘으면 오래된 것부터 버립니다. */
const MAX = 64;

/** 곡을 알아보는 열쇠. 원격에 곡이 없으면 이것으로 만듭니다. */
export interface TrackKey {
  hash: string;
  title: string;
  duration: number | null;
}

export type PendingWrite =
  | { kind: 'preset'; key: string; at: number; row: Record<string, unknown>; track: TrackKey | null }
  | { kind: 'lyrics'; key: string; at: number; lines: LyricLine[]; track: TrackKey };

function read(): PendingWrite[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as PendingWrite[]) : [];
  } catch {
    // 저장 공간이 막혔거나 값이 깨졌습니다. 비어 있는 것으로 봅니다.
    return [];
  }
}

function write(list: PendingWrite[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX)));
  } catch {
    /* 사생활 보호 모드 등. 이번 판만 못 남기고 넘어갑니다. */
  }
}

export function pendingList(): PendingWrite[] {
  return read();
}

export function pendingCount(): number {
  return read().length;
}

/** 같은 `key` 가 있으면 갈아 끼웁니다. */
export function enqueue(item: PendingWrite): void {
  const list = read().filter((x) => !(x.kind === item.kind && x.key === item.key));
  list.push(item);
  write(list);
}

export function dequeue(kind: PendingWrite['kind'], key: string): void {
  write(read().filter((x) => !(x.kind === kind && x.key === key)));
}

export function clearPending(): void {
  write([]);
}
