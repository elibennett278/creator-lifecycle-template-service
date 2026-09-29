import { z } from "zod";
import { infrai } from "./infrai_email.js";

export const lifecycleEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("asset_ready"),
    eventId: z.string().min(1),
    to: z.string().email(),
    creatorName: z.string().min(1),
    assetName: z.string().min(1),
    downloadUrl: z.string().url(),
  }),
  z.object({
    kind: z.literal("subscriber_update"),
    eventId: z.string().min(1),
    to: z.string().email(),
    creatorName: z.string().min(1),
    updateTitle: z.string().min(1),
    updateUrl: z.string().url(),
  }),
  z.object({
    kind: z.literal("content_processed"),
    eventId: z.string().min(1),
    to: z.string().email(),
    creatorName: z.string().min(1),
    contentTitle: z.string().min(1),
    dashboardUrl: z.string().url(),
  }),
]);

export type LifecycleEvent = z.infer<typeof lifecycleEventSchema>;
export type TemplateKey = LifecycleEvent["kind"];
export type TemplateIds = Record<TemplateKey, string>;
export const templateDrafts: Record<TemplateKey, { subject: string; html: string }> = {
  asset_ready: {
    subject: "Your asset is ready to download",
    html: "<p>Your digital asset is ready to download.</p>",
  },
  subscriber_update: {
    subject: "A new subscriber update is available",
    html: "<p>A new subscriber update is available.</p>",
  },
  content_processed: {
    subject: "Your content has finished processing",
    html: "<p>Your content has finished processing.</p>",
  },
};
export type DeliveryChoice = {
  subject: string;
  html: string;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

export function selectDelivery(event: LifecycleEvent): DeliveryChoice {
  switch (event.kind) {
    case "asset_ready":
      return {
        subject: `${event.assetName} is ready to download`,
        html: `<p>Hi ${escapeHtml(event.creatorName)},</p><p>Your customer can now download <strong>${escapeHtml(event.assetName)}</strong>.</p><p><a href="${escapeHtml(event.downloadUrl)}">Download the asset</a></p>`,
      };
    case "subscriber_update":
      return {
        subject: `New from ${event.creatorName}: ${event.updateTitle}`,
        html: `<p>${escapeHtml(event.creatorName)} posted a subscriber update.</p><p><a href="${escapeHtml(event.updateUrl)}">Read ${escapeHtml(event.updateTitle)}</a></p>`,
      };
    case "content_processed":
      return {
        subject: `Processing finished for ${event.contentTitle}`,
        html: `<p>Hi ${escapeHtml(event.creatorName)},</p><p>${escapeHtml(event.contentTitle)} has finished processing.</p><p><a href="${escapeHtml(event.dashboardUrl)}">Open the dashboard</a></p>`,
      };
  }
}

export async function deliverLifecycleMail(event: LifecycleEvent) {
  const delivery = selectDelivery(event);
  const sent = await infrai.email.send({
    to: event.to,
    subject: delivery.subject,
    html: delivery.html,
    idempotency_key: `lifecycle-${event.eventId}`,
  });
  return { kind: event.kind, messageId: sent.message_id };
}
