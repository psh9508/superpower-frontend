import { defineConfig } from "vite";

const allowedHosts = [
  "localhost",
  "unpeeling-treasonably-karyn.ngrok-free.dev",
];

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    allowedHosts,
  },
});
