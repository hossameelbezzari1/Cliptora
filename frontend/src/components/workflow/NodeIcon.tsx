import type { CSSProperties } from "react";
import {
  AudioLines, Bot, BookOpen, BrainCircuit, Braces, CalendarClock, Captions,
  Clapperboard, Database, Download, FileText, FileUp, Film, FolderPlus,
  FolderSearch, FolderX, GitBranch, GitMerge, Globe, Image, ImagePlus,
  Images, MessageSquareText, Mic, Play, ScanSearch, Scissors, ShieldAlert,
  Sparkles, Split, Video, WandSparkles, Workflow, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/** The backend is the ONLY owner of node/action icon choices. */
const LUCIDE: Record<string, LucideIcon> = {
  "audio-lines": AudioLines, bot: Bot, "book-open": BookOpen,
  "brain-circuit": BrainCircuit, braces: Braces, "calendar-clock": CalendarClock,
  captions: Captions, clapperboard: Clapperboard, database: Database,
  download: Download, "file-text": FileText, "file-up": FileUp, film: Film,
  "folder-plus": FolderPlus, "folder-search": FolderSearch, "folder-x": FolderX,
  "git-branch": GitBranch, "git-merge": GitMerge, globe: Globe, image: Image,
  "image-plus": ImagePlus, images: Images, "message-square-text": MessageSquareText,
  mic: Mic, play: Play, "scan-search": ScanSearch, scissors: Scissors,
  "shield-alert": ShieldAlert, sparkles: Sparkles, split: Split,
  video: Video, "wand-sparkles": WandSparkles, workflow: Workflow, zap: Zap,
};

const BRAND_ASSETS: Record<string, string> = {
  gemini: "/icons/nodes/gemini.svg",
  openai: "/icons/nodes/openai.svg",
  ollama: "/icons/nodes/ollama.svg",
};

export type NodeActionMeta = { id: string; label: string; icon?: string };
export type NodeIconMeta = {
  icon?: string;
  family_icon?: string;
  operation_icon?: string;
  actions?: NodeActionMeta[];
};

export function getActionIcon(meta: NodeIconMeta, actionId?: string | null): string {
  return meta.actions?.find((action) => action.id === actionId)?.icon ||
    meta.operation_icon || meta.icon || meta.family_icon || "lucide:workflow";
}

type Props = {
  icon?: string;
  size?: number;
  className?: string;
  title?: string;
};

/** No network/CDN fetch and no arbitrary path from backend metadata. */
export function NodeIcon({ icon = "lucide:workflow", size = 24, className, title }: Props) {
  const safeSize = Math.max(12, Math.min(128, Number.isFinite(size) ? size : 24));
  const style: CSSProperties = { width: safeSize, height: safeSize, flexShrink: 0 };
  const [prefix, name] = icon.split(":", 2);
  if (prefix === "brand" && BRAND_ASSETS[name]) {
    return <img src={BRAND_ASSETS[name]} width={safeSize} height={safeSize}
      style={style} className={className} alt={title || `${name} logo`} loading="lazy" />;
  }
  const Component = prefix === "lucide" ? (LUCIDE[name] || Workflow) : Workflow;
  return <Component size={safeSize} style={style} className={className}
    aria-label={title} aria-hidden={title ? undefined : true} />;
}

/** Useful in ToolLibrary / Canvas / NodeEditor: big provider logo + small action glyph. */
export function WorkflowNodeIcon({
  meta, actionId, size = 28, showActionBadge = false, className,
}: {
  meta: NodeIconMeta;
  actionId?: string | null;
  size?: number;
  showActionBadge?: boolean;
  className?: string;
}) {
  const main = meta.family_icon || meta.icon || "lucide:workflow";
  const action = getActionIcon(meta, actionId);
  const showBadge = showActionBadge && Boolean(actionId) && action !== main;
  return (
    <span className={className} style={{ display: "inline-flex", position: "relative", width: size, height: size, flexShrink: 0 }}>
      <NodeIcon icon={main} size={size} />
      {showBadge && (
        <span style={{ position: "absolute", right: -5, bottom: -5, display: "grid", placeItems: "center", width: 17, height: 17,
          borderRadius: 6, background: "var(--background, #fff)", boxShadow: "0 0 0 1px rgba(128,128,128,.18)" }}>
          <NodeIcon icon={action} size={12} />
        </span>
      )}
    </span>
  );
}
