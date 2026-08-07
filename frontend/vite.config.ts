import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Canister ids come from ../.env, written by scripts/write-env.mjs from
// icp-cli's sync-step variables (icp-cli has no output_env_file equivalent).
const repoRoot = new URL("../", import.meta.url).pathname;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "VITE_");
  const canisterId = env.VITE_CANISTER_ID_HACKATHON;

  return {
    plugins: [react()],
    root: ".",
    envDir: "..",
    build: {
      outDir: "dist",
      emptyOutDir: true,
      // Assets are uploaded to the canister one file at a time, and each file
      // costs an update call. Fewer, larger chunks is the right trade here.
      chunkSizeWarningLimit: 1500,
    },
    server: {
      // `*.localhost` may resolve to IPv4 even when plain `localhost` chooses
      // IPv6. Listen on IPv4 explicitly so the documented showcase hostname and
      // dev-container port forwarding do not intermittently hit a closed socket.
      host: "0.0.0.0",
      port: 5174,
      strictPort: true,
      // Proxy agent traffic to the icp-cli gateway so the browser never makes a
      // cross-origin request (and `fetchRootKey` works without CORS setup).
      // Target must match `gateway.port` in ../icp.yaml.
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8943",
          changeOrigin: true,
        },
        // User images and packages are canister paths. Vite would otherwise
        // answer every `/u/...` request with index.html, which turns all of the
        // showcase art into broken images. The local showcase clock is weeks
        // ahead, so its certified HTTP responses are correctly rejected against
        // wall time; use PocketIC's raw *local* host for this development proxy.
        // This branch is Vite-only and cannot enter the production bundle.
        "/u/": {
          target: canisterId
            ? `http://${canisterId}.raw.localhost:8943`
            : "http://127.0.0.1:8943",
          changeOrigin: true,
        },
      },
    },
  };
});
