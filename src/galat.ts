import type { FastifyReply } from 'fastify';

/** Bentuk galat yang sama di semua endpoint: { galat: kode-mesin, pesan: teks untuk manusia }. */
export function kirimGalat(reply: FastifyReply, status: number, galat: string, pesan: string) {
  return reply.code(status).send({ galat, pesan });
}
