import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type ApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never";

export interface ThreadStartOptions {
  cwd: string;
  sandbox?: SandboxMode;
  approvalPolicy?: ApprovalPolicy;
  skipGitRepoCheck?: boolean;
}

export interface TurnStartOptions {
  threadId: string;
  text: string;
}

export interface ItemCompletedNotification {
  threadId: string;
  turnId: string;
  item: Record<string, unknown>;
}

export interface TokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface ThreadTokenUsage {
  total: TokenUsageBreakdown;
  last: TokenUsageBreakdown;
  modelContextWindow: number | null;
}

export interface TurnCompletedEvent {
  threadId: string;
  turnId: string;
  tokenUsage?: ThreadTokenUsage;
}

export interface CompactCompletedEvent {
  threadId: string;
  turnId?: string;
}

export interface TurnFailedEvent {
  threadId: string;
  turnId: string;
  error: { message?: string };
}

export interface TurnHandlers {
  onItemCompleted?: (n: ItemCompletedNotification) => void;
  onAgentMessageDelta?: (threadId: string, text: string) => void;
  onCommandOutputDelta?: (threadId: string, data: string) => void;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (err: Error) => void;
  method: string;
}

export interface AppServerLogger {
  info: (m: string) => void;
  warn: (m: string) => void;
  error: (m: string) => void;
}

const DEFAULT_RPC_TIMEOUT_MS = 60_000;
const DEFAULT_TURN_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_STOP_TIMEOUT_MS = 10_000;

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CodexAppServerClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private rl: readline.Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private log: AppServerLogger;
  private clientInfo: { name: string; title: string; version: string };
  private initialized = false;
  private exitPromise: Promise<void> | null = null;
  private exitHandlers = new Set<(err: Error) => void>();
  private rpcTimeoutMs = envMs("HARNESS_CODEX_RPC_TIMEOUT_MS", DEFAULT_RPC_TIMEOUT_MS);
  private turnTimeoutMs = envMs("HARNESS_CODEX_TURN_TIMEOUT_MS", DEFAULT_TURN_TIMEOUT_MS);
  private stopTimeoutMs = envMs("HARNESS_CODEX_STOP_TIMEOUT_MS", DEFAULT_STOP_TIMEOUT_MS);

  constructor(log: AppServerLogger, clientInfo?: Partial<{ name: string; title: string; version: string }>) {
    this.log = log;
    this.clientInfo = {
      name: clientInfo?.name ?? "long-run-agent-harness",
      title: clientInfo?.title ?? "long-run-agent-harness",
      version: clientInfo?.version ?? "0.0.0",
    };
  }

  async start(): Promise<void> {
    if (this.proc) return;
    const proc = spawn("codex", ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    this.proc = proc;

    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        const s = line.trim();
        if (s) this.log.warn(`app-server: ${s}`);
      }
    });

    this.rl = readline.createInterface({ input: proc.stdout });
    this.rl.on("line", (line) => this.handleLine(line));

    this.exitPromise = new Promise<void>((resolve) => {
      proc.on("exit", (code, sig) => {
        this.log.warn(`app-server exited code=${code ?? "?"} sig=${sig ?? ""}`);
        const err = new Error(`app-server exited code=${code ?? "?"} sig=${sig ?? ""}`);
        this.proc = null;
        this.rl?.close();
        this.rl = null;
        this.initialized = false;
        for (const [, p] of this.pending) {
          p.reject(new Error(`app-server exited before ${p.method} completed`));
        }
        this.pending.clear();
        for (const h of Array.from(this.exitHandlers)) {
          try {
            h(err);
          } catch {
            /* ignore */
          }
        }
        resolve();
      });
    });

    await this.request("initialize", { clientInfo: this.clientInfo });
    this.initialized = true;
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    const proc = this.proc;
    proc.kill("SIGTERM");
    const exit = this.exitPromise ?? Promise.resolve();
    const timedOut = await Promise.race([
      exit.then(() => false),
      sleep(this.stopTimeoutMs).then(() => true),
    ]);
    if (timedOut && this.proc === proc) {
      this.log.warn(`app-server did not exit after ${this.stopTimeoutMs}ms; killing`);
      proc.kill("SIGKILL");
      await exit;
    }
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  isAlive(): boolean {
    return this.proc !== null && this.initialized;
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(trimmed) as Record<string, unknown>;
    } catch (err) {
      this.log.warn(`app-server: invalid JSON line: ${trimmed.slice(0, 200)}`);
      return;
    }

    if (typeof msg.id === "number") {
      const id = msg.id;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (msg.error) {
        const e = msg.error as { message?: string; code?: number };
        p.reject(new Error(`rpc ${p.method} error: ${e.message ?? JSON.stringify(msg.error)}`));
      } else {
        p.resolve(msg.result);
      }
      return;
    }

    if (typeof msg.method === "string") {
      this.dispatchNotification(msg.method, msg.params);
    }
  }

  private notificationHandlers = new Map<string, (params: unknown) => void>();

  onNotification(method: string, handler: (params: unknown) => void): () => void {
    this.notificationHandlers.set(method, handler);
    return () => {
      if (this.notificationHandlers.get(method) === handler) {
        this.notificationHandlers.delete(method);
      }
    };
  }

  private dispatchNotification(method: string, params: unknown): void {
    const h = this.notificationHandlers.get(method);
    if (h) {
      try {
        h(params);
      } catch (err) {
        this.log.warn(`notification ${method} handler error: ${(err as Error).message}`);
      }
    }
  }

  private onExit(handler: (err: Error) => void): () => void {
    this.exitHandlers.add(handler);
    return () => {
      this.exitHandlers.delete(handler);
    };
  }

  private request<T>(method: string, params: unknown): Promise<T> {
    if (!this.proc) return Promise.reject(new Error("app-server not running"));
    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.pending.delete(id);
        reject(new Error(`rpc ${method} timed out after ${this.rpcTimeoutMs}ms`));
      }, this.rpcTimeoutMs);
      const settleResolve = (v: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v as T);
      };
      const settleReject = (err: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      };
      this.pending.set(id, {
        method,
        resolve: settleResolve,
        reject: settleReject,
      });
      this.proc!.stdin.write(body + "\n", (err) => {
        if (err) {
          this.pending.delete(id);
          settleReject(err);
        }
      });
    });
  }

  async startThread(opts: ThreadStartOptions): Promise<string> {
    const params: Record<string, unknown> = {
      cwd: opts.cwd,
    };
    if (opts.sandbox) params.sandbox = opts.sandbox;
    if (opts.approvalPolicy) params.approvalPolicy = opts.approvalPolicy;
    if (opts.skipGitRepoCheck !== undefined) params.skipGitRepoCheck = opts.skipGitRepoCheck;
    const res = await this.request<{ thread: { id: string } }>("thread/start", params);
    return res.thread.id;
  }

  async resumeThread(threadId: string, opts: ThreadStartOptions): Promise<void> {
    const params: Record<string, unknown> = { threadId, cwd: opts.cwd };
    if (opts.sandbox) params.sandbox = opts.sandbox;
    if (opts.approvalPolicy) params.approvalPolicy = opts.approvalPolicy;
    if (opts.skipGitRepoCheck !== undefined) params.skipGitRepoCheck = opts.skipGitRepoCheck;
    await this.request("thread/resume", params);
  }

  async runTurn(opts: TurnStartOptions, handlers: TurnHandlers = {}): Promise<TurnCompletedEvent> {
    return new Promise<TurnCompletedEvent>((resolve, reject) => {
      const disposers: Array<() => void> = [];
      let settled = false;
      let latestTokenUsage: ThreadTokenUsage | undefined;
      const cleanup = (): void => {
        for (const d of disposers) d();
        clearTimeout(timer);
      };
      const settleResolve = (v: TurnCompletedEvent): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(v);
      };
      const settleReject = (err: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };
      const timer = setTimeout(() => {
        settleReject(new Error(`turn timed out after ${this.turnTimeoutMs}ms`));
      }, this.turnTimeoutMs);

      disposers.push(this.onExit((err) => settleReject(err)));

      disposers.push(
        this.onNotification("item/completed", (params) => {
          const p = params as ItemCompletedNotification;
          if (p.threadId !== opts.threadId) return;
          handlers.onItemCompleted?.(p);
        })
      );
      disposers.push(
        this.onNotification("item/agentMessage/delta", (params) => {
          const p = params as { threadId?: string; text?: string };
          if (p.threadId !== opts.threadId || typeof p.text !== "string") return;
          handlers.onAgentMessageDelta?.(opts.threadId, p.text);
        })
      );
      disposers.push(
        this.onNotification("item/commandExecution/outputDelta", (params) => {
          const p = params as { threadId?: string; data?: string };
          if (p.threadId !== opts.threadId || typeof p.data !== "string") return;
          handlers.onCommandOutputDelta?.(opts.threadId, p.data);
        })
      );
      disposers.push(
        this.onNotification("thread/tokenUsage/updated", (params) => {
          const p = params as { threadId?: string; tokenUsage?: ThreadTokenUsage };
          if (p.threadId !== opts.threadId || !p.tokenUsage) return;
          latestTokenUsage = p.tokenUsage;
        })
      );
      disposers.push(
        this.onNotification("turn/completed", (params) => {
          const p = params as { threadId?: string; turn?: { id?: string } };
          if (p.threadId !== opts.threadId) return;
          settleResolve({
            threadId: opts.threadId,
            turnId: p.turn?.id ?? "",
            tokenUsage: latestTokenUsage,
          });
        })
      );
      disposers.push(
        this.onNotification("turn/failed", (params) => {
          const p = params as TurnFailedEvent;
          if (p.threadId !== opts.threadId) return;
          settleReject(new Error(`turn failed: ${p.error?.message ?? "unknown"}`));
        })
      );

      this.request("turn/start", {
        threadId: opts.threadId,
        input: [{ type: "text", text: opts.text }],
      }).catch((err) => {
        settleReject(err);
      });
    });
  }

  async compactThread(threadId: string): Promise<CompactCompletedEvent> {
    return new Promise<CompactCompletedEvent>((resolve, reject) => {
      const disposers: Array<() => void> = [];
      let settled = false;
      let compactTurnId: string | undefined;
      const cleanup = (): void => {
        for (const d of disposers) d();
        clearTimeout(timer);
      };
      const settleResolve = (v: CompactCompletedEvent): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(v);
      };
      const settleReject = (err: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };
      const timer = setTimeout(() => {
        settleReject(new Error(`compact timed out after ${this.turnTimeoutMs}ms`));
      }, this.turnTimeoutMs);

      disposers.push(this.onExit((err) => settleReject(err)));

      disposers.push(
        this.onNotification("turn/started", (params) => {
          const p = params as { threadId?: string; turn?: { id?: string } };
          if (p.threadId !== threadId) return;
          compactTurnId = p.turn?.id;
        })
      );
      disposers.push(
        this.onNotification("thread/compacted", (params) => {
          const p = params as { threadId?: string; turnId?: string };
          if (p.threadId !== threadId) return;
          settleResolve({ threadId, turnId: p.turnId ?? compactTurnId });
        })
      );
      disposers.push(
        this.onNotification("item/completed", (params) => {
          const p = params as ItemCompletedNotification;
          if (p.threadId !== threadId) return;
          if ((p.item as { type?: string }).type !== "contextCompaction") return;
          settleResolve({ threadId, turnId: p.turnId ?? compactTurnId });
        })
      );
      disposers.push(
        this.onNotification("turn/completed", (params) => {
          const p = params as { threadId?: string; turn?: { id?: string; status?: string } };
          if (p.threadId !== threadId) return;
          if (compactTurnId && p.turn?.id && p.turn.id !== compactTurnId) return;
          if (p.turn?.status === "failed") {
            settleReject(new Error("compact turn failed"));
            return;
          }
          settleResolve({ threadId, turnId: p.turn?.id ?? compactTurnId });
        })
      );
      disposers.push(
        this.onNotification("turn/failed", (params) => {
          const p = params as TurnFailedEvent;
          if (p.threadId !== threadId) return;
          settleReject(new Error(`compact failed: ${p.error?.message ?? "unknown"}`));
        })
      );

      this.request("thread/compact/start", { threadId }).catch((err) => {
        settleReject(err);
      });
    });
  }
}
