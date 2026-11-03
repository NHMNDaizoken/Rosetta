#!/bin/sh
# SPDX-FileCopyrightText: 2026 Rosetta Contributors
# SPDX-License-Identifier: Apache-2.0
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v identity_password="$IDENTITY_DB_PASSWORD" \
  -v data_password="$DATA_DB_PASSWORD" \
  -v workflow_password="$WORKFLOW_DB_PASSWORD" <<'SQL'
CREATE ROLE rosetta_identity LOGIN PASSWORD :'identity_password';
CREATE DATABASE rosetta_identity OWNER rosetta_identity;
CREATE ROLE rosetta_data LOGIN PASSWORD :'data_password' NOINHERIT;
CREATE DATABASE rosetta_data OWNER rosetta_data;
CREATE ROLE rosetta_workflow LOGIN PASSWORD :'workflow_password';
CREATE DATABASE rosetta_workflow OWNER rosetta_workflow;
SQL
