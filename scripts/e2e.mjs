import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { createServer as httpServer } from "node:http";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const name = `ttkmap-e2e-${process.pid}`;
const build = spawnSync(
  "docker",
  ["compose", "--profile", "test", "build", "backend-test"],
  { cwd: root, stdio: "inherit" },
);
if (build.status !== 0) process.exit(build.status ?? 1);
const free = createServer();
await new Promise((done) => free.listen(0, "127.0.0.1", done));
const port = free.address().port;
await new Promise((done) => free.close(done));
const origin = `http://127.0.0.1:${port}`;
const email = "e2e@example.test",
  password = randomBytes(24).toString("hex");
const frameHost = httpServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(
    `<html><iframe title="External map" width="800" height="700" src="${origin}/embed/${new URL(req.url, "http://host").searchParams.get("slug") ?? ""}"></iframe></html>`,
  );
});
await new Promise((done) => frameHost.listen(0, "127.0.0.1", done));
const env = {
  ...process.env,
  E2E_EMAIL: email,
  E2E_PASSWORD: password,
  APP_ORIGIN: origin,
  DATABASE_PATH: "/tmp/e2e.sqlite",
  MEDIA_PATH: "/tmp/e2e-media",
  COOKIE_SECURE: "false",
};
const container = spawn(
  "docker",
  [
    "run",
    "--rm",
    "--init",
    "--name",
    name,
    "-p",
    `127.0.0.1:${port}:8000`,
    ...[
      "E2E_EMAIL",
      "E2E_PASSWORD",
      "APP_ORIGIN",
      "DATABASE_PATH",
      "MEDIA_PATH",
      "COOKIE_SECURE",
    ].flatMap((key) => ["-e", key]),
    "ttkmap-backend-test",
    "python",
    "-m",
    "backend.tests.e2e_server",
  ],
  { env, cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);
let log = "";
for (const stream of [container.stdout, container.stderr])
  stream.on("data", (part) => {
    log = (log + part.toString()).slice(-80000);
  });
let status = 1;
try {
  let ready = false;
  for (let n = 0; n < 90; n++) {
    if (container.exitCode !== null) throw new Error("E2E container exited");
    try {
      if ((await fetch(`${origin}/healthz`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((done) => setTimeout(done, 500));
  }
  if (!ready) throw new Error("E2E API did not become ready");
  const result = spawn(
    "node",
    [
      resolve(root, "frontend/node_modules/@playwright/test/cli.js"),
      "test",
      "--config",
      resolve(root, "frontend/playwright.config.ts"),
      ...process.argv.slice(2),
    ],
    {
      cwd: root,
      env: {
        ...env,
        E2E_BASE_URL: origin,
        E2E_FRAME_URL: `http://127.0.0.1:${frameHost.address().port}`,
      },
      stdio: "inherit",
    },
  );
  status = await new Promise((done) =>
    result.on("exit", (code) => done(code ?? 1)),
  );
} catch (error) {
  console.error(error);
} finally {
  spawnSync("docker", ["stop", "-t", "5", name], { stdio: "ignore" });
  await new Promise((done) => frameHost.close(done));
  if (status) console.error(log);
}
process.exit(status);
