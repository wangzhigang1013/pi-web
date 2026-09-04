import type { RecentProject } from "./project-groups";
import { listSessionFamilies, type SessionFamily } from "./session-family";
import type { SessionInfo } from "./types";
import { workspaceKeyOf } from "./workspace-memory";

export interface CustomSessionFolder {
  id: string;
  name: string;
  sessionIds: string[];
}

export interface PinnedWorkspace {
  root: string;
  key: string;
  name?: string;
}

export interface WorkspaceFolderGroup {
  key: string;
  root: string;
  name: string;
  isCurrent: boolean;
  isPinned: boolean;
  families: SessionFamily[];
  archivedFamilies: SessionFamily[];
  runningCount: number;
  unreadCount: number;
}

export interface CustomFolderGroup {
  id: string;
  name: string;
  families: SessionFamily[];
  archivedFamilies: SessionFamily[];
  runningCount: number;
  unreadCount: number;
}

export interface SessionTreeStructure {
  customGroups: CustomFolderGroup[];
  workspaceGroups: WorkspaceFolderGroup[];
  unclassifiedGroup: WorkspaceFolderGroup | null;
}

export type SidebarViewMode = "tree" | "focused";

const CUSTOM_FOLDERS_STORAGE_KEY = "pi-web:custom-session-folders";
const PINNED_WORKSPACES_STORAGE_KEY = "pi-web:pinned-workspaces";
const COLLAPSED_FOLDERS_STORAGE_KEY = "pi-web:collapsed-session-folders";
const SIDEBAR_VIEW_MODE_STORAGE_KEY = "pi-web:sidebar-view-mode";
const WORKSPACE_ORDER_STORAGE_KEY = "pi-web:workspace-order";
const ARCHIVED_SESSIONS_STORAGE_KEY = "pi-web:archived-sessions";

export function loadArchivedSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(ARCHIVED_SESSIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

export function saveArchivedSessionIds(ids: ReadonlySet<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) window.localStorage.removeItem(ARCHIVED_SESSIONS_STORAGE_KEY);
    else window.localStorage.setItem(ARCHIVED_SESSIONS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Persistence is best-effort.
  }
}

export function loadWorkspaceOrder(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(WORKSPACE_ORDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((k): k is string => typeof k === "string");
    return [];
  } catch {
    return [];
  }
}

export function saveWorkspaceOrder(order: readonly string[]): void {
  if (typeof window === "undefined") return;
  try {
    if (order.length === 0) window.localStorage.removeItem(WORKSPACE_ORDER_STORAGE_KEY);
    else window.localStorage.setItem(WORKSPACE_ORDER_STORAGE_KEY, JSON.stringify([...order]));
  } catch {
    // Persistence is best-effort.
  }
}

export function loadCustomFolders(): CustomSessionFolder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_FOLDERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (f): f is CustomSessionFolder =>
          typeof f === "object" && f !== null && typeof f.id === "string" && typeof f.name === "string" && Array.isArray(f.sessionIds)
      );
    }
    return [];
  } catch {
    return [];
  }
}

export function saveCustomFolders(folders: CustomSessionFolder[]): void {
  if (typeof window === "undefined") return;
  try {
    if (folders.length === 0) window.localStorage.removeItem(CUSTOM_FOLDERS_STORAGE_KEY);
    else window.localStorage.setItem(CUSTOM_FOLDERS_STORAGE_KEY, JSON.stringify(folders));
  } catch {
    // Persistence is best-effort.
  }
}

export function loadPinnedWorkspaces(): PinnedWorkspace[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PINNED_WORKSPACES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (p): p is PinnedWorkspace =>
          typeof p === "object" && p !== null && typeof p.root === "string" && typeof p.key === "string"
      );
    }
    return [];
  } catch {
    return [];
  }
}

export function savePinnedWorkspaces(workspaces: PinnedWorkspace[]): void {
  if (typeof window === "undefined") return;
  try {
    if (workspaces.length === 0) window.localStorage.removeItem(PINNED_WORKSPACES_STORAGE_KEY);
    else window.localStorage.setItem(PINNED_WORKSPACES_STORAGE_KEY, JSON.stringify(workspaces));
  } catch {
    // Persistence is best-effort.
  }
}

export function loadCollapsedFolders(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSED_FOLDERS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((k): k is string => typeof k === "string"));
    return new Set();
  } catch {
    return new Set();
  }
}

export function saveCollapsedFolders(keys: ReadonlySet<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (keys.size === 0) window.localStorage.removeItem(COLLAPSED_FOLDERS_STORAGE_KEY);
    else window.localStorage.setItem(COLLAPSED_FOLDERS_STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // Persistence is best-effort.
  }
}

export function loadSidebarViewMode(): SidebarViewMode {
  if (typeof window === "undefined") return "tree";
  try {
    const raw = window.localStorage.getItem(SIDEBAR_VIEW_MODE_STORAGE_KEY);
    if (raw === "focused") return "focused";
    return "tree";
  } catch {
    return "tree";
  }
}

export function saveSidebarViewMode(mode: SidebarViewMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SIDEBAR_VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // Persistence is best-effort.
  }
}

export function getFolderDisplayName(rootPath: string): string {
  const normalized = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return rootPath;
  return segments[segments.length - 1];
}

export function buildSessionTreeStructure({
  allSessions,
  recentProjects,
  pinnedWorkspaces,
  customFolders = [],
  currentProjectKey,
  runningSessionIds,
  unreadSessionIds,
  workspaceOrder = [],
  archivedSessionIds = new Set(),
  filterQuery = "",
}: {
  allSessions: readonly SessionInfo[];
  recentProjects: readonly RecentProject[];
  pinnedWorkspaces: readonly PinnedWorkspace[];
  customFolders?: readonly CustomSessionFolder[];
  currentProjectKey: string | null;
  runningSessionIds: ReadonlySet<string>;
  unreadSessionIds: ReadonlySet<string>;
  workspaceOrder?: readonly string[];
  archivedSessionIds?: ReadonlySet<string>;
  filterQuery?: string;
}): SessionTreeStructure {
  const query = filterQuery.trim().toLowerCase();

  // Match sessions against filter query if present
  const matchesQuery = (session: SessionInfo): boolean => {
    if (!query) return true;
    const nameMatch = (session.name ?? "").toLowerCase().includes(query);
    const msgMatch = (session.firstMessage ?? "").toLowerCase().includes(query);
    const idMatch = session.id.toLowerCase().includes(query);
    return nameMatch || msgMatch || idMatch;
  };

  // Map session id to SessionInfo for fast lookup
  const sessionMap = new Map<string, SessionInfo>();
  for (const s of allSessions) {
    sessionMap.set(s.id, s);
  }

  // 1. Custom Folders
  const customAssignedSessionIds = new Set<string>();
  const customGroups: CustomFolderGroup[] = [];

  for (const folder of customFolders) {
    const folderSessions: SessionInfo[] = [];
    for (const sid of folder.sessionIds) {
      const s = sessionMap.get(sid);
      if (s) {
        customAssignedSessionIds.add(sid);
        if (matchesQuery(s) || folder.name.toLowerCase().includes(query)) {
          folderSessions.push(s);
        }
      }
    }
    const allFamilies = listSessionFamilies(folderSessions);
    const families = allFamilies.filter((f) => !archivedSessionIds.has(f.root.id));
    const archivedFamilies = allFamilies.filter((f) => archivedSessionIds.has(f.root.id));
    let runningCount = 0;
    let unreadCount = 0;
    for (const fam of allFamilies) {
      const familySessions = [fam.root, ...fam.subagents];
      if (familySessions.some((s) => runningSessionIds.has(s.id))) runningCount++;
      if (familySessions.some((s) => unreadSessionIds.has(s.id))) unreadCount++;
    }
    customGroups.push({
      id: folder.id,
      name: folder.name,
      families,
      archivedFamilies,
      runningCount,
      unreadCount,
    });
  }

  // 2. Workspaces: merge recent projects and pinned workspaces
  const projectMap = new Map<string, { root: string; key: string; isPinned: boolean }>();
  for (const p of recentProjects) {
    projectMap.set(p.key, { root: p.root, key: p.key, isPinned: false });
  }
  for (const pw of pinnedWorkspaces) {
    const existing = projectMap.get(pw.key);
    if (existing) {
      existing.isPinned = true;
    } else {
      projectMap.set(pw.key, { root: pw.root, key: pw.key, isPinned: true });
    }
  }

  const workspaceGroups: WorkspaceFolderGroup[] = [];
  const assignedToWorkspaceIds = new Set<string>();

  for (const [key, p] of projectMap.entries()) {
    const isCurrent = currentProjectKey === key;
    // Sessions in this workspace that aren't claimed by a custom folder
    const wsSessions = allSessions.filter((s) => {
      if (customAssignedSessionIds.has(s.id)) return false;
      const sKey = workspaceKeyOf(s);
      return sKey === key;
    });

    for (const s of wsSessions) {
      assignedToWorkspaceIds.add(s.id);
    }

    const filteredWsSessions = query
      ? wsSessions.filter((s) => matchesQuery(s) || p.root.toLowerCase().includes(query))
      : wsSessions;

    const allFamilies = listSessionFamilies(filteredWsSessions);
    const families = allFamilies.filter((f) => !archivedSessionIds.has(f.root.id));
    const archivedFamilies = allFamilies.filter((f) => archivedSessionIds.has(f.root.id));
    let runningCount = 0;
    let unreadCount = 0;
    for (const fam of allFamilies) {
      const familySessions = [fam.root, ...fam.subagents];
      if (familySessions.some((s) => runningSessionIds.has(s.id))) runningCount++;
      if (familySessions.some((s) => unreadSessionIds.has(s.id))) unreadCount++;
    }

    workspaceGroups.push({
      key,
      root: p.root,
      name: getFolderDisplayName(p.root),
      isCurrent,
      isPinned: p.isPinned,
      families,
      archivedFamilies,
      runningCount,
      unreadCount,
    });
  }

  // Sort workspaces stably using user-defined workspaceOrder if available; otherwise by initial recent activity.
  // CRITICAL: NEVER automatically sort by isCurrent (never auto-promote active workspace to top)!
  const orderMap = new Map<string, number>();
  if (workspaceOrder && workspaceOrder.length > 0) {
    workspaceOrder.forEach((key, idx) => orderMap.set(key, idx));
  }

  workspaceGroups.sort((a, b) => {
    const indexA = orderMap.get(a.key);
    const indexB = orderMap.get(b.key);
    if (indexA !== undefined && indexB !== undefined) {
      return indexA - indexB;
    }
    if (indexA !== undefined) return -1;
    if (indexB !== undefined) return 1;
    const aLatest = a.families[0]?.latestModified ?? "";
    const bLatest = b.families[0]?.latestModified ?? "";
    return bLatest.localeCompare(aLatest);
  });

  // 3. Unclassified sessions (sessions not in custom folders and not in any known workspace)
  const unclassifiedSessions = allSessions.filter(
    (s) => !customAssignedSessionIds.has(s.id) && !assignedToWorkspaceIds.has(s.id)
  );

  let unclassifiedGroup: WorkspaceFolderGroup | null = null;
  if (unclassifiedSessions.length > 0) {
    const filteredUnclassified = query ? unclassifiedSessions.filter(matchesQuery) : unclassifiedSessions;
    const allFamilies = listSessionFamilies(filteredUnclassified);
    const families = allFamilies.filter((f) => !archivedSessionIds.has(f.root.id));
    const archivedFamilies = allFamilies.filter((f) => archivedSessionIds.has(f.root.id));
    let runningCount = 0;
    let unreadCount = 0;
    for (const fam of allFamilies) {
      const familySessions = [fam.root, ...fam.subagents];
      if (familySessions.some((s) => runningSessionIds.has(s.id))) runningCount++;
      if (familySessions.some((s) => unreadSessionIds.has(s.id))) unreadCount++;
    }
    unclassifiedGroup = {
      key: "__unclassified__",
      root: "",
      name: "其他会话",
      isCurrent: false,
      isPinned: false,
      families,
      archivedFamilies,
      runningCount,
      unreadCount,
    };
  }

  return {
    customGroups,
    workspaceGroups,
    unclassifiedGroup,
  };
}
