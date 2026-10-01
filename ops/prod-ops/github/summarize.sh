#!/bin/bash
# Renders bo-prod-ops output (`section|key|value` lines) as a job summary.
# Only what the wrapper printed - UUIDs, classifications, counts, release and
# container metadata - so nothing reaches the summary that is not already in
# the log.   Usage: summarize.sh <title> <output file>
set -euo pipefail
title="$1" file="$2"
printf '### %s\n\n' "$title"
if [[ ! -s "$file" ]]; then
  printf 'No output: the connection or the operation failed before answering - see the log.\n\n'
  exit 0
fi

notes=() meta=() counts=() checks=() ids=()
while IFS='|' read -r section key value; do
  case "$section" in
    error)     notes+=("**Stopped - exit $key:** $value") ;;
    warn)      notes+=("Warning ($key): $value") ;;
    done)      notes+=("**Normalized $value trip(s).**") ;;
    meta)      meta+=("| $key | \`$value\` |") ;;
    count | temporal | assignments) counts+=("| $section | $key | $value |") ;;
    preflight | result) checks+=("| $section | \`$key\` | $value |") ;;
    ids)       ids+=("$key|$value") ;;
    *)         ;;  # stays in the log; the summary shows only what it knows how to render
  esac
done < "$file"

for note in "${notes[@]}"; do printf '%s\n\n' "$note"; done
if (( ${#checks[@]} )); then
  printf '| step | trip | classification / outcome |\n|---|---|---|\n'; printf '%s\n' "${checks[@]}"; echo
fi
if (( ${#counts[@]} )); then
  printf '| section | key | count |\n|---|---|---|\n'; printf '%s\n' "${counts[@]}"; echo
fi
for entry in "${ids[@]}"; do
  bucket="${entry%%|*}" list="${entry#*|}"
  n=0; [[ -z "$list" ]] || n="$(tr ',' '\n' <<< "$list" | wc -l)"
  # shellcheck disable=SC2016 # the backticks are markdown, not a command
  printf '<details><summary>%s ids (%s)</summary>\n\n```\n%s\n```\n</details>\n\n' "$bucket" "$n" "${list//,/$'\n'}"
done
if (( ${#meta[@]} )); then
  printf '| metadata | value |\n|---|---|\n'; printf '%s\n' "${meta[@]}"; echo
fi
