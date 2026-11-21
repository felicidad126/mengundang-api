import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { acaraUji, aplikasiUji, ASAL, kosongkan, PERANGKAT_A, PERANGKAT_B, poolAplikasi, poolPemilik } from './bantu.js';

const pemilik = poolPemilik();
const pool = poolAplikasi();
const app = aplikasiUji(pool);

afterAll(async () => {
  await app.close();
  await pool.end();
  await pemilik.end();
});

beforeEach(async () => {
  await kosongkan(pemilik);
});

const kirim = (body: object, slug = 'laras-bima') =>
  app.inject({ method: 'PUT', url: `/api/acara/${slug}/rsvp`, payload: body, headers: { origin: ASAL } });

const semuaRsvp = async () =>
  (await pemilik.query('SELECT perangkat_id, nama, kehadiran, jumlah, telepon, pesan FROM rsvp ORDER BY id')).rows;

describe('PUT /api/acara/:slug/rsvp', () => {
  it('jawaban baru lalu diperbarui dari perangkat yang sama, bukan digandakan', async () => {
    await acaraUji(pemilik);
    const a = await kirim({ perangkat_id: PERANGKAT_A, nama: 'Budi', kehadiran: 'hadir', jumlah: 2, telepon: '0812-3456-7890' });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ baru: true, rsvp: { nama: 'Budi', kehadiran: 'hadir', jumlah: 2 } });

    const b = await kirim({ perangkat_id: PERANGKAT_A.toUpperCase(), nama: 'Budi S.', kehadiran: 'tidak', jumlah: 3, pesan: '  Maaf  ' });
    expect(b.json()).toMatchObject({ baru: false, rsvp: { kehadiran: 'tidak', jumlah: null } });

    await kirim({ perangkat_id: PERANGKAT_B, nama: 'Sari', kehadiran: 'ragu' });
    expect(await semuaRsvp()).toEqual([
      { perangkat_id: PERANGKAT_A, nama: 'Budi S.', kehadiran: 'tidak', jumlah: null, telepon: null, pesan: 'Maaf' },
      { perangkat_id: PERANGKAT_B, nama: 'Sari', kehadiran: 'ragu', jumlah: null, telepon: null, pesan: null },
    ]);
  });

  it('nomor WhatsApp dinormalisasi ke kode negara, yang tidak valid ditolak', async () => {
    await acaraUji(pemilik);
    await kirim({ perangkat_id: PERANGKAT_A, nama: 'Budi', kehadiran: 'hadir', telepon: '+62 812 3456 7890' });
    expect((await semuaRsvp())[0]?.telepon).toBe('6281234567890');
    const salah = await kirim({ perangkat_id: PERANGKAT_B, nama: 'Sari', kehadiran: 'hadir', telepon: '12ab' });
    expect(salah.statusCode).toBe(400);
    expect(salah.json().kolom).toBe('telepon');
  });

  it('menolak isian tidak valid', async () => {
    await acaraUji(pemilik);
    for (const body of [
      { perangkat_id: 'bukan-uuid', nama: 'Budi', kehadiran: 'hadir' },
      { perangkat_id: PERANGKAT_A, nama: 'Budi', kehadiran: 'mungkin' },
      { perangkat_id: PERANGKAT_A, nama: 'Budi', kehadiran: 'hadir', jumlah: 11 },
      { perangkat_id: PERANGKAT_A, nama: '', kehadiran: 'hadir' },
      { perangkat_id: PERANGKAT_A, kehadiran: 'hadir' },
    ]) {
      expect((await kirim(body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(await semuaRsvp()).toEqual([]);
  });

  it('ditutup setelah batas RSVP atau setelah masa retensi', async () => {
    await acaraUji(pemilik, { batasRsvp: new Date(Date.now() - 1000) });
    await acaraUji(pemilik, { slug: 'sudah-lama', hariLagi: -100 });
    for (const slug of ['laras-bima', 'sudah-lama']) {
      const res = await kirim({ perangkat_id: PERANGKAT_A, nama: 'Budi', kehadiran: 'hadir' }, slug);
      expect(res.statusCode).toBe(403);
      expect(res.json().galat).toBe('rsvp_ditutup');
    }
  });

  it('masih dibuka sebelum batas RSVP; 404 untuk acara yang tidak ada', async () => {
    await acaraUji(pemilik, { batasRsvp: new Date(Date.now() + 60_000) });
    expect((await kirim({ perangkat_id: PERANGKAT_A, nama: 'Budi', kehadiran: 'hadir' })).statusCode).toBe(200);
    expect((await kirim({ perangkat_id: PERANGKAT_A, nama: 'Budi', kehadiran: 'hadir' }, 'tidak-ada')).statusCode).toBe(404);
  });

  it('batas RSVP baru per acara per jam; memperbarui jawaban tetap boleh', async () => {
    await acaraUji(pemilik);
    const kecil = aplikasiUji(pool, { batasRsvpBaruPerJam: 2 });
    const kirimKecil = (perangkat_id: string, kehadiran = 'hadir') =>
      kecil.inject({ method: 'PUT', url: '/api/acara/laras-bima/rsvp', payload: { perangkat_id, nama: 'Tamu', kehadiran, jumlah: 10 }, headers: { origin: ASAL } });
    expect((await kirimKecil(PERANGKAT_A)).statusCode).toBe(200);
    expect((await kirimKecil(PERANGKAT_B)).statusCode).toBe(200);
    const ditolak = await kirimKecil('00000000-0000-4000-8000-000000000003');
    expect(ditolak.statusCode).toBe(429);
    expect(ditolak.json().galat).toBe('terlalu_banyak');
    expect((await kirimKecil(PERANGKAT_A, 'tidak')).statusCode).toBe(200);
    expect(await semuaRsvp()).toHaveLength(2);
    await kecil.close();
  });

  it('pura-pura menerima isian kolom jebakan tanpa menyimpannya', async () => {
    await acaraUji(pemilik);
    const res = await kirim({ perangkat_id: PERANGKAT_A, nama: 'Bot', kehadiran: 'hadir', situs: 'x' });
    expect(res.statusCode).toBe(200);
    expect(await semuaRsvp()).toEqual([]);
  });
});
