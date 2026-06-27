"use client";

import { Moon, Sun, Layers, X, PanelsTopLeft } from "lucide-react";

import { APPS } from "./app-registry";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useTheme } from "@/lib/hooks/use-theme";
import { useWindowStore } from "@/lib/store/windows";
import { cn } from "@/lib/utils";

// Korean search aliases so queries like "컨테이너" match.
const KO_KEYWORDS: Record<string, string> = {
  files: "파일 파일스테이션 공유 폴더 탐색기 smb nfs",
  zfs: "zfs 제트에프에스 풀 pool 데이터셋 dataset 스냅샷 snapshot 스크럽 scrub raidz mirror arc 캐시 vdev 암호화 복제 예약",
  backup: "백업 backup 동기화 sync rsync 알에스싱크 원격 remote 서버 server 모듈 가져오기 보내기 pull push 클라우드 cloud rclone 타임머신 timemachine",
  storage: "스토리지 저장소 디스크 볼륨 스마트 용량 하드",
  monitor: "리소스 모니터 시스템 씨피유 메모리 네트워크 프로세스 상태",
  docker: "컨테이너 도커 이미지 앱",
  system: "시스템 system 서비스 service systemd 데몬 크론 cron 예약 작업 로그 logs journald 관리",
  notifications: "알림 notification 슬랙 slack 텔레그램 telegram 디스코드 discord 웹훅 webhook 이벤트 event",
  packages: "패키지 package 센터 앱 app 설치 install 도커 docker 카탈로그 plex jellyfin nextcloud 스토어 store",
  shares: "공유 share 폴더 folder smb nfs 삼바 samba 파일서비스 afp 네트워크 드라이브",
  users: "사용자 user 유저 그룹 group 계정 account 권한 권한관리 비밀번호",
  dashboard: "대시보드 dashboard 홈 home 개요 overview 위젯 widget 상태 요약",
  security: "보안 security 방화벽 firewall ufw 2fa 이중인증 otp totp 어드바이저 advisor 검사",
  certificates: "인증서 certificate https tls ssl letsencrypt 렛츠인크립트 도메인 cert",
  hardware: "하드웨어 hardware ups 무정전 배터리 battery nut snmp 전원",
  audit: "감사 audit 로그 log 기록 history 이력 활동 activity",
  settings: "설정 환경설정 시스템 테마 전원 재시작 종료 외관 강조색 ssh 키 hostname 시간 네트워크 ip dns",
};

export function CommandPalette() {
  const { paletteOpen, setPalette, open, closeAll, close, focusedId, windows } = useWindowStore();
  const { theme, toggle } = useTheme();

  const focused = windows.find((w) => w.id === focusedId && !w.minimized);

  function run(action: () => void) {
    action();
    setPalette(false);
  }

  return (
    <CommandDialog
      open={paletteOpen}
      onOpenChange={setPalette}
      title="명령 팔레트"
      description="앱을 열거나 동작을 실행하세요"
      className="top-[22%] max-w-xl border-white/10"
    >
      <Command>
      <CommandInput placeholder="앱 또는 명령 검색…" />
      <CommandList>
        <CommandEmpty>결과가 없습니다.</CommandEmpty>

        <CommandGroup heading="앱 열기">
          {APPS.map((app) => (
            <CommandItem
              key={app.id}
              value={`${app.name} ${app.description} ${KO_KEYWORDS[app.id] ?? ""}`}
              onSelect={() => run(() => open(app.id, { title: app.name, width: app.width, height: app.height }))}
            >
              <span className={cn("flex size-6 items-center justify-center rounded-[28%] text-white ring-1 ring-white/10", app.color)}>
                <app.icon className="size-3.5" />
              </span>
              <span className="font-medium">{app.name}</span>
              <span className="text-xs text-muted-foreground">{app.description}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="동작">
          <CommandItem value="테마 전환 다크 라이트 theme dark light" onSelect={() => run(toggle)}>
            {theme === "dark" ? <Sun /> : <Moon />}
            <span>{theme === "dark" ? "라이트 모드" : "다크 모드"}로 전환</span>
          </CommandItem>

          {focused && (
            <CommandItem
              value="현재 창 닫기 close window"
              onSelect={() => run(() => close(focused.id))}
            >
              <X />
              <span>{focused.title} 닫기</span>
              <CommandShortcut>Esc</CommandShortcut>
            </CommandItem>
          )}

          {windows.length > 0 && (
            <CommandItem value="모든 창 닫기 close all clean" onSelect={() => run(closeAll)}>
              <Layers />
              <span>모든 창 닫기</span>
            </CommandItem>
          )}

          {windows.length === 0 && (
            <CommandItem
              value="모든 앱 열기 open everything"
              onSelect={() =>
                run(() => APPS.forEach((a) => open(a.id, { title: a.name, width: a.width, height: a.height })))
              }
            >
              <PanelsTopLeft />
              <span>모든 앱 열기</span>
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  );
}
