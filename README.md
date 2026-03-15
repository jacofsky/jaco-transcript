# jaco-transcript

CLI para transcribir archivos de audio y video a Markdown con diarizacion de hablantes, usando Whisper localmente.

## Prerrequisitos

- **Node.js 18+**
- **Python 3.10+**
- **ffmpeg** (necesario para archivos de video)
- **whisperx** (transcripcion + diarizacion)
- **Token de HuggingFace** (solo para diarizacion)

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

## Uso

```bash
# Transcribir un archivo de audio
npx tsx src/index.ts transcribe audio.mp3

# Transcribir un video (extrae el audio automaticamente)
npx tsx src/index.ts transcribe video.mp4

# Especificar archivo de salida
npx tsx src/index.ts transcribe audio.mp3 -o mi-transcripcion.md

# Cambiar modelo de Whisper
npx tsx src/index.ts transcribe audio.mp3 -m medium

# Desactivar diarizacion
npx tsx src/index.ts transcribe audio.mp3 --no-diarize

# Especificar token de HuggingFace directamente
npx tsx src/index.ts transcribe audio.mp3 --hf-token hf_xxxxx

# Cambiar idioma (default: es)
npx tsx src/index.ts transcribe audio.mp3 -l en
```

## Opciones

| Flag | Default | Descripcion |
|------|---------|-------------|
| `-o, --output <path>` | `<input>.md` | Ruta del archivo de salida |
| `-m, --model <name>` | `large-v3` | Modelo de Whisper (`tiny`, `base`, `small`, `medium`, `large-v3`) |
| `--no-diarize` | — | Desactivar diarizacion de hablantes |
| `--hf-token <token>` | env `HF_TOKEN` | Token de HuggingFace para diarizacion |
| `-l, --language <lang>` | `es` | Idioma de la transcripcion |

## Formatos soportados

- **Audio**: `.mp3`, `.wav`, `.m4a`
- **Video**: `.mp4`, `.webm`

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

## Modelos disponibles

| Modelo | VRAM | Velocidad | Calidad |
|--------|------|-----------|---------|
| `tiny` | ~1 GB | Muy rapida | Baja |
| `base` | ~1 GB | Rapida | Media |
| `small` | ~2 GB | Media | Buena |
| `medium` | ~5 GB | Lenta | Muy buena |
| `large-v3` | ~10 GB | Muy lenta | Excelente |
