import { randomUUID } from "node:crypto";

export class LogContext {
  readonly runId: string;

  constructor() {
    this.runId = randomUUID();
  }
}
