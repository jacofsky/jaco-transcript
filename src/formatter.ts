import { basename, extname } from "node:path";
import { formatTimestamp } from "./utils.js";
import type { TranscriptionResult } from "./transcribe.js";

interface FormatOptions {
  inputPath: string;
  model: string;
  diarize: boolean;
}

export function formatMarkdown(
  result: TranscriptionResult,
  options: FormatOptions
): string {
  const fileName = basename(options.inputPath, extname(options.inputPath));
  const date = new Date().toISOString().split("T")[0];
  const lastSegment = result.segments[result.segments.length - 1];
  const duration = lastSegment ? formatTimestamp(lastSegment.end) : "00:00:00";

  const lines: string[] = [
    `# Transcripcion: ${fileName}`,
    "",
    `**Fecha**: ${date}`,
    `**Duracion**: ${duration}`,
    `**Modelo**: ${options.model}`,
    `**Idioma**: ${result.language}`,
    "",
    "---",
    "",
    "## Transcripcion",
    "",
  ];

  if (options.diarize && result.segments.some((s) => s.speaker)) {
    let currentSpeaker = "";

    for (const segment of result.segments) {
      const speaker = segment.speaker || "Desconocido";
      const timestamp = formatTimestamp(segment.start);

      if (speaker !== currentSpeaker) {
        currentSpeaker = speaker;
        lines.push(`**[${timestamp}] ${speaker}:**`);
      }

      lines.push(`${segment.text}`, "");
    }
  } else {
    for (const segment of result.segments) {
      const timestamp = formatTimestamp(segment.start);
      lines.push(`**[${timestamp}]** ${segment.text}`, "");
    }
  }

  lines.push("---", "", "*Generado con jaco-transcript*", "");

  return lines.join("\n");
}
