import fs from "node:fs";
import path from "node:path";
import type { AgentPaths } from "./types.js";
import { utcnow } from "./time.js";

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export function createLogger(paths: AgentPaths, processName: string): Logger {
  fs.mkdirSync(paths.logsDir, { recursive: true });
  const logFile = path.join(paths.logsDir, `${processName}.log`);

  function write(level: string, msg: string): void {
    const line = `[${utcnow()}] [${level}] ${msg}\n`;
    try {
      fs.appendFileSync(logFile, line, "utf8");
    } catch {
      /* ignore */
    }
    if (level === "error") {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  }

  return {
    info: (m) => write("info", m),
    warn: (m) => write("warn", m),
    error: (m) => write("error", m),
  };
}
