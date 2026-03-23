#!/bin/bash
# download-video.sh — Download a YouTube video and register it
# Usage: ./scripts/download-video.sh "https://youtube.com/watch?v=..." [category]

set -e

URL="${1}"
CATEGORY="${2:-uncategorized}"
API_URL="${API_URL:-http://localhost:3000}"

if [ -z "$URL" ]; then
  echo "Usage: $0 <youtube-url> [category]"
  echo "Example: $0 'https://youtube.com/watch?v=abc123' kubernetes"
  exit 1
fi

echo "🎯 Downloading: $URL"
echo "📂 Category: $CATEGORY"
echo ""

# Call the API to download and register
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${API_URL}/api/videos/download" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"${URL}\", \"category\": \"${CATEGORY}\"}")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  TITLE=$(echo "$BODY" | python3 -c "import sys, json; print(json.load(sys.stdin).get('title', 'Unknown'))" 2>/dev/null || echo "Unknown")
  echo ""
  echo "✅ Download complete!"
  echo "   Title: $TITLE"
  echo "   Transcoding has been started automatically."
else
  echo ""
  echo "❌ Download failed (HTTP $HTTP_CODE):"
  echo "$BODY"
  exit 1
fi
