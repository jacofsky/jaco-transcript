#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import {
  validateInputFile,
  isVideoFile,
  getDefaultOutputPath,
  extractAudio,
} from "./utils.js";
import { transcribe } from "./transcribe.js";
import { formatMarkdown } from "./formatter.js";

const program = new Command();

program
  .name("jt")
  .description("CLI para transcripcion de audio/video con diarizacion")
  .version("1.0.0");

program
  .command("transcribe")
  .description("Transcribir un archivo de audio o video a Markdown")
  .argument("<file>", "Archivo de audio (mp3, wav, m4a) o video (mp4, webm)")
  .option("-o, --output <path>", "Ruta del archivo de salida (.md)")
  .option("-m, --model <name>", "Modelo de Whisper a usar", "large-v3")
  .option("--no-diarize", "Desactivar diarizacion de hablantes")
  .option("--hf-token <token>", "Token de HuggingFace para diarizacion")
  .option("-l, --language <lang>", "Idioma de la transcripcion", "es")
  .action(async (file: string, opts) => {
    try {
      const inputPath = resolve(file);
      validateInputFile(inputPath);

      const outputPath = opts.output
        ? resolve(opts.output)
        : getDefaultOutputPath(inputPath);

      console.log(`Archivo: ${inputPath}`);
      console.log(`Modelo: ${opts.model}`);
      console.log(`Diarizacion: ${opts.diarize ? "Si" : "No"}`);
      console.log(`Idioma: ${opts.language}`);
      console.log(`Salida: ${outputPath}\n`);

      let audioPath = inputPath;
      let tempAudio: string | null = null;

      if (isVideoFile(inputPath)) {
        console.log("Extrayendo audio del video...");
        audioPath = await extractAudio(inputPath);
        tempAudio = audioPath;
        console.log("Audio extraido.\n");
      }

      const result = await transcribe(audioPath, {
        model: opts.model,
        diarize: opts.diarize,
        hfToken: opts.hfToken,
        language: opts.language,
      });

      const markdown = formatMarkdown(result, {
        inputPath,
        model: opts.model,
        diarize: opts.diarize,
      });

      await writeFile(outputPath, markdown, "utf-8");
      console.log(`\nTranscripcion guardada en: ${outputPath}`);

      if (tempAudio) {
        await rm(dirname(tempAudio), { recursive: true, force: true });
      }
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : String(error);
      console.error(`\nError: ${msg}`);
      process.exit(1);
    }
  });

program.parse();
