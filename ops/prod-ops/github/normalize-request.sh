#!/bin/bash
# Validates the normalize workflow's inputs and prints the request bo-prod-ops
# reads on stdin. Runs BEFORE any secret or SSH exists in the job, and again in
# the job that holds them; the server validates a third time.
#
# Env: TRIP_IDS, ACTOR_EMAIL, EXPECTED_RELEASE_SHA (the workflow inputs, passed
# through `env:` - never interpolated into a script). Exit 2 on any refusal.
set -euo pipefail -o noglob
readonly UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
readonly MAX_IDS=200

die() { printf '::error::%s\n' "$*" >&2; exit 2; }

# Commas, spaces and newlines all separate - the audit prints a comma list and
# people paste columns. Upper case is folded; everything else must already be a
# UUID, so `all`, `*`, SQL and shell syntax can only fail.
ids="$(printf '%s' "${TRIP_IDS:-}" | tr 'A-F' 'a-f' | tr -s ', \t\r\n' ',,,,,' | sed 's/^,//; s/,$//')"
[[ -n "$ids" ]] || die "trip_ids is empty - list the ELIGIBLE ids from the audit explicitly"
[[ "$ids" =~ ^$UUID(,$UUID)*$ ]] || die "trip_ids must contain trip UUIDs only - no 'all', '*', ranges, SQL or shell syntax"
count="$(tr ',' '\n' <<< "$ids" | wc -l)"
(( count <= MAX_IDS )) || die "at most $MAX_IDS ids per run ($count given) - split the list"
dupes="$(tr ',' '\n' <<< "$ids" | sort | uniq -d)"
[[ -z "$dupes" ]] || die "an id is listed twice: ${dupes//$'\n'/, }"

by="${ACTOR_EMAIL:-}"
[[ "$by" =~ ^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63}){1,8}$ ]] \
  || die "actor_email must be the email of the person applying it (their app account)"
[[ "${EXPECTED_RELEASE_SHA:-}" =~ ^[0-9a-f]{40}$ ]] \
  || die "expected_release_sha must be the full 40-character lowercase commit the audit reported as backend_release"

printf 'ids=%s\nby=%s\nexpected_release=%s\n' "$ids" "$by" "$EXPECTED_RELEASE_SHA"
