// Merapikan teks dari tamu sebelum disimpan. Teks tetap disimpan apa adanya secara isi
// (tanpa HTML-escape); peloloskan karakter HTML adalah tugas tampilan.

// Karakter kendali, kecuali baris baru, dan karakter pengubah arah teks (bisa dipakai untuk
// menyamarkan isi ucapan saat ditampilkan).
// eslint-disable-next-line no-control-regex -- justru karakter kendali yang dibuang
const KENDALI = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** Satu baris: tanpa karakter kendali dan baris baru, spasi berlebih dirapatkan. */
export function rapikanSatuBaris(teks: string): string {
  return teks.replace(/[\t\r\n]+/g, ' ').replace(KENDALI, '').replace(/\s+/g, ' ').trim();
}

/** Teks bebas: baris baru dipertahankan (paling banyak satu baris kosong berturut-turut). */
export function rapikanPesan(teks: string): string {
  return teks
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(KENDALI, '')
    .split('\n')
    .map((baris) => baris.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Nomor WhatsApp ke bentuk angka saja dengan kode negara: "0812-3456 789" → "628123456789",
 * "+62 812..." → "62812...". Mengembalikan null bila kosong, dan undefined bila tidak valid.
 */
export function normalisasiTelepon(teks: string | undefined): string | null | undefined {
  if (teks === undefined) return null;
  let angka = teks.replace(/[\s\-().]/g, '');
  if (angka === '') return null;
  if (angka.startsWith('+')) angka = angka.slice(1);
  else if (angka.startsWith('0')) angka = `62${angka.slice(1)}`;
  return /^[0-9]{8,16}$/.test(angka) ? angka : undefined;
}
