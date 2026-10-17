#!/bin/zsh
# 用 agy（Nano Banana）生成 WH40K 風格素材到 assets/wh40k/raw/。已存在的檔案跳過（可重跑補缺）。
# 用法：tools/wh40k-gen.sh   （平行 6 支）
cd "${0:A:h}/.."
RAW="$PWD/assets/wh40k/raw"; mkdir -p "$RAW"
SPRITE='Warhammer 40,000 grimdark style, detailed painted game sprite, strictly top-down orthographic view from directly above, single object centered filling about 85% of the frame, isolated on a flat solid pure magenta #FF00FF background, no shadow on the background, no magenta in the object, no text, no border, square 1:1.'
TILE='Warhammer 40,000 grimdark style, seamless tileable square game texture, strictly top-down view, fills the entire frame edge to edge, no border, no text, no perspective, square 1:1.'
gen() {
  local name="$1" desc="$2" style="$3"
  [[ -s "$RAW/$name.png" ]] && return 0
  agy -p "Use your image generation tool (Nano Banana) to generate exactly ONE image: $desc. $style Save the image as PNG at $RAW/$name.png . Reply with only the saved path." \
    --dangerously-skip-permissions --model gemini-3.8-flash-medium --print-timeout 400s >/dev/null 2>&1
  [[ -s "$RAW/$name.png" ]] && echo "ok   $name" || echo "FAIL $name"
}
{ while IFS='|' read -r n d; do print -r -- "$n|$d|$SPRITE"; done < tools/wh40k-prompts.txt
  while IFS='|' read -r n d; do print -r -- "$n|$d|$TILE"; done < tools/wh40k-tiles.txt; } |
while IFS='|' read -r n d s; do
  while (( $(jobs -r | wc -l) >= 6 )); do sleep 2; done
  gen "$n" "$d" "$s" &
done
wait
