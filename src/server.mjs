import { createHealthServer } from "./health.mjs";

const rawPort = process.env.PORT ?? "8080";
if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const server = createHealthServer();
server.on("error", (error) => {
  console.error(`Platform health API failed: ${error.code ?? "startup_error"}`);
  process.exitCode = 1;
});
server.listen(Number(rawPort), process.env.HOST ?? "127.0.0.1", () => {
  console.log(`Platform health API listening on port ${server.address().port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    server.close();
    setTimeout(() => server.closeAllConnections(), 5000).unref();
  });
}
