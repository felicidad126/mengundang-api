import { describe, expect, it } from 'vitest';
import { bacaKonfigurasi, KonfigurasiSalah } from '../src/config.js';
import { selCsv } from '../src/csv.js';
import { normalisasiTelepon, rapikanPesan, rapikanSatuBaris } from '../src/teks.js';

describe('teks', () => {
  it('merapikan satu baris dan pesan', () => {
    expect(rapikanSatuBaris('  Budi\n\tSantoso\u0000\u202E ')).toBe('Budi Santoso');
    expect(rapikanPesan('Halo  \r\n\r\n\r\n  dunia\u0007\tku')).toBe('Halo\n\ndunia ku');
    expect(rapikanSatuBaris('Budi\tSantoso')).toBe('Budi Santoso');
  });

  it.each([
    ['0812-3456-7890', '6281234567890'],
    ['+62 812 3456 7890', '6281234567890'],
    ['(0812) 345.678', '62812345678'],
    ['', null],
    ['   ', null],
    ['0812', undefined],
    ['08abc', undefined],
  ])('telepon %j → %j', (masuk, keluar) => {
    expect(normalisasiTelepon(masuk)).toBe(keluar);
  });
});

describe('csv', () => {
  it.each([
    ['=1+1', `"'=1+1"`],
    ['-5', `"'-5"`],
    ['@SUM(A1)', `"'@SUM(A1)"`],
    ['Kata "kutip"', '"Kata ""kutip"""'],
    [null, '""'],
    [3, '"3"'],
  ])('%j', (masuk, keluar) => {
    expect(selCsv(masuk)).toBe(keluar);
  });
});

describe('konfigurasi', () => {
  const dasar = { MENGUNDANG_ENV: 'production', DATABASE_URL: 'postgres://x', ASAL_DIIZINKAN: 'https://invitation.helonoia.com' };
  it('membaca nilai dan bawaan', () => {
    expect(bacaKonfigurasi(dasar)).toMatchObject({ port: 3000, retensiHari: 90, asalDiizinkan: ['https://invitation.helonoia.com'] });
  });
  it.each([
    [{ MENGUNDANG_ENV: undefined }],
    [{ MENGUNDANG_ENV: 'prod' }],
    [{ DATABASE_URL: '' }],
    [{ ASAL_DIIZINKAN: '' }],
    [{ ASAL_DIIZINKAN: 'invitation.helonoia.com' }],
    [{ PORT: 'abc' }],
    [{ RETENSI_HARI: '0' }],
  ])('menolak %j', (ubah) => {
    expect(() => bacaKonfigurasi({ ...dasar, ...ubah })).toThrow(KonfigurasiSalah);
  });
});
