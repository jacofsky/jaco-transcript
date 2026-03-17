import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execa } from "execa";
import { getAudioDuration } from "./utils.js";
import type { Segment } from "./transcribe.js";

export interface ChunkInfo {
  index: number;
  startTime: number; // seconds
  endTime: number;   // seconds
  filePath: string;  // path to the temp chunk audio file
}

/**
 * Splits an audio file into overlapping chunks using ffmpeg.
 * Overlap is used to avoid cutting words at boundaries.
 *
 * @param audioPath - source audio file path
 * @param chunkDuration - target duration of each chunk in seconds (default: 600 = 10min)
 * @param overlap - overlap between chunks in seconds (default: 3)
 * @param outputDir - directory to write chunk files (temp dir if not provided)
 * @returns array of ChunkInfo
 */
export async function splitAudio(
  audioPath: string,
  chunkDuration: number = 600,
  overlap: number = 3,
  outputDir?: string
): Promise<ChunkInfo[]> {
  const totalDuration = await getAudioDuration(audioPath);

  // If audio fits in a single chunk, return it as-is without splitting
  if (totalDuration <= chunkDuration) {
    return [
      {
        index: 0,
        startTime: 0,
        endTime: totalDuration,
        filePath: audioPath,
      },
    ];
  }

  const dir = outputDir ?? (await mkdtemp(join(tmpdir(), "jt-chunks-")));

  const chunks: ChunkInfo[] = [];
  let index = 0;

  for (let pos = 0; pos < totalDuration; pos += chunkDuration) {
    const startTime = Math.max(0, pos - (index === 0 ? 0 : overlap));
    const endTime = Math.min(pos + chunkDuration + overlap, totalDuration);

    const chunkName = `chunk_${String(index).padStart(3, "0")}.mp3`;
    const chunkPath = join(dir, chunkName);

    await execa("ffmpeg", [
      "-i",
      audioPath,
      "-ss",
      String(startTime),
      "-to",
      String(endTime),
      "-vn",
      "-acodec",
      "libmp3lame",
      "-q:a",
      "2",
      chunkPath,
      "-y",
    ]);

    chunks.push({ index, startTime, endTime, filePath: chunkPath });
    index++;
  }

  return chunks;
}

/**
 * Merges segments from multiple chunks back into a single ordered array.
 * Handles deduplication of segments in the overlap zones.
 * Adjusts timestamps to be relative to the original file start.
 *
 * @param chunks - array of { chunkInfo, segments } pairs
 * @returns merged, deduplicated, sorted segments
 */
export function mergeChunkSegments(
  chunks: Array<{ chunkInfo: ChunkInfo; segments: Segment[] }>
): Segment[] {
  // Sort by chunk index to ensure correct order
  const sorted = [...chunks].sort((a, b) => a.chunkInfo.index - b.chunkInfo.index);

  const all: Segment[] = [];

  for (const { chunkInfo, segments } of sorted) {
    for (const seg of segments) {
      all.push({
        ...seg,
        start: seg.start + chunkInfo.startTime,
        end: seg.end + chunkInfo.startTime,
      });
    }
  }

  // Sort by absolute start time
  all.sort((a, b) => a.start - b.start);

  // Deduplicate segments from overlap zones:
  // Remove a segment if its start is within 1.5s of the previous AND text is identical
  const deduped: Segment[] = [];
  for (const seg of all) {
    const prev = deduped[deduped.length - 1];
    if (
      prev &&
      Math.abs(seg.start - prev.start) < 1.5 &&
      seg.text === prev.text
    ) {
      continue; // duplicate from overlap — skip
    }
    deduped.push(seg);
  }

  return deduped;
}
