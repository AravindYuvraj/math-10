import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import { copyFileSync } from 'fs';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
          'lit/decorators': 'lit/decorators.js'
        }
      },
      optimizeDeps: {
        include: ['lit', 'lit/decorators.js', '@google/genai', 'three']
      },
      publicDir: 'public',
      build: {
        rollupOptions: {
          input: {
            main: path.resolve(__dirname, 'index.html')
          }
        },
        copyPublicDir: true
      },
      plugins: [
        {
          name: 'copy-book-content',
          writeBundle() {
            try {
              copyFileSync('book-content.txt', 'dist/book-content.txt');
              console.log('Copied book-content.txt to dist/');
            } catch (err) {
              console.error('Failed to copy book-content.txt:', err);
            }
          }
        }
      ]
    };
});
