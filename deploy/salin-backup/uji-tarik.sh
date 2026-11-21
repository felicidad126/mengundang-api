#!/usr/bin/env bash
# Uji tarik-backup.sh dengan sumber folder lokal (tanpa SSH). Keluar 0 bila semua lulus.
set -Eeuo pipefail
script_dir=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
src="$work/server" dst="$work/lokal"
mkdir -p "$src"

passed=0 failed=0
check() {
  local name="$1"
  shift
  if "$@"; then echo "LULUS  $name"; passed=$((passed + 1)); else echo "GAGAL  $name"; failed=$((failed + 1)); fi
}
tarik() { TARIK_SUMBER="$src/" TARIK_TUJUAN="$dst" bash "$script_dir/tarik-backup.sh" 2>"$work/log"; }

echo baru >"$src/mengundang-produksi-20261120T183000Z.tar.gpg"
echo lama >"$src/mengundang-produksi-20260801T183000Z.tar.gpg"
touch -d '100 days ago' "$src/mengundang-produksi-20260801T183000Z.tar.gpg"
echo setengah >"$src/mengundang-produksi-20261121T183000Z.tar.gpg.tmp"
echo lain >"$src/latihan-restore.log"

check "penarikan pertama berhasil" tarik
check "hanya backup lengkap yang disalin, yang > 90 hari langsung dibuang" bash -c "
  [[ -e '$dst/mengundang-produksi-20261120T183000Z.tar.gpg' ]] &&
  [[ ! -e '$dst/mengundang-produksi-20260801T183000Z.tar.gpg' ]] &&
  [[ ! -e '$dst/mengundang-produksi-20261121T183000Z.tar.gpg.tmp' && ! -e '$dst/latihan-restore.log' ]]"

echo diubah >"$src/mengundang-produksi-20261120T183000Z.tar.gpg"
rm "$src/mengundang-produksi-20260801T183000Z.tar.gpg"
check "penarikan ulang berhasil" tarik
check "salinan yang sudah ada tidak ditimpa" grep -qx baru "$dst/mengundang-produksi-20261120T183000Z.tar.gpg"

rm "$src/mengundang-produksi-20261120T183000Z.tar.gpg"
check "penarikan setelah server menghapus berkas berhasil" tarik
check "berkas yang hilang di server tetap ada di salinan" test -e "$dst/mengundang-produksi-20261120T183000Z.tar.gpg"

touch -d '30 hours ago' "$dst"/mengundang-*.tar.gpg
check "gagal bila backup terbaru lebih tua dari 26 jam" bash -c "! TARIK_SUMBER='$src/' TARIK_TUJUAN='$dst' bash '$script_dir/tarik-backup.sh' 2>/dev/null"
check "pesan gagal menyebut umur backup" bash -c "
  TARIK_SUMBER='$src/' TARIK_TUJUAN='$dst' bash '$script_dir/tarik-backup.sh' 2>&1 | grep -q 'lebih tua dari 26 jam'"

check "sumber yang tidak ada membuat skrip gagal" bash -c "! TARIK_SUMBER='$work/tidak-ada/' TARIK_TUJUAN='$dst' bash '$script_dir/tarik-backup.sh' 2>/dev/null"

echo "Selesai: $passed lulus, $failed gagal"
((failed == 0))
