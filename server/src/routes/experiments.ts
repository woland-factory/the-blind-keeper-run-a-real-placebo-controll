import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { errorEnvelope, requireAuth } from "../http.js";
import { publicTemplates } from "../templates.js";
import {
  confirmPrep,
  createExperiment,
  createSchema,
  ExperimentError,
  getExperimentSummary,
  getPrep,
  previewDesign,
  previewSchema,
} from "../experiments.js";

const idSchema = z.string().uuid();

export async function registerExperimentRoutes(app: FastifyInstance): Promise<void> {
  // Dedicated bucket for the lock mutation, separate from the global limiter.
  const mutationLimit = {
    rateLimit: { max: app.env.MUTATION_RATE_LIMIT_MAX, timeWindow: "1 minute" },
  };

  app.get(
    "/api/experiments/templates",
    { preHandler: requireAuth },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({ templates: publicTemplates() });
    }
  );

  app.post(
    "/api/experiments/preview",
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = previewSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(errorEnvelope("invalid_input", "Check the design values and try again."));
      }
      return reply.send(previewDesign(parsed.data));
    }
  );

  app.post(
    "/api/experiments",
    { preHandler: requireAuth, config: mutationLimit },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send(errorEnvelope("invalid_input", "Check the design values and try again."));
      }
      try {
        const summary = await createExperiment(app.db, request.user!.id, parsed.data);
        return reply.code(201).send(summary);
      } catch (err) {
        if (err instanceof ExperimentError) {
          return reply.code(err.status).send(errorEnvelope(err.code, err.message));
        }
        throw err;
      }
    }
  );

  app.get(
    "/api/experiments/:id",
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = z.object({ id: idSchema }).safeParse(request.params);
      if (!params.success) {
        return reply.code(404).send(errorEnvelope("not_found", "That experiment does not exist."));
      }
      const summary = await getExperimentSummary(app.db, request.user!.id, params.data.id);
      if (!summary) {
        return reply.code(404).send(errorEnvelope("not_found", "That experiment does not exist."));
      }
      return reply.send(summary);
    }
  );

  // Blind-safe prep read: codes and neutral batch tokens only, no schedule.
  // A read, so the global limiter is enough. Allowed once the codes exist
  // (prepped and running); it does not gate on status.
  app.get(
    "/api/experiments/:id/prep",
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = z.object({ id: idSchema }).safeParse(request.params);
      if (!params.success) {
        return reply.code(404).send(errorEnvelope("not_found", "That experiment does not exist."));
      }
      const prep = await getPrep(app.db, request.user!.id, params.data.id);
      if (!prep) {
        return reply.code(404).send(errorEnvelope("not_found", "That experiment does not exist."));
      }
      return reply.send(prep);
    }
  );

  // Confirm-ready: start the run. Mutation, so it uses the dedicated bucket.
  app.post(
    "/api/experiments/:id/confirm-prep",
    { preHandler: requireAuth, config: mutationLimit },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = z.object({ id: idSchema }).safeParse(request.params);
      if (!params.success) {
        return reply.code(404).send(errorEnvelope("not_found", "That experiment does not exist."));
      }
      try {
        const summary = await confirmPrep(app.db, request.user!.id, params.data.id);
        if (!summary) {
          return reply.code(404).send(errorEnvelope("not_found", "That experiment does not exist."));
        }
        return reply.send(summary);
      } catch (err) {
        if (err instanceof ExperimentError) {
          return reply.code(err.status).send(errorEnvelope(err.code, err.message));
        }
        throw err;
      }
    }
  );
}
