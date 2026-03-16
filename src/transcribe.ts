import { execa } from "execa";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import cliProgress from "cli-progress";
import { getAudioDuration, formatTimestamp } from "./utils.js";

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
}

export async function transcribe(
  audioPath: string,
  options: TranscribeOptions
): Promise<TranscriptionResult> {
  const outputDir = await mkdtemp(join(tmpdir(), "jt-out-"));

  const args = [
    audioPath,
    "--model",
    options.model,
    "--language",
    options.language,
    "--output_format",
    "json",
    "--output_dir",
    outputDir,
  ];

  if (options.diarize) {
    args.push("--diarize");
    const token = options.hfToken || process.env.HF_TOKEN;
    if (!token) {
      console.warn(
        "Advertencia: No se encontro HF_TOKEN. La diarizacion requiere un token de HuggingFace."
      );
      console.warn(
        "Configura la variable de entorno HF_TOKEN o usa --hf-token <token>"
      );
      console.warn("Continuando sin diarizacion...\n");
      args.splice(args.indexOf("--diarize"), 1);
    } else {
      args.push("--hf_token", token);
    }
  }

  // Get audio duration for progress estimation
  let audioDuration = 0;
  try {
    audioDuration = await getAudioDuration(audioPath);
  } catch {
    // If we can't get duration, progress bar will work without ETA
  }

  const durationStr = audioDuration > 0 ? formatTimestamp(audioDuration) : "??:??:??";
  console.log(`Duracion del audio: ${durationStr}\n`);

  const bar = new cliProgress.SingleBar(
    {
      format:
        "Transcribiendo |{bar}| {percentage}% | ETA: {eta_formatted} | {phase}",
      hideCursor: true,
      clearOnComplete: false,
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
    },
    cliProgress.Presets.shades_classic
  );

  bar.start(100, 0, { phase: "Iniciando whisperx..." });

  const proc = execa("whisperx", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  let currentProgress = 0;

  // Parse whisperx stderr for progress updates
  proc.stderr?.on("data", (data: Buffer) => {
    const text = data.toString();

    // WhisperX/tqdm outputs percentage patterns like "XX%|" or "100%"
    const percentMatch = text.match(/(\d{1,3})%\|/);
    if (percentMatch) {
      const percent = parseInt(percentMatch[1], 10);
      // Map whisperx progress (0-100) to our range (10-90)
      // Reserve 0-10 for startup and 90-100 for post-processing
      const mapped = 10 + Math.floor(percent * 0.8);
      if (mapped > currentProgress) {
        currentProgress = mapped;
        bar.update(currentProgress, { phase: "Transcribiendo audio..." });
      }
    }

    // Detect loading phase
    if (text.includes("Loading model") || text.includes("load model")) {
      bar.update(5, { phase: "Cargando modelo..." });
    }

    // Detect alignment phase
    if (text.includes("aligning") || text.includes("Align")) {
      bar.update(Math.max(currentProgress, 85), {
        phase: "Alineando segmentos...",
      });
    }

    // Detect diarization phase
    if (text.includes("diarize") || text.includes("Diarizing")) {
      bar.update(Math.max(currentProgress, 90), {
        phase: "Diarizando hablantes...",
      });
    }
  });

  // Fallback: if no progress from stderr, advance slowly based on time
  let fallbackInterval: NodeJS.Timeout | null = null;
  if (audioDuration > 0) {
    // Estimate total time: ~0.5x realtime for large-v3 on GPU, ~2x on CPU
    // Use a conservative estimate
    const estimatedSeconds = audioDuration * 0.5;
    const tickMs = (estimatedSeconds * 1000) / 80; // 80 ticks for 10-90 range

    fallbackInterval = setInterval(() => {
      // Only use fallback if we haven't gotten real progress
      if (currentProgress < 10) {
        currentProgress = Math.min(currentProgress + 1, 85);
        bar.update(currentProgress, { phase: "Transcribiendo audio..." });
      }
    }, Math.max(tickMs, 1000));
  } else {
    // No duration info, just pulse slowly
    fallbackInterval = setInterval(() => {
      if (currentProgress < 10) {
        currentProgress = Math.min(currentProgress + 1, 85);
        bar.update(currentProgress, { phase: "Procesando..." });
      }
    }, 3000);
  }

  try {
    await proc;
  } finally {
    if (fallbackInterval) clearInterval(fallbackInterval);
  }

  bar.update(95, { phase: "Leyendo resultados..." });

  const files = await readdir(outputDir);
  const jsonFile = files.find((f) => f.endsWith(".json"));
  if (!jsonFile) {
    bar.stop();
    throw new Error("whisperx no genero archivo JSON de salida");
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

  bar.update(100, { phase: "Completado!" });
  bar.stop();

  return {
    segments,
    language: data.language || options.language,
  };
}
