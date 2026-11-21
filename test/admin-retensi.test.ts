import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  aturTampilUcapan,
  aturTampilUcapanRentang,
  buatAcara,
  daftarAcara,
  daftarRsvpAdmin,
  eksporRsvpCsv,
  GalatAdmin,
  hapusAcara,
  hapusRsvp,
  hapusRsvpRentang,
} from '../src/admin.js';
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

  it('tanpa --batas-rsvp, RSVP ditutup di akhir hari tanggal acara menurut zona acara', async () => {
    const a = await buatAcara(pemilik, { slug: 'tanpa-batas', nama: 'A & B', tanggal: '2026-12-12', zona: 'Asia/Jakarta' });
    // 13 Des 00:00 WIB = 12 Des 17:00 UTC
    expect(a.batas_rsvp.toISOString()).toBe('2026-12-12T17:00:00.000Z');
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

describe('pembersihan', () => {
  const rentang = { sejak: '2026-11-20 10:00', sampai: '2026-11-20 11:00', zona: 'Asia/Jakarta' };

  async function isiSpam(id: number) {
    // 09:30, 10:15, 10:45, 11:30 WIB (= 02:30, 03:15, 03:45, 04:30 UTC)
    for (const [i, jam] of ['02:30', '03:15', '03:45', '04:30'].entries()) {
      await pemilik.query(`INSERT INTO ucapan (acara_id, nama, pesan, dibuat) VALUES ($1, 'S', $2, $3)`, [id, `u${i}`, `2026-11-20 ${jam}Z`]);
      await pemilik.query(
        `INSERT INTO rsvp (acara_id, perangkat_id, nama, kehadiran, jumlah, dibuat, diperbarui) VALUES ($1, gen_random_uuid(), $2, 'hadir', 10, $3, $3)`,
        [id, `r${i}`, `2026-11-20 ${jam}Z`],
      );
    }
  }

  it('menyembunyikan dan menampilkan lagi ucapan dalam rentang waktu, hanya acara itu', async () => {
    const id = await acaraUji(pemilik);
    const lain = await acaraUji(pemilik, { slug: 'acara-lain' });
    await isiSpam(id);
    await isiSpam(lain);
    expect(await aturTampilUcapanRentang(pemilik, 'laras-bima', rentang, false)).toBe(2);
    const tampil = await pemilik.query<{ pesan: string }>('SELECT pesan FROM ucapan WHERE acara_id = $1 AND tampil ORDER BY pesan', [id]);
    expect(tampil.rows.map((r) => r.pesan)).toEqual(['u0', 'u3']);
    expect((await pemilik.query('SELECT count(*)::int AS n FROM ucapan WHERE acara_id = $1 AND tampil', [lain])).rows[0].n).toBe(4);
    // Tanpa --sampai: sampai sekarang.
    expect(await aturTampilUcapanRentang(pemilik, 'laras-bima', { sejak: '2026-11-20', zona: 'Asia/Jakarta' }, false)).toBe(2);
    expect(await aturTampilUcapanRentang(pemilik, 'laras-bima', { sejak: '2026-11-20', zona: 'Asia/Jakarta' }, true)).toBe(4);
  });

  it('menghapus RSVP per id dan per rentang (menghitung dulu tanpa --ya)', async () => {
    const id = await acaraUji(pemilik);
    await isiSpam(id);
    expect(await hapusRsvpRentang(pemilik, 'laras-bima', rentang, false)).toEqual({ jumlah: 2, dihapus: false });
    expect((await daftarRsvpAdmin(pemilik, 'laras-bima')).length).toBe(4);
    expect(await hapusRsvpRentang(pemilik, 'laras-bima', rentang, true)).toEqual({ jumlah: 2, dihapus: true });
    const sisa = await daftarRsvpAdmin(pemilik, 'laras-bima');
    expect(sisa.map((r) => r.nama).sort()).toEqual(['r0', 'r3']);
    expect(await hapusRsvp(pemilik, sisa[0]!.id)).toBe(true);
    expect(await hapusRsvp(pemilik, sisa[0]!.id)).toBe(false);
  });

  it('menolak rentang yang salah', async () => {
    await acaraUji(pemilik);
    for (const r of [
      { sejak: '20-11-2026', zona: 'Asia/Jakarta' },
      { sejak: '2026-11-20 25:00', zona: 'Asia/Jakarta' },
      { sejak: '2026-11-20 11:00', sampai: '2026-11-20 10:00', zona: 'Asia/Jakarta' },
      { sejak: '2026-11-20', zona: 'WIB' },
    ]) {
      await expect(aturTampilUcapanRentang(pemilik, 'laras-bima', r, false), JSON.stringify(r)).rejects.toBeInstanceOf(GalatAdmin);
    }
  });

  it('acara:hapus wajib konfirmasi slug persis, lalu menghapus RSVP dan ucapannya', async () => {
    const id = await acaraUji(pemilik);
    await acaraUji(pemilik, { slug: 'acara-lain' });
    await isiSpam(id);
    await expect(hapusAcara(pemilik, 'laras-bima', undefined)).rejects.toThrow('--konfirmasi laras-bima');
    await expect(hapusAcara(pemilik, 'laras-bima', 'laras')).rejects.toBeInstanceOf(GalatAdmin);
    expect(await hapusAcara(pemilik, 'laras-bima', 'laras-bima')).toEqual({ rsvp: 4, ucapan: 4 });
    expect((await pemilik.query('SELECT slug FROM acara')).rows).toEqual([{ slug: 'acara-lain' }]);
    expect((await pemilik.query('SELECT count(*)::int AS n FROM rsvp')).rows[0].n).toBe(0);
    await expect(hapusAcara(pemilik, 'tidak-ada', 'tidak-ada')).rejects.toThrow('tidak ditemukan');
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
