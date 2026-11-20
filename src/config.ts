// Konfigurasi dibaca dari environment satu kali saat start. Nilai wajib tanpa bawaan, supaya
// produksi tidak pernah diam-diam berjalan dengan setelan pengembangan.

export type Lingkungan = 'production' | 'development' | 'test';

export interface Konfigurasi {
  lingkungan: Lingkungan;
  databaseUrl: string;
  host: string;
  port: number;
  logLevel: string;
  /** Origin yang boleh mengirim POST/PUT dari browser, mis. https://invitation.helonoia.com */
  asalDiizinkan: string[];
  /** RSVP dan ucapan dihapus sekian hari setelah tanggal acara. */
  retensiHari: number;
}

export class KonfigurasiSalah extends Error {}

function wajib(env: NodeJS.ProcessEnv, nama: string): string {
  const nilai = env[nama]?.trim();
  if (!nilai) throw new KonfigurasiSalah(`${nama} wajib diisi`);
  return nilai;
}

function bilangan(env: NodeJS.ProcessEnv, nama: string, bawaan: number, min: number, max: number): number {
  const mentah = env[nama]?.trim();
  if (!mentah) return bawaan;
  const nilai = Number(mentah);
  if (!Number.isInteger(nilai) || nilai < min || nilai > max) {
    throw new KonfigurasiSalah(`${nama} harus bilangan bulat ${min}–${max}`);
  }
  return nilai;
}

export function bacaKonfigurasi(env: NodeJS.ProcessEnv = process.env): Konfigurasi {
  const lingkungan = wajib(env, 'MENGUNDANG_ENV');
  if (lingkungan !== 'production' && lingkungan !== 'development' && lingkungan !== 'test') {
    throw new KonfigurasiSalah('MENGUNDANG_ENV harus production, development, atau test');
  }
  const asal = (env.ASAL_DIIZINKAN ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
  for (const a of asal) {
    if (!/^https?:\/\/[^/\s]+$/.test(a)) throw new KonfigurasiSalah(`ASAL_DIIZINKAN tidak valid: ${a}`);
  }
  if (lingkungan === 'production' && asal.length === 0) {
    throw new KonfigurasiSalah('ASAL_DIIZINKAN wajib diisi di production');
  }
  return {
    lingkungan,
    databaseUrl: wajib(env, 'DATABASE_URL'),
    host: env.HOST?.trim() || '0.0.0.0',
    port: bilangan(env, 'PORT', 3000, 1, 65535),
    logLevel: env.LOG_LEVEL?.trim() || 'info',
    asalDiizinkan: asal,
    retensiHari: bilangan(env, 'RETENSI_HARI', 90, 1, 3650),
  };
}
