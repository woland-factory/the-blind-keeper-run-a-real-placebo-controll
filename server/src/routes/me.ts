import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireAuth } from "../http.js";

export async function registerMeRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/me",
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // requireAuth guarantees request.user is set.
      return reply.send({ email: request.user!.email });
    }
  );
}
