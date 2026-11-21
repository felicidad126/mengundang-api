import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Uji memakai PostgreSQL asli (TEST_DATABASE_URL); global setup menyiapkan skema sekali.
    globalSetup: ['test/global-setup.ts'],
    // Semua berkas uji memakai satu database, jadi dijalankan berurutan.
    fileParallelism: false,
  },
});
