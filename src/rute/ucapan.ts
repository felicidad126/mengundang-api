import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { cariAcara, POLA_SLUG } from '../acara.js';
import { kirimGalat, kirimTerlaluBanyak } from '../galat.js';
import { rapikanPesan, rapikanSatuBaris } from '../teks.js';

interface Opsi {
  pool: pg.Pool;
  retensiHari: number;
  /** Ucapan baru per acara per jam (termasuk yang kemudian disembunyikan). */
  batasPerJam: number;
}

const paramsSchema = {
  type: 'object',
  required: ['slug'],
  properties: { slug: { type: 'string', pattern: POLA_SLUG } },
} as const;

const ucapanSchema = {
  type: 'object',
  required: ['id', 'nama', 'pesan', 'dibuat'],
  properties: {
    id: { type: 'integer' },
    nama: { type: 'string' },
    pesan: { type: 'string' },
    dibuat: { type: 'string', format: 'date-time' },
  },
} as const;

interface BarisUcapan {
  id: number;
  nama: string;
  pesan: string;
  dibuat: Date;
}

export async function ruteUcapan(app: FastifyInstance, { pool, retensiHari, batasPerJam }: Opsi) {
  app.get<{ Params: { slug: string }; Querystring: { sebelum?: number; batas: number } }>(
    '/acara/:slug/ucapan',
    {
      schema: {
        params: paramsSchema,
        querystring: {
          type: 'object',
          properties: {
            // Batas atas: angka lebih besar lolos sebagai number tetapi meluap di bigint (galat 500).
            sebelum: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
            batas: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['ucapan', 'jumlah', 'berikutnya'],
            properties: {
              ucapan: { type: 'array', items: ucapanSchema },
              jumlah: { type: 'integer' },
              berikutnya: { type: ['integer', 'null'] },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const acara = await cariAcara(pool, req.params.slug, retensiHari);
      if (!acara) return kirimGalat(reply, 404, 'acara_tidak_ditemukan', 'Acara tidak ditemukan.');
      const { sebelum, batas } = req.query;
      const [daftar, total] = await Promise.all([
        pool.query<BarisUcapan>(
          `SELECT id, nama, pesan, dibuat
             FROM ucapan
            WHERE acara_id = $1 AND tampil AND ($2::bigint IS NULL OR id < $2)
            ORDER BY id DESC
            LIMIT $3`,
          [acara.id, sebelum ?? null, batas + 1],
        ),
        pool.query<{ jumlah: number }>('SELECT count(*)::int AS jumlah FROM ucapan WHERE acara_id = $1 AND tampil', [
          acara.id,
        ]),
      ]);
      const baris = daftar.rows.slice(0, batas);
      return {
        ucapan: baris,
        jumlah: total.rows[0]?.jumlah ?? 0,
        berikutnya: daftar.rows.length > batas ? (baris.at(-1)?.id ?? null) : null,
      };
    },
  );

  app.post<{ Params: { slug: string }; Body: { nama: string; pesan: string; situs?: string } }>(
    '/acara/:slug/ucapan',
    {
      schema: {
        params: paramsSchema,
        body: {
          type: 'object',
          required: ['nama', 'pesan'],
          properties: {
            nama: { type: 'string', minLength: 1, maxLength: 80 },
            pesan: { type: 'string', minLength: 1, maxLength: 500 },
            // Kolom jebakan: tidak terlihat oleh tamu, biasanya diisi bot.
            situs: { type: 'string', maxLength: 200 },
          },
        },
        response: { 201: { type: 'object', required: ['ucapan'], properties: { ucapan: ucapanSchema } } },
      },
    },
    async (req, reply) => {
      const nama = rapikanSatuBaris(req.body.nama);
      const pesan = rapikanPesan(req.body.pesan);
      if (!nama) return reply.code(400).send({ galat: 'tidak_valid', pesan: 'Nama wajib diisi.', kolom: 'nama' });
      if (!pesan) return reply.code(400).send({ galat: 'tidak_valid', pesan: 'Ucapan wajib diisi.', kolom: 'pesan' });

      const acara = await cariAcara(pool, req.params.slug, retensiHari);
      if (!acara) return kirimGalat(reply, 404, 'acara_tidak_ditemukan', 'Acara tidak ditemukan.');
      if (acara.selesai) return kirimGalat(reply, 410, 'acara_selesai', 'Buku ucapan untuk acara ini sudah ditutup.');

      if (req.body.situs) {
        // Bot: jawab seolah berhasil, tetapi tidak disimpan.
        req.log.info('ucapan dari kolom jebakan diabaikan');
        return reply.code(201).send({ ucapan: { id: 0, nama, pesan, dibuat: new Date() } });
      }

      // Ucapan sejam terakhir di acara ini: untuk batas per jam dan menolak ucapan ganda
      // (nama dan isi sama dalam 10 menit, mis. kirim dua kali atau bot yang mengulang).
      const { rows: hitung } = await pool.query<{ sejam: number; ganda: boolean | null }>(
        `SELECT count(*)::int AS sejam,
                bool_or(nama = $2 AND pesan = $3 AND dibuat > now() - interval '10 minutes') AS ganda
           FROM ucapan
          WHERE acara_id = $1 AND dibuat > now() - interval '1 hour'`,
        [acara.id, nama, pesan],
      );
      if (hitung[0]?.ganda) {
        return kirimGalat(reply, 409, 'ucapan_ganda', 'Ucapan yang sama baru saja terkirim. Terima kasih!');
      }
      if ((hitung[0]?.sejam ?? 0) >= batasPerJam) {
        req.log.warn({ acara: req.params.slug, batasPerJam }, 'batas ucapan per jam tercapai');
        return kirimTerlaluBanyak(reply, 'Sedang banyak sekali ucapan untuk undangan ini. Coba lagi beberapa menit lagi.');
      }

      const { rows } = await pool.query<BarisUcapan>(
        `INSERT INTO ucapan (acara_id, nama, pesan) VALUES ($1, $2, $3)
         RETURNING id, nama, pesan, dibuat`,
        [acara.id, nama, pesan],
      );
      return reply.code(201).send({ ucapan: rows[0] });
    },
  );
}
