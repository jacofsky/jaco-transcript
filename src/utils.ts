import { accessSync, constants } from "node:fs";
import { extname, basename, dirname, join } from "node:path";
import { execa } from "execa";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";

const SUPPORTED_EXTENSIONS = [".mp3", ".mp4", ".m4a", ".wav", ".webm"];

export function validateInputFile(filePath: string): void {
  try {
    accessSync(filePath, constants.R_OK);
  } catch {
    throw new Error(`No se puede leer el archivo: ${filePath}`);
  }

  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(
      `Extension no soportada: ${ext}. Extensiones validas: ${SUPPORTED_EXTENSIONS.join(", ")}`
    );
  }
}

export function isVideoFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return [".mp4", ".webm"].includes(ext);
}

export function getDefaultOutputPath(inputPath: string): string {
  const dir = dirname(inputPath);
  const name = basename(inputPath, extname(inputPath));
  return join(dir, `${name}.md`);
}

export async function extractAudio(videoPath: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "jt-"));
  const outputPath = join(tempDir, "audio.wav");

  await execa("ffmpeg", [
    "-i",
    videoPath,
    "-vn",
    "-acodec",
    "pcm_s16le",
    "-ar",
    "16000",
    "-ac",
    "1",
    outputPath,
    "-y",
  ]);

  return outputPath;
}

export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
