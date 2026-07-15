#!/usr/bin/env bash
# Stage shoot footage for page.html.
#
# The renderer's Chromium (Playwright open-source build) has no H.264 decoder,
# so the H.264 exports from the WorkDrive TILT HOCKEY SHOOT/EXPORTS folder are
# transcoded here into short VP9/WebM segments — only the windows the cut
# actually uses, padded 0.2s in front (SEG_IN in page.html is 0.2).
#
# Inputs (download from WorkDrive into shoot/, spaces renamed to dashes):
#   PRUST-NICHOLS-SCHREMP-x-TILT_1.mp4  FEAS-X-TILT-.mp4  PRUST-X-TILT_1.mp4
#   HALEY-X-TILT.mp4  LAMY-X-TILT.mp4
set -euo pipefail
cd "$(dirname "$0")"
FF="${FF:-$(node -e "console.log(require('@ffmpeg-installer/ffmpeg').path)")}"

seg() { # seg <out> <src> <in-point> <dur>
  "$FF" -y -loglevel error -ss "$3" -t "$4" -i "shoot/$2" \
    -an -c:v libvpx-vp9 -crf 18 -b:v 0 -cpu-used 2 -row-mt 1 "shoot/$1"
  echo "staged shoot/$1"
}

#   segment            source clip                          in     dur
seg seg-v1a.webm "PRUST-NICHOLS-SCHREMP-x-TILT_1.mp4"       0.6    2.0   # snow-spray stop
seg seg-v1b.webm "FEAS-X-TILT-.mp4"                         4.2    2.0   # crossover burst
seg seg-v2a.webm "PRUST-X-TILT_1.mp4"                      15.0    2.0   # toe-drag hands
seg seg-v2b.webm "HALEY-X-TILT.mp4"                         7.4    2.0   # driving the net
seg seg-v3a.webm "PRUST-X-TILT_1.mp4"                       9.1    2.0   # one-timer
seg seg-v3b.webm "LAMY-X-TILT.mp4"                          9.2    2.0   # deke finish
