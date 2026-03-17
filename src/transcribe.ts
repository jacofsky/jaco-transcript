import { execa } from "execa";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import cliProgress from "cli-progress";
import chalk from "chalk";
import { getAudioDuration, formatTimestamp } from "./utils.js";
import { loadBenchmarks, saveBenchmark, estimateTranscriptionTime } from "./benchmark.js";

export interface Segment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface TranscriptionResult {
  segments: Segment[];
  language: string;
}

export interface TranscribeOptions {
  model: string;
  diarize: boolean;
  hfToken?: string;
  language: string;
  computeType?: string;
  workers?: number;
  hasGpu?: boolean;
}

/**
 * Builds the whisperx CLI arg list for a given audio path and options.
 */
function buildArgs(audioPath: string, outputDir: string, options: TranscribeOptions): string[] {
  const args = [
    audioPath,
    "--model",
    options.model,
    "--language",
    options.language,
    "--compute_type",
    options.computeType || "int8",
    "--output_format",
    "json",
    "--output_dir",
    outputDir,
  ];

  if (options.diarize) {
    const token = options.hfToken || process.env.HF_TOKEN;
    if (!token) {
      // Warning already shown in index.ts; skip diarize silently here
    } else {
      args.push("--diarize", "--hf_token", token);
    }
  }

  return args;
}

/**
 * Runs a single whisperx process on one audio file.
 * Does NOT manage its own progress bar — calls progressCallback instead.
 *
 * @param audioPath - path to the audio file to transcribe
 * @param options - transcription options
 * @param progressCallback - optional callback invoked with (percent 0-100, phase label)
 */
async function transcribeSingle(
  audioPath: string,
  options: TranscribeOptions,
  progressCallback?: (percent: number, phase: string) => void
): Promise<TranscriptionResult> {
  const outputDir = await mkdtemp(join(tmpdir(), "jt-out-"));
  const args = buildArgs(audioPath, outputDir, options);

  const proc = execa("whisperx", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let currentProgress = 0;

  proc.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();

    const percentMatch = text.match(/(\d{1,3})%\|/);
    if (percentMatch) {
      const percent = parseInt(percentMatch[1], 10);
      // Map whisperx progress (0-100) to 10-90 range
      const mapped = 10 + Math.floor(percent * 0.8);
      if (mapped > currentProgress) {
        currentProgress = mapped;
        progressCallback?.(currentProgress, "Transcribiendo audio...");
      }
    }

    if (text.includes("Loading model") || text.includes("load model")) {
      progressCallback?.(5, "Cargando modelo...");
    }

    if (text.includes("aligning") || text.includes("Align")) {
      const p = Math.max(currentProgress, 85);
      currentProgress = p;
      progressCallback?.(p, "Alineando segmentos...");
    }

    if (text.includes("diarize") || text.includes("Diarizing")) {
      const p = Math.max(currentProgress, 90);
      currentProgress = p;
      progressCallback?.(p, "Diarizando hablantes...");
    }
  });

  await proc;

  progressCallback?.(95, "Leyendo resultados...");

  const files = await readdir(outputDir);
  const jsonFile = files.find((f) => f.endsWith(".json"));
  if (!jsonFile) {
    throw new Error(chalk.red("whisperx no genero archivo JSON de salida"));
  }

  const rawJson = await readFile(join(outputDir, jsonFile), "utf-8");
  const data = JSON.parse(rawJson);

  const segments: Segment[] = (data.segments || []).map(
    (seg: { start: number; end: number; text: string; speaker?: string }) => ({
      start: seg.start,
      end: seg.end,
      text: seg.text.trim(),
      speaker: seg.speaker,
    })
  );

  progressCallback?.(100, "Completado!");

  return {
    segments,
    language: data.language || options.language,
  };
}

/**
 * Format seconds into a human-readable estimate string.
 * e.g. 150 -> "~2 min 30 seg", 45 -> "~45 seg"
 */
function formatEstimate(secs: number): string {
  const rounded = Math.round(secs);
  if (rounded < 60) {
    return `~${rounded} seg`;
  }
  const mins = Math.floor(rounded / 60);
  const remaining = rounded % 60;
  if (remaining === 0) {
    return `~${mins} min`;
  }
  return `~${mins} min ${remaining} seg`;
}

/**
 * Main transcription entry point.
 * For short audio or single-worker mode: runs whisperx directly with a progress bar.
 * For long audio with multiple workers: splits into chunks and processes in parallel.
 */
export async function transcribe(
  audioPath: string,
  options: TranscribeOptions
): Promise<TranscriptionResult> {
  // Get audio duration for display and chunking decision
  let audioDuration = 0;
  try {
    audioDuration = await getAudioDuration(audioPath);
  } catch {
    // If we can't get duration, continue without it
  }

  const durationStr = audioDuration > 0 ? formatTimestamp(audioDuration) : "??:??:??";
  console.log(`${chalk.gray("Duracion del audio:")} ${chalk.white.bold(durationStr)}\n`);

  // Load benchmarks and show ETA estimate before starting
  const benchmarkStore = await loadBenchmarks();
  const model = options.model;
  const computeType = options.computeType ?? "int8";
  const hasGpu = options.hasGpu ?? false;

  if (audioDuration > 0) {
    const estimatedSecs = estimateTranscriptionTime(audioDuration, model, computeType, hasGpu, benchmarkStore);
    console.log(`${chalk.gray("Tiempo estimado:")} ${chalk.yellow(formatEstimate(estimatedSecs))}\n`);
  }

  const startTime = Date.now();

  const workers = options.workers ?? 1;
  const useChunking = audioDuration > 600 && workers > 1;

  // ── Single-process path ──────────────────────────────────────────────────
  if (!useChunking) {
    const bar = new cliProgress.SingleBar(
      {
        format:
          chalk.cyan("{bar}") +
          chalk.gray(" | ") +
          chalk.white("{percentage}%") +
          chalk.gray(" | ETA: ") +
          chalk.yellow("{eta_formatted}") +
          chalk.gray(" | ") +
          chalk.magenta("{phase}"),
        hideCursor: true,
        clearOnComplete: false,
        barCompleteChar: "\u2588",
        barIncompleteChar: chalk.gray("\u2591"),
      },
      cliProgress.Presets.shades_classic
    );

    bar.start(100, 0, { phase: "Iniciando whisperx..." });

    let currentProgress = 0;

    // Fallback slow-advance timer (used when whisperx emits no progress)
    let fallbackInterval: NodeJS.Timeout | null = null;
    if (audioDuration > 0) {
      const estimatedSeconds = audioDuration * 0.5;
      const tickMs = (estimatedSeconds * 1000) / 80;
      fallbackInterval = setInterval(() => {
        if (currentProgress < 10) {
          currentProgress = Math.min(currentProgress + 1, 85);
          bar.update(currentProgress, { phase: "Transcribiendo audio..." });
        }
      }, Math.max(tickMs, 1000));
    } else {
      fallbackInterval = setInterval(() => {
        if (currentProgress < 10) {
          currentProgress = Math.min(currentProgress + 1, 85);
          bar.update(currentProgress, { phase: "Procesando..." });
        }
      }, 3000);
    }

    let result: TranscriptionResult;
    try {
      result = await transcribeSingle(audioPath, options, (percent, phase) => {
        currentProgress = percent;
        if (percent === 100) {
          bar.update(100, { phase: chalk.green.bold("Completado!") });
        } else {
          bar.update(percent, { phase });
        }
      });
    } finally {
      if (fallbackInterval) clearInterval(fallbackInterval);
    }

    bar.stop();

    // Record actual time and save benchmark
    const wallTimeSec = (Date.now() - startTime) / 1000;
    console.log(`\n${chalk.gray("Tiempo real:")} ${chalk.green(formatEstimate(wallTimeSec))}`);

    if (audioDuration > 0) {
      await saveBenchmark({
        model,
        computeType,
        hasGpu,
        audioDurationSec: audioDuration,
        wallTimeSec,
        realTimeFactor: wallTimeSec / audioDuration,
        timestamp: Date.now(),
      });
    }

    return result;
  }

  // ── Parallel chunking path ───────────────────────────────────────────────
  const { splitAudio, mergeChunkSegments } = await import("./chunker.js");

  let chunks: Awaited<ReturnType<typeof splitAudio>>;
  try {
    console.log(chalk.blue("Dividiendo audio en chunks..."));
    chunks = await splitAudio(audioPath, 600, 3);
  } catch (err) {
    // Graceful degradation: fall back to single-process
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(
      chalk.yellow("\n⚠ No se pudo dividir el audio en chunks. Usando procesamiento simple...\n") +
      chalk.gray("  Detalle: " + errMsg.split("\n")[0] + "\n")
    );
    return transcribe(audioPath, { ...options, workers: 1 });
  }

  // If splitting returned only one chunk (shouldn't happen given useChunking guard, but be safe)
  if (chunks.length === 1) {
    return transcribeSingle(audioPath, options);
  }

  console.log(
    chalk.blue("Dividiendo audio en") +
      " " +
      chunks.length +
      " " +
      chalk.blue("fragmentos para procesamiento paralelo...")
  );

  // Per-chunk progress tracking (0-100 each)
  const chunkProgress: number[] = new Array(chunks.length).fill(0);
  const chunkPhases: string[] = new Array(chunks.length).fill("En espera...");
  let progressRendered = false;

  function renderChunkProgress() {
    const n = chunks!.length;

    // After the first render, move cursor back up N lines to overwrite in-place
    if (progressRendered) {
      process.stdout.write(`\x1B[${n}A`);
    }

    for (let i = 0; i < n; i++) {
      const pct = chunkProgress[i];
      const phase = chunkPhases[i];
      const filled = Math.floor(pct / 5);
      const bar = "█".repeat(filled).padEnd(20, "░");
      const label = chalk.gray(`Fragmento ${i + 1}/${n}:`);
      const line =
        `  ${label} [${chalk.cyan(bar)}] ${chalk.white(String(pct).padStart(3) + "%")} ${chalk.magenta(phase)}`;
      // Pad to terminal width so leftover chars from longer previous lines are overwritten
      const padded = line.padEnd(process.stdout.columns ?? 80);
      process.stdout.write(padded + "\n");
    }

    progressRendered = true;
  }

  // Print the initial state immediately (reserves the N lines)
  renderChunkProgress();

  // Simple semaphore — limit concurrent whisperx processes
  let running = 0;
  const queue: Array<() => void> = [];

  function acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (running < workers) {
        running++;
        resolve();
      } else {
        queue.push(() => {
          running++;
          resolve();
        });
      }
    });
  }

  function release(): void {
    running--;
    const next = queue.shift();
    if (next) next();
  }

  // Transcribe all chunks with bounded parallelism
  const chunkResults: Array<{ chunkInfo: (typeof chunks)[0]; segments: Segment[] }> = [];

  let detectedLanguage: string = options.language;
  let mergedSegments: Segment[] = [];

  try {
    const tasks = chunks.map((chunk, i) =>
      (async () => {
        await acquire();
        chunkPhases[i] = "Iniciando...";
        renderChunkProgress();
        try {
          const result = await transcribeSingle(chunk.filePath, options, (percent, phase) => {
            chunkProgress[i] = percent;
            chunkPhases[i] = phase;
            renderChunkProgress();
          });
          chunkProgress[i] = 100;
          chunkPhases[i] = "Completado!";
          renderChunkProgress();
          chunkResults.push({ chunkInfo: chunk, segments: result.segments });
          return result.language;
        } finally {
          release();
        }
      })()
    );

    const languages = await Promise.all(tasks);
    detectedLanguage = languages[0] ?? options.language;

    console.log(chalk.green("\n✔ Todos los fragmentos completados. Combinando resultados...\n"));

    mergedSegments = mergeChunkSegments(chunkResults);
  } finally {
    // Clean up the temp directory that splitAudio created (only if chunks are real chunk files,
    // not the original audio — chunks.length > 1 guarantees they were split into a temp dir)
    try {
      const chunkDir = dirname(chunks[0].filePath);
      await rm(chunkDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors — never crash because of this
    }
  }

  // Record actual time and save benchmark
  const wallTimeSec = (Date.now() - startTime) / 1000;
  console.log(`${chalk.gray("Tiempo real:")} ${chalk.green(formatEstimate(wallTimeSec))}\n`);

  if (audioDuration > 0) {
    await saveBenchmark({
      model,
      computeType,
      hasGpu,
      audioDurationSec: audioDuration,
      wallTimeSec,
      realTimeFactor: wallTimeSec / audioDuration,
      timestamp: Date.now(),
    });
  }

  return {
    segments: mergedSegments,
    language: detectedLanguage,
  };
}
