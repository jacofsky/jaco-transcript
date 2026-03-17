import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export interface BenchmarkEntry {
  model: string;           // e.g. 'large-v3'
  computeType: string;     // e.g. 'int8'
  hasGpu: boolean;
  audioDurationSec: number;
  wallTimeSec: number;
  realTimeFactor: number;  // wallTimeSec / audioDurationSec
  timestamp: number;       // Date.now()
}

export interface BenchmarkStore {
  entries: BenchmarkEntry[];
}

/**
 * Path where benchmarks are stored: ~/.jaco-transcript/benchmarks.json
 */
export function getBenchmarkPath(): string {
  return join(homedir(), ".jaco-transcript", "benchmarks.json");
}

/**
 * Load existing benchmarks from disk. Returns empty store if file doesn't exist.
 */
export async function loadBenchmarks(): Promise<BenchmarkStore> {
  try {
    const raw = await readFile(getBenchmarkPath(), "utf-8");
    const parsed = JSON.parse(raw) as BenchmarkStore;
    if (Array.isArray(parsed.entries)) {
      return parsed;
    }
    return { entries: [] };
  } catch {
    return { entries: [] };
  }
}

/**
 * Save a new benchmark entry. Keeps only the last 20 entries to cap file size.
 * Creates ~/.jaco-transcript/ directory if needed.
 */
export async function saveBenchmark(entry: BenchmarkEntry): Promise<void> {
  try {
    const benchmarkPath = getBenchmarkPath();
    await mkdir(dirname(benchmarkPath), { recursive: true });

    const store = await loadBenchmarks();
    store.entries.push(entry);

    // Keep only the last 20 entries
    if (store.entries.length > 20) {
      store.entries = store.entries.slice(store.entries.length - 20);
    }

    await writeFile(benchmarkPath, JSON.stringify(store, null, 2), "utf-8");
  } catch {
    // Silent — benchmark failures must never crash the CLI
  }
}

/**
 * Estimate wall-clock seconds for transcribing `audioDurationSec` seconds of audio
 * using the given model/computeType/hasGpu combination.
 *
 * Strategy:
 * 1. Filter entries matching same model + computeType + hasGpu
 * 2. If 3+ matching entries: use median realTimeFactor * audioDurationSec
 * 3. If 1-2 matching entries: use average realTimeFactor * audioDurationSec
 * 4. If 0 matching entries: use hardcoded fallback table
 */
export function estimateTranscriptionTime(
  audioDurationSec: number,
  model: string,
  computeType: string,
  hasGpu: boolean,
  store: BenchmarkStore
): number {
  const matching = store.entries.filter(
    (e) => e.model === model && e.computeType === computeType && e.hasGpu === hasGpu
  );

  if (matching.length >= 3) {
    // Use median realTimeFactor
    const sorted = [...matching].sort((a, b) => a.realTimeFactor - b.realTimeFactor);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0
        ? (sorted[mid - 1].realTimeFactor + sorted[mid].realTimeFactor) / 2
        : sorted[mid].realTimeFactor;
    return median * audioDurationSec;
  }

  if (matching.length >= 1) {
    // Use average realTimeFactor
    const avg = matching.reduce((sum, e) => sum + e.realTimeFactor, 0) / matching.length;
    return avg * audioDurationSec;
  }

  // Fallback table
  const key = `${model}|${computeType}|${hasGpu}`;
  const fallbackRtf: Record<string, number> = {
    "large-v3|float16|true": 0.3,
    "large-v3|int8|true": 0.4,
    "large-v3|int8|false": 2.5,
    "medium|int8|false": 1.2,
    "small|int8|false": 0.6,
    "base|int8|false": 0.35,
    "tiny|int8|false": 0.2,
  };

  const rtf = fallbackRtf[key] ?? 1.5;
  return rtf * audioDurationSec;
}
