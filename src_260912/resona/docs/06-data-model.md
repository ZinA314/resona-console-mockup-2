# 06. 데이터 모델

## 1. 저장하는 것과 저장하지 않는 것

**저장하지 않습니다**
- 카메라 프레임과 그 파생물(격자 값 포함)
- 마이크 오디오
- 음원 파일 자체
- 관객 개인을 특정할 수 있는 어떤 정보도

**저장합니다**
- 프리셋 (연출 설정)
- 가사 큐
- 세션 요약 (관객 에너지의 시계열 통계)

관객 에너지의 시계열은 개인 정보가 아니라 객석 전체의 집계값입니다. 그래도 원본 신호가 아니라 1초 단위로 요약한 값만 남깁니다.

## 2. Supabase 스키마

```sql
-- 곡
create table tracks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  artist      text,
  duration    real,                    -- 초
  file_hash   text,                    -- 같은 파일을 알아보기 위한 해시
  created_at  timestamptz default now(),
  user_id     uuid references auth.users(id)
);

-- 프리셋
create table presets (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  track_id     uuid references tracks(id) on delete set null,
  scene        text not null default 'weave',
  influence    real not null default 0.6,   -- 관객 영향력 0~1
  intensity    real not null default 1.0,
  trail        real not null default 0.62,
  grain        real not null default 0.22,
  glitch       real not null default 0.18,
  audience_kind text not null default 'camera',  -- camera | microphone | simulation | none
  locked_bpm   real,                              -- 탭이나 배수 보정으로 확정한 BPM
  tempo_locked boolean not null default false,
  palette_id     uuid,                            -- 선택한 팔레트 (아래 palettes)
  palette_auto   boolean not null default true,   -- 분위기가 팔레트를 고를지
  palette_fade   real not null default 2.5,       -- 색 전환 시상수(초)
  dreaminess_lock real,                           -- null 이면 자동 판정을 씁니다
  scene_params   jsonb default '{}'::jsonb,       -- 씬별 슬라이더 (F-508)
  overrides    jsonb default '{}'::jsonb,        -- 수동 고정한 파라미터
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  user_id      uuid references auth.users(id)
);

-- 팔레트 (F-1000)
create table palettes (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  chips      jsonb not null,          -- { bg, deep, base, accent, hot } 각 '#RRGGBB'
  auto       boolean not null default true,   -- 자동 선택 후보에 넣을지
  anchor     jsonb not null default '{"valence":0.5,"arousal":0.5}'::jsonb,
  builtin    boolean not null default false,
  created_at timestamptz default now(),
  user_id    uuid references auth.users(id)
);

alter table presets
  add constraint presets_palette_fk
  foreign key (palette_id) references palettes(id) on delete set null;

-- 가사
create table lyrics (
  id         uuid primary key default gen_random_uuid(),
  track_id   uuid references tracks(id) on delete cascade,
  lines      jsonb not null,           -- [{ t: 12.34 | null, text: "...", words: [...] }]
  created_at timestamptz default now(),
  user_id    uuid references auth.users(id)
);

-- 세션 (리허설 또는 공연 한 회)
create table sessions (
  id          uuid primary key default gen_random_uuid(),
  track_id    uuid references tracks(id) on delete set null,
  preset_id   uuid references presets(id) on delete set null,
  label       text,                    -- "10/12 리허설 2회차"
  started_at  timestamptz not null,
  duration    real,
  avg_audience real,                   -- 평균 관객 에너지
  peak_audience real,
  created_at  timestamptz default now(),
  user_id     uuid references auth.users(id)
);

-- 세션 안의 시계열 (1초 간격 요약)
create table session_samples (
  id          bigserial primary key,
  session_id  uuid references sessions(id) on delete cascade,
  t           real not null,           -- 세션 시작 후 경과 초
  audience    real not null,           -- 0~1
  rms         real not null,
  bpm         real,
  state       text                     -- MusicState
);

create index on session_samples (session_id, t);
```

마이그레이션은 `supabase/migrations/` 에 있습니다. `0001_init.sql` 이 스키마, `0002_rls.sql` 이 정책입니다. 적용 절차는 `08-deploy.md`.

스키마에서 두 가지가 명세와 다릅니다.

- `presets.palette_key text` 를 더했습니다. 콘솔이 들고 있는 팔레트 식별자는 `mono` 처럼 문자열이라 `palette_id uuid` 에 넣을 수 없습니다. `palettes` 테이블을 동기화하는 날 `palette_id` 를 채웁니다
- `tracks (user_id, file_hash)` 와 `lyrics (user_id, track_id)` 에 유일 인덱스를 걸었습니다. 같은 곡을 다시 열어도 행이 늘어나지 않고, 가사는 곡 하나에 한 벌입니다
- `tracks.file_hash` 는 `not null` 입니다. 아래에 이유가 있습니다

`file_hash` 는 파일 내용이 아니라 **이름과 크기**로 만듭니다 — `sha256("이름:크기")` 입니다. 7MB 짜리를 통째로 해싱하면 파일을 열 때마다 눈에 띄게 걸립니다. 같은 기계에서 같은 파일을 다시 여는, 실제로 벌어지는 경우를 덮습니다. 이름을 바꾸면 연결이 끊기는 것은 감수합니다.

이름이 `file_hash` 인데 내용 해시가 아니라는 점이 걸리지만 그대로 둡니다. 지금 담긴 값도 해시이고(대상이 바이트가 아니라 이름과 크기일 뿐), 나중에 내용 해시로 옮기면 이름이 정확히 맞아떨어집니다. 그때까지 `file_key` 로 갔다가 되돌아오면 마이그레이션만 두 번입니다.

#### 유일 인덱스를 부분에서 통짜로 바꾼 경위

처음에는 `where file_hash is not null` 을 붙인 **부분** 유일 인덱스였습니다. 그러면 `on conflict (user_id, file_hash)` 가 그 인덱스를 찾지 못해 upsert 가 `there is no unique or exclusion constraint matching the ON CONFLICT specification` 으로 실패합니다. 추론에 같은 술어를 적어야 하는데 supabase-js 로는 그렇게 보낼 수 없습니다. (실제 Postgres 에 돌려 보고 잡은 것입니다)

통짜로 바꾸면 유일 인덱스에서 NULL 이 서로 다른 값이라는 문제가 따라옵니다. `file_hash` 가 비어 있는 행이 생기면 저장할 때마다 곡이 쌓입니다. 앱에는 그런 경로가 없습니다 — `trackKeyOf` 가 언제나 값을 만들고(`SubtleCrypto` 가 막혀도 원문 `"이름:크기"` 로 물러섭니다), `resolveTrack` 은 곡 열쇠 없이는 불리지 않습니다. 그래서 컬럼을 `not null` 로 못 박아 경로가 생기는 것 자체를 막았습니다.

## 3. 행 수준 보안

정책을 만들지 않으면 앱에서 접근할 때 401 또는 403 이 납니다. 12회차에서 다룬 내용입니다.

**다만 "기본으로 켜져 있다" 는 것은 Table Editor 로 만든 테이블에 한합니다.** SQL Editor 에서 `create table` 로 만들면 RLS 가 꺼진 채로 생기고, 그대로 두면 아무나 읽을 수 있습니다 (SQL Editor 가 "creates tables without enabling RLS" 로 경고하고 `Run and enable RLS` 를 권합니다). 그래서 `0001_init.sql` 이 테이블을 다 만든 뒤 마지막에 여섯 개 모두 `enable row level security` 를 겁니다. 정책은 `0002_rls.sql` 이지만 켜는 것은 0001 입니다 — 0001 만 돌리고 멈춘 상태가 "아무나 읽을 수 있는" 것보다 "아무도 못 읽는" 편이 낫기 때문입니다.

권한(`grant`)도 `0002_rls.sql` 이 직접 줍니다. 프로젝트를 만들 때 `Automatically expose new tables` 를 꺼 두면 Data API 역할에 권한이 붙지 않아 `permission denied` 가 나는데, 설정과 무관하게 돌아야 합니다.

각 테이블에 같은 형태의 정책을 겁니다.

```sql
alter table presets enable row level security;

create policy "본인 것만 읽기" on presets
  for select using (auth.uid() = user_id);

create policy "본인 것만 쓰기" on presets
  for insert with check (auth.uid() = user_id);

create policy "본인 것만 수정" on presets
  for update using (auth.uid() = user_id);

create policy "본인 것만 삭제" on presets
  for delete using (auth.uid() = user_id);
```

`tracks`, `lyrics`, `sessions`, `palettes` 도 같습니다. 다만 `palettes` 의 읽기 정책에는 기본 제공 팔레트를 위해 `or builtin` 을 더합니다. 기본 여덟 개는 모든 사용자가 읽되 고치면 자기 사본이 생깁니다. `session_samples` 는 부모 세션을 통해 확인합니다.

```sql
create policy "부모 세션이 내 것일 때만" on session_samples
  for all using (
    exists (
      select 1 from sessions s
      where s.id = session_samples.session_id and s.user_id = auth.uid()
    )
  );
```

## 4. 타입 정의

프론트엔드에서 쓰는 타입입니다. `lib/types.ts` 에 둡니다.

```ts
/** 오디오 분석 결과. 매 프레임 갱신됩니다. */
export interface MusicAnalysis {
  rms: number;            // 0~1
  peak: number;           // 0~1
  flux: number;           // 0~1 근사
  centroid: number;       // Hz
  bands: [number, number, number, number, number, number];  // SUB LOW LMID MID HI AIR
  stems: [number, number, number, number];                  // drums bass vocal other
  stemPeak: [number, number, number, number];

  bpm: number;
  bpmConf: number;        // 0~1
  beat: number;           // 누적 비트 수
  bar: number;            // 마디 번호
  beatInBar: 1 | 2 | 3 | 4;
  phase: number;          // 현재 비트 안의 진행 0~1

  onset: 0 | 1;
  onsetPulse: number;     // 0~1, 온셋 후 감쇠
  transitionPulse: number;// 0~1, 상태 전이 후 감쇠

  spectrum: Float32Array; // 표시용
}

export type MusicState =
  | 'SILENT' | 'CALM' | 'GROOVE' | 'BUILD' | 'PEAK' | 'BREAK';

export type MoodName =
  | 'DEEP' | 'SERENE' | 'RADIANT' | 'FERVENT' | 'NEUTRAL';

/** 곡의 성격. MusicState 가 순간이라면 이쪽은 곡 단위입니다. */
export interface Mood {
  valence: number;      // 0~1  밝음.   색을 정합니다
  arousal: number;      // 0~1  격렬함. 결을 정합니다
  name: MoodName;       // 표시용. 연출은 위 두 실수를 직접 씁니다
  chromaConf: number;   // 0~1  화음을 얼마나 확신하는가
}

export type PaletteRole = 'bg' | 'deep' | 'base' | 'accent' | 'hot';

export interface Palette {
  id: string;
  name: string;
  chips: Record<PaletteRole, string>;              // '#RRGGBB'
  auto: boolean;                                    // 자동 선택 후보인가
  anchor: { valence: number; arousal: number };
  builtin: boolean;
}

/** 보간이 끝나 씬에 넘기는 색. 선형 RGB 0~1 입니다. */
export interface ResolvedPalette {
  bg: [number, number, number];
  deep: [number, number, number];
  base: [number, number, number];
  accent: [number, number, number];
  hot: [number, number, number];
  /** 화면 표시용 — [{ name: '침잠', weight: 0.62 }, ...] */
  blend: { name: string; weight: number }[];
}

export type AudienceState =
  | 'DORMANT' | 'STIRRING' | 'ACTIVE' | 'SURGE';

/** 관객 입력원. 카메라와 마이크가 이 인터페이스를 각각 구현합니다. */
export interface AudienceSource {
  readonly kind: 'camera' | 'microphone' | 'simulation' | 'none';
  start(): Promise<void>;
  stop(): void;
  read(dt: number): number;      // 0~1
  readonly calibration: number;  // 0~1
}

/** 연출 번역 엔진의 출력 */
export interface DirectionParams {
  density: number;
  scale: number;
  speed: number;
  brightness: number;
  expansion: number;
  glitch: number;
  /** 0 날카로움 ↔ 1 번짐. 무대 씬의 결을 정합니다 */
  dreaminess: number;
  /** 이 프레임의 색 */
  palette: ResolvedPalette;
  /** 지금 곡의 성격 */
  mood: Mood;
  /** 팔레트 accent 의 색상각 ÷ 360. 외부 연동 하위 호환용입니다 */
  hue: number;
  /** 관객 기여분을 화면에 표시하기 위한, 음악만으로 계산한 같은 값들 */
  musicOnly: Omit<DirectionParams, 'musicOnly' | 'palette' | 'mood'>;
}

export type SceneKind =
  | 'weave' | 'type' | 'faces' | 'spectrum' | 'composite' | 'bloom';

/** 07 씬 파라미터 패널이 다루는 값 (F-508) */
export interface SceneParams {
  common: { intensity: number; trail: number; grain: number; glitch: number };
  weave:  { warp: number; weft: number; tension: number; rate: number; split: boolean };
  bloom:  { maxParticles: number; warpScale: number; bloomRadius: number; bloomStrength: number };
  composite: { base: 'weave' | 'bloom' };
}

export interface Preset {
  id: string;
  name: string;
  trackId: string | null;
  scene: SceneKind;
  influence: number;      // 관객 영향력 0~1
  intensity: number;
  trail: number;
  grain: number;
  glitch: number;
  audienceKind: AudienceSource['kind'];
  lockedBpm: number | null;
  tempoLocked: boolean;
  paletteId: string | null;
  paletteAuto: boolean;
  paletteFade: number;        // 초
  dreaminessLock: number | null;
  sceneParams: SceneParams;
  overrides: Partial<Record<keyof DirectionParams, number>>;
}

export interface LyricLine {
  t: number | null;       // 초. null 이면 시각 미정
  text: string;
  words: string[];
}

/** 지금 어느 줄의 어디를 부르고 있는가 (F-602). 매 프레임 바뀝니다. */
export interface LyricCue {
  index: number;          // lines 배열의 원래 번호. 첫 줄 전이면 −1
  ordinal: number;        // 시각 있는 줄만 셌을 때 몇 번째인가. 첫 줄 전이면 0
  total: number;          // 시각이 붙어 재생에 쓰이는 줄의 수
  line: LyricLine | null;
  next: LyricLine | null;
  progress: number;       // 현재 줄 안의 진행 0~1
  word: number;           // 지금 부르는 단어. 없으면 −1
}
```

**시각이 없는 줄도 큐에 남습니다** (`t: null`). 파싱에서 버리면 `길이에 균등 배분` 이 나눌 대상이 이미 사라져 두 기능이 서로를 무효로 만듭니다. 재생·내보내기에서만 건너뛰므로, `LyricCue` 의 `total` 과 `ordinal` 은 시각이 붙은 줄만 셉니다. `index` 는 원래 배열의 번호라서 편집기의 줄 목록이 그대로 씁니다.

Supabase 의 `lyrics.lines` 도 같은 모양입니다. `t` 가 `null` 인 줄이 섞일 수 있습니다.

`LyricCue` 는 스토어에 넣지 않습니다. 매 프레임 바뀌는 값이라 React 상태에 올리면 초당 예순 번 리렌더가 일어납니다. 스토어가 드는 것은 `LyricLine[]` 까지이고, 큐는 `LyricsCursor` 가 캔버스 쪽에서 계산해 `SceneInput` 으로 넘어갑니다. 03 패널은 진행 막대를 DOM 에 직접 쓰고, 줄이 넘어가는 순간에만 상태를 갱신합니다.

출력 창에는 곡의 위치라는 것이 없으므로(`SceneInput.time` 은 `AudioContext.currentTime` 입니다) 큐를 계산할 수 없습니다. 계산 결과를 `BroadcastChannel` 에 실어 보냅니다.

## 5. 상태 관리

실시간 값과 설정값을 구분합니다. 섞으면 매 프레임 리렌더가 일어나 프레임이 떨어집니다.

**실시간 값** — React 상태에 넣지 않습니다. `useRef` 로 들고 있다가 캔버스에서 직접 읽습니다. 화면 표시가 필요한 수치는 4프레임마다 한 번씩만 상태로 밀어 올립니다.

**설정값** — Zustand 스토어에 둡니다. 사용자가 조작할 때만 바뀌므로 리렌더가 문제되지 않습니다.

```ts
// lib/store.ts
interface ConsoleStore {
  scene: SceneKind;
  influence: number;
  audienceKind: AudienceSource['kind'];
  intensity: number;
  trail: number;
  grain: number;
  glitchAmount: number;
  blackout: boolean;
  palettes: Palette[];
  paletteId: string;
  paletteAuto: boolean;
  paletteFade: number;
  dreaminessLock: number | null;
  sceneParams: SceneParams;
  overrides: Partial<Record<keyof DirectionParams, number>>;

  setScene(s: SceneKind): void;
  setInfluence(v: number): void;
  toggleBlackout(): void;
  togglePaletteAuto(): void;
  updateChip(paletteId: string, role: PaletteRole, hex: string): void;
  moveAnchor(paletteId: string, valence: number, arousal: number): void;
  applyPreset(p: Preset): void;
  // ...
}
```

## 6. 파일 구조

```
resona/
├─ CLAUDE.md
├─ docs/                     이 명세들
├─ app/
│  ├─ page.tsx               콘솔
│  ├─ output/page.tsx        출력 창
│  └─ layout.tsx
├─ components/
│  ├─ console/               패널 9개
│  │  ├─ InputPanel.tsx
│  │  ├─ StemPanel.tsx
│  │  ├─ LyricsPanel.tsx     표시 탭과 탭 전환
│  │  ├─ LyricsEditor.tsx    편집 탭 (LRC 편집기, F-603~605)
│  │  ├─ AudiencePanel.tsx
│  │  ├─ ScenePanel.tsx
│  │  ├─ DirectionPanel.tsx
│  │  ├─ ReadoutPanel.tsx
│  │  ├─ RoutingPanel.tsx
│  │  ├─ KeysPanel.tsx
│  │  ├─ PalettePanel.tsx
│  │  ├─ PresetPanel.tsx      12 프리셋 (F-700)
│  │  └─ SceneParamsPanel.tsx
│  ├─ stage/
│  │  ├─ Stage.tsx           캔버스 컨테이너
│  │  └─ scenes/             씬 6개
│  │     ├─ weave.ts         Canvas 2D
│  │     ├─ lyrics.ts        가사 층 (가사·합성 씬이 함께 씁니다)
│  │     ├─ type.ts
│  │     ├─ faces.ts
│  │     ├─ spectrum.ts
│  │     ├─ composite.ts
│  │     └─ bloom/           ★ 무대 씬만 WebGL2
│  │        ├─ Bloom.tsx
│  │        ├─ shaders.ts     GLSL 을 문자열로 (아래 참고)
│  │        └─ bloomPass.ts
│  └─ transport/
├─ lib/
│  ├─ audio/
│  │  ├─ engine.ts           오디오 그래프 구성
│  │  ├─ analyser.worklet.js 약 60Hz 시계 (TS 가 아니라 JS — 아래 참고)
│  │  ├─ onset.ts
│  │  ├─ tempo.ts
│  │  ├─ chroma.ts           크로마 12빈과 장·단 근사
│  │  └─ stems.ts
│  ├─ audience/
│  │  ├─ types.ts            AudienceSource 인터페이스
│  │  ├─ camera.ts
│  │  ├─ microphone.ts
│  │  ├─ simulation.ts
│  │  └─ calibration.ts
│  ├─ lyrics/
│  │  ├─ lrc.ts              LRC 파싱과 내보내기
│  │  └─ cue.ts              현재 줄 · 진행률 · 단어 인덱스
│  ├─ direction/
│  │  ├─ state.ts            음악 상태 판정 (순간)
│  │  ├─ mood.ts             valence · arousal 판정 (곡 단위)
│  │  └─ translate.ts        ★ 두 신호가 합쳐지는 곳
│  ├─ palette/
│  │  ├─ builtin.ts          기본 팔레트 여덟
│  │  ├─ oklab.ts            색 공간 변환과 보간
│  │  └─ resolve.ts          분위기 → 팔레트 선택과 시간 평활
│  ├─ render/
│  ├─ routing/               WebSocket 송출
│  ├─ supabase/
│  │  ├─ client.ts           설정이 없으면 null 을 돌려줍니다
│  │  ├─ auth.ts             GitHub 로그인
│  │  ├─ queue.ts            못 보낸 쓰기를 로컬에 쌓아 둡니다
│  │  └─ library.ts          프리셋·가사 저장과 동기화
│  ├─ store.ts
│  └─ types.ts
└─ public/
```

`lib/direction/translate.ts` 를 별도 폴더로 뺀 것은 의도적입니다. 이 파일이 프로젝트의 주장이므로 찾기 쉬운 곳에 둡니다.

`lib/audio/analyser.worklet.js` 만 TypeScript 가 아닙니다. **워크렛은 브라우저가 직접 파싱하는 별도 모듈이라 번들러가 `.ts` 를 그대로 내보내면 로드에 실패합니다** (실측: `AbortError`). `new URL('./analyser.worklet.js', import.meta.url)` 로 잡으면 번들러가 해시 파일명을 붙여 별도 자산으로 내보내므로, 빌드 단계를 더하지 않고도 캐시 문제 없이 동작합니다.

이 파일은 약 60Hz 로 `dt` 를 보내는 시계일 뿐이라 서른 줄 남짓입니다. 타입이 주는 이득이 작습니다.

**셰이더도 `.glsl` 파일로 두지 않고 `.ts` 안의 문자열로 씁니다.** `.glsl` 은 로더가 필요하고, 로더를 붙이면 워크렛과 같은 이유로 빌드 단계가 늘어 "빌드를 깜빡하면 낡은 셰이더가 조용히 도는" 실패 방식이 생깁니다.

`components/stage/scenes/bloom/` 만 WebGL2 입니다. 나머지 다섯 씬은 Canvas 2D 를 그대로 씁니다. 다섯 씬을 모두 WebGL 로 옮기면 작업량이 크게 늘고, 진단용 씬은 Canvas 2D 로 충분합니다.
