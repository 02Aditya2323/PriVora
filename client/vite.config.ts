import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:4000',
        ws: true,
        configure: (proxy) => {
          proxy.on('error', (err: any) => {
            // Silently ignore normal client disconnect / navigation tear-downs
            if (err?.code === 'EPIPE' || err?.code === 'ECONNRESET') return;
            console.error('Socket proxy error:', err);
          });
          proxy.on('proxyReqWs', (_proxyReq, _req, socket: any) => {
            socket.on('error', (err: any) => {
              if (err?.code === 'EPIPE' || err?.code === 'ECONNRESET') return;
            });
          });
        },
      },
    },
  },
});
