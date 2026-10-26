import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Proxy each service so the browser never hits CORS problems.
const svc = (port) => ({
  target: `http://127.0.0.1:${port}`,
  changeOrigin: true,
  rewrite: (p) => p.replace(/^\/svc\/[a-z]+/, ""),
});

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/svc/booking": svc(8081),
      "/svc/inventory": svc(8082),
      "/svc/payment": svc(8083),
      "/svc/notification": svc(8084),
    },
  },
});
