import type pg from 'pg';

export interface HasilRetensi {
  rsvp: number;
  ucapan: number;
}

/**
 * Menghapus RSVP dan ucapan milik acara yang tanggalnya sudah lewat lebih dari `hari` hari.
 * Baris acara sendiri tetap ada (data pemesanan, bukan data tamu).
 */
export async function hapusDataKedaluwarsa(pool: pg.Pool, hari: number): Promise<HasilRetensi> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const rsvp = await client.query(
      `DELETE FROM rsvp r USING acara a
        WHERE r.acara_id = a.id AND current_date > a.tanggal_acara + $1::int`,
      [hari],
    );
    const ucapan = await client.query(
      `DELETE FROM ucapan u USING acara a
        WHERE u.acara_id = a.id AND current_date > a.tanggal_acara + $1::int`,
      [hari],
    );
    await client.query('COMMIT');
    return { rsvp: rsvp.rowCount ?? 0, ucapan: ucapan.rowCount ?? 0 };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
