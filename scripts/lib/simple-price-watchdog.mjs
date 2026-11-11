import { renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const STALL_MS = 5 * 60 * 1000;
export const STALL_MESSAGE = "Оновлення автоматично зупинено після 5 хвилин без прогресу. Можна запустити повторно.";

export function statusAt(job, modifiedMs, now = Date.now()) {
  if (!["starting", "running"].includes(job.status) || now - modifiedMs < STALL_MS) return job;
  return { ...job, status: "error", error: STALL_MESSAGE, label: STALL_MESSAGE,
    finished_at: Math.floor((modifiedMs + STALL_MS) / 1000) };
}

export function writeJson(file, value) {
  const temporary = file + "." + randomUUID() + ".tmp";
  writeFileSync(temporary, JSON.stringify(value) + "\n");
  renameSync(temporary, file);
}
