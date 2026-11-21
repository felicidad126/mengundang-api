import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { cariAcara, POLA_SLUG } from '../acara.js';
import { kirimGalat, kirimTerlaluBanyak } from '../galat.js';
import { normalisasiTelepon, rapikanPesan, rapikanSatuBaris } from '../teks.js';

interface Opsi {
  pool: pg.Pool;
  retensiHari: number;
  /** RSVP dari perangkat baru per acara per jam; memperbarui jawaban tidak dihitung. */
  batasBaruPerJam: number;
}

type Kehadiran = 'hadir' | 'tidak' | 'ragu';

interface BodyRsvp {
  perangkat_id: string;
  nama: string;
  kehadiran: Kehadiran;
  jumlah?: number;
  telepon?: string;
  pesan?: string;
  situs?: string;
}

const POLA_UUID = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

export async function ruteRsvp(app: FastifyInstance, { pool, retensiHari, batasBaruPerJam }: Opsi) {
  // PUT: satu jawaban per perangkat per acara. Mengirim ulang dari HP yang sama memperbarui
  // jawaban sebelumnya, bukan menambah baris baru.
  app.put<{ Params: { slug: string }; Body: BodyRsvp }>(
    '/acara/:slug/rsvp',
    {
      schema: {
        params: {
          type: 'object',
          required: ['slug'],
          properties: { slug: { type: 'string', pattern: POLA_SLUG } },
        },
        body: {
          type: 'object',
          required: ['perangkat_id', 'nama', 'kehadiran'],
          properties: {
            perangkat_id: { type: 'string', pattern: POLA_UUID },
            nama: { type: 'string', minLength: 1, maxLength: 80 },
            kehadiran: { type: 'string', enum: ['hadir', 'tidak', 'ragu'] },
            jumlah: { type: 'integer', minimum: 1, maximum: 10 },
            telepon: { type: 'string', maxLength: 24 },
            pesan: { type: 'string', maxLength: 500 },
            situs: { type: 'string', maxLength: 200 },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['rsvp', 'baru'],
            properties: {
              baru: { type: 'boolean' },
              rsvp: {
                type: 'object',
                required: ['nama', 'kehadiran', 'jumlah', 'diperbarui'],
                properties: {
                  nama: { type: 'string' },
                  kehadiran: { type: 'string' },
                  jumlah: { type: ['integer', 'null'] },
                  diperbarui: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const nama = rapikanSatuBaris(req.body.nama);
      if (!nama) return reply.code(400).send({ galat: 'tidak_valid', pesan: 'Nama wajib diisi.', kolom: 'nama' });
      const telepon = normalisasiTelepon(req.body.telepon);
      if (telepon === undefined) {
        return reply
          .code(400)
          .send({ galat: 'tidak_valid', pesan: 'Nomor WhatsApp tidak valid.', kolom: 'telepon' });
      }
      const pesan = req.body.pesan === undefined ? null : rapikanPesan(req.body.pesan) || null;
      const kehadiran = req.body.kehadiran;
      const jumlah = kehadiran === 'tidak' ? null : (req.body.jumlah ?? null);

      const acara = await cariAcara(pool, req.params.slug, retensiHari);
      if (!acara) return kirimGalat(reply, 404, 'acara_tidak_ditemukan', 'Acara tidak ditemukan.');
      if (acara.selesai || acara.rsvpDitutup) {
        return kirimGalat(reply, 403, 'rsvp_ditutup', 'Konfirmasi kehadiran untuk acara ini sudah ditutup.');
      }

      if (req.body.situs) {
        req.log.info('RSVP dari kolom jebakan diabaikan');
        return { baru: true, rsvp: { nama, kehadiran, jumlah, diperbarui: new Date() } };
      }

      const perangkatId = req.body.perangkat_id.toLowerCase();
      const { rows: hitung } = await pool.query<{ ada: boolean; sejam: number }>(
        `SELECT EXISTS (SELECT 1 FROM rsvp WHERE acara_id = $1 AND perangkat_id = $2) AS ada,
                (SELECT count(*)::int FROM rsvp WHERE acara_id = $1 AND dibuat > now() - interval '1 hour') AS sejam`,
        [acara.id, perangkatId],
      );
      if (!hitung[0]?.ada && (hitung[0]?.sejam ?? 0) >= batasBaruPerJam) {
        req.log.warn({ acara: req.params.slug, batasBaruPerJam }, 'batas RSVP baru per jam tercapai');
        return kirimTerlaluBanyak(reply, 'Sedang banyak sekali konfirmasi untuk undangan ini. Coba lagi beberapa menit lagi.');
      }

      const { rows } = await pool.query<{
        nama: string;
        kehadiran: Kehadiran;
        jumlah: number | null;
        diperbarui: Date;
        baru: boolean;
      }>(
        `INSERT INTO rsvp (acara_id, perangkat_id, nama, kehadiran, jumlah, telepon, pesan)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ON CONSTRAINT rsvp_satu_per_perangkat DO UPDATE
           SET nama = EXCLUDED.nama,
               kehadiran = EXCLUDED.kehadiran,
               jumlah = EXCLUDED.jumlah,
               telepon = EXCLUDED.telepon,
               pesan = EXCLUDED.pesan,
               diperbarui = now()
         RETURNING nama, kehadiran, jumlah, diperbarui, dibuat = diperbarui AS baru`,
        [acara.id, perangkatId, nama, kehadiran, jumlah, telepon, pesan],
      );
      const baris = rows[0]!;
      return {
        baru: baris.baru,
        rsvp: { nama: baris.nama, kehadiran: baris.kehadiran, jumlah: baris.jumlah, diperbarui: baris.diperbarui },
      };
    },
  );
}
