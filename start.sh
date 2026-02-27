#!/usr/bin/env bash
# ─── AI Voice System — Quick Start ─────────────────────────────────────────
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║      AI Voice System — Starting Up        ║"
echo "║   Emotion-Aware Conversational Assistant  ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

# ── Check Python ────────────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
  echo "❌  python3 not found. Install Python 3.9+ and try again."
  exit 1
fi

# ── Create / activate venv ──────────────────────────────────────────────────
VENV="$BACKEND/venv"
if [ ! -d "$VENV" ]; then
  echo "📦  Creating virtual environment..."
  python3 -m venv "$VENV"
fi

source "$VENV/bin/activate"
echo "✅  Virtual environment activated"

# ── Install dependencies ─────────────────────────────────────────────────────
echo "📥  Installing Python dependencies..."
pip install -q --upgrade pip
pip install -q -r "$BACKEND/requirements.txt"
echo "✅  Dependencies installed"

# ── Start Backend ────────────────────────────────────────────────────────────
echo ""
echo "🚀  Starting FastAPI backend on http://localhost:8080 ..."
# Use --app-dir so uvicorn finds main.py regardless of cwd
uvicorn main:app --reload --host 0.0.0.0 --port 8080 --app-dir "$BACKEND" &
BACKEND_PID=$!
echo "✅  Backend PID: $BACKEND_PID"

# Wait briefly for backend to start
sleep 2

# ── Start Frontend ───────────────────────────────────────────────────────────
echo ""
echo "🌐  Starting frontend server on http://localhost:3000 ..."
# Use --directory so cwd doesn't matter
python3 -m http.server 3000 --bind 127.0.0.1 --directory "$FRONTEND" &
FRONTEND_PID=$!
echo "✅  Frontend PID: $FRONTEND_PID"

# ── Print summary ─────────────────────────────────────────────────────────────
echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║          🎉 System is Running!            ║"
echo "╠═══════════════════════════════════════════╣"
echo "║  Frontend : http://localhost:3000         ║"
echo "║  Backend  : http://localhost:8080         ║"
echo "║  API Docs : http://localhost:8080/docs    ║"
echo "╠═══════════════════════════════════════════╣"
echo "║  Press Ctrl+C to stop all servers        ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

# Open browser (macOS)
if command -v open &>/dev/null; then
  sleep 1
  open "http://localhost:3000"
fi

# ── Cleanup on exit ───────────────────────────────────────────────────────────
trap "echo ''; echo '🛑 Stopping servers...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo '✅  Done.'; exit 0" INT TERM

wait
