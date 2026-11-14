import { readFile } from "node:fs/promises";

const mib = value => Math.round(value / 1024 / 1024 * 10) / 10;
async function containerMemory() {
  for (const [usage, limit] of [
    ["/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory.max"],
    ["/sys/fs/cgroup/memory/memory.usage_in_bytes", "/sys/fs/cgroup/memory/memory.limit_in_bytes"],
  ]) {
    try {
      const [used, maximum] = await Promise.all([readFile(usage, "utf8"), readFile(limit, "utf8")]);
      const usedBytes = Number(used.trim());
      const limitBytes = Number(maximum.trim());
      return {
        containerMiB: Number.isFinite(usedBytes) ? mib(usedBytes) : null,
        containerLimitMiB: Number.isFinite(limitBytes) ? mib(limitBytes) : null,
      };
    } catch { /* Not every host exposes cgroup metrics. */ }
  }
  return {};
}

export async function logMemory(reason, logger = console) {
  const usage = process.memoryUsage();
  logger.info("[memory]", {
    reason,
    rssMiB: mib(usage.rss),
    heapUsedMiB: mib(usage.heapUsed),
    heapTotalMiB: mib(usage.heapTotal),
    externalMiB: mib(usage.external),
    arrayBuffersMiB: mib(usage.arrayBuffers),
    ...await containerMemory(),
    uptimeSeconds: Math.round(process.uptime()),
  });
}

export function startMemoryMonitor({ intervalMs = 60000, logger = console } = {}) {
  const sample = reason => logMemory(reason, logger).catch(() => logger.warn("[memory] sampling failed"));
  void sample("startup");
  const timer = setInterval(() => { void sample("interval"); }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
