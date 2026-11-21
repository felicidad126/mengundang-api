// Perintah admin Helonoia. Di server dijalankan lewat service `admin` (peran pemilik database):
//   docker compose --env-file deploy/produksi.env -f deploy/compose.yml run --rm admin <perintah> ...
import { parseArgs } from 'node:util';
import {
  aturTampilUcapan,
  aturTampilUcapanRentang,
  buatAcara,
  daftarAcara,
  daftarRsvpAdmin,
  daftarUcapanAdmin,
  eksporRsvpCsv,
  GalatAdmin,
  hapusAcara,
  hapusRsvp,
  hapusRsvpRentang,
  type Rentang,
} from './admin.js';
import { buatPool } from './db/pool.js';

const BANTUAN = `Perintah (waktu "YYYY-MM-DD" atau "YYYY-MM-DD HH:MM" menurut --zona, bawaan Asia/Jakarta):
  acara:buat --slug <slug> --nama "<nama>" --tanggal YYYY-MM-DD [--batas-rsvp YYYY-MM-DD] [--zona Asia/Jakarta]
      tanpa --batas-rsvp, RSVP ditutup di akhir hari tanggal acara
  acara:daftar
  acara:hapus <slug> --konfirmasi <slug>          hapus acara beserta semua RSVP dan ucapannya
  rsvp:ekspor <slug> [--zona Asia/Jakarta]        CSV ke stdout (berisi nomor WhatsApp)
  rsvp:daftar <slug>                              id untuk rsvp:hapus
  rsvp:hapus <id>
  rsvp:hapus --acara <slug> --sejak "<waktu>" [--sampai "<waktu>"] [--ya]
      tanpa --ya hanya menghitung berapa yang akan dihapus
  ucapan:daftar <slug>
  ucapan:sembunyikan <id>
  ucapan:sembunyikan --acara <slug> --sejak "<waktu>" [--sampai "<waktu>"]
  ucapan:tampilkan <id>
  ucapan:tampilkan --acara <slug> --sejak "<waktu>" [--sampai "<waktu>"]`;

const waktuLokal = (d: Date | null, zona = 'Asia/Jakarta') =>
  d ? d.toLocaleString('sv-SE', { timeZone: zona, hour12: false }).slice(0, 16) : '-';

function cetakTabel(header: string[], baris: (string | number | null)[][]) {
  console.log([header, ...baris].map((b) => b.map((x) => x ?? '-').join('\t')).join('\n'));
}

function idDari(teks: string | undefined, apa: string): number {
  const id = Number(teks);
  if (!Number.isInteger(id) || id < 1) throw new GalatAdmin(`sebutkan id ${apa} (lihat ${apa}:daftar), atau --acara dengan --sejak`);
  return id;
}

async function jalankan(argv: string[]): Promise<number> {
  const [perintah, ...sisa] = argv;
  const { values, positionals } = parseArgs({
    args: sisa,
    allowPositionals: true,
    options: {
      slug: { type: 'string' },
      nama: { type: 'string' },
      tanggal: { type: 'string' },
      'batas-rsvp': { type: 'string' },
      zona: { type: 'string', default: 'Asia/Jakarta' },
      acara: { type: 'string' },
      sejak: { type: 'string' },
      sampai: { type: 'string' },
      konfirmasi: { type: 'string' },
      ya: { type: 'boolean', default: false },
    },
  });
  if (!perintah || perintah === 'bantuan' || perintah === '--help') {
    console.log(BANTUAN);
    return perintah ? 0 : 2;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL wajib diisi');
    return 2;
  }
  const rentang = (): Rentang | null => {
    if (values.acara === undefined && values.sejak === undefined && values.sampai === undefined) return null;
    if (!values.acara || !values.sejak) throw new GalatAdmin('pembersihan per rentang butuh --acara <slug> dan --sejak "<waktu>"');
    return { sejak: values.sejak, sampai: values.sampai, zona: values.zona };
  };
  const keteranganRentang = (r: Rentang) => `${r.sejak} sampai ${r.sampai ?? 'sekarang'}, zona ${r.zona}`;

  // Perintah admin bisa lebih lama daripada permintaan API; batas query lebih longgar.
  const pool = buatPool(url, { max: 1, batasQueryMs: 60_000 });
  try {
    switch (perintah) {
      case 'acara:buat': {
        const a = await buatAcara(pool, {
          slug: values.slug ?? '',
          nama: values.nama ?? '',
          tanggal: values.tanggal ?? '',
          batasRsvp: values['batas-rsvp'],
          zona: values.zona,
        });
        console.log(`Acara dibuat: ${a.slug} (${a.nama}), tanggal ${a.tanggal_acara}`);
        console.log(`RSVP ditutup: ${waktuLokal(a.batas_rsvp, values.zona)} ${values.zona}`);
        console.log(`Tag untuk undangan: <meta name="acara" content="${a.slug}">`);
        return 0;
      }
      case 'acara:daftar': {
        const daftar = await daftarAcara(pool);
        cetakTabel(
          ['slug', 'nama', 'tanggal', 'batas_rsvp_wib', 'rsvp', 'hadir_orang', 'tidak', 'ragu', 'ucapan'],
          daftar.map((a) => [a.slug, a.nama, a.tanggal_acara, waktuLokal(a.batas_rsvp), a.rsvp, a.hadir_orang, a.tidak, a.ragu, a.ucapan]),
        );
        return 0;
      }
      case 'acara:hapus': {
        const slug = positionals[0];
        if (!slug) throw new GalatAdmin('sebutkan slug acara');
        const hasil = await hapusAcara(pool, slug, values.konfirmasi);
        console.log(`Acara ${slug} dihapus, beserta ${hasil.rsvp} RSVP dan ${hasil.ucapan} ucapan`);
        return 0;
      }
      case 'rsvp:ekspor': {
        const slug = positionals[0];
        if (!slug) throw new GalatAdmin('sebutkan slug acara');
        process.stdout.write(await eksporRsvpCsv(pool, slug, values.zona));
        return 0;
      }
      case 'rsvp:daftar': {
        const slug = positionals[0];
        if (!slug) throw new GalatAdmin('sebutkan slug acara');
        const daftar = await daftarRsvpAdmin(pool, slug);
        cetakTabel(
          ['id', 'dibuat_wib', 'kehadiran', 'jumlah', 'nama'],
          daftar.map((r) => [r.id, waktuLokal(r.dibuat), r.kehadiran, r.jumlah, r.nama]),
        );
        return 0;
      }
      case 'rsvp:hapus': {
        const r = rentang();
        if (!r) {
          const id = idDari(positionals[0], 'rsvp');
          if (!(await hapusRsvp(pool, id))) throw new GalatAdmin(`RSVP ${id} tidak ditemukan`);
          console.log(`RSVP ${id} dihapus`);
          return 0;
        }
        const hasil = await hapusRsvpRentang(pool, values.acara!, r, values.ya);
        if (!hasil.dihapus) {
          console.log(`${hasil.jumlah} RSVP acara ${values.acara} masuk dalam rentang ${keteranganRentang(r)}.`);
          console.log('Belum ada yang dihapus. Ulangi dengan --ya untuk menghapusnya.');
          return hasil.jumlah > 0 ? 1 : 0;
        }
        console.log(`${hasil.jumlah} RSVP acara ${values.acara} dihapus (${keteranganRentang(r)})`);
        return 0;
      }
      case 'ucapan:daftar': {
        const slug = positionals[0];
        if (!slug) throw new GalatAdmin('sebutkan slug acara');
        const daftar = await daftarUcapanAdmin(pool, slug);
        cetakTabel(
          ['id', 'tampil', 'dibuat_wib', 'nama', 'pesan'],
          daftar.map((u) => [u.id, u.tampil ? 'ya' : 'TIDAK', waktuLokal(u.dibuat), u.nama, u.pesan.replace(/\s+/g, ' ').slice(0, 80)]),
        );
        return 0;
      }
      case 'ucapan:sembunyikan':
      case 'ucapan:tampilkan': {
        const tampil = perintah === 'ucapan:tampilkan';
        const kata = tampil ? 'ditampilkan' : 'disembunyikan';
        const r = rentang();
        if (!r) {
          const id = idDari(positionals[0], 'ucapan');
          if (!(await aturTampilUcapan(pool, id, tampil))) throw new GalatAdmin(`ucapan ${id} tidak ditemukan`);
          console.log(`Ucapan ${id} ${kata}`);
          return 0;
        }
        const n = await aturTampilUcapanRentang(pool, values.acara!, r, tampil);
        console.log(`${n} ucapan acara ${values.acara} ${kata} (${keteranganRentang(r)})`);
        return 0;
      }
      default:
        console.error(`Perintah tidak dikenal: ${perintah}\n\n${BANTUAN}`);
        return 2;
    }
  } catch (e) {
    if (e instanceof GalatAdmin) {
      console.error(`GAGAL: ${e.message}`);
      return 1;
    }
    throw e;
  } finally {
    await pool.end();
  }
}

process.exitCode = await jalankan(process.argv.slice(2));
