#!/bin/sh
# SPDX-FileCopyrightText: 2026 Rosetta Contributors
# SPDX-License-Identifier: Apache-2.0
set -eu
# One operator/Compose migrator at a time. Never replay an older authority
# constraint or function over a database that has accepted later migrations.
for migration in /migrations/[0-9][0-9][0-9]-*.sql; do
  version=${migration##*/}
  version=${version%%-*}
  if [ "$(psql -X "$@" -Atqc "SELECT to_regclass('core.schema_migrations') IS NOT NULL")" = t ] &&
     [ "$(psql -X "$@" -Atqc "SELECT EXISTS(SELECT FROM core.schema_migrations WHERE version=$version)")" = t ]; then
    printf 'Migration %s already applied\n' "$version"
  else
    psql -X "$@" -f "$migration"
  fi
done
