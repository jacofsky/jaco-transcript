#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import { cpus } from "node:os";
import chalk from "chalk";
import {
  validateInputFile,
  isVideoFile,
  getDefaultOutputPath,
  extractAudio,
} from "./utils.js";
import { transcribe } from "./transcribe.js";
import { formatMarkdown } from "./formatter.js";
import { detectHardware } from "./hardware.js";
import select from "@inquirer/select";
import password from "@inquirer/password";

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
  .option("-m, --model <name>", "Modelo de Whisper a usar")
  .option("--no-diarize", "Desactivar diarizacion de hablantes")
  .option("--hf-token <token>", "Token de HuggingFace para diarizacion")
  .option("-l, --language <lang>", "Idioma de la transcripcion", "es")
  .option("--compute-type <type>", "Tipo de computacion: int8, float16, float32", "int8")
  .option("--fast", "Modo rapido: modelo small + int8, sin prompt interactivo")
  .option("--workers <number>", "Numero de workers para procesamiento paralelo", String(Math.max(1, Math.floor(cpus().length / 2))))
  .action(async (file: string, opts) => {
    try {
      const inputPath = resolve(file);
      validateInputFile(inputPath);

      // Detect whether --compute-type was explicitly passed by the user
      const computeTypeExplicit = process.argv.includes("--compute-type");

      // --fast mode: override model and compute_type, skip interactive prompt
      if (opts.fast) {
        opts.model = "small";
        opts.computeType = "int8";
        console.log(chalk.yellow.bold("\n⚡ Modo rapido activado:") + chalk.yellow(" modelo small + int8\n"));
      }

      // Run hardware detection before model selection (only when not in fast mode)
      const hw = await detectHardware();

      // Apply hardware-recommended compute type if not explicitly set by user
      if (!computeTypeExplicit && !opts.fast) {
        opts.computeType = hw.recommendedComputeType;
      }

      if (!opts.model) {
        // Show hardware info to guide the user's model selection
        const hwLabel = hw.hasGpu
          ? chalk.green("GPU (" + hw.gpuName + ")")
          : chalk.yellow("CPU (" + hw.cpuCores + " cores)");
        console.log(`\n  ${chalk.gray("Hardware:")} ${hwLabel}`);
        console.log(`  ${chalk.gray("Recomendado:")} ${chalk.cyan(hw.recommendedModel)} + ${chalk.cyan(hw.recommendedComputeType)}\n`);

        opts.model = await select({
          message: "Selecciona el modelo de Whisper:",
          choices: [
            { name: "tiny     (~1 GB VRAM, muy rapida, calidad baja)", value: "tiny" },
            { name: "base     (~1 GB VRAM, rapida, calidad media)", value: "base" },
            { name: "small    (~2 GB VRAM, media, calidad buena)", value: "small" },
            { name: "medium   (~5 GB VRAM, lenta, calidad muy buena)", value: "medium" },
            { name: "large-v3 (~10 GB VRAM, muy lenta, calidad excelente)", value: "large-v3" },
          ],
          default: hw.recommendedModel,
        });
      }

      // Si no se paso --no-diarize explicitamente, preguntar via menu
      if (opts.diarize) {
        const diarizeChoice = await select({
          message: "Usar diarizacion de hablantes? (identifica quien habla)",
          choices: [
            { name: "Si  — Identificar hablantes (requiere HF_TOKEN)", value: true },
            { name: "No  — Solo transcripcion plana", value: false },
          ],
          default: true,
        });
        opts.diarize = diarizeChoice;
      }

      // Si eligio diarizacion, asegurar que haya un HF_TOKEN
      if (opts.diarize) {
        const token = opts.hfToken || process.env.HF_TOKEN;
        if (!token) {
          const inputToken = await password({
            message: "Ingresa tu token de HuggingFace (https://huggingface.co/settings/tokens):",
            mask: "*",
          });

          if (!inputToken.trim()) {
            console.warn(chalk.yellow("\n⚠ No se ingreso token. Continuando sin diarizacion...\n"));
            opts.diarize = false;
          } else {
            opts.hfToken = inputToken.trim();
          }
        }
      }

      const outputPath = opts.output
        ? resolve(opts.output)
        : getDefaultOutputPath(inputPath);

      console.log(chalk.bold.cyan("\n  ╔══════════════════════════════════════╗"));
      console.log(chalk.bold.cyan("  ║") + chalk.bold("  jaco-transcript                     ") + chalk.bold.cyan("║"));
      console.log(chalk.bold.cyan("  ╚══════════════════════════════════════╝\n"));
      console.log(`  ${chalk.gray("Archivo:")}      ${chalk.white(inputPath)}`);
      console.log(`  ${chalk.gray("Modelo:")}       ${chalk.yellow(opts.model)}`);
      console.log(`  ${chalk.gray("Compute:")}      ${chalk.yellow(opts.computeType)}`);
      console.log(`  ${chalk.gray("Diarizacion:")}  ${opts.diarize ? chalk.green("Si") : chalk.red("No")}`);
      console.log(`  ${chalk.gray("Idioma:")}       ${chalk.white(opts.language)}`);
      if (parseInt(opts.workers, 10) > 1) {
        console.log(`  ${chalk.gray("Workers:")}      ${chalk.cyan(opts.workers)}`);
      }
      console.log(`  ${chalk.gray("Salida:")}       ${chalk.white(outputPath)}\n`);

      let audioPath = inputPath;
      let tempAudio: string | null = null;

      if (isVideoFile(inputPath)) {
        console.log(chalk.blue("▶ [1/3]") + " Extrayendo audio del video...");
        audioPath = await extractAudio(inputPath);
        tempAudio = audioPath;
        console.log(chalk.green("✔ [1/3]") + " Audio extraido.\n");
      }

      console.log(chalk.blue(`▶ [${isVideoFile(inputPath) ? "2/3" : "1/2"}]`) + " Transcribiendo...\n");

      const result = await transcribe(audioPath, {
        model: opts.model,
        diarize: opts.diarize,
        hfToken: opts.hfToken,
        language: opts.language,
        computeType: opts.computeType,
        workers: parseInt(opts.workers, 10),
        hasGpu: hw.hasGpu,
      });

      console.log(chalk.blue(`\n▶ [${isVideoFile(inputPath) ? "3/3" : "2/2"}]`) + " Generando Markdown...");

      const markdown = formatMarkdown(result, {
        inputPath,
        model: opts.model,
        diarize: opts.diarize,
      });

      await writeFile(outputPath, markdown, "utf-8");
      console.log(chalk.green.bold(`\n✔ Transcripcion guardada en: ${outputPath}`));

      if (tempAudio) {
        await rm(dirname(tempAudio), { recursive: true, force: true });
      }
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : String(error);
      console.error(chalk.red.bold(`\n✖ Error: ${msg}`));
      process.exit(1);
    }
  });

program.parse();
