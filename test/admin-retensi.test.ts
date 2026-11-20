import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { aturTampilUcapan, buatAcara, daftarAcara, eksporRsvpCsv, GalatAdmin } from '../src/admin.js';
import { hapusDataKedaluwarsa } from '../src/retensi.js';
import { acaraUji, kosongkan, PERANGKAT_A, PERANGKAT_B, poolAplikasi, poolPemilik, tanggal } from './bantu.js';

const pemilik = poolPemilik();
const aplikasi = poolAplikasi();

afterAll(async () => {
  await aplikasi.end();
  await pemilik.end();
});

beforeEach(async () => {
  await kosongkan(pemilik);
});

describe('acara:buat', () => {
  it('batas RSVP ditutup di akhir hari itu menurut zona acara', async () => {
    const a = await buatAcara(pemilik, {
      slug: 'laras-bima',
      nama: ' Laras & Bima ',
      tanggal: '2026-12-12',
      batasRsvp: '2026-12-05',
      zona: 'Asia/Makassar',
    });
    expect(a).toMatchObject({ slug: 'laras-bima', nama: 'Laras & Bima', tanggal_acara: '2026-12-12' });
    // 6 Des 00:00 WITA = 5 Des 16:00 UTC
    expect(a.batas_rsvp?.toISOString()).toBe('2026-12-05T16:00:00.000Z');
  });

  it('menolak slug, tanggal, zona yang salah, dan slug ganda', async () => {
    const dasar = { slug: 'ok', nama: 'A & B', tanggal: '2026-12-12', zona: 'Asia/Jakarta' };
    for (const salah of [
      { slug: 'Laras Bima' },
      { tanggal: '12-12-2026' },
      { tanggal: '2026-02-30' },
      { zona: 'Jakarta' },
      { batasRsvp: '2026-12-13' },
      { nama: '  ' },
    ]) {
      await expect(buatAcara(pemilik, { ...dasar, ...salah }), JSON.stringify(salah)).rejects.toBeInstanceOf(GalatAdmin);
    }
    await buatAcara(pemilik, dasar);
    await expect(buatAcara(pemilik, dasar)).rejects.toThrow('sudah dipakai');
  });
});

describe('acara:daftar, rsvp:ekspor, ucapan:sembunyikan', () => {
  it('rekap jumlah tamu dan CSV aman dibuka di spreadsheet', async () => {
    const id = await acaraUji(pemilik);
    await pemilik.query(
      `INSERT INTO rsvp (acara_id, perangkat_id, nama, kehadiran, jumlah, telepon, pesan, dibuat, diperbarui) VALUES
         ($1, $2, '=HYPERLINK("x")', 'hadir', 3, '6281234567890', 'Kata "kutip"', '2026-11-20 03:00Z', '2026-11-20 03:00Z'),
         ($1, $3, 'Ani', 'tidak', NULL, NULL, NULL, '2026-11-20 04:00Z', '2026-11-20 04:00Z')`,
      [id, PERANGKAT_A, PERANGKAT_B],
    );
    await pemilik.query("INSERT INTO ucapan (acara_id, nama, pesan) VALUES ($1, 'Budi', 'Selamat')", [id]);

    expect(await daftarAcara(pemilik)).toEqual([
      expect.objectContaining({ slug: 'laras-bima', rsvp: 2, hadir_orang: 3, tidak: 1, ragu: 0, ucapan: 1 }),
    ]);

    const csv = await eksporRsvpCsv(pemilik, 'laras-bima', 'Asia/Jakarta');
    expect(csv.startsWith('\uFEFF"Nama","Kehadiran"')).toBe(true);
    const baris = csv.slice(1).split('\r\n');
    expect(baris[1]).toBe(
      `"'=HYPERLINK(""x"")","Hadir","3","6281234567890","Kata ""kutip""","2026-11-20 10:00","2026-11-20 10:00"`,
    );
    expect(baris[2]).toBe('"Ani","Tidak hadir","","","","2026-11-20 11:00","2026-11-20 11:00"');
    await expect(eksporRsvpCsv(pemilik, 'tidak-ada', 'Asia/Jakarta')).rejects.toThrow('tidak ditemukan');
  });

  it('ucapan bisa disembunyikan dan ditampilkan lagi', async () => {
    const id = await acaraUji(pemilik);
    const { rows } = await pemilik.query<{ id: number }>(
      "INSERT INTO ucapan (acara_id, nama, pesan) VALUES ($1, 'Spam', 'x') RETURNING id",
      [id],
    );
    const ucapanId = rows[0]!.id;
    expect(await aturTampilUcapan(pemilik, ucapanId, false)).toBe(true);
    expect((await pemilik.query('SELECT tampil FROM ucapan')).rows[0].tampil).toBe(false);
    expect(await aturTampilUcapan(pemilik, ucapanId + 99, false)).toBe(false);
  });
});

describe('retensi data tamu', () => {
  it('menghapus RSVP dan ucapan acara yang lewat 90 hari, sisanya utuh', async () => {
    const lama = await acaraUji(pemilik, { slug: 'lama', hariLagi: -91 });
    const batas = await acaraUji(pemilik, { slug: 'batas', hariLagi: -90 });
    const baru = await acaraUji(pemilik, { slug: 'baru', hariLagi: 10 });
    for (const id of [lama, batas, baru]) {
      await pemilik.query("INSERT INTO rsvp (acara_id, perangkat_id, nama, kehadiran) VALUES ($1, gen_random_uuid(), 'X', 'hadir')", [id]);
      await pemilik.query("INSERT INTO ucapan (acara_id, nama, pesan) VALUES ($1, 'X', 'Y')", [id]);
    }
    // Dijalankan dengan peran aplikasi, seperti di server.
    expect(await hapusDataKedaluwarsa(aplikasi, 90)).toEqual({ rsvp: 1, ucapan: 1 });
    const sisa = await pemilik.query('SELECT a.slug FROM rsvp r JOIN acara a ON a.id = r.acara_id ORDER BY a.slug');
    expect(sisa.rows.map((r) => r.slug)).toEqual(['baru', 'batas']);
    expect((await pemilik.query('SELECT count(*)::int AS n FROM acara')).rows[0].n).toBe(3);
    expect(tanggal(0)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
