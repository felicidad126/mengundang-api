import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { acaraUji, aplikasiUji, ASAL, kosongkan, poolAplikasi, poolPemilik } from './bantu.js';

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

const kirim = (slug: string, body: object, headers: Record<string, string> = { origin: ASAL }) =>
  app.inject({ method: 'POST', url: `/api/acara/${slug}/ucapan`, payload: body, headers });

describe('POST /api/acara/:slug/ucapan', () => {
  it('menyimpan ucapan yang sudah dirapikan lalu menampilkannya', async () => {
    await acaraUji(pemilik);
    const res = await kirim('laras-bima', { nama: '  Budi\u202E  Santoso ', pesan: 'Selamat ya!\r\n\r\n\r\n\r\nSemoga  bahagia. ' });
    expect(res.statusCode).toBe(201);
    expect(res.json().ucapan).toMatchObject({ nama: 'Budi Santoso', pesan: 'Selamat ya!\n\nSemoga bahagia.' });
    expect(res.headers['cache-control']).toBe('no-store');

    const daftar = await app.inject({ method: 'GET', url: '/api/acara/laras-bima/ucapan' });
    expect(daftar.statusCode).toBe(200);
    expect(daftar.json()).toMatchObject({ jumlah: 1, berikutnya: null, ucapan: [{ nama: 'Budi Santoso' }] });
  });

  it('menolak isian kosong, terlalu panjang, atau bukan JSON', async () => {
    await acaraUji(pemilik);
    expect((await kirim('laras-bima', { nama: '   ', pesan: 'Halo' })).json()).toMatchObject({ galat: 'tidak_valid', kolom: 'nama' });
    expect((await kirim('laras-bima', { nama: 'Budi', pesan: '\n \n' })).json()).toMatchObject({ kolom: 'pesan' });
    expect((await kirim('laras-bima', { nama: 'Budi', pesan: 'x'.repeat(501) })).statusCode).toBe(400);
    expect((await kirim('laras-bima', { nama: 'B'.repeat(81), pesan: 'Halo' })).statusCode).toBe(400);
    const teks = await app.inject({
      method: 'POST',
      url: '/api/acara/laras-bima/ucapan',
      payload: 'nama=Budi&pesan=Halo',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ASAL },
    });
    expect(teks.statusCode).toBe(415);
    expect((await pemilik.query('SELECT count(*)::int AS n FROM ucapan')).rows[0].n).toBe(0);
  });

  it('menolak origin lain, tetapi menerima permintaan tanpa Origin', async () => {
    await acaraUji(pemilik);
    const lain = await kirim('laras-bima', { nama: 'Budi', pesan: 'Halo' }, { origin: 'https://contoh.com' });
    expect(lain.statusCode).toBe(403);
    expect(lain.json().galat).toBe('asal_ditolak');
    expect((await kirim('laras-bima', { nama: 'Budi', pesan: 'Halo' }, {})).statusCode).toBe(201);
  });

  it('pura-pura menerima isian kolom jebakan tanpa menyimpannya', async () => {
    await acaraUji(pemilik);
    const res = await kirim('laras-bima', { nama: 'Bot', pesan: 'Beli sekarang', situs: 'http://spam' });
    expect(res.statusCode).toBe(201);
    expect((await pemilik.query('SELECT count(*)::int AS n FROM ucapan')).rows[0].n).toBe(0);
  });

  it('404 untuk acara yang tidak ada, 400 untuk slug tidak valid', async () => {
    expect((await kirim('tidak-ada', { nama: 'Budi', pesan: 'Halo' })).statusCode).toBe(404);
    expect((await kirim('Huruf_Besar', { nama: 'Budi', pesan: 'Halo' })).statusCode).toBe(400);
  });

  it('410 setelah masa retensi acara lewat', async () => {
    await acaraUji(pemilik, { hariLagi: -91 });
    const res = await kirim('laras-bima', { nama: 'Budi', pesan: 'Halo' });
    expect(res.statusCode).toBe(410);
    expect(res.json().galat).toBe('acara_selesai');
  });
});

describe('GET /api/acara/:slug/ucapan', () => {
  it('terbaru dulu, berhalaman, dan tanpa ucapan yang disembunyikan atau milik acara lain', async () => {
    const id = await acaraUji(pemilik);
    const lain = await acaraUji(pemilik, { slug: 'acara-lain' });
    for (let i = 1; i <= 5; i++) {
      await pemilik.query('INSERT INTO ucapan (acara_id, nama, pesan) VALUES ($1, $2, $3)', [id, `Tamu ${i}`, `Pesan ${i}`]);
    }
    await pemilik.query("INSERT INTO ucapan (acara_id, nama, pesan, tampil) VALUES ($1, 'Spam', 'x', false)", [id]);
    await pemilik.query("INSERT INTO ucapan (acara_id, nama, pesan) VALUES ($1, 'Tamu lain', 'y')", [lain]);

    const hal1 = (await app.inject({ method: 'GET', url: '/api/acara/laras-bima/ucapan?batas=2' })).json();
    expect(hal1.jumlah).toBe(5);
    expect(hal1.ucapan.map((u: { nama: string }) => u.nama)).toEqual(['Tamu 5', 'Tamu 4']);
    const hal2 = (await app.inject({ method: 'GET', url: `/api/acara/laras-bima/ucapan?batas=2&sebelum=${hal1.berikutnya}` })).json();
    expect(hal2.ucapan.map((u: { nama: string }) => u.nama)).toEqual(['Tamu 3', 'Tamu 2']);
    const hal3 = (await app.inject({ method: 'GET', url: `/api/acara/laras-bima/ucapan?batas=2&sebelum=${hal2.berikutnya}` })).json();
    expect(hal3.ucapan.map((u: { nama: string }) => u.nama)).toEqual(['Tamu 1']);
    expect(hal3.berikutnya).toBeNull();
    expect(Object.keys(hal1.ucapan[0]).sort()).toEqual(['dibuat', 'id', 'nama', 'pesan']);
  });

  it('batas di luar 1–50 ditolak', async () => {
    await acaraUji(pemilik);
    expect((await app.inject({ method: 'GET', url: '/api/acara/laras-bima/ucapan?batas=51' })).statusCode).toBe(400);
  });
});
