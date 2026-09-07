import { NextResponse } from "next/server";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const dynamic = "force-dynamic";

const ACCOUNTS_FILE_PATH = path.join(os.homedir(), ".pi", "agent", "antigravity-accounts.json");
const AUTH_FILE_PATH = path.join(os.homedir(), ".pi", "agent", "auth.json");

const CLIENT_ID = Buffer.from(
  "MTA3MTAwNjA2MDU5MS10bWhzc2luMmgyMWxjcmUyMzV2dG9sb2poNGc0MDNlc" +
    "C5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbQ==",
  "base64",
).toString("utf8");
const CLIENT_SECRET = Buffer.from("R09DU1BYLUs1OEZXUjQ" + "4NkxkTEoxbUxCOHNYQzR6NnFEQWY=", "base64").toString("utf8");
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const ENDPOINTS = [
  "https://daily-cloudcode-pa.sandbox.googleapis.com",
  "https://cloudcode-pa.googleapis.com",
];

interface StoredAccount {
  email: string;
  refresh: string;
  access?: string;
  expires?: number;
  projectId?: string;
  addedAt?: number;
  lastUsedAt?: number;
  quotaExhaustedUntil?: number;
  exhaustedReason?: string;
  tier?: string;
}

interface AccountsStore {
  activeEmail: string;
  autoFailover: boolean;
  accounts: StoredAccount[];
}

function safeReadJson<T>(filePath: string): T | undefined {
  try {
    if (fs.existsSync(filePath)) {
      const text = fs.readFileSync(filePath, "utf8").trim();
      if (text) return JSON.parse(text) as T;
    }
  } catch (err) {
    console.error(`[api/antigravity] Failed reading ${filePath}:`, err);
  }
  return undefined;
}

function safeWriteJson(filePath: string, data: unknown): void {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {
    console.error(`[api/antigravity] Failed writing ${filePath}:`, err);
  }
}

function loadAccountsStore(): AccountsStore {
  const fromAccounts = safeReadJson<AccountsStore>(ACCOUNTS_FILE_PATH);
  const authData = safeReadJson<Record<string, any>>(AUTH_FILE_PATH);
  const antigravityAuth = authData?.antigravity;

  const map = new Map<string, StoredAccount>();

  if (fromAccounts?.accounts && Array.isArray(fromAccounts.accounts)) {
    for (const acc of fromAccounts.accounts) {
      if (acc.email && acc.refresh) map.set(acc.email.toLowerCase(), acc);
    }
  }

  if (antigravityAuth?.accounts && Array.isArray(antigravityAuth.accounts)) {
    for (const acc of antigravityAuth.accounts) {
      if (acc.email && acc.refresh) {
        const k = acc.email.toLowerCase();
        map.set(k, { ...map.get(k), ...acc });
      }
    }
  }

  if (antigravityAuth?.email && antigravityAuth?.refresh) {
    const k = antigravityAuth.email.toLowerCase();
    map.set(k, {
      email: k,
      refresh: antigravityAuth.refresh,
      access: antigravityAuth.access,
      expires: antigravityAuth.expires,
      projectId: antigravityAuth.projectId,
      ...map.get(k),
    });
  }

  const accounts = Array.from(map.values());
  let activeEmail = (
    fromAccounts?.activeEmail ||
    antigravityAuth?.activeAccountEmail ||
    antigravityAuth?.email ||
    accounts[0]?.email ||
    ""
  ).toLowerCase();

  if (activeEmail && !map.has(activeEmail) && accounts.length > 0) {
    activeEmail = accounts[0]!.email;
  }

  const autoFailover = fromAccounts?.autoFailover ?? antigravityAuth?.autoFailover ?? true;

  const store: AccountsStore = { activeEmail, autoFailover, accounts };
  safeWriteJson(ACCOUNTS_FILE_PATH, store);
  return store;
}

function persistStore(store: AccountsStore): void {
  safeWriteJson(ACCOUNTS_FILE_PATH, store);
  try {
    const authData = safeReadJson<Record<string, any>>(AUTH_FILE_PATH) || {};
    const active = store.accounts.find((a) => a.email.toLowerCase() === store.activeEmail.toLowerCase()) || store.accounts[0];
    if (active) {
      authData.antigravity = {
        refresh: active.refresh,
        access: active.access || "",
        expires: active.expires || 0,
        projectId: active.projectId || "antigravity-default",
        email: active.email,
        type: "oauth",
        accounts: store.accounts,
        activeAccountEmail: store.activeEmail,
        autoFailover: store.autoFailover,
      };
      safeWriteJson(AUTH_FILE_PATH, authData);
    }
  } catch (err) {
    console.error("[api/antigravity] Failed syncing auth.json:", err);
  }
}

async function refreshGoogleToken(refreshToken: string): Promise<{ access: string; expires: number }> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${errText}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  return {
    access: data.access_token,
    expires: Date.now() + (data.expires_in || 3600) * 1000 - 5 * 60 * 1000,
  };
}

function antigravityHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "antigravity/1.15.8 windows/amd64",
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": JSON.stringify({
      ideType: "ANTIGRAVITY",
      platform: "WINDOWS",
      pluginType: "GEMINI",
    }),
  };
}

async function fetchQuotaForToken(token: string): Promise<{
  planLabel?: string;
  groups: Array<{
    displayName: string;
    buckets: Array<{
      displayName: string;
      remainingFraction: number;
      resetTime?: string;
      disabled?: boolean;
      description?: string;
    }>;
  }>;
}> {
  let quotaData: any = null;
  let assistData: any = null;

  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(`${endpoint}/v1internal:retrieveUserQuotaSummary`, {
        method: "POST",
        headers: antigravityHeaders(token),
        body: JSON.stringify({}),
      });
      if (res.ok) {
        quotaData = await res.json();
        break;
      }
    } catch {}
  }

  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(`${endpoint}/v1internal:loadCodeAssist`, {
        method: "POST",
        headers: antigravityHeaders(token),
        body: JSON.stringify({
          metadata: { ideType: "ANTIGRAVITY", platform: "WINDOWS", pluginType: "GEMINI" },
        }),
      });
      if (res.ok) {
        assistData = await res.json();
        break;
      }
    } catch {}
  }

  const paidTier = assistData?.paidTier;
  const productTier = assistData?.currentTier;
  const planLabel = paidTier?.name
    ? `${paidTier.name}${paidTier.id ? ` (${paidTier.id})` : ""}`
    : productTier?.name
      ? `${productTier.name}${productTier.id ? ` (${productTier.id})` : ""}`
      : undefined;

  const groups: Array<{
    displayName: string;
    buckets: Array<{
      displayName: string;
      remainingFraction: number;
      resetTime?: string;
      disabled?: boolean;
      description?: string;
    }>;
  }> = [];

  for (const g of quotaData?.groups || []) {
    const buckets: any[] = [];
    for (const b of g?.buckets || []) {
      const isDisabled = b.disabled === true;
      let frac = typeof b.remainingFraction === "number" ? Math.max(0, Math.min(1, b.remainingFraction)) : 0;
      if (isDisabled) frac = 0;
      buckets.push({
        displayName: b.displayName || b.bucketId || "Limit",
        remainingFraction: frac,
        resetTime: b.resetTime,
        disabled: isDisabled,
        description: b.description,
      });
    }
    if (buckets.length || g.displayName) {
      groups.push({
        displayName: g.displayName || "Quota Group",
        buckets,
      });
    }
  }

  return { planLabel, groups };
}

export async function GET() {
  const store = loadAccountsStore();
  const now = Date.now();

  const accountResults = await Promise.all(
    store.accounts.map(async (acc) => {
      const isActive = acc.email.toLowerCase() === store.activeEmail.toLowerCase();
      const isCooldown = !!(acc.quotaExhaustedUntil && acc.quotaExhaustedUntil > now);

      let token = acc.access;
      // Refresh token if needed
      if (!token || !acc.expires || acc.expires <= now + 5 * 60 * 1000) {
        try {
          const refreshed = await refreshGoogleToken(acc.refresh);
          acc.access = refreshed.access;
          acc.expires = refreshed.expires;
          token = refreshed.access;
        } catch (err: any) {
          return {
            email: acc.email,
            projectId: acc.projectId || "default",
            tier: acc.tier,
            isActive,
            isCooldown,
            cooldownUntil: acc.quotaExhaustedUntil,
            error: `Token refresh failed: ${err?.message || String(err)}`,
          };
        }
      }

      try {
        const quota = await fetchQuotaForToken(token);
        if (quota.planLabel && !acc.tier) {
          acc.tier = quota.planLabel;
        }
        return {
          email: acc.email,
          projectId: acc.projectId || "default",
          tier: quota.planLabel || acc.tier,
          isActive,
          isCooldown,
          cooldownUntil: acc.quotaExhaustedUntil,
          usage: quota,
        };
      } catch (err: any) {
        return {
          email: acc.email,
          projectId: acc.projectId || "default",
          tier: acc.tier,
          isActive,
          isCooldown,
          cooldownUntil: acc.quotaExhaustedUntil,
          error: `Fetch quota failed: ${err?.message || String(err)}`,
        };
      }
    }),
  );

  // Save any refreshed tokens
  persistStore(store);

  return NextResponse.json({
    activeEmail: store.activeEmail,
    autoFailover: store.autoFailover,
    accounts: accountResults,
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      action: string;
      email?: string;
      enabled?: boolean;
      rawText?: string;
      account?: Partial<StoredAccount>;
    };

    const store = loadAccountsStore();

    if (body.action === "switch") {
      const targetEmail = (body.email || "").trim().toLowerCase();
      const target = store.accounts.find((a) => a.email.toLowerCase() === targetEmail);
      if (!target) {
        return NextResponse.json({ error: `Account ${targetEmail} not found.` }, { status: 404 });
      }
      store.activeEmail = target.email;
      target.lastUsedAt = Date.now();
      persistStore(store);
      return NextResponse.json({ success: true, activeEmail: store.activeEmail });
    }

    if (body.action === "toggleAutoFailover") {
      store.autoFailover = body.enabled ?? true;
      persistStore(store);
      return NextResponse.json({ success: true, autoFailover: store.autoFailover });
    }

    if (body.action === "delete") {
      const targetEmail = (body.email || "").trim().toLowerCase();
      store.accounts = store.accounts.filter((a) => a.email.toLowerCase() !== targetEmail);
      if (store.activeEmail.toLowerCase() === targetEmail) {
        store.activeEmail = store.accounts[0]?.email || "";
      }
      persistStore(store);
      return NextResponse.json({ success: true, accounts: store.accounts });
    }

    if (body.action === "add") {
      let email = body.account?.email?.trim().toLowerCase();
      let refresh = body.account?.refresh?.trim();
      let access = body.account?.access?.trim();
      let projectId = body.account?.projectId?.trim();
      let expires = body.account?.expires;

      // Check if rawText was provided (e.g. user pasted raw string)
      if (body.rawText) {
        const text = body.rawText;
        // 1. Try to find email
        const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i);
        if (emailMatch) email = emailMatch[0].toLowerCase();

        // 2. Try to find JSON payload
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            // Clean up potentially malformed concatenated quotes or scopes
            const cleanedJson = jsonMatch[0].replace(/\]https:\/\/[^"]*"/g, "]");
            const parsed = JSON.parse(cleanedJson);
            refresh = parsed.refresh_token || parsed.refresh || refresh;
            access = parsed.token || parsed.access_token || parsed.access || access;
            projectId = parsed.project_id || parsed.projectId || projectId;
            if (parsed.expiry) {
              expires = new Date(parsed.expiry).getTime();
            }
          } catch {
            // If regex JSON parse failed, try line by line extraction
            const rtMatch = text.match(/"refresh_token"\s*:\s*"([^"]+)"/);
            if (rtMatch) refresh = rtMatch[1];
            const tokMatch = text.match(/"token"\s*:\s*"([^"]+)"/);
            if (tokMatch) access = tokMatch[1];
            const projMatch = text.match(/"project_id"\s*:\s*"([^"]+)"/);
            if (projMatch) projectId = projMatch[1];
          }
        }
      }

      if (!refresh) {
        return NextResponse.json(
          { error: "未找到有效的 refresh_token。请确保粘贴的内容包含账号凭据 JSON。" },
          { status: 400 },
        );
      }

      // Refresh token to verify and get fresh access token
      try {
        const refreshed = await refreshGoogleToken(refresh);
        access = refreshed.access;
        expires = refreshed.expires;
      } catch (err: any) {
        return NextResponse.json(
          { error: `凭证验证失败，无法刷新 Token: ${err?.message || String(err)}` },
          { status: 400 },
        );
      }

      if (!email) {
        try {
          const uRes = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
            headers: { Authorization: `Bearer ${access}` },
          });
          if (uRes.ok) {
            const uData = (await uRes.json()) as { email?: string };
            if (uData.email) email = uData.email.toLowerCase();
          }
        } catch {}
      }

      if (!email) {
        email = `google-account-${Date.now()}@gmail.com`;
      }

      const existingIdx = store.accounts.findIndex((a) => a.email.toLowerCase() === email.toLowerCase());
      const newAcc: StoredAccount = {
        email,
        refresh,
        access,
        expires,
        projectId: projectId || "antigravity-default",
        addedAt: existingIdx >= 0 ? store.accounts[existingIdx]!.addedAt : Date.now(),
        lastUsedAt: Date.now(),
      };

      if (existingIdx >= 0) {
        store.accounts[existingIdx] = { ...store.accounts[existingIdx], ...newAcc };
      } else {
        store.accounts.push(newAcc);
      }

      if (!store.activeEmail) {
        store.activeEmail = email;
      }

      persistStore(store);
      return NextResponse.json({ success: true, account: newAcc });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || String(error) }, { status: 500 });
  }
}
