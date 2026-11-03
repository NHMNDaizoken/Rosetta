# SPDX-FileCopyrightText: 2026 Junctura Contributors
# SPDX-License-Identifier: Apache-2.0
# Least-privilege policy for the Core process. Paths are server-composed;
# clients never choose arbitrary OpenBao paths.
path "secret/data/tenants/+/apps/+/+" {
  capabilities = ["create", "update", "read", "delete"]
}

path "secret/metadata/tenants/+/apps/+/+" {
  capabilities = ["read", "delete", "list"]
}

path "sys/health" {
  capabilities = ["read"]
}
