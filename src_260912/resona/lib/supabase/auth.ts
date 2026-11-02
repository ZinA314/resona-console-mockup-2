'use client';

/**
 * Supabase Auth — GitHub 로그인.
 *
 * `audioEngine` 과 같은 외부 스토어 꼴입니다. React 가 `useSyncExternalStore`
 * 로 구독하고, 실시간 루프는 이것을 건드리지 않습니다.
 */
import { getSupabase, supabaseConfigured } from '@/lib/supabase/client';

export interface AuthState {
  /** 로그인한 사용자의 id. 안 했으면 null */
  userId: string | null;
  /** 화면에 띄울 이름. GitHub 사용자명이나 이메일 */
  label: string | null;
  /** 첫 세션 확인이 끝났는가. 끝나기 전에는 "로그인" 을 띄우지 않습니다 */
  ready: boolean;
  /** 로그인·로그아웃이 도는 중 */
  busy: boolean;
  error: string | null;
}

export const INITIAL_AUTH: AuthState = {
  userId: null,
  label: null,
  ready: !supabaseConfigured, // 설정이 없으면 확인할 것도 없습니다
  busy: false,
  error: null,
};

class AuthManager {
  private state: AuthState = INITIAL_AUTH;
  private listeners = new Set<() => void>();
  private started = false;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    this.start();
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = (): AuthState => this.state;

  private patch(next: Partial<AuthState>) {
    this.state = { ...this.state, ...next };
    for (const fn of this.listeners) fn();
  }

  /** 첫 구독 때 한 번만. 세션을 읽고 변화를 듣습니다. */
  private start() {
    if (this.started) return;
    this.started = true;
    const sb = getSupabase();
    if (!sb) return;

    void sb.auth
      .getSession()
      .then(({ data }) => this.apply(data.session?.user ?? null))
      .catch(() => this.patch({ ready: true }));

    sb.auth.onAuthStateChange((_event, session) => {
      this.apply(session?.user ?? null);
    });
  }

  private apply(user: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null) {
    const meta = user?.user_metadata ?? {};
    const label =
      (typeof meta.user_name === 'string' && meta.user_name) ||
      (typeof meta.preferred_username === 'string' && meta.preferred_username) ||
      user?.email ||
      null;
    this.patch({ userId: user?.id ?? null, label, ready: true, busy: false, error: null });
  }

  get userId(): string | null {
    return this.state.userId;
  }

  /**
   * GitHub 로그인. 조작 핸들러 안에서 부르십시오 — 리디렉션이 일어납니다.
   * 실패해도 던지지 않습니다. 화면이 멈추면 안 됩니다.
   */
  async signIn(): Promise<void> {
    const sb = getSupabase();
    if (!sb) return;
    this.patch({ busy: true, error: null });
    try {
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'github',
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) this.patch({ busy: false, error: error.message });
    } catch {
      this.patch({ busy: false, error: '로그인을 시작하지 못했습니다.' });
    }
  }

  async signOut(): Promise<void> {
    const sb = getSupabase();
    if (!sb) return;
    this.patch({ busy: true });
    try {
      await sb.auth.signOut();
    } catch {
      /* 네트워크가 끊겨도 화면은 계속 돌아야 합니다. */
    }
    this.patch({ userId: null, label: null, busy: false });
  }
}

export const authManager = new AuthManager();
