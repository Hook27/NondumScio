#!/usr/bin/env bash
# Triviale test: de repo heeft een niet-lege README.md.
set -eu

cd "$(dirname "$0")/.."

if [ ! -s README.md ]; then
  echo "FAIL: README.md ontbreekt of is leeg" >&2
  exit 1
fi

echo "OK: README.md bestaat en is niet leeg"
