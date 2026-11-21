#!/bin/bash
# Dijalankan image postgres sekali, saat database pertama kali dibuat (volume kosong).
# Membuat peran aplikasi dengan LOGIN; hak aksesnya diberikan oleh migrasi 0001_awal.
# Tanpa `set -e` dan sejenisnya: bila berkas ini tidak executable, entrypoint postgres men-source-nya.
: "${MENGUNDANG_APP_DB_PASSWORD:?MENGUNDANG_APP_DB_PASSWORD wajib diisi}"
# Kata sandi lewat variabel psql (:'sandi'), tidak disusun ke dalam teks SQL.
psql -v ON_ERROR_STOP=1 -v sandi="$MENGUNDANG_APP_DB_PASSWORD" \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE mengundang_app LOGIN PASSWORD :'sandi';
SQL
