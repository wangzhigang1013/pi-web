import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  getFolderDisplayName,
  buildSessionTreeStructure,
} = await jiti.import("./session-folders.ts");

test("getFolderDisplayName extracts the trailing folder segment correctly", () => {
  assert.equal(getFolderDisplayName("C:/Users/test/project-alpha"), "project-alpha");
  assert.equal(getFolderDisplayName("C:\\Users\\test\\project-beta"), "project-beta");
  assert.equal(getFolderDisplayName("/home/user/workspace/gamma/"), "gamma");
  assert.equal(getFolderDisplayName("project"), "project");
});

test("buildSessionTreeStructure groups sessions into workspaces and computes activity", () => {
  const mockSessions = [
    {
      id: "s1",
      path: "/sessions/s1.jsonl",
      cwd: "C:/projects/app-one",
      projectRoot: "C:/projects/app-one",
      projectKey: "app-one-key",
      modified: "2025-01-02T10:00:00Z",
      messageCount: 5,
      firstMessage: "Hello App One",
    },
    {
      id: "s2",
      path: "/sessions/s2.jsonl",
      cwd: "C:/projects/app-two",
      projectRoot: "C:/projects/app-two",
      projectKey: "app-two-key",
      modified: "2025-01-01T10:00:00Z",
      messageCount: 2,
      firstMessage: "Hello App Two",
    },
    {
      id: "s3",
      path: "/sessions/s3.jsonl",
      cwd: "C:/projects/app-one",
      projectRoot: "C:/projects/app-one",
      projectKey: "app-one-key",
      modified: "2025-01-03T10:00:00Z",
      messageCount: 8,
      firstMessage: "Fix bug in App One",
    },
  ];

  const recentProjects = [
    { root: "C:/projects/app-one", key: "app-one-key" },
    { root: "C:/projects/app-two", key: "app-two-key" },
  ];

  const runningSessionIds = new Set(["s1"]);
  const unreadSessionIds = new Set(["s2"]);

  const tree = buildSessionTreeStructure({
    allSessions: mockSessions,
    recentProjects,
    pinnedWorkspaces: [],
    customFolders: [],
    currentProjectKey: "app-one-key",
    runningSessionIds,
    unreadSessionIds,
  });

  assert.equal(tree.workspaceGroups.length, 2);
  const appOneGroup = tree.workspaceGroups.find((g) => g.key === "app-one-key");
  assert.ok(appOneGroup);
  assert.equal(appOneGroup.name, "app-one");
  assert.equal(appOneGroup.isCurrent, true);
  assert.equal(appOneGroup.families.length, 2);
  assert.equal(appOneGroup.runningCount, 1);
  assert.equal(appOneGroup.unreadCount, 0);

  const appTwoGroup = tree.workspaceGroups.find((g) => g.key === "app-two-key");
  assert.ok(appTwoGroup);
  assert.equal(appTwoGroup.name, "app-two");
  assert.equal(appTwoGroup.isCurrent, false);
  assert.equal(appTwoGroup.families.length, 1);
  assert.equal(appTwoGroup.runningCount, 0);
  assert.equal(appTwoGroup.unreadCount, 1);
});

test("buildSessionTreeStructure respects workspaceOrder and does not auto-promote current workspace to top", () => {
  const mockSessions = [
    {
      id: "s1",
      path: "/sessions/s1.jsonl",
      cwd: "C:/projects/app-one",
      projectRoot: "C:/projects/app-one",
      projectKey: "app-one-key",
      modified: "2025-01-02T10:00:00Z",
      messageCount: 1,
      firstMessage: "One",
    },
    {
      id: "s2",
      path: "/sessions/s2.jsonl",
      cwd: "C:/projects/app-two",
      projectRoot: "C:/projects/app-two",
      projectKey: "app-two-key",
      modified: "2025-01-01T10:00:00Z",
      messageCount: 1,
      firstMessage: "Two",
    },
  ];

  const recentProjects = [
    { root: "C:/projects/app-one", key: "app-one-key" },
    { root: "C:/projects/app-two", key: "app-two-key" },
  ];

  // Specify order where app-two is FIRST, even when current project is app-one
  const tree = buildSessionTreeStructure({
    allSessions: mockSessions,
    recentProjects,
    pinnedWorkspaces: [],
    customFolders: [],
    currentProjectKey: "app-one-key",
    runningSessionIds: new Set(),
    unreadSessionIds: new Set(),
    workspaceOrder: ["app-two-key", "app-one-key"],
  });

  // app-two must remain at index 0, NOT jumping behind or below app-one
  assert.equal(tree.workspaceGroups[0].key, "app-two-key");
  assert.equal(tree.workspaceGroups[1].key, "app-one-key");
});

test("buildSessionTreeStructure respects custom folders and query filtering", () => {
  const mockSessions = [
    {
      id: "s1",
      path: "/sessions/s1.jsonl",
      cwd: "C:/projects/app-one",
      projectRoot: "C:/projects/app-one",
      projectKey: "app-one-key",
      modified: "2025-01-02T10:00:00Z",
      messageCount: 5,
      firstMessage: "Important Research",
    },
    {
      id: "s2",
      path: "/sessions/s2.jsonl",
      cwd: "C:/projects/app-one",
      projectRoot: "C:/projects/app-one",
      projectKey: "app-one-key",
      modified: "2025-01-01T10:00:00Z",
      messageCount: 2,
      firstMessage: "Daily Chat",
    },
  ];

  const recentProjects = [
    { root: "C:/projects/app-one", key: "app-one-key" },
  ];

  const customFolders = [
    { id: "custom-1", name: "重要任务", sessionIds: ["s1"] },
  ];

  const tree = buildSessionTreeStructure({
    allSessions: mockSessions,
    recentProjects,
    pinnedWorkspaces: [],
    customFolders,
    currentProjectKey: "app-one-key",
    runningSessionIds: new Set(),
    unreadSessionIds: new Set(),
  });

  assert.equal(tree.customGroups.length, 1);
  assert.equal(tree.customGroups[0].name, "重要任务");
  assert.equal(tree.customGroups[0].families.length, 1);
  assert.equal(tree.customGroups[0].families[0].root.id, "s1");

  // s1 is claimed by custom group, so workspace only has s2
  const wsGroup = tree.workspaceGroups.find((g) => g.key === "app-one-key");
  assert.ok(wsGroup);
  assert.equal(wsGroup.families.length, 1);
  assert.equal(wsGroup.families[0].root.id, "s2");

  // Filtering by query
  const filtered = buildSessionTreeStructure({
    allSessions: mockSessions,
    recentProjects,
    pinnedWorkspaces: [],
    customFolders,
    currentProjectKey: "app-one-key",
    runningSessionIds: new Set(),
    unreadSessionIds: new Set(),
    filterQuery: "Daily",
  });

  assert.equal(filtered.customGroups[0].families.length, 0);
  assert.equal(filtered.workspaceGroups[0].families.length, 1);
  assert.equal(filtered.workspaceGroups[0].families[0].root.id, "s2");
});

test("buildSessionTreeStructure separates active and archived sessions", () => {
  const mockSessions = [
    {
      id: "s1",
      path: "/sessions/s1.jsonl",
      cwd: "C:/projects/app-one",
      projectRoot: "C:/projects/app-one",
      projectKey: "app-one-key",
      modified: "2025-01-02T10:00:00Z",
      messageCount: 5,
      firstMessage: "Active task",
    },
    {
      id: "s2",
      path: "/sessions/s2.jsonl",
      cwd: "C:/projects/app-one",
      projectRoot: "C:/projects/app-one",
      projectKey: "app-one-key",
      modified: "2025-01-01T10:00:00Z",
      messageCount: 2,
      firstMessage: "Finished old task",
    },
  ];

  const recentProjects = [
    { root: "C:/projects/app-one", key: "app-one-key" },
  ];

  const tree = buildSessionTreeStructure({
    allSessions: mockSessions,
    recentProjects,
    pinnedWorkspaces: [],
    customFolders: [],
    currentProjectKey: "app-one-key",
    runningSessionIds: new Set(),
    unreadSessionIds: new Set(),
    archivedSessionIds: new Set(["s2"]),
  });

  const ws = tree.workspaceGroups.find((g) => g.key === "app-one-key");
  assert.ok(ws);
  assert.equal(ws.families.length, 1);
  assert.equal(ws.families[0].root.id, "s1");
  assert.equal(ws.archivedFamilies.length, 1);
  assert.equal(ws.archivedFamilies[0].root.id, "s2");
});
