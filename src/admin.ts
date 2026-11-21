// Pekerjaan admin Helonoia, dijalankan lewat src/cli.ts dengan peran pemilik database.
// Portal customer kelak memakai tabel yang sama.
import type pg from 'pg';
import { keCsv } from './csv.js';

const POLA_SLUG = /^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/;
const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

export class GalatAdmin extends Error {}

/** Zona waktu harus dikenal PostgreSQL (nama IANA, mis. Asia/Jakarta). */
export async function pastikanZona(pool: pg.Pool, zona: string): Promise<void> {
  const { rowCount } = await pool.query('SELECT 1 FROM pg_timezone_names WHERE name = $1', [zona]);
  if (!rowCount) throw new GalatAdmin(`zona waktu tidak dikenal: ${zona} (contoh: Asia/Jakarta, Asia/Makassar)`);
}

export interface AcaraBaru {
  slug: string;
  nama: string;
  /** YYYY-MM-DD */
  tanggal: string;
  /**
   * YYYY-MM-DD; RSVP ditutup setelah hari itu berakhir di zona acara. Bila kosong, RSVP ditutup
   * di akhir hari tanggal acara.
   */
  batasRsvp?: string;
  /** Zona waktu acara, mis. Asia/Jakarta (WIB), Asia/Makassar (WITA), Asia/Jayapura (WIT). */
  zona: string;
}

export async function buatAcara(pool: pg.Pool, a: AcaraBaru) {
  if (!POLA_SLUG.test(a.slug)) {
    throw new GalatAdmin('slug hanya huruf kecil, angka, dan tanda minus (2–50 karakter), mis. laras-bima');
  }
  if (!a.nama.trim()) throw new GalatAdmin('nama wajib diisi');
  if (!POLA_TANGGAL.test(a.tanggal)) throw new GalatAdmin('tanggal harus YYYY-MM-DD');
  if (a.batasRsvp !== undefined && !POLA_TANGGAL.test(a.batasRsvp)) {
    throw new GalatAdmin('batas RSVP harus YYYY-MM-DD');
  }
  if (a.batasRsvp !== undefined && a.batasRsvp > a.tanggal) {
    throw new GalatAdmin('batas RSVP tidak boleh setelah tanggal acara');
  }
  await pastikanZona(pool, a.zona);
  try {
    const { rows } = await pool.query<{ id: number; slug: string; nama: string; tanggal_acara: string; batas_rsvp: Date }>(
      `INSERT INTO acara (slug, nama, tanggal_acara, batas_rsvp)
       VALUES ($1, $2, $3::date, ($4::date + 1)::timestamp AT TIME ZONE $5)
       RETURNING id, slug, nama, tanggal_acara, batas_rsvp`,
      [a.slug, a.nama.trim(), a.tanggal, a.batasRsvp ?? a.tanggal, a.zona],
    );
    return rows[0]!;
  } catch (e) {
    const err = e as { code?: string; message: string };
    if (err.code === '23505') throw new GalatAdmin(`slug "${a.slug}" sudah dipakai`);
    if (err.code === '22007' || err.code === '22008') throw new GalatAdmin('tanggal tidak valid');
    throw e;
  }
}

export interface RingkasanAcara {
  slug: string;
  nama: string;
  tanggal_acara: string;
  batas_rsvp: Date | null;
  rsvp: number;
  hadir_orang: number;
  tidak: number;
  ragu: number;
  ucapan: number;
}

export async function daftarAcara(pool: pg.Pool): Promise<RingkasanAcara[]> {
  const { rows } = await pool.query<RingkasanAcara>(
    `SELECT a.slug, a.nama, a.tanggal_acara, a.batas_rsvp,
            count(r.id)::int AS rsvp,
            coalesce(sum(coalesce(r.jumlah, 1)) FILTER (WHERE r.kehadiran = 'hadir'), 0)::int AS hadir_orang,
            count(r.id) FILTER (WHERE r.kehadiran = 'tidak')::int AS tidak,
            count(r.id) FILTER (WHERE r.kehadiran = 'ragu')::int AS ragu,
            (SELECT count(*) FROM ucapan u WHERE u.acara_id = a.id)::int AS ucapan
       FROM acara a
       LEFT JOIN rsvp r ON r.acara_id = a.id
      GROUP BY a.id
      ORDER BY a.tanggal_acara DESC, a.slug`,
  );
  return rows;
}

async function idAcara(pool: pg.Pool, slug: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>('SELECT id FROM acara WHERE slug = $1', [slug]);
  if (!rows[0]) throw new GalatAdmin(`acara "${slug}" tidak ditemukan`);
  return rows[0].id;
}

const LABEL_KEHADIRAN: Record<string, string> = { hadir: 'Hadir', tidak: 'Tidak hadir', ragu: 'Masih ragu' };

export async function eksporRsvpCsv(pool: pg.Pool, slug: string, zona: string): Promise<string> {
  await pastikanZona(pool, zona);
  const id = await idAcara(pool, slug);
  const { rows } = await pool.query<{
    nama: string;
    kehadiran: string;
    jumlah: number | null;
    telepon: string | null;
    pesan: string | null;
    dikirim: string;
    diperbarui: string;
  }>(
    `SELECT nama, kehadiran, jumlah, telepon, pesan,
            to_char(dibuat AT TIME ZONE $2, 'YYYY-MM-DD HH24:MI') AS dikirim,
            to_char(diperbarui AT TIME ZONE $2, 'YYYY-MM-DD HH24:MI') AS diperbarui
       FROM rsvp
      WHERE acara_id = $1
      ORDER BY array_position(ARRAY['hadir', 'ragu', 'tidak'], kehadiran), lower(nama), id`,
    [id, zona],
  );
  return keCsv(
    ['Nama', 'Kehadiran', 'Jumlah', 'WhatsApp', 'Pesan', `Dikirim (${zona})`, `Diperbarui (${zona})`],
    rows.map((r) => [
      r.nama,
      LABEL_KEHADIRAN[r.kehadiran] ?? r.kehadiran,
      r.jumlah,
      r.telepon,
      r.pesan,
      r.dikirim,
      r.diperbarui,
    ]),
  );
}

export async function daftarUcapanAdmin(pool: pg.Pool, slug: string) {
  const id = await idAcara(pool, slug);
  const { rows } = await pool.query<{ id: number; nama: string; pesan: string; tampil: boolean; dibuat: Date }>(
    'SELECT id, nama, pesan, tampil, dibuat FROM ucapan WHERE acara_id = $1 ORDER BY id DESC',
    [id],
  );
  return rows;
}

/** Mengembalikan false bila ucapan tidak ada. */
export async function aturTampilUcapan(pool: pg.Pool, id: number, tampil: boolean): Promise<boolean> {
  const { rowCount } = await pool.query('UPDATE ucapan SET tampil = $2 WHERE id = $1', [id, tampil]);
  return (rowCount ?? 0) > 0;
}

// ---------- Pembersihan per rentang waktu (banjir spam) ----------

const POLA_WAKTU = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/;

export interface Rentang {
  /** "YYYY-MM-DD" atau "YYYY-MM-DD HH:MM" menurut `zona`; tanggal saja = pukul 00:00. */
  sejak: string;
  /** Tidak diisi = sampai sekarang. */
  sampai?: string;
  zona: string;
}

interface RentangUtc {
  sejak: Date;
  sampai: Date | null;
}

/** Mengubah rentang waktu lokal ke UTC dan memeriksanya. */
async function rentangUtc(pool: pg.Pool, r: Rentang): Promise<RentangUtc> {
  for (const [nama, nilai] of [['--sejak', r.sejak], ['--sampai', r.sampai]] as const) {
    if (nilai !== undefined && !POLA_WAKTU.test(nilai)) throw new GalatAdmin(`${nama} harus "YYYY-MM-DD" atau "YYYY-MM-DD HH:MM"`);
  }
  await pastikanZona(pool, r.zona);
  try {
    const { rows } = await pool.query<{ sejak: Date; sampai: Date | null }>(
      'SELECT $1::timestamp AT TIME ZONE $3 AS sejak, $2::timestamp AT TIME ZONE $3 AS sampai',
      [r.sejak, r.sampai ?? null, r.zona],
    );
    const hasil = rows[0]!;
    if (hasil.sampai && hasil.sampai <= hasil.sejak) throw new GalatAdmin('--sampai harus setelah --sejak');
    return hasil;
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === '22007' || err.code === '22008') throw new GalatAdmin('waktu tidak valid');
    throw e;
  }
}

/** Sembunyikan (atau tampilkan lagi) semua ucapan satu acara yang masuk dalam rentang waktu. */
export async function aturTampilUcapanRentang(pool: pg.Pool, slug: string, r: Rentang, tampil: boolean): Promise<number> {
  const id = await idAcara(pool, slug);
  const { sejak, sampai } = await rentangUtc(pool, r);
  const { rowCount } = await pool.query(
    `UPDATE ucapan SET tampil = $4
      WHERE acara_id = $1 AND dibuat >= $2 AND ($3::timestamptz IS NULL OR dibuat < $3) AND tampil <> $4`,
    [id, sejak, sampai, tampil],
  );
  return rowCount ?? 0;
}

export async function daftarRsvpAdmin(pool: pg.Pool, slug: string) {
  const id = await idAcara(pool, slug);
  const { rows } = await pool.query<{ id: number; nama: string; kehadiran: string; jumlah: number | null; dibuat: Date }>(
    'SELECT id, nama, kehadiran, jumlah, dibuat FROM rsvp WHERE acara_id = $1 ORDER BY id DESC',
    [id],
  );
  return rows;
}

/** Mengembalikan false bila RSVP tidak ada. */
export async function hapusRsvp(pool: pg.Pool, id: number): Promise<boolean> {
  const { rowCount } = await pool.query('DELETE FROM rsvp WHERE id = $1', [id]);
  return (rowCount ?? 0) > 0;
}

/**
 * RSVP satu acara yang pertama kali masuk dalam rentang waktu. Tanpa `jalankan`, hanya menghitung
 * (supaya admin melihat dulu berapa yang akan hilang); dengan `jalankan`, menghapusnya.
 */
export async function hapusRsvpRentang(
  pool: pg.Pool,
  slug: string,
  r: Rentang,
  jalankan: boolean,
): Promise<{ jumlah: number; dihapus: boolean }> {
  const id = await idAcara(pool, slug);
  const { sejak, sampai } = await rentangUtc(pool, r);
  const syarat = 'acara_id = $1 AND dibuat >= $2 AND ($3::timestamptz IS NULL OR dibuat < $3)';
  if (!jalankan) {
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM rsvp WHERE ${syarat}`, [id, sejak, sampai]);
    return { jumlah: rows[0]?.n ?? 0, dihapus: false };
  }
  const { rowCount } = await pool.query(`DELETE FROM rsvp WHERE ${syarat}`, [id, sejak, sampai]);
  return { jumlah: rowCount ?? 0, dihapus: true };
}

/** Menghapus acara beserta semua RSVP dan ucapannya. `konfirmasi` harus sama persis dengan slug. */
export async function hapusAcara(pool: pg.Pool, slug: string, konfirmasi: string | undefined) {
  if (konfirmasi !== slug) {
    throw new GalatAdmin(`menghapus acara ikut menghapus semua RSVP dan ucapannya; ulangi slug-nya persis: --konfirmasi ${slug}`);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: number; rsvp: number; ucapan: number }>(
      `SELECT a.id,
              (SELECT count(*)::int FROM rsvp r WHERE r.acara_id = a.id) AS rsvp,
              (SELECT count(*)::int FROM ucapan u WHERE u.acara_id = a.id) AS ucapan
         FROM acara a WHERE a.slug = $1 FOR UPDATE`,
      [slug],
    );
    const a = rows[0];
    if (!a) throw new GalatAdmin(`acara "${slug}" tidak ditemukan`);
    await client.query('DELETE FROM acara WHERE id = $1', [a.id]);
    await client.query('COMMIT');
    return { rsvp: a.rsvp, ucapan: a.ucapan };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
