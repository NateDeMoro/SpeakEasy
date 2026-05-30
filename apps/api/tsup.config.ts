import { defineConfig } from 'tsup';

// Bundle the workspace's @quack/shared (TS source) into the output so the Cloud Run
// container runs a self-contained dist/server.js. External npm deps (hono) stay external.
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  noExternal: [/@quack\//],
  clean: true,
});
