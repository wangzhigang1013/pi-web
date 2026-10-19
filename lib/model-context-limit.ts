import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AnyModel } from "@earendil-works/pi-ai";
import type { ModelScopeResult } from "./model-scope";

/** A model-shaped value whose `contextWindow` is a number the clamp can cap. */
function hasNumericContextWindow(
  model: object,
): model is { provider: string; id: string; contextWindow: number } {
  const candidate = model as { provider?: unknown; id?: unknown; contextWindow?: unknown };
  return typeof candidate.provider === "string"
    && typeof candidate.id === "string"
    && typeof candidate.contextWindow === "number";
}

/**
 * Cache key: model type, provider, id. pi allows entries of different types to share a provider
 * id (a chat `Model` and a `ClassifierModel` may both be `prov/foo`), and `getAllModels` mixes
 * them while `getModel` picks one; without the type they would read each other's capped copy.
 * Chat models carry no `type`, so they key under "chat".
 */
function clampKey(model: { provider: string; id: string; type?: string }): string {
  return `${model.type ?? "chat"}/${model.provider}/${model.id}`;
}

/**
 * A copy of `model` with `contextWindow` capped to `limit`, or the original
 * reference when the limit is unset or the window already fits. Every other
 * field (including `maxTokens`) is preserved. A model without a numeric
 * `contextWindow` (an image or classifier entry) is returned untouched. An
 * already-capped model has `contextWindow === limit`, so it is returned as-is:
 * repeated calls stay reference-stable.
 */
export function clampModelContext<T extends object>(model: T, limit: number | undefined): T;
export function clampModelContext<T extends object>(model: T | undefined, limit: number | undefined): T | undefined;
export function clampModelContext<T extends object>(model: T | undefined, limit: number | undefined): T | undefined {
  if (limit === undefined || model === undefined) return model;
  if (!hasNumericContextWindow(model) || model.contextWindow <= limit) return model;
  // A copy only when the model is over the limit.
  return { ...model, contextWindow: limit } as T;
}

/**
 * Clamp every model of a resolved scope, keeping the scope's shape and order
 * and leaving `resolveVisibleModels` / `selectInitialModelScope` untouched.
 * `visible` and each `scopedModels[i]` are re-mapped; other fields pass through.
 *
 * Call this only after the scope's runtime has been wrapped by
 * {@link applyContextWindowLimit} (in `startRpcSession` that call precedes this
 * one). The scope models are then the runtime's cached capped copies, so
 * re-clamping returns the same reference in `visible` and `scopedModels`
 * instead of making a second copy of a model that appears in both.
 */
export function clampScopeModels(scope: ModelScopeResult, limit: number | undefined): ModelScopeResult {
  if (limit === undefined) return scope;
  return {
    ...scope,
    visible: scope.visible.map((model) => clampModelContext(model, limit)),
    scopedModels: scope.scopedModels.map((scoped) => ({
      ...scoped,
      model: clampModelContext(scoped.model, limit),
    })),
  };
}

/**
 * Read the single top-level `contextWindowLimit` key from a settings object.
 * Only a safe positive integer enables the limit; anything else (missing, 0,
 * negative, NaN, non-number, unsafe) returns undefined so behavior is unchanged.
 */
export function resolveContextWindowLimit(settings: unknown): number | undefined {
  if (typeof settings !== "object" || settings === null) return undefined;
  const value = (settings as Record<string, unknown>).contextWindowLimit;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** Per-runtime clamp state: the applied limit, its copies, and whether a mismatch was warned. */
interface ContextWindowClampState {
  limit: number;
  clampedByKey: Map<string, object>;
  mismatchWarned: boolean;
}

const clampStates = new WeakMap<ModelRuntime, ContextWindowClampState>();
let limitLogged = false;

/** Clamp through the runtime's shared cache so one model keeps returning one object. */
function clampWithState<T extends object>(model: T, state: ContextWindowClampState): T {
  if (!hasNumericContextWindow(model) || model.contextWindow <= state.limit) return model;
  const key = clampKey(model);
  const cached = state.clampedByKey.get(key);
  if (cached !== undefined) return cached as T; // the copy cached for this provider/id/type
  const clamped = { ...model, contextWindow: state.limit } as T;
  state.clampedByKey.set(key, clamped);
  return clamped;
}

/** The limit already applied to `runtime`, or undefined when it is not wrapped. Diagnostics only. */
export function getAppliedContextWindowLimit(runtime: ModelRuntime): number | undefined {
  return clampStates.get(runtime)?.limit;
}

/**
 * Clamp every model this runtime resolves to `limit` tokens of context, leaving
 * all other fields (including `maxTokens`) untouched.
 *
 * `limit === undefined` returns immediately without wrapping anything, so the
 * session's cost and behavior are unchanged. Otherwise the runtime's
 * model-returning readers are wrapped once. The first limit wins: when a later
 * call passes a different one (a runtime shared by parent and child sessions can,
 * after a settings edit on disk), the applied limit and its cache stay put and a
 * warning names the ignored value. Readers missing from the SDK are skipped
 * rather than wrapped, so a version mismatch degrades to less capping.
 */
export function applyContextWindowLimit(runtime: ModelRuntime, limit: number | undefined): void {
  if (limit === undefined) return;
  const existing = clampStates.get(runtime);
  if (existing) {
    if (existing.limit !== limit && !existing.mismatchWarned) {
      existing.mismatchWarned = true;
      console.warn(`[pi-web] ignoring contextWindowLimit ${limit}; ${existing.limit} is already applied to this ModelRuntime`);
    }
    return;
  }
  const state: ContextWindowClampState = { limit, clampedByKey: new Map<string, object>(), mismatchWarned: false };
  clampStates.set(runtime, state);
  if (!limitLogged) {
    limitLogged = true;
    console.warn(`[pi-web] clamping model context windows to ${limit} tokens (settings.json contextWindowLimit)`);
  }

  type RuntimeModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;
  // Readers this SDK build does not have, reported once below.
  const missing: string[] = [];

  // Saved originals are called with the runtime as `this`, and any error they
  // throw propagates untouched.
  const originalGetModel = runtime.getModel;
  if (typeof originalGetModel === "function") {
    runtime.getModel = function (provider: string, id: string): RuntimeModel | undefined {
      const model = originalGetModel.call(runtime, provider, id);
      return model ? clampWithState(model, state) : undefined;
    };
  } else {
    missing.push("getModel");
  }

  const originalGetModels = runtime.getModels;
  if (typeof originalGetModels === "function") {
    runtime.getModels = function (provider?: string): readonly RuntimeModel[] {
      return originalGetModels.call(runtime, provider).map((model) => clampWithState(model, state));
    };
  } else {
    missing.push("getModels");
  }

  const originalGetAllModels = runtime.getAllModels;
  if (typeof originalGetAllModels === "function") {
    runtime.getAllModels = function (provider?: string): readonly AnyModel[] {
      return originalGetAllModels.call(runtime, provider).map((model) => clampWithState(model, state));
    };
  } else {
    missing.push("getAllModels");
  }

  const originalGetAvailable = runtime.getAvailable;
  if (typeof originalGetAvailable === "function") {
    runtime.getAvailable = async function (
      ...args: Parameters<ModelRuntime["getAvailable"]>
    ): Promise<readonly RuntimeModel[]> {
      const models = await originalGetAvailable.apply(runtime, args);
      return models.map((model) => clampWithState(model, state));
    };
  } else {
    missing.push("getAvailable");
  }

  const originalGetAvailableSnapshot = runtime.getAvailableSnapshot;
  if (typeof originalGetAvailableSnapshot === "function") {
    runtime.getAvailableSnapshot = function (): readonly RuntimeModel[] {
      return originalGetAvailableSnapshot.call(runtime).map((model) => clampWithState(model, state));
    };
  } else {
    missing.push("getAvailableSnapshot");
  }

  const originalGetAllAvailable = runtime.getAllAvailable;
  if (typeof originalGetAllAvailable === "function") {
    runtime.getAllAvailable = async function (
      ...args: Parameters<ModelRuntime["getAllAvailable"]>
    ): Promise<readonly AnyModel[]> {
      const models = await originalGetAllAvailable.apply(runtime, args);
      return models.map((model) => clampWithState(model, state));
    };
  } else {
    missing.push("getAllAvailable");
  }

  // Physical models keep their `api`, so virtual-model detection (`api === "pi-virtual"`)
  // still holds on the copy. `resolveModel()` routes through this method, so a routed
  // physical model comes back capped too.
  const originalGetPhysicalModel = runtime.getPhysicalModel;
  if (typeof originalGetPhysicalModel === "function") {
    runtime.getPhysicalModel = function (provider: string, id: string): RuntimeModel | undefined {
      const model = originalGetPhysicalModel.call(runtime, provider, id);
      return model ? clampWithState(model, state) : undefined;
    };
  } else {
    missing.push("getPhysicalModel");
  }

  if (missing.length > 0) {
    console.warn(`[pi-web] ModelRuntime is missing ${missing.join(", ")}; contextWindowLimit will not cap those readers`);
  }
}
