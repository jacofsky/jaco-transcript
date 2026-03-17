// Detects available hardware (GPU vs CPU) to suggest optimal whisperx settings
import { cpus } from "node:os";
import { execa } from "execa";

export interface HardwareInfo {
  hasGpu: boolean;
  gpuName?: string;
  cpuCores: number;
  recommendedModel: string;       // 'large-v3' | 'medium' | 'small'
  recommendedComputeType: string; // 'float16' | 'int8' | 'float32'
}

export async function detectHardware(): Promise<HardwareInfo> {
  const cpuCores = cpus().length;

  try {
    let hasGpu = false;
    let gpuName: string | undefined;
    let isAppleSilicon = false;

    // Try nvidia-smi first
    try {
      const result = await execa(
        "nvidia-smi",
        ["--query-gpu=name", "--format=csv,noheader"],
        { timeout: 3000, reject: true }
      );
      const name = result.stdout.split("\n")[0].trim();
      if (name) {
        hasGpu = true;
        gpuName = name;
      }
    } catch {
      // nvidia-smi not available or failed — try Apple Silicon on macOS
    }

    // On macOS, check for Apple Silicon GPU
    if (!hasGpu && process.platform === "darwin") {
      try {
        const result = await execa("system_profiler", ["SPDisplaysDataType"], {
          timeout: 3000,
          reject: true,
        });
        if (result.stdout.includes("Apple M")) {
          hasGpu = true;
          isAppleSilicon = true;
          gpuName = "Apple Silicon (Metal)";
        }
      } catch {
        // system_profiler failed — treat as no GPU
      }
    }

    // Determine recommended model
    let recommendedModel: string;
    if (hasGpu) {
      recommendedModel = "large-v3";
    } else if (cpuCores >= 8) {
      recommendedModel = "medium";
    } else {
      recommendedModel = "small";
    }

    // Determine recommended compute type
    let recommendedComputeType: string;
    if (hasGpu && !isAppleSilicon) {
      recommendedComputeType = "float16"; // NVIDIA GPU supports float16 well
    } else {
      recommendedComputeType = "int8"; // Apple Metal and CPU use int8
    }

    return {
      hasGpu,
      gpuName,
      cpuCores,
      recommendedModel,
      recommendedComputeType,
    };
  } catch {
    // If anything unexpected fails, return safe CPU defaults
    return {
      hasGpu: false,
      cpuCores,
      recommendedModel: "small",
      recommendedComputeType: "int8",
    };
  }
}
