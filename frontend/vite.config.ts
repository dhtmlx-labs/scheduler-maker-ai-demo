import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "", "VITE_");

  return {
    base: "./",
    server: {
      port: Number(env.VITE_PORT || 3000),
      strictPort: true,
      host: true,
      origin: `http://0.0.0.0:${env.VITE_PORT || 3000}`,
      watch: {
        usePolling: true,
      },
    },
  };
});
