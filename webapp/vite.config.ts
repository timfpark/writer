import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Reads the service's port from the environment or a webapp/.env file. The
// WRITER_ prefix is not Vite's VITE_ prefix, so the value configures only the
// development server's proxy and never enters the browser bundle.
function servicePort(mode: string): number {
  const value = loadEnv(mode, ".", "WRITER_")["WRITER_SERVICE_PORT"] ?? "8888";
  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1 || port > 65535) {
    throw new Error(
      `WRITER_SERVICE_PORT must be a port from 1 to 65535, got '${value}'`,
    );
  }
  return port;
}

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
    proxy: {
      // The IPv4 literal matches the service's loopback bind; localhost can
      // resolve to ::1 first. Paths are forwarded unchanged.
      "/api/": { target: `http://127.0.0.1:${servicePort(mode)}` },
    },
  },
  test: {
    environment: "jsdom",
    unstubGlobals: true,
  },
}));
