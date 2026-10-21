const port = process.env.PORT ?? "8080";
try {
  const response = await fetch(`http://127.0.0.1:${port}/health`, {
    signal: AbortSignal.timeout(2000),
  });
  const body = await response.json();
  if (response.status !== 200 || body.service !== "rosetta-core" || body.status !== "ok") {
    throw new Error("Unexpected health response");
  }
} catch {
  console.error("Platform health check failed");
  process.exitCode = 1;
}
