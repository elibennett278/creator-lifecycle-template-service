import { createServer } from "node:http";
import { ZodError } from "zod";
import { InfraiError } from "./infrai_email.js";
import {
  deliverLifecycleMail,
  lifecycleEventSchema,
} from "./lifecycle_mailer.js";

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.method !== "POST" || request.url !== "/lifecycle-mails") {
    response.writeHead(404).end(JSON.stringify({ error: "route_not_found" }));
    return;
  }

  try {
    const event = lifecycleEventSchema.parse(await readJson(request));
    const result = await deliverLifecycleMail(event);
    response.writeHead(202).end(JSON.stringify(result));
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      response.writeHead(400).end(JSON.stringify({ error: "invalid_request" }));
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      response.writeHead(status).end(JSON.stringify({ error: error.detail.code ?? "delivery_rejected" }));
      return;
    }
    console.error(error);
    response.writeHead(500).end(JSON.stringify({ error: "internal_error" }));
  }
});

const port = Number(process.env.PORT ?? "3000");
server.listen(port, () => console.log(`Lifecycle mail service listening on http://localhost:${port}`));
