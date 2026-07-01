"use client";

import type { ComponentType } from "react";
import { FolderClosed, HardDrive, Activity, Box, Settings as SettingsIcon, Database, RefreshCw, Bell, ServerCog, UsersRound, ShieldCheck, FolderCog, Package, LayoutDashboard, Lock, BatteryCharging, ScrollText, SquareTerminal, Disc3 } from "lucide-react";

import { FileStation } from "@/components/apps/file-station";
import { Terminal } from "@/components/apps/terminal";
import { DiskInventory } from "@/components/apps/disk-inventory";
import { StorageManager } from "@/components/apps/storage-manager";
import { ResourceMonitor } from "@/components/apps/resource-monitor";
import { ContainerManager } from "@/components/apps/container-manager";
import { Settings } from "@/components/apps/settings";
import { ZfsManager } from "@/components/apps/zfs-manager";
import { BackupSync } from "@/components/apps/backup-sync";
import { Notifications } from "@/components/apps/notifications";
import { SystemAdmin } from "@/components/apps/system-admin";
import { Users } from "@/components/apps/users";
import { Security } from "@/components/apps/security";
import { SharesManager } from "@/components/apps/shares-manager";
import { PackageCenter } from "@/components/apps/package-center";
import { Dashboard } from "@/components/apps/dashboard";
import { Certificates } from "@/components/apps/certificates";
import { Hardware } from "@/components/apps/hardware";
import { AuditLog } from "@/components/apps/audit-log";

export interface AppDef {
  id: string;
  name: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  /** Solid flat tile background (Toss/Apple style — no gradient). */
  color: string;
  component: ComponentType;
  width: number;
  height: number;
}

export const APPS: AppDef[] = [
  {
    id: "dashboard",
    name: "Dashboard",
    description: "At-a-glance overview",
    icon: LayoutDashboard,
    color: "bg-gradient-to-b from-[#6366F1] to-[#4338CA]",
    component: Dashboard,
    width: 1040,
    height: 700,
  },
  {
    id: "files",
    name: "File Station",
    description: "Browse files & shares",
    icon: FolderClosed,
    color: "bg-gradient-to-b from-[#3B82F6] to-[#2563EB]",
    component: FileStation,
    width: 940,
    height: 620,
  },
  {
    id: "zfs",
    name: "ZFS",
    description: "Pools, datasets & snapshots",
    icon: Database,
    color: "bg-gradient-to-b from-[#0EA5E9] to-[#0369A1]",
    component: ZfsManager,
    width: 960,
    height: 660,
  },
  {
    id: "backup",
    name: "Backup & Sync",
    description: "rsync server & sync jobs",
    icon: RefreshCw,
    color: "bg-gradient-to-b from-[#10B981] to-[#059669]",
    component: BackupSync,
    width: 900,
    height: 640,
  },
  {
    id: "storage",
    name: "Storage Manager",
    description: "Disks, SMART & volumes",
    icon: HardDrive,
    color: "bg-gradient-to-b from-[#6366F1] to-[#4F46E5]",
    component: StorageManager,
    width: 780,
    height: 620,
  },
  {
    id: "disks",
    name: "Disk Inventory",
    description: "HDD 인벤토리 · 결함 · 이력 · 교체",
    icon: Disc3,
    color: "bg-gradient-to-b from-[#0891B2] to-[#155E75]",
    component: DiskInventory,
    width: 900,
    height: 640,
  },
  {
    id: "monitor",
    name: "Resource Monitor",
    description: "CPU, memory & network",
    icon: Activity,
    color: "bg-gradient-to-b from-[#14B8A6] to-[#0D9488]",
    component: ResourceMonitor,
    width: 900,
    height: 660,
  },
  {
    id: "docker",
    name: "Container Manager",
    description: "Docker containers",
    icon: Box,
    color: "bg-gradient-to-b from-[#F59E0B] to-[#D97706]",
    component: ContainerManager,
    width: 920,
    height: 620,
  },
  {
    id: "system",
    name: "System",
    description: "Services, cron & logs",
    icon: ServerCog,
    color: "bg-gradient-to-b from-[#64748B] to-[#334155]",
    component: SystemAdmin,
    width: 940,
    height: 640,
  },
  {
    id: "terminal",
    name: "Terminal",
    description: "Run shell commands (admin)",
    icon: SquareTerminal,
    color: "bg-gradient-to-b from-[#1f2937] to-[#0b0f17]",
    component: Terminal,
    width: 820,
    height: 520,
  },
  {
    id: "packages",
    name: "Package Center",
    description: "Install self-hosted apps",
    icon: Package,
    color: "bg-gradient-to-b from-[#06B6D4] to-[#0891B2]",
    component: PackageCenter,
    width: 980,
    height: 660,
  },
  {
    id: "shares",
    name: "Shared Folders",
    description: "SMB / NFS shares",
    icon: FolderCog,
    color: "bg-gradient-to-b from-[#3B82F6] to-[#1D4ED8]",
    component: SharesManager,
    width: 900,
    height: 620,
  },
  {
    id: "users",
    name: "Users",
    description: "Users & groups",
    icon: UsersRound,
    color: "bg-gradient-to-b from-[#A855F7] to-[#7E22CE]",
    component: Users,
    width: 880,
    height: 620,
  },
  {
    id: "security",
    name: "Security",
    description: "Firewall, advisor & 2FA",
    icon: ShieldCheck,
    color: "bg-gradient-to-b from-[#EF4444] to-[#B91C1C]",
    component: Security,
    width: 900,
    height: 640,
  },
  {
    id: "certificates",
    name: "Certificates",
    description: "HTTPS & Let's Encrypt",
    icon: Lock,
    color: "bg-gradient-to-b from-[#22C55E] to-[#15803D]",
    component: Certificates,
    width: 880,
    height: 620,
  },
  {
    id: "hardware",
    name: "Hardware",
    description: "UPS & SNMP",
    icon: BatteryCharging,
    color: "bg-gradient-to-b from-[#EAB308] to-[#A16207]",
    component: Hardware,
    width: 860,
    height: 600,
  },
  {
    id: "audit",
    name: "Audit Log",
    description: "User action history",
    icon: ScrollText,
    color: "bg-gradient-to-b from-[#64748B] to-[#475569]",
    component: AuditLog,
    width: 920,
    height: 620,
  },
  {
    id: "notifications",
    name: "Notifications",
    description: "Slack, Telegram & Discord",
    icon: Bell,
    color: "bg-gradient-to-b from-[#F43F5E] to-[#E11D48]",
    component: Notifications,
    width: 860,
    height: 620,
  },
  {
    id: "settings",
    name: "Settings",
    description: "System preferences",
    icon: SettingsIcon,
    color: "bg-gradient-to-b from-[#64748B] to-[#475569]",
    component: Settings,
    width: 760,
    height: 560,
  },
];

export const APP_MAP: Record<string, AppDef> = Object.fromEntries(
  APPS.map((a) => [a.id, a])
);
