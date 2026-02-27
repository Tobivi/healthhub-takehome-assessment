# AI Voice System — Emotion-Aware Conversational Assistant

A full-stack voice AI application that detects your emotional state from speech and responds with matching empathy.

## Pipeline

```
Microphone → Whisper STT → GPT-4o-mini (Emotion) → GPT-4o-mini (Response) → OpenAI TTS
```

| Stage | Model | Purpose |
|-------|-------|---------|
| Speech-to-Text | `whisper-1` | Transcribe audio to text |
| Emotion Detection | `gpt-4o-mini` | Classify emotion (8 categories) |
| Response Generation | `gpt-4o-mini` | Emotion-aware reply |
| Text-to-Speech | `tts-1` | Voice synthesis with emotion-matched voice |

## Detected Emotions

| Emotion | Emoji | TTS Voice | Color |
|---------|-------|-----------|-------|
| Happy | 😊 | nova | Green |
| Neutral | 😐 | alloy | Blue |
| Sad | 😢 | shimmer | Purple |
| Angry | 😠 | alloy | Red |
| Irritated | 😤 | alloy | Orange |
| Fearful | 😰 | echo | Yellow |
| Surprised | 😮 | echo | Cyan |
| Disgusted | 🤢 | alloy | Lime |

## Quick Start

```bash
cd ai-voice-system
chmod +x start.sh
./start.sh
```

This will:
1. Create a Python venv
2. Install all dependencies
3. Start the FastAPI backend on port `8000`
4. Start the frontend server on port `3000`
5. Open the browser automatically (macOS)

## Manual Start

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
python3 -m http.server 3000
# Open http://localhost:3000
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/process` | Full pipeline (audio file → JSON response) |
| `POST` | `/api/test` | Test with text input (no audio needed) |
| `GET` | `/docs` | Swagger API docs |

### `/api/process` Request

- `Content-Type: multipart/form-data`
- Field: `audio` — audio file (webm/mp4/wav/ogg)

### `/api/process` Response

```json
{
  "transcript": "I'm really frustrated today",
  "emotion": "irritated",
  "emotion_confidence": 87,
  "emotion_reasoning": "Strong frustration markers in the text",
  "emotion_config": {
    "emoji": "😤",
    "color": "#f97316",
    "voice": "alloy",
    "label": "IRRITATED"
  },
  "response_text": "I can hear that you're having a tough time...",
  "audio_base64": "<base64 mp3 data>"
}
```

## Frontend Features

- **Live waveform** — real-time microphone visualization via Web Audio API
- **Pipeline indicator** — shows each processing step
- **Emotion card** — color-coded with animated waveform bars
- **Custom audio player** — with progress bar, seek, auto-play
- **Typewriter effect** — AI response types out character by character
- **Text mode** — type instead of speak (click send icon)
- **Demo chips** — quick test phrases to try without a mic
- **Keyboard shortcut** — press `Space` to start/stop recording

## Project Structure

```
ai-voice-system/
├── backend/
│   ├── main.py          # FastAPI app
│   ├── requirements.txt # Python deps
│   └── .env             # API keys
├── frontend/
│   ├── index.html       # App shell
│   ├── style.css        # All styles
│   └── app.js           # All logic
├── start.sh             # One-command launcher
└── README.md
```

## Requirements

- Python 3.9+
- OpenAI API key (in `backend/.env`)
- Modern browser (Chrome, Firefox, Edge, Safari 15+)
- Microphone permissions
