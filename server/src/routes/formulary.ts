import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireAuth } from "../http.js";
import { buildExport, listFormulary } from "../formulary.js";

export async function registerFormularyRoutes(app: FastifyInstance): Promise<void> {
  // The personal formulary: the requesting user's finished runs as cards. A
  // read, so the global limiter is enough. Owner-scoped and finished-only.
  app.get(
    "/api/formulary",
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const cards = await listFormulary(app.db, request.user!.id);
      return reply.send({ cards });
    }
  );

  // The portable export: the same finished runs in full, as a downloadable
  // JSON file. Owner-scoped; a sealed run and its allocation never appear.
  app.get(
    "/api/formulary/export",
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const data = await buildExport(app.db, request.user!.id, request.user!.email);
      return reply
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Content-Disposition", 'attachment; filename="blind-keeper-export.json"')
        .send(data);
    }
  );
}
