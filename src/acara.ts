import type pg from 'pg';

export const POLA_SLUG = '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$';

export interface StatusAcara {
  id: number;
  /** Lewat dari tanggal acara + masa retensi: tidak menerima data baru. */
  selesai: boolean;
  /** Lewat dari batas RSVP. */
  rsvpDitutup: boolean;
}

/** Status acara menurut jam database; null bila slug tidak ada. */
export async function cariAcara(pool: pg.Pool, slug: string, retensiHari: number): Promise<StatusAcara | null> {
  const { rows } = await pool.query<{ id: number; selesai: boolean; rsvp_ditutup: boolean }>(
    `SELECT id,
            current_date > tanggal_acara + $2::int AS selesai,
            coalesce(now() > batas_rsvp, false) AS rsvp_ditutup
       FROM acara
      WHERE slug = $1`,
    [slug, retensiHari],
  );
  const baris = rows[0];
  return baris ? { id: baris.id, selesai: baris.selesai, rsvpDitutup: baris.rsvp_ditutup } : null;
}
