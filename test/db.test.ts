import { afterAll, describe, expect, it } from 'vitest';
import { jalankanMigrasi, MigrasiDitolak } from '../src/db/jalankan-migrasi.js';
import { buatPool } from '../src/db/pool.js';
import { poolAplikasi, urlUji } from './bantu.js';

function urlDatabase(nama: string): string {
  const u = new URL(urlUji());
  u.pathname = `/${nama}`;
  return u.toString();
}

describe('migrasi', () => {
  it('naik, turun, lalu naik lagi di database kosong', async () => {
    const nama = `mengundang_uji_migrasi_${process.pid}`;
    const admin = buatPool(urlUji(), { max: 1 });
    await admin.query(`DROP DATABASE IF EXISTS ${nama}`);
    await admin.query(`CREATE DATABASE ${nama}`);
    const pool = buatPool(urlDatabase(nama), { max: 1 });
    const tabel = async () =>
      (
        await pool.query<{ t: string }>(
          "SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1",
        )
      ).rows.map((r) => r.t);
    try {
      expect((await jalankanMigrasi(pool, 'naik')).diterapkan).toEqual(['0001_awal']);
      expect(await tabel()).toEqual(['acara', 'rsvp', 'skema_migrasi', 'ucapan']);
      expect((await jalankanMigrasi(pool, 'naik')).diterapkan).toEqual([]);

      // Pengaman: tanpa konfirmasi atau dengan versi lain, ditolak dan skema utuh.
      await expect(jalankanMigrasi(pool, 'turun')).rejects.toThrow(MigrasiDitolak);
      await expect(jalankanMigrasi(pool, 'turun', undefined, { konfirmasi: '0002_lain' })).rejects.toThrow('--konfirmasi 0001_awal');
      // Masih ada data: ditolak tanpa --hapus-semua-data.
      await pool.query("INSERT INTO acara (slug, nama, tanggal_acara) VALUES ('ada-data', 'A', current_date)");
      await expect(jalankanMigrasi(pool, 'turun', undefined, { konfirmasi: '0001_awal' })).rejects.toThrow('1 baris data');
      expect(await tabel()).toEqual(['acara', 'rsvp', 'skema_migrasi', 'ucapan']);
      expect((await jalankanMigrasi(pool, 'turun', undefined, { konfirmasi: '0001_awal', hapusSemuaData: true })).dibatalkan).toEqual(['0001_awal']);
      expect(await tabel()).toEqual(['skema_migrasi']);
      expect((await jalankanMigrasi(pool, 'naik')).diterapkan).toEqual(['0001_awal']);

      await pool.query("INSERT INTO skema_migrasi (versi) VALUES ('9999_dari_masa_depan')");
      await expect(jalankanMigrasi(pool, 'naik')).rejects.toThrow('tidak dikenal');
    } finally {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${nama} WITH (FORCE)`);
      await admin.end();
    }
  });
});

describe('hak peran aplikasi (mengundang_app)', () => {
  const pool = poolAplikasi();
  afterAll(() => pool.end());

  it('boleh membaca acara dan menulis ucapan/RSVP', async () => {
    await expect(pool.query('SELECT count(*) FROM acara')).resolves.toBeTruthy();
    await expect(pool.query('SELECT count(*) FROM rsvp')).resolves.toBeTruthy();
  });

  it.each([
    ["INSERT INTO acara (slug, nama, tanggal_acara) VALUES ('x', 'x', current_date)", 'permission denied'],
    ['UPDATE acara SET nama = nama', 'permission denied'],
    ['DELETE FROM acara', 'permission denied'],
    ['UPDATE ucapan SET tampil = false', 'permission denied'],
    ['DROP TABLE ucapan', 'must be owner'],
    ['ALTER TABLE rsvp ADD COLUMN x int', 'must be owner'],
    ['CREATE TABLE coba (id int)', 'permission denied'],
    ['SELECT * FROM skema_migrasi', 'permission denied'],
  ])('ditolak: %s', async (sql, pesan) => {
    await expect(pool.query(sql)).rejects.toThrow(pesan);
  });
});
