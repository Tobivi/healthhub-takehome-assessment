"""
AI Voice System - Backend API
Emotion-Aware Conversational Voice Assistant
Backend: FastAPI + OpenAI (Whisper STT | GPT-4o-mini | TTS)
"""

import os
import io
import json
import base64
import logging
import tempfile

from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import openai
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger(__name__)

# ─── App Setup ────────────────────────────────────────────────────────────────

app = FastAPI(title="AI Voice System", version="1.0.0", description="Emotion-Aware Conversational AI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# ─── Emotion Configuration ────────────────────────────────────────────────────

EMOTION_CONFIG = {
    "happy": {
        "emoji": "😊",
        "color": "#22c55e",
        "gradient": "linear-gradient(135deg, #14532d, #166534)",
        "voice": "nova",
        "label": "HAPPY",
        "description": "User is happy and positive",
    },
    "neutral": {
        "emoji": "😐",
        "color": "#3b82f6",
        "gradient": "linear-gradient(135deg, #1e3a5f, #1d4ed8)",
        "voice": "alloy",
        "label": "NEUTRAL",
        "description": "User is in a neutral state",
    },
    "sad": {
        "emoji": "😢",
        "color": "#a78bfa",
        "gradient": "linear-gradient(135deg, #2e1065, #4c1d95)",
        "voice": "shimmer",
        "label": "SAD",
        "description": "User seems sad or distressed",
    },
    "angry": {
        "emoji": "😠",
        "color": "#ef4444",
        "gradient": "linear-gradient(135deg, #450a0a, #991b1b)",
        "voice": "alloy",
        "label": "ANGRY",
        "description": "User is angry",
    },
    "irritated": {
        "emoji": "😤",
        "color": "#f97316",
        "gradient": "linear-gradient(135deg, #431407, #c2410c)",
        "voice": "alloy",
        "label": "IRRITATED",
        "description": "User is irritated or frustrated",
    },
    "fearful": {
        "emoji": "😰",
        "color": "#fbbf24",
        "gradient": "linear-gradient(135deg, #422006, #b45309)",
        "voice": "echo",
        "label": "FEARFUL",
        "description": "User seems fearful or anxious",
    },
    "surprised": {
        "emoji": "😮",
        "color": "#22d3ee",
        "gradient": "linear-gradient(135deg, #0c4a6e, #0e7490)",
        "voice": "echo",
        "label": "SURPRISED",
        "description": "User seems surprised",
    },
    "disgusted": {
        "emoji": "🤢",
        "color": "#84cc16",
        "gradient": "linear-gradient(135deg, #1a2e05, #365314)",
        "voice": "alloy",
        "label": "DISGUSTED",
        "description": "User is disgusted",
    },
}

EMOTION_RESPONSE_PROMPTS = {
    "angry": (
        "The user is angry. Respond with EXTREME calm, patience, and empathy. "
        "First validate their feelings genuinely. Then offer constructive help. "
        "Keep your tone de-escalating, never defensive."
    ),
    "irritated": (
        "The user sounds irritated or frustrated. Respond soothingly. "
        "Acknowledge any inconvenience sincerely. Be solution-focused and helpful."
    ),
    "sad": (
        "The user seems sad or distressed. Respond with deep warmth and genuine empathy. "
        "Show that you care. Be gentle, comforting, and supportive."
    ),
    "happy": (
        "The user is happy and positive! Match their enthusiasm with warmth. "
        "Be upbeat, friendly, and engaging. Celebrate with them."
    ),
    "fearful": (
        "The user seems anxious or fearful. Be calm, reassuring, and gentle. "
        "Provide clarity and support to help them feel safe and grounded."
    ),
    "neutral": (
        "The user is in a neutral state. Be professional, clear, and genuinely helpful. "
        "Provide accurate and useful information."
    ),
    "surprised": (
        "The user seems surprised. Provide clear, helpful context. "
        "Be engaging and informative."
    ),
    "disgusted": (
        "The user seems disgusted or put off. Acknowledge their reaction with empathy. "
        "Be understanding and help redirect to something positive."
    ),
}

EMOTION_ALIASES = {
    "frustrated": "irritated",
    "fear": "fearful",
    "anger": "angry",
    "happiness": "happy",
    "sadness": "sad",
    "surprise": "surprised",
    "disgust": "disgusted",
    "excited": "happy",
    "content": "happy",
    "anxious": "fearful",
    "worried": "fearful",
    "upset": "sad",
}


def normalize_emotion(raw: str) -> str:
    raw = raw.lower().strip()
    if raw in EMOTION_CONFIG:
        return raw
    return EMOTION_ALIASES.get(raw, "neutral")


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "AI Voice System", "version": "1.0.0"}


def _parse_history(raw: str) -> list:
    """Parse and validate conversation history from JSON string."""
    try:
        h = json.loads(raw)
        if not isinstance(h, list):
            return []
        # Keep only valid {role, content} dicts; limit to last 10 messages (5 turns)
        valid = [m for m in h if isinstance(m, dict) and m.get("role") in ("user", "assistant") and "content" in m]
        return valid[-10:]
    except Exception:
        return []


@app.post("/api/process")
async def process_full_pipeline(
    audio: UploadFile = File(...),
    history: str = Form("[]"),   # JSON array of {role, content} conversation turns
):
    """
    Full pipeline endpoint:
      1. Speech-to-Text  (OpenAI Whisper)
      2. Emotion Detection  (GPT-4o-mini)
      3. Context-Aware + Emotion-Aware Response  (GPT-4o-mini)
      4. Text-to-Speech  (OpenAI TTS)
    Returns JSON with transcript, emotion metadata, response text, and base64 audio.
    """
    logger.info(f"[PROCESS] Received audio | filename={audio.filename} | content_type={audio.content_type}")

    # ── Read audio bytes ──────────────────────────────────────────────────────
    content = await audio.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty audio file received.")

    # Determine file suffix
    ct = (audio.content_type or "").lower()
    if "mp4" in ct or "m4a" in ct:
        suffix = ".mp4"
    elif "wav" in ct:
        suffix = ".wav"
    elif "ogg" in ct:
        suffix = ".ogg"
    elif "mp3" in ct or "mpeg" in ct:
        suffix = ".mp3"
    else:
        suffix = ".webm"

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        # ── Step 1: Whisper STT ───────────────────────────────────────────────
        logger.info("[STT] Transcribing with Whisper-1...")
        with open(tmp_path, "rb") as f:
            whisper_response = client.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                response_format="text",
            )
        transcript = str(whisper_response).strip()
        if not transcript:
            raise HTTPException(
                status_code=422,
                detail="Could not transcribe audio. Please speak clearly and try again.",
            )
        logger.info(f"[STT] Transcript: {transcript}")

        # ── Step 2: Emotion Detection ─────────────────────────────────────────
        logger.info("[EMOTION] Detecting emotion...")
        emotion_completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an emotion detection AI. Analyze the given text and detect the primary emotion.\n\n"
                        "Available emotions: happy, neutral, sad, angry, irritated, fearful, surprised, disgusted\n\n"
                        "Return ONLY a valid JSON object with these exact fields:\n"
                        '{"emotion": "<emotion>", "confidence": <integer 50-100>, "reasoning": "<one sentence>"}'
                    ),
                },
                {
                    "role": "user",
                    "content": f'Detect the emotion in this text: "{transcript}"',
                },
            ],
            response_format={"type": "json_object"},
            max_tokens=120,
        )

        try:
            emotion_data = json.loads(emotion_completion.choices[0].message.content)
        except json.JSONDecodeError:
            emotion_data = {"emotion": "neutral", "confidence": 70, "reasoning": "Default fallback."}

        emotion = normalize_emotion(emotion_data.get("emotion", "neutral"))
        confidence = int(emotion_data.get("confidence", 70))
        reasoning = emotion_data.get("reasoning", "")
        config = EMOTION_CONFIG[emotion]

        logger.info(f"[EMOTION] Detected: {emotion} | Confidence: {confidence}% | {reasoning}")

        # ── Step 3: Generate Context-Aware + Emotion-Aware Response ──────────
        conv_history = _parse_history(history)
        logger.info(f"[AI] Generating response | history_turns={len(conv_history)//2} | emotion={emotion}")
        ai_completion = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are an empathetic AI voice assistant with advanced emotional intelligence.\n\n"
                        f"{EMOTION_RESPONSE_PROMPTS.get(emotion, EMOTION_RESPONSE_PROMPTS['neutral'])}\n\n"
                        "Guidelines:\n"
                        "- Keep your response to 2-3 sentences maximum\n"
                        "- Be conversational and human-like, not robotic\n"
                        "- Do NOT explicitly mention that you detected their emotion\n"
                        "- Build naturally on the conversation history when relevant\n"
                        "- Reference earlier topics if it adds value, otherwise stay focused"
                    ),
                },
                *conv_history,           # ← full conversation context
                {"role": "user", "content": transcript},
            ],
            max_tokens=200,
        )
        response_text = ai_completion.choices[0].message.content.strip()
        logger.info(f"[AI] Response: {response_text}")

        # ── Step 4: Text-to-Speech ────────────────────────────────────────────
        logger.info(f"[TTS] Synthesizing speech | voice={config['voice']}...")
        tts_response = client.audio.speech.create(
            model="tts-1",
            voice=config["voice"],
            input=response_text,
            speed=0.95,
        )
        audio_b64 = base64.b64encode(tts_response.content).decode("utf-8")
        logger.info("[TTS] Speech synthesis complete.")

        return {
            "transcript": transcript,
            "emotion": emotion,
            "emotion_confidence": confidence,
            "emotion_reasoning": reasoning,
            "emotion_config": config,
            "response_text": response_text,
            "audio_base64": audio_b64,
        }

    except HTTPException:
        raise
    except openai.APIError as e:
        logger.error(f"[OPENAI] API Error: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail=f"OpenAI API error: {str(e)}")
    except Exception as e:
        logger.error(f"[ERROR] Unexpected: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


@app.post("/api/test")
async def test_text_input(
    text: str = Form(...),
    history: str = Form("[]"),
):
    """
    Test endpoint: process text directly (no audio needed).
    Supports conversation history for context-aware responses.
    """
    logger.info(f"[TEST] Processing text: {text}")

    # Emotion detection
    emotion_completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": (
                    "Detect emotion in the text. Available: happy, neutral, sad, angry, irritated, fearful, surprised, disgusted.\n"
                    'Return JSON: {"emotion": "<emotion>", "confidence": <50-100>, "reasoning": "<one sentence>"}'
                ),
            },
            {"role": "user", "content": f'Text: "{text}"'},
        ],
        response_format={"type": "json_object"},
        max_tokens=120,
    )

    try:
        emotion_data = json.loads(emotion_completion.choices[0].message.content)
    except Exception:
        emotion_data = {"emotion": "neutral", "confidence": 70, "reasoning": "Fallback."}

    emotion = normalize_emotion(emotion_data.get("emotion", "neutral"))
    config = EMOTION_CONFIG[emotion]

    # AI response — context-aware using conversation history
    conv_history = _parse_history(history)
    ai_completion = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {
                "role": "system",
                "content": (
                    f"You are an empathetic AI voice assistant. {EMOTION_RESPONSE_PROMPTS.get(emotion, '')}\n"
                    "Keep response to 2-3 sentences. Be conversational. Build on the conversation history when relevant."
                ),
            },
            *conv_history,           # ← full conversation context
            {"role": "user", "content": text},
        ],
        max_tokens=200,
    )
    response_text = ai_completion.choices[0].message.content.strip()

    # TTS
    tts = client.audio.speech.create(
        model="tts-1",
        voice=config["voice"],
        input=response_text,
        speed=0.95,
    )
    audio_b64 = base64.b64encode(tts.content).decode()

    return {
        "transcript": text,
        "emotion": emotion,
        "emotion_confidence": emotion_data.get("confidence", 70),
        "emotion_reasoning": emotion_data.get("reasoning", ""),
        "emotion_config": config,
        "response_text": response_text,
        "audio_base64": audio_b64,
    }
