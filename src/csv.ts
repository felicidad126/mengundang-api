// CSV untuk dibuka di Excel/Google Sheets: UTF-8 dengan BOM, baris CRLF, setiap sel dikutip.
// Sel yang diawali = + - @ tab atau CR diberi awalan ' supaya tidak dijalankan sebagai rumus
// (CSV/formula injection): nama dan pesan berasal dari tamu.

const AWAL_RUMUS = /^[=+\-@\t\r]/;

export function selCsv(nilai: string | number | null | undefined): string {
  if (nilai === null || nilai === undefined) return '""';
  let teks = String(nilai);
  if (AWAL_RUMUS.test(teks)) teks = `'${teks}`;
  return `"${teks.replace(/"/g, '""')}"`;
}

export function keCsv(header: readonly string[], baris: readonly (readonly (string | number | null)[])[]): string {
  const semua = [header, ...baris].map((b) => b.map(selCsv).join(','));
  return `\uFEFF${semua.join('\r\n')}\r\n`;
}
