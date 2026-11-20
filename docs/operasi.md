# Operasi mengundang-api

Untuk admin Helonoia yang memasang, merilis, dan merawat API RSVP dan buku ucapan.

## Ringkasnya

| | |
| --- | --- |
| Server | VM Helonoia (aaPanel), folder `/opt/mengundang-api` (clone repo ini) |
| Alamat publik | `https://invitation.helonoia.com/api/` (nginx situs undangan meneruskan `/api/` ke `127.0.0.1:8090`) |
| Service | `db` (PostgreSQL 18), `migrate` (sekali jalan), `api`, `backup`; `admin` hanya untuk perintah |
| Database | Tidak punya port di host; jaringan `dalam` tanpa akses internet. Dua peran: `mengundang` (pemilik skema: migrasi, admin, backup) dan `mengundang_app` (API: hanya baca acara, tulis RSVP/ucapan) |
| Rahasia | `deploy/produksi.env` (mode 600, tidak pernah masuk git). Kunci **privat** backup tidak pernah di server |
| Backup | Harian 01:30 WIB, terenkripsi GPG, disimpan 30 hari di `deploy/backup/`; salinan kedua ditarik VM lokal lewat Tailscale |
| Retensi data tamu | RSVP dan ucapan dihapus otomatis 90 hari setelah tanggal acara |

Semua perintah di bawah dijalankan dari `/opt/mengundang-api` sebagai root, dengan singkatan:

```bash
cd /opt/mengundang-api
DC="docker compose --env-file deploy/produksi.env -f deploy/compose.yml"
```

## Pemasangan pertama

1. **Kode dan kunci publik backup**

   ```bash
   git clone https://github.com/felicidad126/mengundang-api.git /opt/mengundang-api
   cd /opt/mengundang-api
   install -d -m 700 deploy/kunci deploy/backup
   # Tempel isi kunci PUBLIK (mengundang-backup-public.asc) ke berkas ini:
   nano deploy/kunci/backup-public.asc && chmod 600 deploy/kunci/backup-public.asc
   ```

   Pasangan kuncinya dibuat di laptop pemegang kunci, bukan di server:

   ```bash
   gpg --quick-gen-key "Mengundang Backup <backup@helonoia.com>" future-default default never
   gpg --armor --export backup@helonoia.com > mengundang-backup-public.asc
   gpg --armor --export-secret-keys backup@helonoia.com > mengundang-backup-private.asc
   ```

   Simpan `mengundang-backup-private.asc` dan passphrase-nya di dua tempat terpisah (mis. password
   manager dan flashdisk). Tanpa kunci privat, backup tidak bisa dibuka oleh siapa pun.

2. **Berkas env.** Kata sandi dibuat langsung ke berkas, tidak pernah diketik atau ditampilkan:

   ```bash
   install -m 600 deploy/produksi.env.example deploy/produksi.env
   sed -i "s/^MENGUNDANG_DB_PASSWORD=.*/MENGUNDANG_DB_PASSWORD=$(openssl rand -hex 32)/" deploy/produksi.env
   sed -i "s/^MENGUNDANG_APP_DB_PASSWORD=.*/MENGUNDANG_APP_DB_PASSWORD=$(openssl rand -hex 32)/" deploy/produksi.env
   # Isi MENGUNDANG_IMAGE dengan digest dari ringkasan job "terbit" CI di main.
   nano deploy/produksi.env
   ```

3. **Nyalakan**

   ```bash
   $DC up -d --wait
   $DC ps
   curl -s http://127.0.0.1:8090/api/health    # {"status":"ok"}
   ```

4. **nginx.** Salin [`deploy/nginx/http-mengundang.conf`](../deploy/nginx/http-mengundang.conf) ke
   `/www/server/panel/vhost/nginx/0.mengundang-api.conf`, dan tambahkan isi
   [`deploy/nginx/lokasi-api.conf`](../deploy/nginx/lokasi-api.conf) ke URL rewrite situs
   `invitation.helonoia.com` di aaPanel. Lalu `nginx -t && nginx -s reload` dan periksa
   `curl -s https://invitation.helonoia.com/api/health`.

## Rilis versi baru

1. Merge pull request ke `main`. Job **terbit** di CI membangun image, menjalankan uji asap compose
   produksi (termasuk backup dan latihan restore), lalu menerbitkannya ke GHCR. Ringkasan job
   berisi baris `ghcr.io/felicidad126/mengundang-api@sha256:...`.
2. Di server: `git -C /opt/mengundang-api pull` (compose, skrip backup), ganti `MENGUNDANG_IMAGE`
   di `deploy/produksi.env` dengan digest itu, lalu:

   ```bash
   $DC exec -T backup bash /scripts/backup.sh   # backup sebelum migrasi
   $DC up -d --wait
   curl -s https://invitation.helonoia.com/api/health
   ```

3. Batal rilis: kembalikan `MENGUNDANG_IMAGE` ke digest sebelumnya. Bila rilis itu memasang migrasi
   baru, jalankan dulu `$DC run --rm migrate node dist/db/migrate.js down` dengan image baru, satu
   kali per migrasi baru, baru kemudian ganti image.

Migrasi tidak pernah berjalan dari aplikasi; selalu lewat service `migrate` sebelum `api` menyala.

## Perintah admin

```bash
# Acara baru. Batas RSVP berlaku sampai akhir hari itu di zona acara (WIB/WITA/WIT).
$DC run --rm admin acara:buat --slug laras-bima --nama "Laras & Bima" \
  --tanggal 2026-12-12 --batas-rsvp 2026-12-05 --zona Asia/Makassar
# Mencetak tag <meta name="acara" content="laras-bima"> untuk <head> undangan klien.

$DC run --rm admin acara:daftar                                   # rekap semua acara
$DC run --rm -T admin rsvp:ekspor laras-bima > rsvp-laras-bima.csv # CSV untuk mempelai
$DC run --rm admin ucapan:daftar laras-bima                       # cari id ucapan
$DC run --rm admin ucapan:sembunyikan 42                          # sembunyikan ucapan tidak pantas
$DC run --rm admin ucapan:tampilkan 42
```

- CSV memakai UTF-8 dengan BOM (nama tampil benar di Excel) dan sel yang diawali `= + - @` diberi
  awalan `'` supaya tidak dijalankan sebagai rumus.
- Berkas CSV berisi nomor WhatsApp tamu: kirim hanya ke mempelai, lalu hapus dari server.

## Backup dan restore

| | |
| --- | --- |
| Jadwal | Setiap hari 01:30 WIB (`MENGUNDANG_BACKUP_TIME_UTC`, bawaan 18:30 UTC). Saat service `backup` pertama menyala, langsung dibuat backup bila belum ada backup 24 jam terakhir |
| Isi | `pg_dump` utuh + sidik data per tabel (jumlah baris dan hash) dari snapshot yang sama |
| Berkas | `deploy/backup/mengundang-produksi-<waktu UTC>.tar.gpg`, mode 640 grup `tarik-backup` (atau 600 bila akun tarik belum dipasang) |
| Lama simpan | 30 hari; backup lama dihapus hanya setelah backup baru berhasil |
| Pemantauan | `$DC ps`: service `backup` **healthy** bila ada backup < 26 jam. Log: `$DC logs backup` |

Backup manual (mis. sebelum rilis): `$DC exec -T backup bash /scripts/backup.sh`.

**Latihan restore** (minimal setahun sekali, disarankan tiap 3 bulan), di mesin yang punya Docker dan
kunci privat (laptop pemegang kunci atau VM lokal):

```bash
BACKUP_DIR=/srv/backup/mengundang \
BACKUP_PRIVATE_KEY=/media/aman/mengundang-backup-private.asc \
BACKUP_KEY_PASSPHRASE_FILE=/media/aman/passphrase.txt \
  bash deploy/scripts/latihan-restore.sh
```

Skrip menyalakan PostgreSQL baru, memulihkan backup terbaru, membandingkan sidik data, lalu
membuang container. Keluar 0 dan mencetak `COCOK: <n> tabel, <n> baris` bila berhasil. CI menjalankan
latihan yang sama di setiap push.

**Restore sungguhan** (VM hilang atau data rusak):

1. Pasang stack seperti di "Pemasangan pertama" langkah 1–2, dengan volume database kosong. Jangan
   jalankan `up` untuk semua service; nyalakan database saja: `$DC up -d --wait db`.
2. Bawa kunci privat ke server **sementara** (mis. `/root/pulih/kunci.asc` dan `passphrase.txt`,
   mode 600), lalu pulihkan ke database yang masih kosong. Skrip menolak database yang berisi dan
   keluar 0 hanya bila sidik datanya `COCOK`:

   ```bash
   $DC run --rm --no-deps -T -v /root/pulih:/pulih:ro \
     -e BACKUP_PRIVATE_KEY=/pulih/kunci.asc -e BACKUP_KEY_PASSPHRASE_FILE=/pulih/passphrase.txt \
     --entrypoint bash backup /scripts/restore.sh /backup/<berkas>.tar.gpg postgres://mengundang@db:5432/mengundang
   ```

3. Restore tidak membawa hak akses; berikan lagi hak peran aplikasi:

   ```bash
   $DC exec -T db psql -U mengundang -d mengundang <<'SQL'
   GRANT USAGE ON SCHEMA public TO mengundang_app;
   GRANT SELECT ON acara TO mengundang_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON rsvp, ucapan TO mengundang_app;
   SQL
   ```

4. `$DC up -d --wait`, periksa `/api/health` dan `acara:daftar`, lalu hapus kunci dari server:
   `shred -u /root/pulih/*`.

## Salinan kedua di VM lokal (model tarik)

VM lokal menarik backup dari server; server tidak pernah memegang akses ke VM lokal, jadi server
yang dibobol tidak bisa menghapus salinan di sana. Berkasnya terenkripsi, jadi VM lokal juga tidak
perlu kunci privat untuk menyimpannya.

1. Pasang Tailscale di server dan VM lokal, di tailnet yang sama (login dilakukan pemilik akun).
2. Di VM lokal (Linux dengan `rsync`): buat pengguna khusus dan kunci SSH:

   ```bash
   sudo useradd --create-home tarik
   sudo -u tarik ssh-keygen -t ed25519 -N '' -f /home/tarik/.ssh/tarik-backup
   ```

3. Salin `/home/tarik/.ssh/tarik-backup.pub` ke server, lalu di server:

   ```bash
   bash deploy/salin-backup/pasang-akun-tarik.sh /root/tarik-backup.pub
   # Isi MENGUNDANG_BACKUP_FILE_GROUP di deploy/produksi.env dengan GID yang dicetak, lalu:
   $DC up -d backup
   ```

   Akun `tarik-backup` hanya menerima kunci itu, hanya dari alamat Tailscale, dan dikunci
   `rrsync -ro` ke folder backup (tanpa shell, tidak bisa menulis atau menghapus).

4. Di VM lokal: catat sidik host server sekali, pasang skrip dan cron:

   ```bash
   sudo -u tarik ssh-keyscan <nama-tailscale-server> >> /home/tarik/.ssh/known_hosts   # cocokkan dengan ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub di server
   sudo install -m 755 tarik-backup.sh /usr/local/bin/tarik-backup.sh
   sudo install -d -o tarik -m 700 /srv/backup/mengundang
   echo '17 3 * * * tarik TARIK_SUMBER=tarik-backup@<nama-tailscale-server>:/ TARIK_TUJUAN=/srv/backup/mengundang /usr/local/bin/tarik-backup.sh >> /var/log/tarik-backup.log 2>&1' |
     sudo tee /etc/cron.d/tarik-backup
   sudo touch /var/log/tarik-backup.log && sudo chown tarik /var/log/tarik-backup.log
   ```

   Skrip keluar bukan 0 (dan mencatat `GAGAL`) bila backup terbaru lebih tua dari 26 jam. Salinan
   disimpan 90 hari; berkas yang sudah ada tidak pernah ditimpa.

## Privasi dan retensi

- IP tamu tidak disimpan di database. Log akses nginx (aaPanel) tetap mencatat IP; log container
  dirotasi (3 × 10 MB per service).
- RSVP dan nomor WhatsApp hanya bisa dibaca lewat perintah admin. Ucapan bersifat publik untuk tamu
  undangan itu.
- Setiap hari API menghapus RSVP dan ucapan acara yang tanggalnya lewat lebih dari
  `MENGUNDANG_RETENSI_HARI` (bawaan 90) hari. Backup yang memuat data itu ikut habis setelah 30 hari
  di server dan 90 hari di VM lokal.

## Mengganti kata sandi database

Peran aplikasi dibuat sekali saat volume database pertama kali dibuat, jadi mengganti
`MENGUNDANG_APP_DB_PASSWORD` di env saja tidak cukup:

```bash
BARU=$(openssl rand -hex 32)
$DC exec -T db psql -U mengundang -d mengundang -v sandi="$BARU" <<'SQL'
ALTER ROLE mengundang_app PASSWORD :'sandi';
SQL
sed -i "s/^MENGUNDANG_APP_DB_PASSWORD=.*/MENGUNDANG_APP_DB_PASSWORD=$BARU/" deploy/produksi.env
unset BARU
$DC up -d --wait api
```

Untuk peran pemilik `mengundang`, langkahnya sama dengan `ALTER ROLE mengundang`, lalu
`$DC up -d --wait` (semua service yang memakainya).
