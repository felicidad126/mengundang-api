// Daftar migrasi, eksplisit dan berurutan. Setiap migrasi punya jalur turun.
// Jangan ubah migrasi yang sudah terpasang di server; tambahkan migrasi baru.

export interface Migrasi {
  versi: string;
  naik: string;
  turun: string;
  /**
   * Query yang menghasilkan satu kolom angka: jumlah baris data yang ikut hilang bila migrasi ini
   * dibatalkan. Bila lebih dari 0, `down` menolak kecuali diberi --hapus-semua-data.
   */
  dataHilang?: string;
}

export const MIGRASI: readonly Migrasi[] = [
  {
    versi: '0001_awal',
    naik: /* sql */ `
      -- Peran aplikasi: hanya membaca acara dan mengelola RSVP/ucapan, tidak bisa mengubah skema.
      -- Di server peran ini dibuat dengan LOGIN dan kata sandi oleh deploy/postgres/init;
      -- di tempat lain (uji, CI) dibuat di sini tanpa LOGIN.
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'mengundang_app') THEN
          CREATE ROLE mengundang_app NOLOGIN;
        END IF;
      END
      $$;

      CREATE TABLE acara (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$'),
        nama text NOT NULL CHECK (char_length(nama) BETWEEN 1 AND 120),
        tanggal_acara date NOT NULL,
        batas_rsvp timestamptz,
        dibuat timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE rsvp (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        acara_id bigint NOT NULL REFERENCES acara (id) ON DELETE CASCADE,
        perangkat_id uuid NOT NULL,
        nama text NOT NULL CHECK (char_length(nama) BETWEEN 1 AND 80),
        kehadiran text NOT NULL CHECK (kehadiran IN ('hadir', 'tidak', 'ragu')),
        jumlah smallint CHECK (jumlah BETWEEN 1 AND 10),
        telepon text CHECK (telepon ~ '^[0-9]{8,16}$'),
        pesan text CHECK (char_length(pesan) <= 500),
        dibuat timestamptz NOT NULL DEFAULT now(),
        diperbarui timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT rsvp_satu_per_perangkat UNIQUE (acara_id, perangkat_id),
        CONSTRAINT rsvp_tidak_hadir_tanpa_jumlah CHECK (kehadiran <> 'tidak' OR jumlah IS NULL)
      );
      -- Batas RSVP baru per acara per jam dan pembersihan per rentang waktu.
      CREATE INDEX rsvp_per_acara_waktu ON rsvp (acara_id, dibuat);

      CREATE TABLE ucapan (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        acara_id bigint NOT NULL REFERENCES acara (id) ON DELETE CASCADE,
        nama text NOT NULL CHECK (char_length(nama) BETWEEN 1 AND 80),
        pesan text NOT NULL CHECK (char_length(pesan) BETWEEN 1 AND 500),
        tampil boolean NOT NULL DEFAULT true,
        dibuat timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX ucapan_tampil_per_acara ON ucapan (acara_id, id DESC) WHERE tampil;
      -- Batas ucapan per acara per jam, ucapan ganda, dan pembersihan per rentang waktu.
      CREATE INDEX ucapan_per_acara_waktu ON ucapan (acara_id, dibuat);

      GRANT USAGE ON SCHEMA public TO mengundang_app;
      GRANT SELECT ON acara TO mengundang_app;
      -- RSVP diperbarui (kirim ulang dari perangkat yang sama); ucapan tidak pernah diubah API.
      -- DELETE untuk retensi harian.
      GRANT SELECT, INSERT, UPDATE, DELETE ON rsvp TO mengundang_app;
      GRANT SELECT, INSERT, DELETE ON ucapan TO mengundang_app;
    `,
    turun: /* sql */ `
      -- Peran mengundang_app sengaja tidak dihapus: berlaku untuk seluruh server database
      -- dan kata sandinya dikelola di luar migrasi.
      DROP TABLE ucapan;
      DROP TABLE rsvp;
      DROP TABLE acara;
      REVOKE USAGE ON SCHEMA public FROM mengundang_app;
    `,
    dataHilang: /* sql */ `
      SELECT (SELECT count(*) FROM acara) + (SELECT count(*) FROM rsvp) + (SELECT count(*) FROM ucapan) AS n
    `,
  },
];
