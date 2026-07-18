#!/bin/bash
# Double-click on macOS: serves this folder and opens it in the browser.
cd "$(dirname "$0")" || exit 1
PORT=8650

if lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Already running, opening the browser..."
  open "http://localhost:$PORT"
  exit 0
fi

echo "Tron Legacy CV is running at http://localhost:$PORT"
echo "Close this window (or press Ctrl+C) to stop it."
(sleep 1; open "http://localhost:$PORT") &
python3 -m http.server $PORT --bind 127.0.0.1
