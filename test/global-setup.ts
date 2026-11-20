import { jalankanMigrasi } from '../src/db/jalankan-migrasi.js';
import { buatPool } from '../src/db/pool.js';

// Sekali sebelum semua uji: skema public dikosongkan lalu dimigrasi dari nol.
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL wajib diisi (PostgreSQL 18, pengguna yang boleh CREATE DATABASE)');
  const pool = buatPool(url, 1);
  try {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await jalankanMigrasi(pool, 'naik');
  } finally {
    await pool.end();
  }
}
