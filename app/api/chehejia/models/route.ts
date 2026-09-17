import { NextResponse } from "next/server";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

const MODELS_FILE_PATH = path.join(os.homedir(), ".pi", "agent", "models.json");
const SETTINGS_FILE_PATH = path.join(os.homedir(), ".pi", "agent", "settings.json");
const EPT_AUTH_FILE_PATH = path.join(os.homedir(), ".config", "ept", "auth_session.json");

const GATEWAY_BASE_URL = "https://portal-k8s-prod.ep.chehejia.com/api/copilot/v2/claudecode";
const MODELS_ENDPOINT = `${GATEWAY_BASE_URL}/v1/models`;

export interface UserQuotaInfo {
  planName: string;
  totalBudget: number;
  actualCost: number;
  remainingBudget: number;
  usagePercentage: number;
  resetCycle: string;
}

export interface RemoteChehejiaModel {
  id: string; // 例如 claude-aws-claude-haiku-4-5
  displayName: string; // 例如 aws-claude-haiku-4-5
  createdAt?: string;
  hasVision: boolean;
  hasThinking: boolean;
  contextWindow: number;
  maxTokens: number;
  priceTag?: string; // 例如 "0.3x" 或 "免费"
  usedTokens?: string; // 例如 "25,849,363"
  usedCost?: string; // 例如 "15.93 元"
}

interface EptSession {
  portal_token?: string;
  access_token?: string;
  account?: {
    label?: string;
    email?: string;
    username?: string;
  };
}

function getEptCliPath(): string | null {
  const defaultWinPath = path.join(os.homedir(), ".ept", "bin", "ept.exe");
  if (fs.existsSync(defaultWinPath)) return defaultWinPath;
  const defaultUnixPath = path.join(os.homedir(), ".ept", "bin", "ept");
  if (fs.existsSync(defaultUnixPath)) return defaultUnixPath;
  return null;
}

function stripAnsi(str: string): string {
  // 剥离控制字符与 ANSI 转义码
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/[\x00-\x09\x0b-\x1f\x7f]/g, "");
}

async function getUsageAndPricing(): Promise<{
  quota: UserQuotaInfo | null;
  pricingMap: Record<string, string>;
  usageMap: Record<string, { tokens: string; cost: string }>;
}> {
  const eptBin = getEptCliPath();
  if (!eptBin) return { quota: null, pricingMap: {}, usageMap: {} };

  let quota: UserQuotaInfo | null = null;
  const pricingMap: Record<string, string> = {};
  const usageMap: Record<string, { tokens: string; cost: string }> = {};

  try {
    // 1. 获取额度概要（3 秒超时）
    const { stdout: summaryOut } = await execFileAsync(
      eptBin,
      ["usage", "--summary-only", "--json"],
      { timeout: 3000, encoding: "utf8" },
    );

    if (summaryOut) {
      const summary = JSON.parse(summaryOut.trim());
      const totalBudget = Number(summary.total_budget || 0);
      const actualCost = Number(summary.actual_cost || 0);
      const remainingBudget = Math.max(0, Number((totalBudget - actualCost).toFixed(2)));
      const usagePercentage = Number(Number(summary.usage_percentage || 0).toFixed(2));

      quota = {
        planName: summary.plan_name || "pro",
        totalBudget,
        actualCost: Number(actualCost.toFixed(2)),
        remainingBudget,
        usagePercentage,
        resetCycle: summary.reset_cycle || "monthly",
      };
    }
  } catch (err) {
    console.warn("[api/chehejia/models] Failed fetching ept summary:", err);
  }

  try {
    // 2. 获取完整 usage 报告解析价格与历史用量（4 秒超时）
    const { stdout: fullOut } = await execFileAsync(
      eptBin,
      ["usage"],
      { timeout: 4000, encoding: "utf8" },
    );

    if (fullOut) {
      const cleanOut = stripAnsi(fullOut);
      const rawLines = cleanOut.split(/\r?\n/);
      const mergedLines: string[] = [];

      // 终端自动折行合并处理（拼接被切断到下一行的价格或文字）
      for (const line of rawLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith("•") || trimmed.startsWith("#")) {
          mergedLines.push(trimmed);
        } else if (mergedLines.length > 0) {
          // 若上一行结尾数字带有小数点或行首是数字/credit，合并处理
          mergedLines[mergedLines.length - 1] += " " + trimmed;
        } else {
          mergedLines.push(trimmed);
        }
      }

      for (const line of mergedLines) {
        // 匹配模型价格行，如：
        // • aws-claude-haiku-4-5(简写:haiku-4.5)（支持图片） 1.7x credit
        // • baidu-deepseek-v4-flash[1m](简写:...) 0.3x credit
        // • free-basic（私有化）
        if (line.startsWith("•") && (line.includes("credit") || line.includes("私有化") || line.includes("free"))) {
          const nameMatch = line.match(/•\s*([a-zA-Z0-9_.-]+(?:\[1m\])?)/);
          if (nameMatch) {
            const mName = nameMatch[1];
            // 匹配 0.3x / 1.7x / 5.7x 等，容忍中间空格或折行
            const priceMatch = line.match(/(\d+(?:\.\d+)?)\s*x\s*credit/i);
            let price: string | null = null;
            if (priceMatch) {
              price = `${priceMatch[1]}x`;
            } else if (line.includes("私有化") || line.includes("free") || mName.startsWith("free-")) {
              price = "免费";
            }

            if (price) {
              pricingMap[mName] = price;
              // 存一份去除 [1m] 的基础名
              const baseName = mName.replace(/\[1m\]/i, "");
              if (!pricingMap[baseName]) pricingMap[baseName] = price;
            }
          }
        }

        // 匹配详细消耗行：• **baidu-deepseek-v4-flash[****1m]**: 25,849,363 tokens，15.93 元
        const usageMatch = line.match(/•\s*\*\*(.+?)\*\*:\s*([0-9,]+)\s*tokens[，,]\s*([0-9.]+)\s*元/);
        if (usageMatch) {
          const rawName = usageMatch[1].replace(/\*/g, "").trim();
          usageMap[rawName] = {
            tokens: usageMatch[2],
            cost: `${usageMatch[3]} 元`,
          };
          const baseName = rawName.replace(/\[1m\]/i, "");
          if (!usageMap[baseName]) usageMap[baseName] = usageMap[rawName];
        }
      }
    }
  } catch (err) {
    console.warn("[api/chehejia/models] Failed fetching full ept usage:", err);
  }

  return { quota, pricingMap, usageMap };
}

function resolveModelPrice(
  displayName: string,
  rawId: string,
  pricingMap: Record<string, string>,
): string | undefined {
  // 1. 直接全名匹配
  if (pricingMap[displayName]) return pricingMap[displayName];
  if (pricingMap[rawId]) return pricingMap[rawId];

  // 2. 去除 [1m] 后的基础名匹配
  const baseDisplay = displayName.replace(/\[1m\]/gi, "");
  if (pricingMap[baseDisplay]) return pricingMap[baseDisplay];

  // 3. 命名特征兜底（如 free- 开头为免费）
  if (displayName.startsWith("free-") || rawId.includes("free-")) return "免费";
  if (displayName.includes("lpai-") || rawId.includes("lpai-")) return "免费";

  // 4. 针对 andes- / kivy- / 别名做跨名映射
  if (displayName.includes("andes-glm-5.2") || displayName.includes("glm-5.2")) {
    return pricingMap["kivy-glm-5_2"] || pricingMap["kivy-glm-5_2[1m]"] || "1.0x";
  }

  // 5. 模糊下划线与连字符互通
  const altKey = displayName.replace(/_/g, ".");
  if (pricingMap[altKey]) return pricingMap[altKey];
  const altKey2 = displayName.replace(/\./g, "_");
  if (pricingMap[altKey2]) return pricingMap[altKey2];

  return undefined;
}

function getEptTokenAndAccount(): { token: string | null; accountName: string | null } {
  try {
    if (fs.existsSync(EPT_AUTH_FILE_PATH)) {
      const text = fs.readFileSync(EPT_AUTH_FILE_PATH, "utf8").trim();
      if (text) {
        const sess = JSON.parse(text) as EptSession;
        const token = sess.portal_token || sess.access_token || null;
        const accountName = sess.account?.username || sess.account?.label || sess.account?.email || null;
        return { token, accountName };
      }
    }
  } catch (err) {
    console.error("[api/chehejia/models] Failed reading ept auth:", err);
  }
  return { token: null, accountName: null };
}

function safeReadJson<T>(filePath: string): T | null {
  try {
    if (fs.existsSync(filePath)) {
      const text = fs.readFileSync(filePath, "utf8").trim();
      if (text) return JSON.parse(text) as T;
    }
  } catch (err) {
    console.error(`[api/chehejia/models] Failed reading ${filePath}:`, err);
  }
  return null;
}

function safeWriteJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

export async function GET() {
  const { token, accountName } = getEptTokenAndAccount();

  // 读取本地已配置的 chehejia 模型
  const modelsData = safeReadJson<any>(MODELS_FILE_PATH);
  const chehejiaProvider = modelsData?.providers?.chehejia;
  const currentConfiguredModels: Array<{ id: string; name?: string }> = chehejiaProvider?.models || [];
  const enabledModelIds = currentConfiguredModels.map((m) => m.id);

  // 读取当前设置的默认模型
  const settingsData = safeReadJson<any>(SETTINGS_FILE_PATH);
  const currentDefaultModel = settingsData?.defaultProvider === "chehejia" ? settingsData?.defaultModel : null;

  if (!token) {
    return NextResponse.json({
      ok: false,
      isNetworkError: false,
      error: "未在本地检测到 EPT 登录凭证，请先在终端运行 ept login 登录。",
      gatewayUrl: GATEWAY_BASE_URL,
      hasEptToken: false,
      accountName: null,
      quota: null,
      remoteModels: [], // 离线/未登录时清空选项
      enabledModelIds: [],
      defaultModelId: currentDefaultModel,
    });
  }

  // 并行获取网关模型与用户额度用量报告（加严格的 3.5 秒内网超时熔断，在家连不上时秒级返回，不卡顿）
  const [modelsRespResult, usageData] = await Promise.all([
    fetch(MODELS_ENDPOINT, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(3500),
    }).catch((err) => ({
      networkError: true,
      error: err?.message || String(err),
    })),
    getUsageAndPricing(),
  ]);

  if ("networkError" in modelsRespResult) {
    return NextResponse.json({
      ok: false,
      isNetworkError: true,
      error: "无法连接公司模型网关 (portal-k8s-prod.ep.chehejia.com)。您当前可能处于非公司内网或未开启公司 VPN。",
      gatewayUrl: GATEWAY_BASE_URL,
      hasEptToken: true,
      accountName,
      quota: usageData.quota,
      remoteModels: [], // 无法连接内网时，模型列表清空，不展示任何选项！
      enabledModelIds: [],
      defaultModelId: currentDefaultModel,
    });
  }

  const resp = modelsRespResult as Response;
  if (!resp.ok) {
    const errText = await resp.text();
    return NextResponse.json({
      ok: false,
      isNetworkError: true,
      error: `公司网关返回错误 (HTTP ${resp.status}): ${errText.slice(0, 200)}`,
      gatewayUrl: GATEWAY_BASE_URL,
      hasEptToken: true,
      accountName,
      quota: usageData.quota,
      remoteModels: [], // 报错时清空选项
      enabledModelIds: [],
      defaultModelId: currentDefaultModel,
    });
  }

  const json = (await resp.json()) as { data?: any[] };
  const rawList = Array.isArray(json.data) ? json.data : [];

  const allModels: RemoteChehejiaModel[] = rawList.map((item) => {
    const id = item.id || "";
    const displayName = item.display_name || id.replace(/^claude-/, "");
    const caps = item.capabilities || {};
    const hasVision = Boolean(caps.image_input?.supported);
    const hasThinking = Boolean(caps.effort?.supported);
    const is1m = displayName.includes("[1m]") || id.includes("[1m]");
    const contextWindow = is1m ? 1000000 : 200000;
    const maxTokens = 65536;

    // 智能解析价格与用量
    const priceTag = resolveModelPrice(displayName, id, usageData.pricingMap);
    const modelUsage =
      usageData.usageMap[displayName] ||
      usageData.usageMap[id] ||
      usageData.usageMap[displayName.replace(/\[1m\]/gi, "")];

    return {
      id,
      displayName,
      createdAt: item.created_at,
      hasVision,
      hasThinking,
      contextWindow,
      maxTokens,
      priceTag,
      usedTokens: modelUsage?.tokens,
      usedCost: modelUsage?.cost,
    };
  });

  // 优选去重：若同时存在带 [1m] 和不带 [1m] 的相同模型，只保留 [1m] 版本，剔除冗余普通版
  const oneMBases = new Set<string>();
  for (const m of allModels) {
    if (m.displayName.toLowerCase().includes("[1m]")) {
      oneMBases.add(m.displayName.replace(/\[1m\]/gi, "").toLowerCase());
    }
  }

  const remoteModels = allModels.filter((m) => {
    const lower = m.displayName.toLowerCase();
    if (!lower.includes("[1m]") && oneMBases.has(lower)) {
      return false;
    }
    return true;
  });

  // 将已启用的模型列表中旧的非 1m 模型平滑迁移映射到对应 [1m] 模型
  const mappedEnabledModelIds = enabledModelIds.map((eid) => {
    const lower = eid.toLowerCase();
    if (oneMBases.has(lower)) {
      const candidate = remoteModels.find((m) => m.displayName.toLowerCase() === `${lower}[1m]`);
      if (candidate) return candidate.displayName;
    }
    return eid;
  });

  // 默认模型同理平滑迁移
  let normalizedDefaultModel = currentDefaultModel;
  if (currentDefaultModel && oneMBases.has(currentDefaultModel.toLowerCase())) {
    const candidate = remoteModels.find((m) => m.displayName.toLowerCase() === `${currentDefaultModel.toLowerCase()}[1m]`);
    if (candidate) normalizedDefaultModel = candidate.displayName;
  }

  return NextResponse.json({
    ok: true,
    isNetworkError: false,
    gatewayUrl: GATEWAY_BASE_URL,
    hasEptToken: true,
    accountName,
    quota: usageData.quota,
    remoteModels,
    enabledModelIds: mappedEnabledModelIds,
    defaultModelId: normalizedDefaultModel,
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      enabledModels?: Array<{
        id: string; // 模型实际使用的调用ID（如 display_name）
        name?: string;
        reasoning?: boolean;
        hasVision?: boolean;
        contextWindow?: number;
        maxTokens?: number;
        priceTag?: string;
      }>;
      defaultModelId?: string;
    };

    const enabledModels = body.enabledModels || [];
    const defaultModelId = body.defaultModelId;

    // 1. 读取并更新 models.json
    const modelsData = safeReadJson<any>(MODELS_FILE_PATH) || { providers: {} };
    if (!modelsData.providers) modelsData.providers = {};

    const existingProvider = modelsData.providers.chehejia || {};
    const updatedModels = enabledModels.map((m) => {
      // 构造展示名称，如 "baidu-deepseek-v4-flash[1m] (0.3x)" 或 "azure-gpt-5_6-sol (5.7x, 视觉)"
      let displayName = m.name || m.id;
      if (!displayName.includes("(") && (m.priceTag || m.hasVision)) {
        const tags: string[] = [];
        if (m.priceTag) tags.push(m.priceTag);
        if (m.hasVision) tags.push("视觉");
        if (tags.length > 0) displayName = `${m.id} (${tags.join(", ")})`;
      }

      return {
        id: m.id,
        name: displayName,
        reasoning: Boolean(m.reasoning),
        input: m.hasVision ? ["text", "image"] : ["text"],
        contextWindow: m.contextWindow || 200000,
        maxTokens: m.maxTokens || 65536,
      };
    });

    modelsData.providers.chehejia = {
      name: existingProvider.name || "公司模型池子 (chehejia)",
      baseUrl: existingProvider.baseUrl || GATEWAY_BASE_URL,
      api: existingProvider.api || "anthropic-messages",
      apiKey:
        existingProvider.apiKey ||
        "!python -c \"import pathlib, runpy; runpy.run_path(str(pathlib.Path.home() / '.pi' / 'agent' / 'ept-portal-token.py'))\"",
      authHeader: true,
      models: updatedModels,
    };

    safeWriteJson(MODELS_FILE_PATH, modelsData);

    // 2. 如果指定了默认模型，更新 settings.json
    if (defaultModelId) {
      const settingsData = safeReadJson<any>(SETTINGS_FILE_PATH) || {};
      settingsData.defaultProvider = "chehejia";
      settingsData.defaultModel = defaultModelId;
      safeWriteJson(SETTINGS_FILE_PATH, settingsData);
    }

    return NextResponse.json({
      ok: true,
      savedCount: updatedModels.length,
      defaultModelId: defaultModelId || null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: `保存模型配置失败: ${err?.message || String(err)}` },
      { status: 500 },
    );
  }
}
