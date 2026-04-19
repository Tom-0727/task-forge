// basic-agent/src/trajectory/recorder.ts
// JSONL writer: one JSON.stringify(event) per line, append-only, one file per run.
// Verbatim pass-through — no event projection.
import * as fs from "node:fs";
import * as path from "node:path";

export interface Recorder {
  readonly path: string;
  write(evt: unknown): void;
  close(): Promise<void>;
}

export function createRecorder(runId: string, dir: string): Recorder {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${runId}.jsonl`);
  const stream = fs.createWriteStream(filePath, { flags: "a" });

  return {
    path: filePath,
    write(evt: unknown): void {
      stream.write(JSON.stringify(evt) + "\n");
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
      });
    },
  };
}
