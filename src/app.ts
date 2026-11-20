import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Konfigurasi } from './config.js';
import { kirimGalat } from './galat.js';
import { ruteHealth } from './rute/health.js';
import { ruteRsvp } from './rute/rsvp.js';
import { ruteUcapan } from './rute/ucapan.js';

export interface OpsiAplikasi {
  pool: pg.Pool;
  konfigurasi: Pick<Konfigurasi, 'lingkungan' | 'logLevel' | 'asalDiizinkan' | 'retensiHari'>;
}

const METODE_TULIS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function buatAplikasi({ pool, konfigurasi }: OpsiAplikasi): FastifyInstance {
  const app = Fastify({
    logger:
      konfigurasi.lingkungan === 'test'
        ? false
        : {
            level: konfigurasi.logLevel,
            redact: ['req.headers.cookie', 'req.headers.authorization'],
          },
    // Badan permintaan paling besar 8 KB (ucapan maks 500 karakter); nginx membatasi hal yang sama.
    bodyLimit: 8 * 1024,
    // Alamat IP tamu tidak dipakai dan tidak disimpan; pembatasan laju ada di nginx.
    trustProxy: false,
    routerOptions: { ignoreTrailingSlash: true },
  });

  // Hanya browser dari origin sendiri yang boleh menulis. Permintaan tanpa header Origin
  // (curl, pemeriksa kesehatan) tetap boleh; JSON wajib, jadi situs lain tidak bisa
  // mengirim form biasa ke API ini.
  app.addHook('onRequest', async (req, reply) => {
    if (!METODE_TULIS.has(req.method)) return;
    const origin = req.headers.origin;
    const bebas = konfigurasi.asalDiizinkan.length === 0 && konfigurasi.lingkungan !== 'production';
    if (origin && !bebas && !konfigurasi.asalDiizinkan.includes(origin)) {
      return kirimGalat(reply, 403, 'asal_ditolak', 'Permintaan dari situs ini tidak diizinkan.');
    }
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
  });

  app.setNotFoundHandler((_req, reply) => kirimGalat(reply, 404, 'tidak_ditemukan', 'Alamat tidak ditemukan.'));

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err.validation) {
      const kolom = err.validation[0]?.instancePath.replace(/^\//, '') || undefined;
      return reply.code(400).send({ galat: 'tidak_valid', pesan: 'Isian tidak valid.', kolom });
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return kirimGalat(reply, err.statusCode, 'permintaan_ditolak', err.message);
    }
    req.log.error({ err }, 'galat tak terduga');
    return kirimGalat(reply, 500, 'galat_server', 'Terjadi kesalahan di server. Coba lagi sebentar lagi.');
  });

  app.register(
    async (api) => {
      await ruteHealth(api, { pool });
      await ruteUcapan(api, { pool, retensiHari: konfigurasi.retensiHari });
      await ruteRsvp(api, { pool, retensiHari: konfigurasi.retensiHari });
    },
    { prefix: '/api' },
  );

  return app;
}
