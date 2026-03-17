# jaco-transcript

CLI para transcribir archivos de audio y video a Markdown con diarizacion de hablantes, usando WhisperX localmente.

Detecta automaticamente tu hardware (GPU/CPU), sugiere el modelo y tipo de computo optimos, divide archivos largos en fragmentos para procesamiento paralelo, y aprende de cada ejecucion para darte estimaciones de tiempo cada vez mas precisas.

## Prerrequisitos

- **Node.js 18+**
- **Python 3.10+**
- **ffmpeg** (necesario para extraer audio de videos)
- **whisperx** (motor de transcripcion y diarizacion)
- **Token de HuggingFace** (solo para diarizacion de hablantes)

### Instalacion de prerrequisitos

```bash
# ffmpeg
brew install ffmpeg

# whisperx
pip install whisperx

# Token de HuggingFace (gratis en https://huggingface.co/settings/tokens)
export HF_TOKEN="tu_token_aqui"
```

## Instalacion

```bash
npm install
```

## Inicio rapido

```bash
# Transcripcion interactiva (te guia por las opciones)
npx tsx src/index.ts transcribe audio.mp3

# Modo rapido: sin preguntas, modelo small + int8 (ideal para pruebas)
npx tsx src/index.ts transcribe audio.mp3 --fast

# Archivo largo con procesamiento paralelo (4 workers)
npx tsx src/index.ts transcribe reunion-larga.mp3 --workers 4

# Video con diarizacion y salida especifica
npx tsx src/index.ts transcribe video.mp4 -o transcripcion.md --hf-token hf_xxxxx
```

## Uso

```bash
# Transcripcion interactiva (selecciona modelo y opciones via menu)
npx tsx src/index.ts transcribe audio.mp3

# Transcribir un video (extrae el audio automaticamente con ffmpeg)
npx tsx src/index.ts transcribe video.mp4

# Especificar archivo de salida
npx tsx src/index.ts transcribe audio.mp3 -o mi-transcripcion.md

# Usar modelo especifico
npx tsx src/index.ts transcribe audio.mp3 -m medium

# Modo rapido: omite menus, usa small + int8
npx tsx src/index.ts transcribe audio.mp3 --fast

# Cambiar tipo de computo manualmente
npx tsx src/index.ts transcribe audio.mp3 --compute-type float16

# Procesamiento paralelo con N workers (util para audios >10 min)
npx tsx src/index.ts transcribe conferencia.mp3 --workers 4

# Desactivar diarizacion de hablantes
npx tsx src/index.ts transcribe audio.mp3 --no-diarize

# Pasar token de HuggingFace directamente
npx tsx src/index.ts transcribe audio.mp3 --hf-token hf_xxxxx

# Cambiar idioma (default: es)
npx tsx src/index.ts transcribe audio.mp3 -l en
```

## Opciones

| Flag | Default | Descripcion |
|------|---------|-------------|
| `-o, --output <path>` | `<input>.md` | Ruta del archivo de salida |
| `-m, --model <name>` | Interactivo | Modelo de Whisper a usar |
| `--fast` | — | Modo rapido: modelo `small` + `int8`, sin menus interactivos |
| `--compute-type <type>` | Segun hardware | Tipo de computo: `int8`, `float16`, `float32` |
| `--workers <N>` | Mitad de CPUs | Workers para procesamiento paralelo de chunks |
| `--no-diarize` | — | Desactivar diarizacion de hablantes |
| `--hf-token <token>` | env `HF_TOKEN` | Token de HuggingFace para diarizacion |
| `-l, --language <lang>` | `es` | Idioma de la transcripcion |

## Rendimiento

### Deteccion automatica de hardware

Al iniciar, jaco-transcript detecta si tienes GPU disponible:

- **NVIDIA GPU**: usa `nvidia-smi` para obtener el nombre y recomienda `float16`
- **Apple Silicon (M1/M2/M3)**: detectado via `system_profiler`, recomienda `int8`
- **Solo CPU**: recomienda `int8` y ajusta el modelo segun el numero de cores

El hardware detectado y el modelo recomendado se muestran antes del menu de seleccion de modelo.

### Modo rapido (`--fast`)

Activa automaticamente:
- Modelo `small` (~2 GB VRAM, buena calidad)
- Tipo de computo `int8` (minima memoria, maxima velocidad)
- Omite todos los menus interactivos

Ideal para transcripciones rapidas o cuando ya sabes lo que quieres.

### Procesamiento paralelo de audio largo

Para archivos de **mas de 10 minutos** con `--workers N > 1`:

1. El audio se divide en fragmentos de 10 minutos con 3 segundos de solapamiento
2. Hasta N fragmentos se transcriben en paralelo con N procesos de whisperx
3. Los resultados se reensamblan y los segmentos duplicados del solapamiento se eliminan
4. El directorio temporal con los fragmentos se limpia automaticamente al terminar

Ejemplo: una grabacion de 60 minutos con `--workers 4` se procesa en ~4 fragmentos paralelos,
reduciendo el tiempo de espera significativamente.

### Aprendizaje de benchmarks

Despues de cada transcripcion exitosa, jaco-transcript guarda en `~/.jaco-transcript/benchmarks.json`:
- Modelo y tipo de computo usados
- Duracion del audio y tiempo real transcurrido
- Factor de tiempo real (RTF)

En las siguientes ejecuciones, usa estos datos para mostrar estimaciones de tiempo cada vez mas
precisas antes de empezar. Con 3 o mas mediciones del mismo modelo/hardware, usa la mediana
del RTF para mayor estabilidad.

## Formatos soportados

- **Audio**: `.mp3`, `.wav`, `.m4a`
- **Video**: `.mp4`, `.webm`

## Modelos disponibles

| Modelo | VRAM aprox. | Velocidad | Calidad |
|--------|-------------|-----------|---------|
| `tiny` | ~1 GB | Muy rapida | Baja |
| `base` | ~1 GB | Rapida | Media |
| `small` | ~2 GB | Media | Buena |
| `medium` | ~5 GB | Lenta | Muy buena |
| `large-v3` | ~10 GB | Muy lenta | Excelente |

## Ejemplo de salida

```markdown
# Transcripcion: reunion-equipo

**Fecha**: 2026-03-15
**Duracion**: 00:15:32
**Modelo**: large-v3
**Idioma**: es

---

## Transcripcion

**[00:00:01] SPEAKER_00:**
Hola, bienvenidos a la reunion de hoy.

**[00:00:05] SPEAKER_01:**
Gracias, empecemos con el primer punto.

**[00:01:12] SPEAKER_00:**
Perfecto, el tema principal es...

---

*Generado con jaco-transcript*
```

Sin diarizacion (`--no-diarize`):

```markdown
**[00:00:01]** Hola, bienvenidos a la reunion de hoy.

**[00:00:05]** Gracias, empecemos con el primer punto.
```
