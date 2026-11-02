-- 행 수준 보안. `docs/06-data-model.md` 3절.
--
-- 정책을 만들지 않으면 앱에서 접근할 때 401 또는 403 이 납니다. 테이블마다
-- select·insert·update·delete 네 가지를 겁니다.
--
-- **"RLS 가 기본으로 켜져 있다" 는 것은 Table Editor 로 만든 테이블에
-- 한합니다.** SQL Editor 에서 `create table` 로 만들면 꺼진 채로 생기므로
-- 0001 이 마지막에 여섯 개 모두 켭니다. 여기서 한 번 더 거는 것은 다른
-- 경로로 만든 데이터베이스에도 이 파일만으로 정책을 얹을 수 있게 하려는
-- 것입니다. `enable row level security` 는 여러 번 걸어도 됩니다.
--
-- 0001 을 실행한 뒤 이어서 실행하십시오. 여러 번 돌려도 됩니다.

-- `user_id` 를 클라이언트가 채우지 않아도 되게 합니다. 빠뜨리면 insert 가
-- 정책에 걸려 403 이 나는데, 원인을 찾기 어려운 자리입니다.
alter table tracks          alter column user_id set default auth.uid();
alter table palettes        alter column user_id set default auth.uid();
alter table presets         alter column user_id set default auth.uid();
alter table lyrics          alter column user_id set default auth.uid();
alter table sessions        alter column user_id set default auth.uid();

alter table tracks          enable row level security;
alter table palettes        enable row level security;
alter table presets         enable row level security;
alter table lyrics          enable row level security;
alter table sessions        enable row level security;
alter table session_samples enable row level security;

-- 본인 것만. 네 가지를 한 테이블씩 겁니다.
do $$
declare
  t text;
begin
  foreach t in array array['tracks', 'presets', 'lyrics', 'sessions']
  loop
    execute format('drop policy if exists "본인 것만 읽기" on %I', t);
    execute format('drop policy if exists "본인 것만 쓰기" on %I', t);
    execute format('drop policy if exists "본인 것만 수정" on %I', t);
    execute format('drop policy if exists "본인 것만 삭제" on %I', t);

    execute format(
      'create policy "본인 것만 읽기" on %I for select using (auth.uid() = user_id)', t);
    execute format(
      'create policy "본인 것만 쓰기" on %I for insert with check (auth.uid() = user_id)', t);
    execute format(
      'create policy "본인 것만 수정" on %I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
    execute format(
      'create policy "본인 것만 삭제" on %I for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;

-- 팔레트만 읽기가 다릅니다. **기본 제공 여덟 개는 모두가 읽습니다.**
-- 고치면 자기 사본이 생기므로(F-1001) 쓰기·수정·삭제는 본인 것만입니다.
drop policy if exists "본인 것과 기본 제공 읽기" on palettes;
drop policy if exists "본인 것만 쓰기" on palettes;
drop policy if exists "본인 것만 수정" on palettes;
drop policy if exists "본인 것만 삭제" on palettes;

create policy "본인 것과 기본 제공 읽기" on palettes
  for select using (auth.uid() = user_id or builtin);
create policy "본인 것만 쓰기" on palettes
  for insert with check (auth.uid() = user_id and not builtin);
create policy "본인 것만 수정" on palettes
  for update using (auth.uid() = user_id and not builtin)
  with check (auth.uid() = user_id and not builtin);
create policy "본인 것만 삭제" on palettes
  for delete using (auth.uid() = user_id and not builtin);

-- 새 프로젝트에서 `Automatically expose new tables` 를 꺼 두면 Data API 역할에
-- 권한이 붙지 않아 `permission denied for table tracks` 가 납니다. 설정과
-- 무관하게 돌도록 여기서 직접 줍니다. **RLS 를 켠 뒤에 줍니다** — 순서가
-- 뒤바뀌면 정책 없는 테이블이 잠깐 열립니다.
--
-- `anon` 에게도 주는 것은 Supabase 의 기본과 같습니다. 무엇을 보여 줄지는
-- 권한이 아니라 위의 정책이 정합니다. 로그인하지 않으면 `auth.uid()` 가
-- null 이라 기본 제공 팔레트 말고는 한 줄도 보이지 않습니다.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public
  to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

-- 세션 표본은 자기 `user_id` 가 없습니다. 부모 세션을 통해 확인합니다.
drop policy if exists "부모 세션이 내 것일 때만" on session_samples;
create policy "부모 세션이 내 것일 때만" on session_samples
  for all using (
    exists (
      select 1 from sessions s
      where s.id = session_samples.session_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from sessions s
      where s.id = session_samples.session_id and s.user_id = auth.uid()
    )
  );
