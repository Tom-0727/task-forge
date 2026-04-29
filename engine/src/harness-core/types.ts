export type Provider = "claude" | "codex";
export type InteractionMode = "web-ui" | "feishu" | "none";
export type HeartbeatAction = "invoke" | "skip_short_sleep" | "skip_long_sleep";
export type RuntimeState =
  | "running"
  | "off_hours"
  | "stopped"
  | "engine_build_failed"
  | "crashed";

export interface FeishuConfig {
  app_id_env: string;
  app_secret_env?: string;
  chat_id: string;
}

export interface InteractionConfig {
  mode: InteractionMode;
  web_ui_port?: number;
  feishu?: FeishuConfig;
}

export interface RuntimeConfig {
  default_interval_minutes: number;
  default_max_turns: number;
  default_max_budget_usd: number;
}

export interface AgentIdentity {
  schema_version: 1;
  agent_name: string;
  provider: Provider;
  created_at: string;
  engine_version_at_create: string;
  interaction: InteractionConfig;
  runtime: RuntimeConfig;
}

export interface AgentPaths {
  agentDir: string;
  runtimeDir: string;
  heartbeatExtensionsDir: string;
  heartbeatPreDir: string;
  heartbeatPostDir: string;
  identityFile: string;
  pidFile: string;
  stateFile: string;
  heartbeatFile: string;
  intervalFile: string;
  passiveModeFile: string;
  claudeSessionFile: string;
  codexThreadFile: string;
  compactRequestFile: string;
  compactStatusFile: string;
  metricsFile: string;
  eventsFile: string;
  pendingDir: string;
  awaitingDir: string;
  workScheduleFile: string;
  dueRemindersFile: string;
  pidsDir: string;
  logsDir: string;
  mailboxDir: string;
  contactsFile: string;
  memoryDir: string;
  scheduledTasksFile: string;
  todoListDir: string;
  skillsDir: string;
  skillsTodoPreHeartbeat: string;
}

export interface PromptSection {
  source: string;
  content: string;
}

export interface WorkSchedule {
  timezone: string;
  windows: Array<{ days: number[]; start: string; end: string }>;
}

export interface PendingMessage {
  mailbox_id: string;
  ts?: string;
  source?: string;
  [k: string]: unknown;
}

export interface TodoSubtask {
  text: string;
  done?: boolean;
}

export interface TodoItem {
  id: string;
  title: string;
  description?: string;
  done?: boolean;
  subtasks?: TodoSubtask[];
}

export interface ScheduledTask {
  id: string;
  title: string;
  description?: string;
  subtasks?: Array<{ text: string }>;
}

export interface HeartbeatDecision {
  action: HeartbeatAction;
  reason?: "off_hours" | "awaiting" | "passive";
  mailboxStatus?: string;
  pendingSnapshot?: Record<string, string>;
  sleepMinutes?: number;
  sleepSeconds?: number;
  stateUpdate: "running" | "off_hours";
}
