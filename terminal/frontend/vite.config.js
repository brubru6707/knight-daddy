import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In dev, /api is proxied to the FastAPI backend (run_backend.sh, port 8000).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { "/api": process.env.API_URL || "http://127.0.0.1:8000" } },
});
