import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const envUrl = (name, fallback) => process.env[`VITE_${name.toUpperCase()}_URL`] || fallback;

// Proxy each service so the browser never hits CORS problems.
const svc = (name, port) => ({
  target: envUrl(name, `http://127.0.0.1:${port}`),
  changeOrigin: true,
  rewrite: (p) => p.replace(/^\/svc\/[a-z]+/, ""),
});

export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 5173),
    proxy: {
      "/svc/booking": svc("booking", 8081),
      "/svc/inventory": svc("inventory", 8082),
      "/svc/payment": svc("payment", 8083),
      "/svc/notification": svc("notification", 8084),
    },
  },
});
