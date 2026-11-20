import type pg from 'pg';
import { buatAplikasi } from '../src/app.js';
import { buatPool } from '../src/db/pool.js';

export const ASAL = 'https://invitation.helonoia.com';

export function urlUji(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL wajib diisi');
  return url;
}

/** Pemilik skema (seperti service migrate dan admin). */
export const poolPemilik = () => buatPool(urlUji(), 2);
/** Peran aplikasi, sama dengan service api di server. */
export const poolAplikasi = () => buatPool(urlUji(), 4, 'mengundang_app');

export async function kosongkan(pool: pg.Pool) {
  await pool.query('TRUNCATE acara RESTART IDENTITY CASCADE');
}

/** Tanggal YYYY-MM-DD, `hari` hari dari hari ini (UTC). */
export function tanggal(hari: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + hari);
  return d.toISOString().slice(0, 10);
}

export async function acaraUji(
  pemilik: pg.Pool,
  { slug = 'laras-bima', hariLagi = 30, batasRsvp = null as Date | null } = {},
): Promise<number> {
  const { rows } = await pemilik.query<{ id: number }>(
    'INSERT INTO acara (slug, nama, tanggal_acara, batas_rsvp) VALUES ($1, $2, $3, $4) RETURNING id',
    [slug, 'Laras & Bima', tanggal(hariLagi), batasRsvp],
  );
  return rows[0]!.id;
}

export function aplikasiUji(pool: pg.Pool) {
  return buatAplikasi({
    pool,
    konfigurasi: { lingkungan: 'test', logLevel: 'silent', asalDiizinkan: [ASAL], retensiHari: 90 },
  });
}

export const PERANGKAT_A = '3f2b7c1e-8d4a-4b6f-9c2e-1a5d7e9f0b3c';
export const PERANGKAT_B = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
