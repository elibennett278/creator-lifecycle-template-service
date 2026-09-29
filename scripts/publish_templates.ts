import { randomUUID } from "node:crypto";
import { infrai } from "../src/infrai_email.js";
import { templateDrafts, type TemplateIds, type TemplateKey } from "../src/lifecycle_mailer.js";

const release = process.env.TEMPLATE_RELEASE ?? new Date().toISOString().replace(/[:.]/g, "-");
const publicationId = randomUUID();
const ids = {} as TemplateIds;

for (const [kind, draft] of Object.entries(templateDrafts) as Array<
  [TemplateKey, (typeof templateDrafts)[TemplateKey]]
>) {
  const created = await infrai.email.template.create({
    name: `creator-lifecycle-${release}-${publicationId}-${kind}`,
    subject: draft.subject,
    html: draft.html,
    idempotency_key: `template-${publicationId}-${kind}`,
  });
  ids[kind] = created.template_id;
}

console.log(JSON.stringify(ids, null, 2));
