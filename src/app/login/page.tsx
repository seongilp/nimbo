"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Cloud, Loader2, LogIn, Sparkles, User, Lock, KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Public demo build: shows a one-click entry button (auth runs against mock
// data, so admin/admin succeeds). Set NEXT_PUBLIC_NIMBO_DEMO=1 to enable.
const DEMO = process.env.NEXT_PUBLIC_NIMBO_DEMO === "1";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doLogin(u: string, p: string, c?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p, code: c }),
      });
      const json = await res.json();
      if (json.ok) {
        router.replace(next);
        router.refresh();
        return;
      }
      if (json.twoFactorRequired) {
        // Password was correct — now prompt for the TOTP code (or re-prompt on a
        // wrong one). Keep the username/password; only the code changes.
        setTwoFactorRequired(true);
        setError(json.error ?? null);
      } else {
        setTwoFactorRequired(false);
        setError(json.error ?? "로그인 실패");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void doLogin(username, password, twoFactorRequired ? code : undefined);
  }

  return (
    <div className="desktop-wallpaper flex h-dvh w-full items-center justify-center p-4">
      <form onSubmit={submit} className="glass shadow-window w-full max-w-sm rounded-3xl border border-white/10 p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex size-14 items-center justify-center rounded-[26%] bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white shadow-icon ring-1 ring-white/10">
            <Cloud className="size-7 fill-white/25" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Nimbo 로그인</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {DEMO ? "라이브 데모 — 클릭 한 번으로 둘러보기" : "서버 계정으로 로그인하세요"}
            </p>
          </div>
        </div>

        {DEMO && (
          <div className="mb-5">
            <Button
              type="button"
              onClick={() => doLogin("admin", "admin")}
              disabled={busy}
              className="w-full gap-2 bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white hover:brightness-110"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              데모로 둘러보기
            </Button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              로그인 없이 바로 체험 · 데모 데이터(변경은 저장되지 않음)
            </p>
            <div className="my-4 flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              또는 계정으로 로그인
              <span className="h-px flex-1 bg-border" />
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div className="relative">
            <User className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="사용자 이름 (예: root)" autoFocus autoComplete="username" className="pl-9" />
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="비밀번호" autoComplete="current-password" className="pl-9" />
          </div>

          {twoFactorRequired && (
            <div>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="인증 코드 (6자리)"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  className="pl-9 tracking-[0.3em]"
                />
              </div>
              <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">인증 앱(Google OTP 등)의 6자리 코드를 입력하세요.</p>
            </div>
          )}

          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

          <Button
            type="submit"
            className="w-full gap-2"
            disabled={busy || !username || !password || (twoFactorRequired && code.length !== 6)}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : twoFactorRequired ? <KeyRound className="size-4" /> : <LogIn className="size-4" />}
            {twoFactorRequired ? "인증 코드 확인" : "로그인"}
          </Button>
        </div>

        <p className="mt-5 text-center text-[11px] text-muted-foreground">
          이 서버의 OS 계정(예: root)으로 인증합니다.
          <br />
          <a href="/privacy" className="underline-offset-2 hover:text-foreground hover:underline">개인정보처리방침</a>
        </p>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="desktop-wallpaper h-dvh w-full" />}>
      <LoginForm />
    </Suspense>
  );
}
