import { buatAplikasi } from './app.js';
import { bacaKonfigurasi } from './config.js';
import { buatPool } from './db/pool.js';
import { hapusDataKedaluwarsa } from './retensi.js';

const konfigurasi = bacaKonfigurasi();
const pool = buatPool(konfigurasi.databaseUrl);
const app = buatAplikasi({ pool, konfigurasi });

pool.on('error', (err) => app.log.error({ err }, 'koneksi database idle terputus'));

// Retensi data tamu: sekali tak lama setelah start, lalu setiap 24 jam.
const SEHARI = 24 * 60 * 60 * 1000;
async function jalankanRetensi() {
  try {
    const hasil = await hapusDataKedaluwarsa(pool, konfigurasi.retensiHari);
    app.log.info({ retensiHari: konfigurasi.retensiHari, ...hasil }, 'retensi data tamu selesai');
  } catch (err) {
    app.log.error({ err }, 'retensi data tamu gagal; dicoba lagi besok');
  }
}
const pewaktuAwal = setTimeout(jalankanRetensi, 60_000);
const pewaktuHarian = setInterval(jalankanRetensi, SEHARI);
pewaktuAwal.unref();
pewaktuHarian.unref();

let berhenti = false;
async function hentikan(sinyal: string) {
  if (berhenti) return;
  berhenti = true;
  app.log.info({ sinyal }, 'menghentikan aplikasi');
  clearTimeout(pewaktuAwal);
  clearInterval(pewaktuHarian);
  await app.close();
  await pool.end();
}
process.on('SIGTERM', () => void hentikan('SIGTERM'));
process.on('SIGINT', () => void hentikan('SIGINT'));

await app.listen({ host: konfigurasi.host, port: konfigurasi.port });
