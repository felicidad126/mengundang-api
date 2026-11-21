// Langkah migrasi, dijalankan sebelum aplikasi start (service `migrate` di compose):
//   node dist/db/migrate.js up
//       pasang semua migrasi yang belum terpasang
//   node dist/db/migrate.js down --konfirmasi <versi> [--hapus-semua-data]
//       batalkan satu migrasi terakhir; versinya wajib disebut persis, dan bila pembatalan itu
//       ikut menghapus data yang masih ada, --hapus-semua-data wajib (backup dulu)
// DATABASE_URL di sini memakai peran pemilik skema, bukan peran aplikasi.
import { parseArgs } from 'node:util';
import { jalankanMigrasi, MigrasiDitolak } from './jalankan-migrasi.js';
import { buatPool } from './pool.js';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    konfirmasi: { type: 'string' },
    'hapus-semua-data': { type: 'boolean', default: false },
  },
});
const perintah = positionals[0];
if ((perintah !== 'up' && perintah !== 'down') || positionals.length > 1) {
  console.error('Pemakaian: node dist/db/migrate.js up | down --konfirmasi <versi> [--hapus-semua-data]');
  process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL wajib diisi');
  process.exit(2);
}

// Migrasi boleh lama (tabel besar kelak); batas query jauh lebih longgar daripada API.
const pool = buatPool(url, { max: 1, batasQueryMs: 600_000 });
try {
  if (perintah === 'up') {
    const hasil = await jalankanMigrasi(pool, 'naik');
    console.log(hasil.diterapkan.length ? `Migrasi dipasang: ${hasil.diterapkan.join(', ')}` : 'Skema sudah terbaru');
  } else {
    const hasil = await jalankanMigrasi(pool, 'turun', undefined, {
      konfirmasi: values.konfirmasi,
      hapusSemuaData: values['hapus-semua-data'],
    });
    console.log(hasil.dibatalkan.length ? `Migrasi dibatalkan: ${hasil.dibatalkan.join(', ')}` : 'Tidak ada migrasi untuk dibatalkan');
  }
} catch (e) {
  console.error(`${e instanceof MigrasiDitolak ? 'DITOLAK' : 'GAGAL'}: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
