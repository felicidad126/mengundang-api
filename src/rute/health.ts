import type { FastifyInstance } from 'fastify';
import type pg from 'pg';

export async function ruteHealth(app: FastifyInstance, { pool }: { pool: pg.Pool }) {
  app.get('/health', async (req, reply) => {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok' };
    } catch (err) {
      req.log.error({ err }, 'database tidak bisa dihubungi');
      return reply.code(503).send({ status: 'database_tidak_tersedia' });
    }
  });
}
