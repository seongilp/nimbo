"use client";

import { useState } from "react";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  File as FileIcon,
  FileText,
  FileImage,
  FileVideo,
  FileArchive,
  Link2,
  HardDrive,
  Home,
  Lock,
  Users,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { usePoll } from "@/lib/hooks/use-poll";
import { formatBytes, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DirListing, FileEntry, ShareInfo } from "@/lib/types";

function fileIcon(entry: FileEntry) {
  if (entry.type === "directory") return Folder;
  if (entry.type === "symlink") return Link2;
  const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "heic"].includes(ext)) return FileImage;
  if (["mp4", "mkv", "mov", "avi", "webm"].includes(ext)) return FileVideo;
  if (["zip", "tar", "gz", "zst", "7z", "rar", "iso"].includes(ext)) return FileArchive;
  if (["txt", "md", "pdf", "doc", "docx", "log"].includes(ext)) return FileText;
  return FileIcon;
}

export function FileStation() {
  const [path, setPath] = useState("/");
  const { data: listing, loading, error, refresh } = usePoll<DirListing>(
    `/api/files?path=${encodeURIComponent(path)}`,
    0
  );
  const { data: shares } = usePoll<ShareInfo[]>("/api/shares", 0);

  const segments = path.split("/").filter(Boolean);
  const smbShares = (shares ?? []).filter((s) => s.protocol === "smb");

  return (
    <div className="flex h-full bg-background">
      {/* Sidebar */}
      <div className="hidden w-56 shrink-0 flex-col border-r bg-muted/20 sm:flex">
        <div className="px-3 py-3">
          <p className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Locations
          </p>
        </div>
        <ScrollArea className="flex-1 px-2">
          <SidebarItem icon={Home} label="Root (/)" active={path === "/"} onClick={() => setPath("/")} />
          {/* Quick links to common locations; harmless if they don't exist on this host. */}
          {[
            { label: "home", path: "/home" },
            { label: "mnt", path: "/mnt" },
            { label: "srv", path: "/srv" },
          ].map((loc) => (
            <SidebarItem
              key={loc.path}
              icon={HardDrive}
              label={loc.label}
              active={path === loc.path}
              onClick={() => setPath(loc.path)}
            />
          ))}

          {smbShares.length > 0 && (
            <p className="mt-4 px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Shared folders
            </p>
          )}
          {smbShares.map((s) => (
            <SidebarItem
              key={s.name}
              icon={s.guestOk ? Users : s.readOnly ? Lock : FolderOpen}
              label={s.name}
              active={path === s.path}
              onClick={() => setPath(s.path)}
            />
          ))}
        </ScrollArea>
      </div>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar / breadcrumb */}
        <div className="flex items-center gap-1 border-b px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setPath("/")}
          >
            <Home className="size-3.5" />
          </Button>
          <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
            {segments.map((seg, i) => {
              const segPath = "/" + segments.slice(0, i + 1).join("/");
              return (
                <div key={segPath} className="flex shrink-0 items-center">
                  <ChevronRight className="size-3.5 text-muted-foreground" />
                  <button
                    className="rounded px-1.5 py-0.5 text-sm hover:bg-accent"
                    onClick={() => setPath(segPath)}
                  >
                    {seg}
                  </button>
                </div>
              );
            })}
          </div>
          <Button variant="ghost" size="icon" className="size-7" onClick={refresh}>
            <RefreshCw className="size-3.5" />
          </Button>
        </div>

        {/* Listing */}
        <ScrollArea className="min-h-0 flex-1">
          {loading && !listing ? (
            <div className="space-y-1 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : error && !listing ? (
            <div className="flex flex-col items-center justify-center gap-3 px-4 py-16 text-center">
              <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <TriangleAlert className="size-5" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">폴더를 불러오지 못했습니다</p>
                <p className="max-w-xs text-xs text-muted-foreground">{error}</p>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={refresh}>
                <RefreshCw className="size-3.5" /> 다시 시도
              </Button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="hidden px-4 py-2 font-medium md:table-cell">Modified</th>
                  <th className="px-4 py-2 text-right font-medium">Size</th>
                </tr>
              </thead>
              <tbody>
                {listing?.entries.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-12 text-center text-sm text-muted-foreground">
                      This folder is empty.
                    </td>
                  </tr>
                )}
                {listing?.entries.map((entry) => {
                  const Icon = fileIcon(entry);
                  const isDir = entry.type === "directory";
                  return (
                    <tr
                      key={entry.path}
                      className={cn(
                        "border-b border-border/40 last:border-0",
                        isDir ? "cursor-pointer hover:bg-accent/50" : "hover:bg-accent/30"
                      )}
                      onClick={() => isDir && setPath(entry.path)}
                    >
                      <td className="px-4 py-1.5">
                        <div className="flex items-center gap-2.5">
                          <Icon
                            className={cn(
                              "size-4 shrink-0",
                              isDir ? "text-primary" : "text-muted-foreground"
                            )}
                          />
                          <span className="truncate">{entry.name}</span>
                          {entry.type === "symlink" && (
                            <Badge variant="outline" className="text-[10px]">link</Badge>
                          )}
                        </div>
                      </td>
                      <td className="hidden px-4 py-1.5 text-xs text-muted-foreground md:table-cell">
                        {formatRelative(entry.modified)}
                      </td>
                      <td className="px-4 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                        {isDir ? "—" : formatBytes(entry.sizeBytes)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </ScrollArea>

        {/* Status bar */}
        <div className="flex items-center justify-between border-t px-4 py-1.5 text-xs text-muted-foreground">
          <span>{listing?.entries.length ?? 0} items</span>
          {listing?.isMock && <Badge variant="secondary" className="text-[10px]">demo data</Badge>}
        </div>
      </div>
    </div>
  );
}

function SidebarItem({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
        active ? "bg-primary/10 font-medium text-primary" : "hover:bg-accent"
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
