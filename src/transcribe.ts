import { execa } from "execa";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

  console.log("Ejecutando whisperx...\n");

  await execa("whisperx", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const files = await readdir(outputDir);
  const jsonFile = files.find((f) => f.endsWith(".json"));
  if (!jsonFile) {
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

  return {
    segments,
    language: data.language || options.language,
  };
}
