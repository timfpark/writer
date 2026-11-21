import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin } from "vite";
import { patchCssModules } from "vite-css-modules";
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

// The font files name their license but do not carry its text, which the SIL
// Open Font License asks every copy to include, so the build emits each
// typeface's license beside its fonts.
const fontLicenses = {
  "@fontsource-variable/inter/LICENSE": "assets/inter-LICENSE.txt",
  "@fontsource-variable/newsreader/LICENSE": "assets/newsreader-LICENSE.txt",
};

function emitFontLicenses(): Plugin {
  return {
    name: "writer:font-licenses",
    apply: "build",
    async generateBundle() {
      for (const [specifier, fileName] of Object.entries(fontLicenses)) {
        const resolved = await this.resolve(specifier);
        if (!resolved) {
          this.error(`could not resolve ${specifier}; run npm ci in webapp/`);
        }
        this.emitFile({
          type: "asset",
          fileName,
          source: await this.fs.readFile(resolved.id),
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    patchCssModules({ generateSourceTypes: true }),
    react(),
    emitFontLicenses(),
  ],
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
    // Playwright runs the browser tests in e2e/.
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    unstubGlobals: true,
    // Vitest loads CSS as empty unless listed here; the contrast test reads
    // the tokens.
    css: { include: [/\/src\/styles\/tokens\.css/] },
  },
}));
