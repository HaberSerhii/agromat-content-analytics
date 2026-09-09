import { promises as fs } from "node:fs";
import path from "node:path";
import { serialize, deserialize } from "node:v8";

function filePath(name: string) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("Invalid cache name");
  return path.join(
    process.env.DASHBOARD_CACHE_DIR ||
      path.join(process.cwd(), "data", "dashboard-cache"),
    `${name}.bin`,
  );
}

/** V8 preserves the Map/Set indexes used by server-only datasets. */
export async function readPersistentResult<T>(
  name: string,
  maxAgeMs: number,
): Promise<{ value: T; createdAt: number } | null> {
  try {
    const entry = deserialize(await fs.readFile(filePath(name))) as {
      value: T;
      createdAt: number;
    };
    const age = Date.now() - entry.createdAt;
    return Number.isFinite(age) && age >= 0 && age < maxAgeMs ? entry : null;
  } catch {
    return null;
  }
}

export async function writePersistentResult<T>(
  name: string,
  value: T,
): Promise<void> {
  const destination = filePath(name);
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(temporary, serialize({ createdAt: Date.now(), value }), {
      mode: 0o600,
    });
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined);
    console.warn(
      `[cache] ${name} persistence failed`,
      error instanceof Error ? error.message : error,
    );
  }
}
