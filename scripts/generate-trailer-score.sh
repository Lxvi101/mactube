#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mkdir -p "$PROJECT_DIR/public"

ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "sine=frequency=55:sample_rate=48000:duration=20" \
  -f lavfi -i "sine=frequency=110:sample_rate=48000:duration=20" \
  -f lavfi -i "sine=frequency=220:sample_rate=48000:duration=20" \
  -f lavfi -i "anoisesrc=color=pink:sample_rate=48000:duration=20" \
  -filter_complex "[0:a]volume=0.055,lowpass=f=180[a0];[1:a]volume=0.018,afade=t=in:st=2:d=4,afade=t=out:st=16:d=4[a1];[2:a]volume=0.007,tremolo=f=0.28:d=0.8,aecho=0.8:0.5:90:0.25[a2];[3:a]lowpass=f=850,highpass=f=100,volume=0.009[a3];[a0][a1][a2][a3]amix=inputs=4:normalize=0,alimiter=limit=0.6,afade=t=in:st=0:d=1.2,afade=t=out:st=18.2:d=1.8[out]" \
  -map "[out]" -c:a pcm_s16le "$PROJECT_DIR/public/trailer-score.wav"

echo "Generated public/trailer-score.wav"
