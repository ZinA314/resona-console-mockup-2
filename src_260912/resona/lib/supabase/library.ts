'use client';

/**
 * 프리셋과 가사를 저장하고 불러옵니다 (F-700, F-605).
 *
 * **저장이 실패해도 화면은 계속 돕니다.** 이 파일의 공개 함수는 던지지
 * 않습니다. 원격에 못 보내면 로컬에 쌓아 두고(`queue.ts`) 연결이 돌아왔을 때
 * 다시 보냅니다. 렌더 루프와 분석 루프는 이 파일을 부르지 않습니다 —
 * 사용자가 버튼을 눌렀을 때와 곡을 바꿨을 때만 돕니다.
 *
 * 로그인하지 않았거나 Supabase 설정이 없어도 프리셋은 **로컬에 남습니다.**
 * 새로 고침한 뒤 불러오면 같은 상태가 됩니다. 로그인하면 그때 올라갑니다.
 */
import { authManager } from '@/lib/supabase/auth';
import { getSupabase, supabaseConfigured } from '@/lib/supabase/client';
import {
  dequeue,
  enqueue,
  pendingCount,
  pendingList,
  type TrackKey,
} from '@/lib/supabase/queue';
import { DEFAULT_SCENE_PARAMS, type LyricLine, type Preset } from '@/lib/types';

const LOCAL_KEY = 'resona.presets.v1';

export interface StoredPreset {
  preset: Preset;
  /** 이 프리셋을 만든 곡. 파일을 다시 열면 이것으로 찾아 제안합니다 (F-703) */
  trackHash: string | null;
  trackTitle: string | null;
  updatedAt: number;
  /** 원격에 올라가 있는가. 아니면 대기열에 있습니다 */
  remote: boolean;
}

export interface LibraryState {
  presets: StoredPreset[];
  /** 아직 못 보낸 쓰기의 수 */
  pending: number;
  syncing: boolean;
  /** 마지막 실패. 화면에 조용히 띄우고 동작은 막지 않습니다 */
  error: string | null;
  /** F-703. 방금 연 곡에 맞는 프리셋 */
  suggestion: StoredPreset | null;
}

export const INITIAL_LIBRARY: LibraryState = {
  presets: [],
  pending: 0,
  syncing: false,
  error: null,
  suggestion: null,
};

/**
 * 곡을 알아보는 열쇠.
 *
 * 파일 내용을 통째로 해싱하면 확실하지만 7MB 짜리에서 눈에 띄게 걸립니다.
 * 이름과 크기만으로 만듭니다 — 같은 기계에서 같은 파일을 다시 여는, 실제로
 * 벌어지는 경우를 덮습니다. 이름을 바꾸면 연결이 끊기는 것은 감수합니다.
 */
export async function trackKeyOf(file: File, duration: number | null): Promise<TrackKey> {
  const seed = `${file.name}:${file.size}`;
  let hash = seed;
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
    hash = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    // SubtleCrypto 는 보안 컨텍스트에서만 됩니다. 안 되면 원문을 씁니다.
  }
  return { hash, title: file.name.replace(/\.[^.]+$/, ''), duration };
}

function readLocal(): StoredPreset[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as StoredPreset[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(list: StoredPreset[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
  } catch {
    /* 저장 공간이 막혔습니다. 원격이 살아 있으면 그쪽에 남습니다. */
  }
}

/** 프리셋 → `presets` 행. 스키마는 `06-data-model.md` 2절. */
function toRow(p: Preset, trackId: string | null): Record<string, unknown> {
  const c = p.sceneParams.common;
  return {
    id: p.id,
    name: p.name,
    track_id: trackId,
    scene: p.scene,
    influence: p.influence,
    // 평평한 넷은 스키마에 있는 그대로 채웁니다. 읽을 때는 `scene_params` 를
    // 씁니다 — 씬별 값까지 담고 있는 쪽이 그쪽입니다.
    intensity: c.intensity,
    trail: c.trail,
    grain: c.grain,
    glitch: c.glitch,
    audience_kind: p.audienceKind,
    locked_bpm: p.lockedBpm,
    tempo_locked: p.tempoLocked,
    palette_key: p.paletteId,
    palette_auto: p.paletteAuto,
    palette_fade: p.paletteFade,
    dreaminess_lock: p.dreaminessLock,
    scene_params: p.sceneParams,
    overrides: p.overrides,
    updated_at: new Date().toISOString(),
  };
}

/** `presets` 행 → 프리셋. 빠진 값은 기본값으로 채웁니다. */
function fromRow(row: Record<string, unknown>): StoredPreset {
  const sp = (row.scene_params ?? {}) as Partial<typeof DEFAULT_SCENE_PARAMS>;
  const preset: Preset = {
    id: String(row.id),
    name: String(row.name ?? '이름 없음'),
    trackId: (row.track_id as string | null) ?? null,
    scene: (row.scene as Preset['scene']) ?? 'weave',
    influence: Number(row.influence ?? 0.6),
    intensity: Number(row.intensity ?? 1),
    trail: Number(row.trail ?? 0.62),
    grain: Number(row.grain ?? 0.22),
    glitch: Number(row.glitch ?? 0.18),
    audienceKind: (row.audience_kind as Preset['audienceKind']) ?? 'none',
    lockedBpm: (row.locked_bpm as number | null) ?? null,
    tempoLocked: Boolean(row.tempo_locked),
    paletteId: (row.palette_key as string | null) ?? null,
    paletteAuto: row.palette_auto === undefined ? true : Boolean(row.palette_auto),
    paletteFade: Number(row.palette_fade ?? 2.5),
    dreaminessLock: (row.dreaminess_lock as number | null) ?? null,
    sceneParams: {
      common: { ...DEFAULT_SCENE_PARAMS.common, ...sp.common },
      weave: { ...DEFAULT_SCENE_PARAMS.weave, ...sp.weave },
      bloom: { ...DEFAULT_SCENE_PARAMS.bloom, ...sp.bloom },
      composite: { ...DEFAULT_SCENE_PARAMS.composite, ...sp.composite },
    },
    overrides: (row.overrides ?? {}) as Preset['overrides'],
  };
  const track = row.tracks as { file_hash?: string; title?: string } | null | undefined;
  return {
    preset,
    trackHash: track?.file_hash ?? null,
    trackTitle: track?.title ?? null,
    updatedAt: Date.parse(String(row.updated_at ?? '')) || Date.now(),
    remote: true,
  };
}

class Library {
  private state: LibraryState = INITIAL_LIBRARY;
  private listeners = new Set<() => void>();
  private started = false;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    this.start();
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): LibraryState => this.state;

  private patch(next: Partial<LibraryState>) {
    this.state = { ...this.state, ...next };
    for (const fn of this.listeners) fn();
  }

  private start() {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    this.patch({ presets: readLocal(), pending: pendingCount() });
    // 로그인 상태가 바뀌면 원격 목록을 다시 받고 밀린 것을 보냅니다.
    authManager.subscribe(() => void this.refresh());
    window.addEventListener('online', () => void this.flush());
    void this.refresh();
  }

  // ── 읽기 ──────────────────────────────────────────────────────

  /** 원격 목록을 받아 로컬과 합칩니다. 실패하면 로컬만 씁니다. */
  async refresh(): Promise<void> {
    const sb = getSupabase();
    const uid = authManager.userId;
    if (!sb || !uid) {
      this.patch({ presets: readLocal(), pending: pendingCount() });
      return;
    }
    this.patch({ syncing: true });
    try {
      const { data, error } = await sb
        .from('presets')
        .select('*, tracks(file_hash, title)')
        .order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      const remote = (data ?? []).map((r) => fromRow(r as Record<string, unknown>));
      this.patch({ presets: this.merge(remote), syncing: false, error: null });
    } catch (err) {
      this.patch({
        presets: readLocal(),
        syncing: false,
        error: err instanceof Error ? err.message : '목록을 받지 못했습니다.',
      });
    }
    await this.flush();
  }

  /** 원격과 로컬을 합칩니다. 같은 id 는 새로 고친 쪽이 이깁니다. */
  private merge(remote: StoredPreset[]): StoredPreset[] {
    const byId = new Map<string, StoredPreset>();
    for (const p of readLocal()) byId.set(p.preset.id, p);
    for (const p of remote) {
      const local = byId.get(p.preset.id);
      if (!local || p.updatedAt >= local.updatedAt) byId.set(p.preset.id, p);
    }
    const list = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
    writeLocal(list);
    return list;
  }

  // ── 쓰기 ──────────────────────────────────────────────────────

  /**
   * 프리셋을 저장합니다. **먼저 로컬에 남기고** 원격을 시도합니다.
   * 원격이 안 되면 대기열에 넣습니다. 던지지 않습니다.
   */
  async savePreset(preset: Preset, track: TrackKey | null): Promise<void> {
    const stored: StoredPreset = {
      preset,
      trackHash: track?.hash ?? null,
      trackTitle: track?.title ?? null,
      updatedAt: Date.now(),
      remote: false,
    };
    const list = [stored, ...readLocal().filter((p) => p.preset.id !== preset.id)];
    writeLocal(list);
    this.patch({ presets: list });

    enqueue({
      kind: 'preset',
      key: preset.id,
      at: Date.now(),
      row: toRow(preset, null),
      track,
    });
    this.patch({ pending: pendingCount() });
    await this.flush();
  }

  async deletePreset(id: string): Promise<void> {
    const list = readLocal().filter((p) => p.preset.id !== id);
    writeLocal(list);
    dequeue('preset', id);
    this.patch({ presets: list, pending: pendingCount() });
    const sb = getSupabase();
    if (!sb || !authManager.userId) return;
    try {
      await sb.from('presets').delete().eq('id', id);
    } catch {
      /* 지우지 못해도 화면에서는 사라집니다. 다음 새로 고침에 다시 보입니다. */
    }
  }

  /** 가사를 곡과 묶어 저장합니다 (F-605). 시각 미정 줄도 그대로 넣습니다. */
  async saveLyrics(lines: LyricLine[], track: TrackKey): Promise<void> {
    enqueue({ kind: 'lyrics', key: track.hash, at: Date.now(), lines, track });
    this.patch({ pending: pendingCount() });
    await this.flush();
  }

  /** 곡에 묶어 둔 가사를 받아 옵니다. 없으면 null 입니다. */
  async loadLyrics(track: TrackKey): Promise<LyricLine[] | null> {
    const sb = getSupabase();
    if (!sb || !authManager.userId) return null;
    try {
      const trackId = await this.resolveTrack(track);
      if (!trackId) return null;
      const { data, error } = await sb
        .from('lyrics')
        .select('lines')
        .eq('track_id', trackId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const lines = data?.lines;
      // `t: null` 을 그대로 살립니다. 시각 미정 줄을 버리지 않습니다.
      return Array.isArray(lines) ? (lines as LyricLine[]) : null;
    } catch (err) {
      this.patch({ error: err instanceof Error ? err.message : '가사를 받지 못했습니다.' });
      return null;
    }
  }

  // ── 동기화 ────────────────────────────────────────────────────

  /** 곡을 찾거나 만들어 id 를 돌려줍니다. */
  private async resolveTrack(track: TrackKey): Promise<string | null> {
    const sb = getSupabase();
    const uid = authManager.userId;
    if (!sb || !uid) return null;
    const { data, error } = await sb
      .from('tracks')
      .upsert(
        {
          title: track.title,
          duration: track.duration,
          file_hash: track.hash,
          user_id: uid,
        },
        { onConflict: 'user_id,file_hash' },
      )
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return (data?.id as string) ?? null;
  }

  /** 대기열을 비웁니다. 하나가 실패하면 그것만 남기고 넘어갑니다. */
  async flush(): Promise<void> {
    const sb = getSupabase();
    const uid = authManager.userId;
    if (!sb || !uid) return;
    const list = pendingList();
    if (list.length === 0) return;

    this.patch({ syncing: true });
    let failed: string | null = null;
    for (const item of list) {
      try {
        const trackId = item.track ? await this.resolveTrack(item.track) : null;
        if (item.kind === 'preset') {
          const { error } = await sb
            .from('presets')
            .upsert({ ...item.row, track_id: trackId, user_id: uid });
          if (error) throw new Error(error.message);
          const list2 = readLocal().map((p) =>
            p.preset.id === item.key ? { ...p, remote: true } : p,
          );
          writeLocal(list2);
        } else {
          const { error } = await sb.from('lyrics').upsert(
            { track_id: trackId, lines: item.lines, user_id: uid, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,track_id' },
          );
          if (error) throw new Error(error.message);
        }
        dequeue(item.kind, item.key);
      } catch (err) {
        failed = err instanceof Error ? err.message : '보내지 못했습니다.';
      }
    }
    this.patch({
      syncing: false,
      pending: pendingCount(),
      presets: readLocal(),
      error: failed,
    });
  }

  // ── F-703 곡 연결 ─────────────────────────────────────────────

  /**
   * 방금 연 곡에 맞는 프리셋을 찾아 제안합니다.
   *
   * **적용하지 않고 제안만 합니다.** 자동으로 걸면 리허설에서 손봐 둔 값이
   * 곡을 다시 여는 순간 사라집니다. 적용 순서는 F-703 그대로
   * `loadFile → 제안 → applyPreset` 입니다.
   */
  suggestFor(track: TrackKey | null): void {
    if (!track) {
      this.patch({ suggestion: null });
      return;
    }
    const hit = this.state.presets.find((p) => p.trackHash === track.hash) ?? null;
    this.patch({ suggestion: hit });
  }

  dismissSuggestion(): void {
    this.patch({ suggestion: null });
  }

  get configured(): boolean {
    return supabaseConfigured;
  }
}

export const library = new Library();
