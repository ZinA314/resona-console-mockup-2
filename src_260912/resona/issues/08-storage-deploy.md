## 목표

설정을 저장하고 배포한다.

## 작업

- [ ] Supabase 프로젝트 생성
- [ ] 스키마 적용 (tracks / presets / lyrics / sessions / session_samples)
- [ ] RLS 정책 (테이블마다 select·insert·update·delete)
- [ ] Supabase Auth GitHub 로그인
- [ ] 프리셋 저장·불러오기
- [ ] 곡 파일명과 프리셋 연결, 로드 시 자동 제안
- [ ] Supabase 연결 실패 시 로컬 임시 저장 후 동기화
- [ ] Vercel 배포

## 완료 기준

- [ ] 프리셋을 저장하고 페이지를 새로 고친 뒤 불러오면 같은 상태가 된다
- [ ] 배포된 주소에서 다른 브라우저로 로그인해도 프리셋이 보인다
- [ ] 로그인하지 않은 사용자가 남의 프리셋을 읽지 못한다

## 주의

RLS 정책이 없으면 앱에서 접근할 때 401 또는 403 이 난다. 12회차에서 다룬 내용이다.

**다만 "기본으로 켜져 있다" 는 것은 Table Editor 로 만든 테이블에 한한다 (2026-09-07 확인).** SQL Editor 에서 `create table` 로 만들면 RLS 가 꺼진 채로 생기고, 그대로 두면 아무나 읽을 수 있다. SQL Editor 가 "creates tables without enabling RLS" 로 경고하고 `Run and enable RLS` 를 권하는 것이 그 때문이다.

그래서 `0001_init.sql` 이 테이블을 다 만든 뒤 여섯 개 모두 `enable row level security` 를 건다. 정책은 `0002_rls.sql` 이지만 켜는 것은 0001 이다 — 0001 만 돌리고 멈춘 상태가 "아무나 읽을 수 있는" 것보다 "아무도 못 읽는" 편이 낫다.

권한(`grant`)도 `0002_rls.sql` 이 직접 준다. 프로젝트 생성 화면의 `Automatically expose new tables` 를 꺼 두면 Data API 역할에 권한이 붙지 않아 `permission denied` 가 나는데, 설정과 무관하게 돌아야 한다.

## 참고

- `docs/06-data-model.md` 2·3절
