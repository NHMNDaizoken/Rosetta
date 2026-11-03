#!/bin/sh
# SPDX-FileCopyrightText: 2026 Rosetta Contributors
# SPDX-License-Identifier: Apache-2.0
# Initialize/unseal local OpenBao and mint a Core token.
# Operator material stays on openbao-operator; Core only mounts core-token.
set -eu
BAO_ADDR="${BAO_ADDR:-http://secrets:8200}"
export BAO_ADDR
OPERATOR_DIR="${OPERATOR_DIR:-/operator}"
TOKEN_DIR="${TOKEN_DIR:-/token}"
mkdir -p "$OPERATOR_DIR" "$TOKEN_DIR"
chmod 700 "$OPERATOR_DIR" "$TOKEN_DIR"

i=0
while [ "$i" -lt 90 ]; do
  if wget -q -S -O /dev/null "$BAO_ADDR/v1/sys/health?standbyok=true" 2>&1 | grep -q "HTTP/"; then
    break
  fi
  i=$((i + 1))
  sleep 1
done

if [ ! -f "$OPERATOR_DIR/init.json" ]; then
  bao operator init -key-shares=1 -key-threshold=1 -format=json > "$OPERATOR_DIR/init.json"
  chmod 600 "$OPERATOR_DIR/init.json"
fi

UNSEAL_KEY="$(sed -n 's/.*"unseal_keys_b64":\["\([^"]*\)".*/\1/p' "$OPERATOR_DIR/init.json" | head -n1)"
ROOT_TOKEN="$(sed -n 's/.*"root_token":"\([^"]*\)".*/\1/p' "$OPERATOR_DIR/init.json" | head -n1)"
if [ -z "$UNSEAL_KEY" ] || [ -z "$ROOT_TOKEN" ]; then
  echo "openbao init material missing or unreadable" >&2
  exit 1
fi

bao operator unseal "$UNSEAL_KEY" >/dev/null
export BAO_TOKEN="$ROOT_TOKEN"

if ! bao secrets list 2>/dev/null | grep -q '^secret/'; then
  bao secrets enable -path=secret kv-v2 >/dev/null
fi

bao policy write rosetta-core /policy/rosetta-core.hcl >/dev/null

if [ -f "$TOKEN_DIR/core-token" ]; then
  OLD_TOKEN="$(cat "$TOKEN_DIR/core-token")"
  if BAO_TOKEN="$OLD_TOKEN" bao token lookup >/dev/null 2>&1; then
    echo "OpenBao ready; reusing Core token"
    exit 0
  fi
fi

TOKEN_JSON="$(bao token create -policy=rosetta-core -display-name=rosetta-core -format=json)"
TOKEN="$(printf '%s' "$TOKEN_JSON" | sed -n 's/.*"client_token":"\([^"]*\)".*/\1/p' | head -n1)"
if [ -z "$TOKEN" ]; then
  echo "failed to mint Core token" >&2
  exit 1
fi
umask 077
printf '%s' "$TOKEN" > "$TOKEN_DIR/core-token"
chmod 600 "$TOKEN_DIR/core-token"
echo "OpenBao ready for Rosetta Core"
