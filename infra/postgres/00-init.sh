#!/bin/sh
# SPDX-FileCopyrightText: 2026 Junctura Contributors
# SPDX-License-Identifier: Apache-2.0
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v identity_password="$IDENTITY_DB_PASSWORD" \
  -v data_password="$DATA_DB_PASSWORD" \
  -v workflow_password="$WORKFLOW_DB_PASSWORD" <<'SQL'
CREATE ROLE junctura_identity LOGIN PASSWORD :'identity_password';
CREATE DATABASE junctura_identity OWNER junctura_identity;
CREATE ROLE junctura_data LOGIN PASSWORD :'data_password' NOINHERIT;
CREATE DATABASE junctura_data OWNER junctura_data;
CREATE ROLE junctura_workflow LOGIN PASSWORD :'workflow_password';
CREATE DATABASE junctura_workflow OWNER junctura_workflow;
SQL
