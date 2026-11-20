// Langkah migrasi, dijalankan sebelum aplikasi start (service `migrate` di compose):
//   node dist/db/migrate.js up      pasang semua migrasi yang belum terpasang
//   node dist/db/migrate.js down    batalkan satu migrasi terakhir
// DATABASE_URL di sini memakai peran pemilik skema, bukan peran aplikasi.
import { buatPool } from './pool.js';
import { jalankanMigrasi } from './jalankan-migrasi.js';

const perintah = process.argv[2];
if (perintah !== 'up' && perintah !== 'down') {
  console.error('Pemakaian: node dist/db/migrate.js up|down');
  process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL wajib diisi');
  process.exit(2);
}

const pool = buatPool(url, 1);
try {
  const hasil = await jalankanMigrasi(pool, perintah === 'up' ? 'naik' : 'turun');
  if (perintah === 'up') {
    console.log(hasil.diterapkan.length ? `Migrasi dipasang: ${hasil.diterapkan.join(', ')}` : 'Skema sudah terbaru');
  } else {
    console.log(hasil.dibatalkan.length ? `Migrasi dibatalkan: ${hasil.dibatalkan.join(', ')}` : 'Tidak ada migrasi untuk dibatalkan');
  }
} catch (e) {
  console.error(`GAGAL: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
