# 08. 배포와 저장 설정

7단계에서 쓰는 설정 절차입니다. **이 문서의 단계를 밟지 않아도 콘솔은 돕니다** — 분석·렌더·가사 편집이 전부 브라우저 안에서 끝나고, 저장만 로컬에 남습니다. 계정에 묶어 두고 다른 기계에서 이어 쓰려면 아래를 합니다.

## 1. Supabase 프로젝트

1. [supabase.com](https://supabase.com) 에서 프로젝트를 만듭니다. 지역은 공연장과 가까운 곳으로 잡습니다.
   - 생성 화면의 **Security** 절에서 `Automatically expose new tables` 를 **켠 채로** 두십시오. 끄면 Data API 역할에 권한이 붙지 않아 `permission denied for table tracks` 가 납니다. (끄고 만들었더라도 `0002_rls.sql` 이 권한을 직접 주므로 복구됩니다)
2. SQL Editor 에 `supabase/migrations/0001_init.sql` 을 붙여 넣고 실행합니다.
3. 이어서 `supabase/migrations/0002_rls.sql` 을 실행합니다.

**SQL Editor 가 "creates tables without enabling RLS" 라고 경고할 수 있습니다.** `create table` 로 만든 테이블은 RLS 가 저절로 켜지지 않기 때문입니다 — Table Editor 로 만들 때만 켜집니다. `Run and enable RLS` 를 눌러도 되고, 그냥 `Run` 을 눌러도 됩니다. **0001 이 마지막에 여섯 테이블 모두 `enable row level security` 를 겁니다.**

**0002 를 빠뜨리지 마십시오.** RLS 는 켜졌는데 정책이 없으면 앱에서 접근할 때 401 또는 403 이 납니다. 테이블은 만들어졌는데 아무것도 읽히지 않는 상태가 됩니다. 0001 만 돌리고 멈추는 것이 "아무나 읽을 수 있는" 상태보다는 낫도록 그렇게 짰습니다.

두 파일 모두 여러 번 실행해도 됩니다. `if not exists` 와 `drop policy if exists` 를 걸어 두었습니다.

## 2. GitHub 로그인

1. GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App
   - Homepage URL: 배포 주소 (개발 중에는 `http://localhost:3000`)
   - Authorization callback URL: `https://<프로젝트>.supabase.co/auth/v1/callback`
2. Client ID 와 Client Secret 을 Supabase → Authentication → Providers → **GitHub** 에 넣고 켭니다.
3. Supabase → Authentication → URL Configuration
   - Site URL: 배포 주소
   - Redirect URLs 에 `http://localhost:3000/auth/callback` 과 `https://<배포주소>/auth/callback` 을 넣습니다

콜백 주소가 둘인 것에 주의하십시오. GitHub 이 부르는 곳은 **Supabase** 이고, Supabase 가 되돌려보내는 곳이 **앱**입니다.

## 3. 환경 변수

Supabase → Project Settings → **API Keys** 에서 가져옵니다.

새 프로젝트는 기본 탭이 **Publishable / Secret** 이고, 예전 이름인 `anon` 은 **Legacy** 탭에 따로 있습니다. **둘 중 아무 쪽이나 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 에 넣으면 됩니다** — `sb_publishable_…` 도 그대로 동작합니다. 변수 이름이 `ANON_KEY` 인 것은 예전 이름을 따른 것일 뿐이고, 클라이언트가 키 앞머리를 보고 알아서 처리합니다.

`sb_secret_…` 과 Legacy 탭의 `service_role` 은 **절대 넣지 마십시오.** 그 둘은 RLS 를 통째로 지나갑니다.

`.env.example` 을 `.env.local` 로 복사하고 두 값을 채웁니다.

```
NEXT_PUBLIC_SUPABASE_URL=https://<프로젝트>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_…   # 또는 Legacy 탭의 anon 키
```

이 키는 공개되어도 되는 값입니다. 브라우저 번들에 그대로 박히고, 배포된 페이지를 열면 누구나 볼 수 있습니다. 데이터를 지키는 것은 키가 아니라 RLS 정책입니다.

## 4. Vercel 배포

```bash
npm i -g vercel      # 아직 없다면
vercel link
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel --prod
```

GitHub 저장소를 Vercel 에 연결해 두면 `main` 에 병합될 때마다 자동으로 올라갑니다. 그 경우 환경 변수는 Vercel 대시보드 → Settings → Environment Variables 에 넣습니다.

프레임워크는 자동으로 잡힙니다. Next.js 기본값 그대로라 `vercel.json` 이 필요 없습니다.

**배포된 주소는 https 입니다.** 외부 연동(8단계)의 로컬 WebSocket 은 그 주소에서 막힙니다 (`03-screens.md` 10 절). 외부 연동은 로컬 실행에서 씁니다.

## 5. 확인

1. 배포 주소를 열고 상단 바에서 `GitHub 로그인`
2. 음원을 하나 열고 12 프리셋에 이름을 붙여 `저장`
3. 다른 브라우저에서 같은 계정으로 로그인 → 그 프리셋이 보입니다
4. 로그아웃한 채로 열면 남의 프리셋이 보이지 않습니다 (RLS)

## 저장이 안 될 때

| 증상 | 볼 곳 |
|---|---|
| 목록이 비어 있고 12 패널에 401·403 | `0002_rls.sql` 을 실행했는가 |
| 로그인 뒤 되돌아오지 않음 | Supabase 의 Redirect URLs 에 `/auth/callback` 이 있는가 |
| `대기 N` 이 줄지 않음 | 인터넷이 끊겼거나 로그아웃 상태. 연결되면 저절로 올라갑니다 |
| 상단 바에 계정 칸이 없음 | 환경 변수 두 개가 비어 있음. 저장은 로컬로만 돕니다 |

## 저장이 실패해도 콘솔은 멈추지 않습니다

공연장에서 인터넷이 끊기는 것은 흔한 일입니다. 그래서 이렇게 두었습니다.

- 프리셋은 **먼저 로컬에 남고** 원격을 시도합니다. 새로 고침해도 그대로 있습니다
- 못 보낸 쓰기는 대기열(`lib/supabase/queue.ts`)에 쌓입니다. 같은 대상은 마지막 것만 남습니다
- 연결이 돌아오거나 로그인하면 저절로 올라갑니다
- 저장 관련 함수는 **던지지 않습니다.** 렌더 루프와 분석 루프는 이 코드를 부르지 않습니다
