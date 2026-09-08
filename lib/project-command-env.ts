import {
  createBashToolDefinition,
  createLocalBashOperations,
  getAgentDir,
  type BashOperations,
  type InlineExtension,
  type LoadExtensionsResult,
} from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { backgroundTasks } from "./background-tasks";

const HOST_EXTENSION_NAME = "pi-web-project-command-environment";
const HOST_EXTENSION_PATH = `<inline:${HOST_EXTENSION_NAME}>`;

type ProjectShellSettings = {
  getShellCommandPrefix(): string | undefined;
  getShellPath(): string | undefined;
};

type ProjectCommandBashOperationsOptions = {
  agentBinDir?: string;
  baseEnvironment?: NodeJS.ProcessEnv;
  localOperations?: BashOperations;
  platform?: NodeJS.Platform;
  shellPath?: string;
};

function isHostRuntimeVariable(name: string, platform: NodeJS.Platform): boolean {
  const comparableName = platform === "win32" ? name.toUpperCase() : name;
  return comparableName === "PORT"
    || comparableName === "NODE_ENV"
    || comparableName.startsWith("NEXT_");
}

export function sanitizeProjectCommandEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const environment = { ...baseEnvironment };
  for (const name of Object.keys(environment)) {
    if (isHostRuntimeVariable(name, platform)) delete environment[name];
  }
  return environment;
}

function withAgentBinDirectory(
  environment: NodeJS.ProcessEnv,
  agentBinDir: string,
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  const pathKey = platform === "win32"
    ? Object.keys(environment).find((name) => name.toUpperCase() === "PATH") ?? "PATH"
    : "PATH";
  const pathDelimiter = platform === "win32" ? ";" : ":";
  const currentPath = environment[pathKey] ?? "";
  const pathEntries = currentPath.split(pathDelimiter).filter(Boolean);
  if (!pathEntries.includes(agentBinDir)) {
    environment[pathKey] = [agentBinDir, currentPath].filter(Boolean).join(pathDelimiter);
  }
  return environment;
}

export function createProjectCommandBashOperations(
  options: ProjectCommandBashOperationsOptions = {},
): BashOperations {
  const {
    agentBinDir = join(getAgentDir(), "bin"),
    baseEnvironment = process.env,
    localOperations = createLocalBashOperations({ shellPath: options.shellPath }),
    platform = process.platform,
  } = options;

  return {
    exec(command, cwd, executionOptions) {
      const environment = withAgentBinDirectory(
        sanitizeProjectCommandEnvironment(executionOptions.env ?? baseEnvironment, platform),
        agentBinDir,
        platform,
      );
      return localOperations.exec(command, cwd, {
        ...executionOptions,
        env: environment,
      });
    },
  };
}

export function createProjectCommandBashExtension(options: {
  cwd: string;
  settings: ProjectShellSettings;
}): InlineExtension {
  return {
    name: HOST_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      const displayDefinition = createBashToolDefinition(options.cwd);
      pi.registerTool({
        ...displayDefinition,
        async execute(toolCallId, params, signal, onUpdate, context) {
          const sessionId = (context as any)?.session?.id || options.cwd;
          const ac = new AbortController();
          const unregister = backgroundTasks.registerBashController(sessionId, ac);

          // 记录 bash 执行前的端口快照
          try {
            await backgroundTasks.snapshotBefore(sessionId);
          } catch {
            // best-effort
          }

          const executionDefinition = createBashToolDefinition(options.cwd, {
            commandPrefix: options.settings.getShellCommandPrefix(),
            operations: createProjectCommandBashOperations({
              shellPath: options.settings.getShellPath(),
            }),
          });

          // 组合会话主 signal 与单独中止命令的 ac.signal
          const combinedSignal = signal ? AbortSignal.any([signal, ac.signal]) : ac.signal;

          try {
            return await executionDefinition.execute(toolCallId, params, combinedSignal, onUpdate, context);
          } finally {
            unregister();
            // 异步追踪新拉起的后台端口服务
            void backgroundTasks.trackAfter(sessionId).catch(() => {});
          }
        },
      });
    },
  };
}

export function preferUserBashExtension(base: LoadExtensionsResult): LoadExtensionsResult {
  const hostExtensionIndex = base.extensions.findIndex((extension) => extension.path === HOST_EXTENSION_PATH);
  if (hostExtensionIndex < 0) return base;

  const userBashOwner = base.extensions
    .slice(0, hostExtensionIndex)
    .find((extension) => extension.tools.has("bash"));
  if (!userBashOwner) return base;

  return {
    ...base,
    extensions: base.extensions.filter((_, index) => index !== hostExtensionIndex),
    errors: base.errors.filter((error) => !(
      error.path === HOST_EXTENSION_PATH
      && error.error === `Tool "bash" conflicts with ${userBashOwner.path}`
    )),
  };
}
