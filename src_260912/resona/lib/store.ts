/**
 * 설정값 스토어. `docs/06-data-model.md` 5절.
 *
 * 여기에는 사용자가 조작할 때만 바뀌는 값만 둡니다. 매 프레임 바뀌는 분석값은
 * 넣지 마십시오. 넣으면 프레임마다 리렌더가 일어나 프레임이 떨어집니다.
 */
import { create } from 'zustand';
import { audioEngine } from '@/lib/audio/engine';
import { makeLine, quantize, sortLines, toDraft } from '@/lib/lyrics/lrc';
import {
  BUILTIN_PALETTES,
  MONO_PALETTE_ID,
  newPaletteId,
} from '@/lib/palette/builtin';
import type { TrackKey } from '@/lib/supabase/queue';
import {
  DEFAULT_SCENE_PARAMS,
  type AudienceSource,
  type DirectionParams,
  type LyricLine,
  type Palette,
  type PaletteRole,
  type Preset,
  type SceneKind,
  type SceneParams,
} from '@/lib/types';

/** 컬러칩 편집기 아래에 남기는 최근 색의 개수. `03-screens.md` 10 절. */
const RECENT_MAX = 8;

/**
 * 가사가 없을 때의 자리. **같은 객체를 계속 씁니다.**
 * `LyricsCursor` 는 배열이 바뀌면 커서를 처음부터 다시 잡으므로, 빌 때마다
 * 새 배열을 만들면 매 프레임 커서가 초기화됩니다.
 */
const NO_LYRICS: LyricLine[] = [];

interface ConsoleStore {
  scene: SceneKind;
  /** 관객 영향력 0~1. 0 이면 음악만으로 동작합니다. */
  influence: number;
  audienceKind: AudienceSource['kind'];
  /**
   * 07 씬 파라미터 (F-508). 공통 넷과 씬별 값이 한 곳에 모여 있습니다.
   * 플랫 필드로 흩어 두면 프리셋의 `scene_params` 와 두 벌이 됩니다.
   */
  sceneParams: SceneParams;
  blackout: boolean;
  overrides: Partial<Record<keyof DirectionParams, number>>;
  /** F-303-2. 확정한 템포와 자물쇠. 프리셋에 함께 저장됩니다. */
  lockedBpm: number | null;
  tempoLocked: boolean;
  /** 지금까지 두드린 횟수. 화면에 진행을 보여 주는 값이라 프리셋에는 없습니다. */
  tapCount: number;
  /** 시뮬레이션에서 손으로 밀어 올리는 몫 0~1 (F-303). */
  simGain: number;
  /** `A` 키로 영향력을 0 과 오가기 위해 직전 값을 기억합니다. */
  lastInfluence: number;

  // ── 05 팔레트 (F-1000) ──
  palettes: Palette[];
  paletteId: string;
  /**
   * 곡의 분위기가 팔레트를 고를지 (F-1002).
   * **자동과 수동은 둘 중 하나입니다** (8-5절). 켜져 있으면 `paletteId` 는
   * 직전 선택을 기억할 뿐 화면에 선택 표시가 나가지 않습니다.
   */
  paletteAuto: boolean;
  /** 색 전환 시상수(초) 0.5~8. */
  paletteFade: number;
  /** F-405. null 이면 자동 판정(`1 − arousal`)을 씁니다. */
  dreaminessLock: number | null;
  /** 컬러칩 편집기가 아래에 남기는 최근 색. */
  recentColors: string[];

  // ── 03 가사 큐 (F-600) ──
  /**
   * 시각순으로 정렬된 가사 줄. **매 프레임 바뀌는 값이 아닙니다** — 지금 어느
   * 줄인지는 `LyricsCursor` 가 캔버스 쪽에서 계산합니다 (F-602).
   */
  lyrics: LyricLine[];
  /** 어디서 온 가사인지. 패널이 파일 이름을 보여 줍니다. */
  lyricsName: string | null;
  /**
   * 편집 탭의 원문 영역 (F-603).
   *
   * **스토어가 들고 있습니다.** 큐와 원문이 따로 놀면 원문에 한 줄 적고
   * `파싱` 을 눌렀을 때 불러온 스무 줄이 그 한 줄로 바뀝니다. 큐를 바꾸는
   * 모든 동작이 여기를 함께 손봐야 해서, 규칙을 한 곳에 모았습니다.
   */
  lyricsDraft: string;
  /**
   * 원문 영역을 사람이 고쳐 큐와 어긋나 있는가.
   *
   * 손댄 상태에서는 큐가 바뀌어도 원문을 다시 그리지 않습니다 — 타이핑하던
   * 글이 사라지면 안 됩니다. **파일 로드만 예외입니다.** 파일을 여는 것은
   * "이 가사로 바꿔라" 라고 직접 말한 행위라 그 자리에서 갈아 끼웁니다.
   */
  lyricsDirty: boolean;
  /**
   * 전체 오프셋 버튼으로 지금까지 민 총량(초). 표시 전용입니다.
   *
   * 실제 값은 이미 각 줄의 `t` 에 들어가 있습니다. 여기에 따로 두는 것은
   * 오퍼레이터가 "얼마나 밀었더라" 를 화면에서 볼 수 있게 하려는 것뿐입니다.
   * 내보낼 때 `[offset:]` 으로 나가지 않습니다 (F-605).
   */
  lyricsOffset: number;
  /**
   * F-604 탭 모드. 켜져 있으면 `Space` 가 "현재 줄에 지금 시각 찍기" 입니다.
   *
   * **키 처리는 전역 단축키 처리기 한곳에서 갈립니다.** 편집기 컴포넌트가
   * 같은 키를 또 듣게 하면 한 번 누른 것이 두 줄에 찍힙니다.
   */
  tapMode: boolean;
  /** 다음에 찍을 줄. 찍을 때마다 하나씩 내려갑니다. */
  tapIndex: number;

  // ── 7단계 저장 ──
  /**
   * 지금 열려 있는 곡을 알아보는 열쇠 (F-703).
   * 프리셋·가사를 곡에 묶는 데 씁니다. 파일을 열 때만 바뀝니다.
   */
  trackKey: TrackKey | null;

  setScene(s: SceneKind): void;
  setInfluence(v: number): void;
  setAudienceKind(k: AudienceSource['kind']): void;
  setSimGain(v: number): void;
  /** 공통 넷을 고칩니다. */
  setCommonParam(key: keyof SceneParams['common'], v: number): void;
  setWeaveParam<K extends keyof SceneParams['weave']>(
    key: K,
    v: SceneParams['weave'][K],
  ): void;
  setBloomParam(key: keyof SceneParams['bloom'], v: number): void;
  setCompositeBase(base: SceneParams['composite']['base']): void;
  /** `자동` 버튼. 기본값으로 되돌립니다. */
  resetSceneParams(group: keyof SceneParams): void;
  toggleBlackout(): void;
  toggleInfluence(): void;
  setLockedBpm(bpm: number | null): void;
  /** 지금 화면에 보이는 값을 그대로 고정합니다. */
  lockTempoAt(bpm: number): void;
  unlockTempo(): void;
  /** 곡이 바뀌면 템포도 바뀌므로 확정값을 버립니다. 프리셋 적용은 예외입니다. */
  clearTempoLock(): void;
  /**
   * 탭 한 번. `T` 키와 탭 버튼이 **같은 경로로** 이곳을 부릅니다.
   * 두 곳에서 따로 세면 한쪽만 화면이 갱신됩니다.
   */
  registerTap(): void;
  /** 배수 보정. 지금 값에 계수를 곱해 확정하고 잠급니다. */
  applyTempoScale(factor: number): void;
  setOverride(key: keyof DirectionParams, v: number | null): void;

  /**
   * 큐를 갈아 끼웁니다 (파일 로드 · 파싱 · 균등 배분).
   * **원문 영역도 함께 갈고 손댄 상태를 풉니다.**
   */
  setLyrics(lines: LyricLine[], name: string | null): void;
  clearLyrics(): void;
  /** 원문 영역을 사람이 고쳤습니다. 손댄 상태가 됩니다. */
  setLyricsDraft(text: string): void;
  /** `되돌리기`. 원문 영역을 지금 큐의 내용으로 되돌리고 손댄 상태를 풉니다. */
  revertLyricsDraft(): void;
  /** 줄 하나의 타임스탬프를 고칩니다 (F-603). 고친 뒤 시각순으로 다시 세웁니다. */
  setLyricTime(index: number, t: number): void;
  /** 줄 하나의 글자를 고칩니다 (F-603). 표시 탭과 씬에 바로 반영됩니다. */
  setLyricText(index: number, text: string): void;
  /** 줄 하나를 지웁니다. */
  removeLyricLine(index: number): void;
  /**
   * 지금 재생 위치에 빈 줄을 넣습니다. 새 줄의 번호를 돌려줍니다 —
   * 편집기가 곧바로 그 줄의 글자 입력으로 들어갑니다.
   */
  addLyricLineHere(): number;
  /**
   * 전체 오프셋 (F-603). **`[offset:]` 태그와 부호가 반대입니다** (F-601).
   * 여기서는 타임스탬프 자체를 밀므로 `+0.1s` 를 누르면 가사가 늦게 뜹니다.
   */
  shiftLyrics(delta: number): void;
  /** 탭 모드를 켜고 끕니다 (F-604). 끌 때 줄을 시각순으로 다시 세웁니다. */
  setTapMode(on: boolean): void;
  /** 어느 줄부터 찍을지. 줄 목록에서 고릅니다. */
  setTapIndex(index: number): void;
  /** 지금 재생 위치를 현재 줄에 찍고 다음 줄로 내려갑니다 (F-604). */
  stampTap(): void;

  selectPalette(id: string): void;
  /**
   * `자동` 토글. 끌 때 `dominantId` 를 주면 그 팔레트가 선택됩니다 (8-5절).
   * 직전 섞임의 우세 팔레트를 넘기면 색이 크게 튀지 않습니다.
   */
  togglePaletteAuto(dominantId?: string): void;
  setPaletteFade(v: number): void;
  /** 자동이 꺼져 있을 때만 씁니다. `[` `]` 키가 부릅니다. */
  cyclePalette(step: 1 | -1): void;
  /** 자동 선택 후보에 넣거나 뺍니다. */
  togglePaletteCandidate(id: string): void;
  /**
   * 역할 하나의 색을 바꿉니다.
   * 기본 제공 팔레트를 고치면 사본이 만들어집니다 (F-1001).
   */
  updateChip(id: string, role: PaletteRole, hex: string): void;
  /** 2축 평면에서 앵커를 끌어 옮깁니다. 기본 팔레트면 역시 사본이 됩니다. */
  moveAnchor(id: string, valence: number, arousal: number): void;
  createPalette(): void;
  duplicatePalette(id: string): void;
  deletePalette(id: string): void;
  renamePalette(id: string, name: string): void;
  setDreaminessLock(v: number | null): void;

  setTrackKey(key: TrackKey | null): void;
  /**
   * 지금 콘솔 상태를 프리셋 한 벌로 뜹니다 (F-701). `applyPreset` 의 반대입니다.
   * 두 함수가 같은 목록을 다뤄야 저장했다 불러왔을 때 값이 빠지지 않습니다.
   */
  capturePreset(name: string, id?: string): Preset;
  applyPreset(p: Preset): void;
}

/**
 * 기본 제공 여덟 개는 지울 수 없고, **고치면 사본이 만들어집니다** (F-1001).
 *
 * 사본은 원본의 `auto` 를 물려받고 원본은 후보에서 빠집니다. 그러지 않으면
 * 앵커를 끌어 옮겼을 때 원본이 제자리에 남아 후보가 둘이 되고, "앵커를 옮기면
 * 다른 팔레트가 뽑힌다" 는 것이 성립하지 않습니다. 명세에 적혀 있지 않아
 * 이렇게 정했습니다.
 */
function forkIfBuiltin(
  palettes: Palette[],
  id: string,
): { palettes: Palette[]; id: string } {
  const i = palettes.findIndex((p) => p.id === id);
  if (i < 0) return { palettes, id };
  const src = palettes[i];
  if (!src.builtin) {
    return { palettes: palettes.slice(), id };
  }
  const copy: Palette = {
    ...src,
    id: newPaletteId(),
    name: `${src.name} 사본`,
    chips: { ...src.chips },
    anchor: { ...src.anchor },
    builtin: false,
  };
  const next = palettes.slice();
  next[i] = { ...src, auto: false };
  next.splice(i + 1, 0, copy);
  return { palettes: next, id: copy.id };
}

/**
 * 큐를 고친 결과를 넘깁니다. **원문 영역은 손대지 않은 상태에서만 따라옵니다.**
 *
 * 탭으로 시각을 찍거나 줄 목록에서 고치는 동안 원문을 매번 다시 그리면,
 * 원문 영역에 타이핑하던 글이 그때마다 지워집니다. 손댄 상태를 존중하되
 * 손대지 않았으면 큐를 그대로 비춥니다 (`issues/15` 의 표).
 */
function commit(
  s: { lyricsDirty: boolean },
  lyrics: LyricLine[],
): { lyrics: LyricLine[]; lyricsDraft?: string } {
  return s.lyricsDirty ? { lyrics } : { lyrics, lyricsDraft: toDraft(lyrics) };
}

/** `from` 번째부터 시각이 없는 첫 줄. 없으면 −1 입니다. */
function firstUndated(lines: LyricLine[], from = 0): number {
  for (let i = from; i < lines.length; i += 1) {
    if (lines[i].t === null) return i;
  }
  return -1;
}

/** 프리셋 id. 원격의 uuid 컬럼에 그대로 들어갑니다. */
function newPresetId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function pushRecent(list: string[], hex: string): string[] {
  const h = hex.toLowerCase();
  return [h, ...list.filter((c) => c !== h)].slice(0, RECENT_MAX);
}

export const useConsoleStore = create<ConsoleStore>((set, get) => ({
  scene: 'weave',
  influence: 0.6, // F-403 기본값
  // 관객은 증폭기이지 전제 조건이 아니므로 꺼진 상태로 시작합니다.
  audienceKind: 'none',
  sceneParams: {
    common: { ...DEFAULT_SCENE_PARAMS.common },
    weave: { ...DEFAULT_SCENE_PARAMS.weave },
    bloom: { ...DEFAULT_SCENE_PARAMS.bloom },
    composite: { ...DEFAULT_SCENE_PARAMS.composite },
  },
  blackout: false,
  overrides: {},
  lockedBpm: null,
  tempoLocked: false,
  tapCount: 0,
  simGain: 0,
  lastInfluence: 0.6,

  palettes: BUILTIN_PALETTES.map((p) => ({
    ...p,
    chips: { ...p.chips },
    anchor: { ...p.anchor },
  })),
  paletteId: MONO_PALETTE_ID,
  paletteAuto: true,
  paletteFade: 2.5, // 8-4절 기본값
  dreaminessLock: null,
  recentColors: [],
  lyrics: NO_LYRICS,
  lyricsName: null,
  lyricsDraft: '',
  lyricsDirty: false,
  lyricsOffset: 0,
  tapMode: false,
  tapIndex: 0,
  trackKey: null,

  setScene: (scene) => set({ scene }),
  setInfluence: (v) =>
    set((s) => ({ influence: v, lastInfluence: v > 0 ? v : s.lastInfluence })),
  setAudienceKind: (audienceKind) => set({ audienceKind }),
  setSimGain: (simGain) => set({ simGain }),
  setCommonParam: (key, v) =>
    set((s) => ({
      sceneParams: { ...s.sceneParams, common: { ...s.sceneParams.common, [key]: v } },
    })),
  setWeaveParam: (key, v) =>
    set((s) => ({
      sceneParams: { ...s.sceneParams, weave: { ...s.sceneParams.weave, [key]: v } },
    })),
  setBloomParam: (key, v) =>
    set((s) => ({
      sceneParams: { ...s.sceneParams, bloom: { ...s.sceneParams.bloom, [key]: v } },
    })),
  setCompositeBase: (base) =>
    set((s) => ({ sceneParams: { ...s.sceneParams, composite: { base } } })),
  resetSceneParams: (group) =>
    set((s) => ({
      sceneParams: { ...s.sceneParams, [group]: { ...DEFAULT_SCENE_PARAMS[group] } },
    })),
  toggleBlackout: () => set((s) => ({ blackout: !s.blackout })),
  setLockedBpm: (lockedBpm) => set({ lockedBpm }),
  lockTempoAt: (bpm) =>
    set({ lockedBpm: Math.round(bpm * 10) / 10, tempoLocked: true }),
  unlockTempo: () => set({ tempoLocked: false }),
  clearTempoLock: () => set({ lockedBpm: null, tempoLocked: false, tapCount: 0 }),
  registerTap: () => {
    const bpm = audioEngine.tap();
    // 시간 초과로 다시 세기 시작했을 수 있으므로 엔진의 값을 그대로 읽습니다.
    set({ tapCount: audioEngine.tapCount });
    if (bpm === null) return;
    // 네 번째에 도달하는 순간 잠급니다. 탭을 친다는 것 자체가
    // "내가 값을 정하겠다"는 의사이므로 그대로 존중합니다. 잠그지 않으면
    // 0.4초 뒤 자동 추정에 덮어씌워져 아무 일도 없던 것처럼 보입니다.
    set({ lockedBpm: Math.round(bpm * 10) / 10, tempoLocked: true });
  },
  applyTempoScale: (factor) =>
    set({
      lockedBpm: Math.round(audioEngine.scaledBpm(factor) * 10) / 10,
      tempoLocked: true,
    }),
  toggleInfluence: () =>
    set((s) => ({
      influence: s.influence > 0 ? 0 : s.lastInfluence,
    })),
  setOverride: (key, v) =>
    set((s) => {
      const overrides = { ...s.overrides };
      if (v === null) delete overrides[key];
      else overrides[key] = v;
      return { overrides };
    }),
  selectPalette: (paletteId) =>
    // 카드를 누른다는 것 자체가 "내가 색을 정하겠다" 는 의사입니다.
    // 탭 템포(F-303-2)와 같은 원칙으로, 사람이 개입하면 자동이 물러납니다.
    set({ paletteId, paletteAuto: false }),
  togglePaletteAuto: (dominantId) =>
    set((s) => {
      if (s.paletteAuto) {
        // 끄는 길. 카드를 안 눌렀으므로 직전 섞임의 우세 팔레트를 고릅니다.
        const has = dominantId && s.palettes.some((p) => p.id === dominantId);
        return { paletteAuto: false, paletteId: has ? dominantId : s.paletteId };
      }
      // 켜는 길. 선택이 풀립니다 — 화면에서 선택 표시가 사라집니다.
      return { paletteAuto: true };
    }),
  setPaletteFade: (v) => set({ paletteFade: Math.min(8, Math.max(0.5, v)) }),
  cyclePalette: (step) =>
    set((s) => {
      // 자동이 켜져 있으면 색을 분위기가 정합니다. 여기서 건드리지 않습니다.
      if (s.paletteAuto || s.palettes.length === 0) return {};
      const i = s.palettes.findIndex((p) => p.id === s.paletteId);
      const n = s.palettes.length;
      const next = ((i < 0 ? 0 : i + step) + n) % n;
      return { paletteId: s.palettes[next].id };
    }),
  togglePaletteCandidate: (id) =>
    set((s) => ({
      palettes: s.palettes.map((p) => (p.id === id ? { ...p, auto: !p.auto } : p)),
    })),
  updateChip: (id, role, hex) =>
    set((s) => {
      const forked = forkIfBuiltin(s.palettes, id);
      const i = forked.palettes.findIndex((p) => p.id === forked.id);
      if (i < 0) return {};
      const target = forked.palettes[i];
      forked.palettes[i] = { ...target, chips: { ...target.chips, [role]: hex } };
      return {
        palettes: forked.palettes,
        paletteId: forked.id,
        recentColors: pushRecent(s.recentColors, hex),
      };
    }),
  moveAnchor: (id, valence, arousal) =>
    set((s) => {
      const forked = forkIfBuiltin(s.palettes, id);
      const i = forked.palettes.findIndex((p) => p.id === forked.id);
      if (i < 0) return {};
      forked.palettes[i] = {
        ...forked.palettes[i],
        anchor: { valence: clamp01(valence), arousal: clamp01(arousal) },
      };
      // 앵커를 옮기는 것은 자동 선택을 조정하는 일이라 선택을 바꾸지 않습니다.
      return { palettes: forked.palettes };
    }),
  setLyrics: (lines, lyricsName) =>
    set(() => {
      const next = lines.length > 0 ? sortLines(lines) : NO_LYRICS;
      return {
        lyrics: next,
        lyricsName,
        // 파일 로드·파싱·균등 배분은 모두 "이 가사로 바꿔라" 입니다.
        // 손댄 글이 있어도 갈아 끼우고 손댄 상태를 풉니다.
        lyricsDraft: toDraft(next),
        lyricsDirty: false,
        lyricsOffset: 0,
        // 미정 줄이 없으면 처음부터 다시 찍을 수 있게 0 으로 둡니다.
        tapIndex: Math.max(0, firstUndated(next)),
      };
    }),
  clearLyrics: () =>
    set({
      lyrics: NO_LYRICS,
      lyricsName: null,
      lyricsDraft: '',
      lyricsDirty: false,
      lyricsOffset: 0,
      tapMode: false,
      tapIndex: 0,
    }),
  setLyricsDraft: (lyricsDraft) => set({ lyricsDraft, lyricsDirty: true }),
  revertLyricsDraft: () =>
    set((s) => ({ lyricsDraft: toDraft(s.lyrics), lyricsDirty: false })),
  setLyricTime: (index, t) =>
    set((s) => {
      if (index < 0 || index >= s.lyrics.length) return {};
      const next = s.lyrics.slice();
      next[index] = { ...next[index], t: quantize(t) };
      return commit(s, sortLines(next));
    }),
  setLyricText: (index, text) =>
    set((s) => {
      if (index < 0 || index >= s.lyrics.length) return {};
      const next = s.lyrics.slice();
      next[index] = makeLine(next[index].t, text);
      return commit(s, next);
    }),
  removeLyricLine: (index) =>
    set((s) => {
      if (index < 0 || index >= s.lyrics.length) return {};
      const next = s.lyrics.filter((_, i) => i !== index);
      return {
        ...commit(s, next.length > 0 ? next : NO_LYRICS),
        tapIndex: Math.min(s.tapIndex, Math.max(0, next.length - 1)),
      };
    }),
  addLyricLineHere: () => {
    const s = get();
    const t = quantize(audioEngine.currentTime);
    const next = sortLines([...s.lyrics, makeLine(t, '')]);
    // 정렬 뒤의 자리를 찾아 돌려줍니다. 같은 시각이 여럿이면 글자가 빈
    // 줄이 방금 넣은 것입니다.
    const index = next.findIndex((l) => l.t === t && l.text === '');
    set(commit(s, next));
    return index < 0 ? next.length - 1 : index;
  },
  shiftLyrics: (delta) =>
    set((s) => {
      if (s.lyrics.length === 0) return {};
      // 첫 줄이 0 아래로 내려가지 않는 만큼만 밉니다. 줄마다 0 에서 자르면
      // 앞쪽 줄들이 한 자리에 뭉쳐, 되돌려도 간격이 돌아오지 않습니다.
      // 시각 미정 줄은 밀 것이 없으므로 셈에서 뺍니다.
      let earliest = Infinity;
      for (const l of s.lyrics) if (l.t !== null && l.t < earliest) earliest = l.t;
      if (!Number.isFinite(earliest)) return {};
      const d = Math.max(delta, -earliest);
      if (d === 0) return {};
      const next = s.lyrics.map((l) =>
        l.t === null ? l : { ...l, t: quantize(l.t + d) },
      );
      return { ...commit(s, next), lyricsOffset: s.lyricsOffset + d };
    }),
  setTapMode: (on) =>
    set((s) => {
      // 뒤로 탐색하며 찍으면 순서가 어긋날 수 있습니다. 나올 때 세웁니다.
      // 찍는 중에 세우면 손 밑에서 줄이 자리를 바꿔 다음 줄을 놓칩니다.
      // 찍기는 시각 미정 줄부터 시작합니다. 없으면 첫 줄부터 다시 찍습니다.
      if (on) return { tapMode: true, tapIndex: Math.max(0, firstUndated(s.lyrics)) };
      return { tapMode: false, ...commit(s, sortLines(s.lyrics)) };
    }),
  setTapIndex: (index) =>
    set((s) => ({ tapIndex: Math.max(0, Math.min(s.lyrics.length, index)) })),
  stampTap: () =>
    set((s) => {
      const i = s.tapIndex;
      if (i < 0 || i >= s.lyrics.length) return {};
      const next = s.lyrics.slice();
      // LRC 가 담을 수 있는 1/100초에 맞춰 둡니다. 그래야 내보냈다 다시
      // 읽어도 값이 그대로입니다 (F-605).
      next[i] = { ...next[i], t: quantize(audioEngine.currentTime) };
      // 여기서는 정렬하지 않습니다. 위의 `setTapMode` 주석 참고.
      // 다음은 아직 시각이 없는 줄입니다. 남은 것이 없으면 그냥 한 칸
      // 내려가 이미 찍은 줄을 다시 찍을 수 있게 둡니다.
      const after = firstUndated(next, i + 1);
      return {
        ...commit(s, next),
        tapIndex: after >= 0 && after < next.length ? after : i + 1,
      };
    }),

  createPalette: () =>
    set((s) => {
      const base =
        s.palettes.find((p) => p.id === s.paletteId) ?? s.palettes[0];
      const made: Palette = {
        id: newPaletteId(),
        name: '새 팔레트',
        chips: { ...base.chips },
        auto: false,
        anchor: { valence: 0.5, arousal: 0.5 },
        builtin: false,
      };
      return { palettes: [...s.palettes, made], paletteId: made.id, paletteAuto: false };
    }),
  duplicatePalette: (id) =>
    set((s) => {
      const i = s.palettes.findIndex((p) => p.id === id);
      if (i < 0) return {};
      const src = s.palettes[i];
      const made: Palette = {
        ...src,
        id: newPaletteId(),
        name: `${src.name} 사본`,
        chips: { ...src.chips },
        anchor: { ...src.anchor },
        auto: false,
        builtin: false,
      };
      const palettes = s.palettes.slice();
      palettes.splice(i + 1, 0, made);
      return { palettes, paletteId: made.id, paletteAuto: false };
    }),
  deletePalette: (id) =>
    set((s) => {
      const victim = s.palettes.find((p) => p.id === id);
      // 기본 제공 여덟 개는 지울 수 없습니다.
      if (!victim || victim.builtin) return {};
      const palettes = s.palettes.filter((p) => p.id !== id);
      if (palettes.length === 0) return {};
      return {
        palettes,
        paletteId:
          s.paletteId === id
            ? (palettes.find((p) => p.id === MONO_PALETTE_ID) ?? palettes[0]).id
            : s.paletteId,
      };
    }),
  renamePalette: (id, name) =>
    set((s) => ({
      palettes: s.palettes.map((p) =>
        p.id === id && !p.builtin ? { ...p, name } : p,
      ),
    })),
  setDreaminessLock: (v) =>
    set({ dreaminessLock: v === null ? null : clamp01(v) }),

  setTrackKey: (trackKey) => set({ trackKey }),
  capturePreset: (name, id) => {
    const s = get();
    const c = s.sceneParams.common;
    return {
      id: id ?? newPresetId(),
      name,
      trackId: null,
      scene: s.scene,
      influence: s.influence,
      // 평평한 넷은 스키마(`06-data-model.md` 2절)에 있는 그대로 채웁니다.
      intensity: c.intensity,
      trail: c.trail,
      grain: c.grain,
      glitch: c.glitch,
      audienceKind: s.audienceKind,
      lockedBpm: s.lockedBpm,
      tempoLocked: s.tempoLocked,
      paletteId: s.paletteId,
      paletteAuto: s.paletteAuto,
      paletteFade: s.paletteFade,
      dreaminessLock: s.dreaminessLock,
      sceneParams: {
        common: { ...s.sceneParams.common },
        weave: { ...s.sceneParams.weave },
        bloom: { ...s.sceneParams.bloom },
        composite: { ...s.sceneParams.composite },
      },
      overrides: { ...s.overrides },
    };
  },
  applyPreset: (p) =>
    set({
      scene: p.scene,
      influence: p.influence,
      lastInfluence: p.influence > 0 ? p.influence : get().lastInfluence,
      sceneParams: {
        common: { ...p.sceneParams.common },
        weave: { ...p.sceneParams.weave },
        bloom: { ...p.sceneParams.bloom },
        composite: { ...p.sceneParams.composite },
      },
      audienceKind: p.audienceKind,
      overrides: { ...p.overrides },
      lockedBpm: p.lockedBpm,
      tempoLocked: p.tempoLocked,
      tapCount: 0,
      simGain: 0,
      paletteId: p.paletteId ?? MONO_PALETTE_ID,
      paletteAuto: p.paletteAuto,
      paletteFade: p.paletteFade,
      dreaminessLock: p.dreaminessLock,
    }),
}));

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
