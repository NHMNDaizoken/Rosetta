// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { HttpError } from "./http.mjs";

export function validateIdentity(claims, issuer, now = Date.now() / 1000) {
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.active !== true || claims.iss !== issuer || !audiences.includes("rosetta-core") ||
      !Number.isFinite(claims.exp) || claims.exp <= now || typeof claims.sub !== "string" || !claims.sub) {
    throw new HttpError(401, "invalid_token");
  }
  if (typeof claims.tenant_id !== "string" || !/^[a-z][a-z0-9-]{0,62}$/.test(claims.tenant_id) ||
      !Array.isArray(claims.tenant_memberships) || !claims.tenant_memberships.includes(claims.tenant_id)) {
    throw new HttpError(403, "tenant_required");
  }
  const roles = claims.realm_access?.roles ?? [];
  if (!Array.isArray(roles) || !roles.includes("core-reader")) throw new HttpError(403, "insufficient_role");
  return { subject: claims.sub, tenantId: claims.tenant_id, roles: roles.filter((role) => ["core-reader", "core-writer"].includes(role)) };
}

export function createAuthorizer(config, fetcher = fetch) {
  return async (request, withContext = false) => {
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string" || !/^Bearer [A-Za-z0-9._~-]+$/.test(authorization) || authorization.length > 8192) {
      throw new HttpError(401, "bearer_token_required");
    }
    let response;
    try {
      response = await fetcher(`${config.identityUrl}/protocol/openid-connect/token/introspect`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: "rosetta-core", client_secret: config.clientSecret, token: authorization.slice(7) }),
        signal: AbortSignal.timeout(3000),
        redirect: "error",
      });
      if (!response.ok) throw new Error("Introspection unavailable");
      const claims = await response.json();
      const identity = validateIdentity(claims, config.issuer);
      return withContext ? { ...identity, issuer: config.issuer,
        clientId: typeof claims.client_id === "string" && claims.client_id.length <= 255 ? claims.client_id : undefined,
        credentialExpiresAt: claims.exp * 1000 } : identity;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, "identity_unavailable");
    }
  };
}
