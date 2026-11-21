import pg from 'pg';

// Kolom bigint (id) dikembalikan pg sebagai string; nilainya jauh di bawah 2^53, jadi aman
// diubah ke number supaya JSON berisi angka.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
// Kolom date dikembalikan apa adanya (YYYY-MM-DD), tanpa diubah ke Date berzona waktu.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export interface OpsiPool {
  max?: number;
  /** Jalankan sesi sebagai peran lain (SET ROLE saat koneksi dibuka); dipakai uji. */
  peran?: string;
  /**
   * Batas waktu satu query (statement_timeout). Bawaan 5 detik untuk API; migrasi dan perintah
   * admin memakai batas lebih longgar. 0 = tanpa batas.
   */
  batasQueryMs?: number;
}

export function buatPool(connectionString: string, { max = 10, peran, batasQueryMs = 5000 }: OpsiPool = {}): pg.Pool {
  if (peran !== undefined && !/^[a-z_][a-z0-9_]*$/.test(peran)) throw new Error(`nama peran tidak valid: ${peran}`);
  if (!Number.isInteger(batasQueryMs) || batasQueryMs < 0) throw new Error('batasQueryMs harus bilangan bulat >= 0');
  return new pg.Pool({
    connectionString,
    max,
    // Sesi dipaksa UTC; query yang macet dihentikan, bukan menahan koneksi selamanya.
    options: [
      '-c TimeZone=UTC',
      `-c statement_timeout=${batasQueryMs}`,
      '-c idle_in_transaction_session_timeout=10000',
      ...(peran ? [`-c role=${peran}`] : []),
    ].join(' '),
    connectionTimeoutMillis: 5000,
  });
}
