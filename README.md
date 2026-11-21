# mengundang-api

API RSVP dan buku ucapan untuk undangan digital **Mengundang by Helonoia**
([katalog](https://invitation.helonoia.com/), repo situs
[`felicidad126.github.io`](https://github.com/felicidad126/felicidad126.github.io)).

Undangan klien (tema dengan tag `<meta name="acara" content="<slug>">`) mengirim RSVP dan ucapan
tamu ke API ini lewat `/acara.js` di situs. Demo tema di katalog tidak memanggil API sama sekali.

## Endpoint

| Metode | Jalur | Isi |
| --- | --- | --- |
| GET | `/api/health` | status aplikasi dan database |
| GET | `/api/acara/:slug/ucapan?batas=20&sebelum=<id>` | ucapan yang tampil, terbaru dulu, berhalaman |
| POST | `/api/acara/:slug/ucapan` | `{ nama ≤ 80, pesan ≤ 500 }` |
| PUT | `/api/acara/:slug/rsvp` | `{ perangkat_id (uuid), nama, kehadiran: hadir/tidak/ragu, jumlah 1–10?, telepon?, pesan? }`; satu jawaban per perangkat per acara |

Galat selalu berbentuk `{ "galat": "<kode>", "pesan": "<teks untuk tamu>" }`. Permintaan tulis dari
browser hanya diterima dari origin di `ASAL_DIIZINKAN` dan harus JSON. Pembatasan laju ada di nginx.
Belum ada endpoint untuk mempelai; data dibaca admin lewat perintah CLI (portal customer menyusul).

## Susunan

- Node 26 LTS, TypeScript, Fastify, `pg`; migrasi SQL eksplisit dengan jalur turun (`src/db/migrasi.ts`).
- Satu image untuk migrasi, API, dan perintah admin ([`deploy/Dockerfile`](deploy/Dockerfile)).
- Produksi: [`deploy/compose.yml`](deploy/compose.yml) — database tanpa port host, jaringan internal
  tanpa internet, container hanya-baca tanpa hak root, backup GPG harian.
- Operasi (pasang, rilis, admin, backup, restore, salinan ke VM lokal): [`docs/operasi.md`](docs/operasi.md).
- Rencana dan keputusan: [`plans/pending/rsvp-ucapan.md`](plans/pending/rsvp-ucapan.md).

## Pengembangan

Butuh Node 26, pnpm (versi di `packageManager`), dan PostgreSQL 18 untuk uji.

```bash
pnpm install
pnpm lint
pnpm build
TEST_DATABASE_URL=postgres://pengguna:sandi@localhost:5432/mengundang_uji pnpm test
shellcheck -x deploy/*.sh deploy/scripts/*.sh deploy/salin-backup/*.sh deploy/postgres/init/*.sh
bash deploy/salin-backup/uji-tarik.sh
# Uji asap stack produksi dengan image lokal (butuh Docker, jalankan sebagai root):
docker build -f deploy/Dockerfile -t mengundang-api:lokal . && MENGUNDANG_IMAGE=mengundang-api:lokal bash deploy/uji-asap.sh
```

Uji API memakai PostgreSQL asli dan menjalankan API dengan hak peran `mengundang_app`, sama seperti
di server. CI menjalankan semua langkah di atas di setiap push, dan di `main` menerbitkan image yang
lolos ke GHCR.
