'use client';

/**
 * Supabase 브라우저 클라이언트.
 *
 * **설정이 없어도 앱은 돌아야 합니다.** 환경 변수가 비어 있으면 `null` 을
 * 돌려주고, 저장 기능만 조용히 꺼집니다. 공연장에서 쓰는 도구라 로그인과
 * 저장은 곁다리이고 분석·렌더가 본체입니다.
 */
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** 환경 변수가 갖춰졌는가. 화면에 "저장 꺼짐" 을 알리는 데 씁니다. */
export const supabaseConfigured = Boolean(URL && ANON);

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured || typeof window === 'undefined') return null;
  cached ??= createBrowserClient(URL as string, ANON as string);
  return cached;
}
