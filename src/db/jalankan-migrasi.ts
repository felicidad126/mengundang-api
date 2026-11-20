import type pg from 'pg';
import { MIGRASI, type Migrasi } from './migrasi.js';

// Kunci advisory: dua proses migrasi yang jalan bersamaan tidak saling menimpa.
const KUNCI_MIGRASI = 727_001;

export type Arah = 'naik' | 'turun';

export interface HasilMigrasi {
  diterapkan: string[];
  dibatalkan: string[];
}

async function versiTerpasang(client: pg.PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ versi: string }>('SELECT versi FROM skema_migrasi ORDER BY versi');
  return rows.map((r) => r.versi);
}

/**
 * `naik`: memasang semua migrasi yang belum terpasang, masing-masing dalam transaksinya sendiri.
 * `turun`: membatalkan satu migrasi terakhir.
 * Menolak bekerja bila database berisi versi yang tidak dikenal kode ini (database lebih baru).
 */
export async function jalankanMigrasi(
  pool: pg.Pool,
  arah: Arah,
  daftar: readonly Migrasi[] = MIGRASI,
): Promise<HasilMigrasi> {
  const client = await pool.connect();
  const hasil: HasilMigrasi = { diterapkan: [], dibatalkan: [] };
  try {
    await client.query('SELECT pg_advisory_lock($1)', [KUNCI_MIGRASI]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS skema_migrasi (
        versi text PRIMARY KEY,
        diterapkan timestamptz NOT NULL DEFAULT now()
      )`);
    const terpasang = await versiTerpasang(client);
    const dikenal = new Set(daftar.map((m) => m.versi));
    const asing = terpasang.filter((v) => !dikenal.has(v));
    if (asing.length > 0) {
      throw new Error(`database berisi migrasi yang tidak dikenal kode ini: ${asing.join(', ')}`);
    }

    if (arah === 'naik') {
      for (const m of daftar) {
        if (terpasang.includes(m.versi)) continue;
        await client.query('BEGIN');
        try {
          await client.query(m.naik);
          await client.query('INSERT INTO skema_migrasi (versi) VALUES ($1)', [m.versi]);
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw new Error(`migrasi ${m.versi} gagal: ${(e as Error).message}`, { cause: e });
        }
        hasil.diterapkan.push(m.versi);
      }
    } else {
      const terakhir = terpasang.at(-1);
      const m = daftar.find((x) => x.versi === terakhir);
      if (m) {
        await client.query('BEGIN');
        try {
          await client.query(m.turun);
          await client.query('DELETE FROM skema_migrasi WHERE versi = $1', [m.versi]);
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw new Error(`pembatalan ${m.versi} gagal: ${(e as Error).message}`, { cause: e });
        }
        hasil.dibatalkan.push(m.versi);
      }
    }
    return hasil;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [KUNCI_MIGRASI]).catch(() => undefined);
    client.release();
  }
}
