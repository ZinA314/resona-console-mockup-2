-- RESONA 스키마. `docs/06-data-model.md` 2·3절을 옮긴 것입니다.
--
-- Supabase SQL Editor 에 통째로 붙여 넣고 한 번 실행하면 됩니다.
-- 여러 번 실행해도 되도록 `if not exists` 와 `drop policy if exists` 를 썼습니다.

create extension if not exists pgcrypto;

-- ── 곡 ────────────────────────────────────────────────────────
create table if not exists tracks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  artist      text,
  duration    real,                    -- 초
  file_hash   text,                    -- 같은 파일을 알아보기 위한 해시
  created_at  timestamptz default now(),
  user_id     uuid references auth.users(id)
);

-- 같은 사용자가 같은 파일을 다시 올려도 곡이 늘어나지 않게 합니다.
-- `file_hash` 로 곡을 찾아 프리셋과 가사를 다시 붙이는 것이 F-703 입니다.
--
-- **부분 인덱스로 만들지 마십시오.** `where file_hash is not null` 을 붙이면
-- `on conflict (user_id, file_hash)` 가 그 인덱스를 못 찾아 upsert 가
-- "there is no unique or exclusion constraint matching" 으로 실패합니다.
-- 술어를 같이 적어야 하는데 supabase-js 로는 그렇게 보낼 수 없습니다.
--
-- 통짜로 바꾸면 유일 인덱스에서 NULL 이 서로 다른 값이라는 문제가 따라옵니다.
-- `file_hash` 가 비어 있는 행이 생기면 저장할 때마다 곡이 쌓입니다. 앱에는
-- 그런 경로가 없으므로(`trackKeyOf` 가 언제나 값을 만듭니다) 아예 막습니다.
update tracks set file_hash = 'legacy-' || id::text where file_hash is null;
alter table tracks alter column file_hash set not null;

drop index if exists tracks_user_hash;
create unique index if not exists tracks_user_hash
  on tracks (user_id, file_hash);

-- ── 팔레트 (F-1000) ───────────────────────────────────────────
create table if not exists palettes (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  chips      jsonb not null,          -- { bg, deep, base, accent, hot } 각 '#RRGGBB'
  auto       boolean not null default true,
  anchor     jsonb not null default '{"valence":0.5,"arousal":0.5}'::jsonb,
  builtin    boolean not null default false,
  created_at timestamptz default now(),
  user_id    uuid references auth.users(id)
);

-- ── 프리셋 (F-700) ────────────────────────────────────────────
create table if not exists presets (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  track_id     uuid references tracks(id) on delete set null,
  scene        text not null default 'weave',
  influence    real not null default 0.6,
  intensity    real not null default 1.0,
  trail        real not null default 0.62,
  grain        real not null default 0.22,
  glitch       real not null default 0.18,
  audience_kind text not null default 'none',
  locked_bpm   real,
  tempo_locked boolean not null default false,
  palette_id     uuid,
  -- 콘솔이 들고 있는 팔레트 식별자(`mono` 처럼 문자열입니다).
  -- `palette_id` 는 `palettes` 테이블을 동기화하는 날을 위해 비워 둡니다 —
  -- 지금은 팔레트가 클라이언트에만 있어 uuid 를 채울 수 없습니다.
  palette_key    text,
  palette_auto   boolean not null default true,
  palette_fade   real not null default 2.5,
  dreaminess_lock real,
  scene_params   jsonb default '{}'::jsonb,   -- 씬별 슬라이더 (F-508)
  overrides    jsonb default '{}'::jsonb,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  user_id      uuid references auth.users(id)
);

do $$ begin
  alter table presets
    add constraint presets_palette_fk
    foreign key (palette_id) references palettes(id) on delete set null;
exception when duplicate_object then null;
end $$;

-- ── 가사 (F-605) ──────────────────────────────────────────────
--
-- `lines` 의 `t` 는 **null 일 수 있습니다.** 시각 미정 줄은 큐에 남아 있고
-- 재생과 `.lrc` 내보내기에서만 건너뜁니다 (`03-screens.md` 03 절).
-- 저장·불러오기에서 버리면 편집하던 줄이 사라집니다.
create table if not exists lyrics (
  id         uuid primary key default gen_random_uuid(),
  track_id   uuid references tracks(id) on delete cascade,
  lines      jsonb not null,           -- [{ t: 12.34 | null, text: "...", words: [...] }]
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  user_id    uuid references auth.users(id)
);

-- 곡 하나에 가사 한 벌. 저장할 때마다 행이 쌓이지 않게 덮어씁니다.
create unique index if not exists lyrics_user_track
  on lyrics (user_id, track_id);

-- ── 세션 ──────────────────────────────────────────────────────
create table if not exists sessions (
  id          uuid primary key default gen_random_uuid(),
  track_id    uuid references tracks(id) on delete set null,
  preset_id   uuid references presets(id) on delete set null,
  label       text,
  started_at  timestamptz not null,
  duration    real,
  avg_audience real,
  peak_audience real,
  created_at  timestamptz default now(),
  user_id     uuid references auth.users(id)
);

create table if not exists session_samples (
  id          bigserial primary key,
  session_id  uuid references sessions(id) on delete cascade,
  t           real not null,
  audience    real not null,
  rms         real not null,
  bpm         real,
  state       text
);

create index if not exists session_samples_session_t
  on session_samples (session_id, t);

-- ── 행 수준 보안을 여기서 켭니다 ──────────────────────────────
--
-- **SQL Editor 로 만든 테이블은 RLS 가 저절로 켜지지 않습니다.** Table Editor
-- 로 만들 때만 켜집니다. 그래서 SQL Editor 가 "creates tables without enabling
-- RLS" 경고를 띄우고 `Run and enable RLS` 를 권합니다.
--
-- 정책은 0002 에 있지만 켜는 것은 여기서 합니다. 0001 만 돌리고 멈춘 상태가
-- "아무나 읽을 수 있는" 것보다 "아무도 못 읽는" 편이 훨씬 낫습니다.
alter table tracks          enable row level security;
alter table palettes        enable row level security;
alter table presets         enable row level security;
alter table lyrics          enable row level security;
alter table sessions        enable row level security;
alter table session_samples enable row level security;

-- 이미 만든 데이터베이스에 나중 컬럼을 더할 때를 위해.
alter table presets add column if not exists palette_key text;
alter table lyrics  add column if not exists updated_at timestamptz default now();
