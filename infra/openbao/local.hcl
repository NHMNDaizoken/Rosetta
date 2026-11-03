# SPDX-FileCopyrightText: 2026 Rosetta Contributors
# SPDX-License-Identifier: Apache-2.0
# Local Compose listener only. TLS and auto-unseal remain production work.
# Persist under /openbao/file so the non-root image user can write the volume.
ui = false

storage "raft" {
  path = "/openbao/file"
}

listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = 1
}

api_addr     = "http://secrets:8200"
cluster_addr = "http://secrets:8201"
