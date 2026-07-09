import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "개인정보처리방침 — Nimbo",
  description: "Nimbo는 셀프호스팅 소프트웨어입니다. 모든 데이터는 당신의 서버에만 저장되며 외부로 전송되지 않습니다.",
};

const UPDATED = "2026-07-09";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="desktop-wallpaper min-h-dvh overflow-y-auto text-foreground">
      <div className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> 돌아가기
        </Link>

        <div className="mb-8 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-[26%] bg-gradient-to-b from-[#3B82F6] to-[#2563EB] text-white shadow-icon ring-1 ring-white/10">
            <ShieldCheck className="size-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">개인정보처리방침</h1>
            <p className="text-xs text-muted-foreground">최종 업데이트: {UPDATED}</p>
          </div>
        </div>

        <div className="glass space-y-7 rounded-2xl border border-white/10 p-6 sm:p-8">
          <p className="text-sm leading-relaxed text-muted-foreground">
            <strong className="text-foreground">Nimbo는 셀프호스팅(self-hosted) 소프트웨어입니다.</strong>{" "}
            당신의 서버에서 직접 실행되며, 콘솔이 다루는 모든 데이터는 <strong className="text-foreground">당신의 서버에만</strong>{" "}
            저장됩니다. 개발자나 제3자에게 전송되는 정보는 없으며, 원격 분석(텔레메트리)이나 추적도 하지 않습니다.
          </p>

          <Section title="1. 수집·처리하는 정보">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong className="text-foreground">로그인 정보</strong> — 서버의 OS 계정으로 인증합니다. 비밀번호는{" "}
                <strong className="text-foreground">저장하지 않고</strong> 서버의 시스템 라이브러리로 검증만 합니다.
              </li>
              <li>
                <strong className="text-foreground">세션</strong> — 로그인 시 HMAC 서명 쿠키(<code>nimbo_session</code>)가
                발급되며, 서버에서만 검증됩니다.
              </li>
              <li>
                <strong className="text-foreground">접속 IP 주소</strong> — 로그인 허용 대역(IP 접근제어), 감사 로그, 무차별
                대입 차단(fail2ban)에 사용되며 서버 내에만 기록됩니다.
              </li>
              <li>
                <strong className="text-foreground">감사 로그·설정</strong> — 사용자 작업/로그인 이력과 서버 설정은 서버의{" "}
                <code>/etc/nimbo</code> 및 로그(journald)에 로컬 저장됩니다.
              </li>
            </ul>
          </Section>

          <Section title="2. 이용 목적">
            <p>인증, 접근 제어, 보안(무차별 대입·비정상 접근 차단), 그리고 서버 관리 기능 제공에만 사용합니다.</p>
          </Section>

          <Section title="3. 제3자 제공 및 외부 전송">
            <p>
              <strong className="text-foreground">없음.</strong> Nimbo는 어떤 정보도 외부 서버로 전송하지 않습니다. 광고,
              분석 도구, 추적 스크립트를 포함하지 않으며, 폰트 등 리소스도 앱에 번들되어 외부 CDN을 호출하지 않습니다.
            </p>
          </Section>

          <Section title="4. 쿠키">
            <p>
              인증용 세션 쿠키(<code>nimbo_session</code>) 하나만 사용합니다. <code>HttpOnly</code>로 설정되어
              자바스크립트로 읽을 수 없으며, HTTPS 접속 시 <code>Secure</code> 플래그가 적용됩니다. 광고·추적 쿠키는
              없습니다.
            </p>
          </Section>

          <Section title="5. 보관 및 파기">
            <p>
              모든 데이터는 당신의 서버에 있으며 당신이 직접 관리합니다. 서버에서{" "}
              <code>sudo nimbo uninstall --purge</code>를 실행하면 설정·인증 정보(<code>/etc/nimbo</code>)를 포함해
              완전히 삭제됩니다.
            </p>
          </Section>

          <Section title="6. 보안 조치">
            <p>
              Caddy를 통한 HTTPS, 앱의 루프백(127.0.0.1) 바인딩, 첫 로그인 네트워크 고정(IP 접근제어), 선택적 2단계
              인증(TOTP), 로그인 잠금 및 fail2ban, 셸을 거치지 않는(argv) 권한 명령 실행 등으로 보호합니다. 자세한 내용은{" "}
              <a
                href="https://github.com/seongilp/nimbo/blob/main/SECURITY.md"
                className="text-primary underline-offset-2 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                보안 정책(SECURITY.md)
              </a>
              을 참고하세요.
            </p>
          </Section>

          <Section title="7. 소개 웹사이트">
            <p>
              공개 소개 페이지(GitHub Pages)는 정적 페이지로 추적 쿠키나 분석 도구를 사용하지 않습니다. 다만 호스팅
              제공자(GitHub)의 서버 접근 로그는 GitHub의 정책을 따릅니다.
            </p>
          </Section>

          <Section title="8. 이용자의 권리">
            <p>
              데이터가 전적으로 당신의 서버에 있으므로, 언제든 직접 열람·수정·삭제할 수 있습니다. Users 앱에서 접근 허용
              계정·IP를, Security 앱에서 2FA·방화벽을, Audit Log 앱에서 활동 기록을 확인/관리할 수 있습니다.
            </p>
          </Section>

          <Section title="9. 문의">
            <p>
              문의는 GitHub 저장소를 통해 받습니다:{" "}
              <a
                href="https://github.com/seongilp/nimbo/issues"
                className="text-primary underline-offset-2 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                github.com/seongilp/nimbo/issues
              </a>
              . 보안 취약점은 공개 이슈 대신{" "}
              <a
                href="https://github.com/seongilp/nimbo/security/advisories/new"
                className="text-primary underline-offset-2 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                비공개 보안 신고
              </a>
              로 접수해 주세요.
            </p>
          </Section>

          <p className="border-t border-white/10 pt-5 text-xs text-muted-foreground">
            본 방침은 {UPDATED}부터 적용됩니다. 변경 시 이 페이지에 갱신됩니다.
          </p>
        </div>
      </div>
    </main>
  );
}
