/**
 * Observability (§40/§41). Minimal, dependency-free building blocks the hosted
 * deployment scrapes: structured JSON logs (greppable, ship to any log sink)
 * and an in-process counters/gauges registry exposed via the /health endpoint.
 * Swap-in for Prometheus/OpenTelemetry later; the call sites stay the same.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

let minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";
const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function setLogLevel(l: LogLevel): void {
  minLevel = l;
}

/** Structured log line: one JSON object per event, timestamped. */
export function log(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
  if (ORDER[level] < ORDER[minLevel]) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
  // eslint-disable-next-line no-console
  (level === "error" ? console.error : console.log)(line);
}

/** A tiny counters + gauges registry. Counters only go up; gauges are set. */
export class Metrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly startedAt = Date.now();

  inc(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }
  set(name: string, value: number): void {
    this.gauges.set(name, value);
  }
  get(name: string): number {
    return this.counters.get(name) ?? this.gauges.get(name) ?? 0;
  }

  /** Health snapshot for the /health endpoint and operator dashboards. */
  snapshot(): Record<string, unknown> {
    return {
      ok: true,
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
    };
  }
}
