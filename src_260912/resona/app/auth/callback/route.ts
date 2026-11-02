/**
 * GitHub OAuth 콜백 (F-800 밖, 7단계 인증).
 *
 * Supabase 가 `?code=` 를 붙여 여기로 돌려보냅니다. 세션 쿠키로 바꿔 심고
 * 콘솔로 되돌립니다. 실패해도 콘솔로 보냅니다 — 오퍼레이터를 빈 화면에
 * 세워 두지 않습니다.
 */
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (code && url && anon) {
    const store = await cookies();
    const supabase = createServerClient(url, anon, {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (list) => {
          try {
            for (const { name, value, options } of list) store.set(name, value, options);
          } catch {
            // 라우트 핸들러 밖에서 불릴 수 있습니다. 미들웨어가 갱신합니다.
          }
        },
      },
    });
    try {
      await supabase.auth.exchangeCodeForSession(code);
    } catch {
      /* 실패해도 콘솔로 보냅니다. */
    }
  }

  return NextResponse.redirect(origin);
}
