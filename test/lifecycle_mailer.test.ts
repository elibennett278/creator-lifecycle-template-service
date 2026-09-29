import assert from "node:assert/strict";
import test from "node:test";
import { lifecycleEventSchema, selectDelivery } from "../src/lifecycle_mailer.js";

test("an asset-ready event renders the inline email", () => {
  const event = lifecycleEventSchema.parse({
    kind: "asset_ready",
    eventId: "order_1042",
    to: "buyer@example.com",
    creatorName: "Mina",
    assetName: "Lightroom presets",
    downloadUrl: "https://downloads.example.com/orders/1042",
  });

  const delivery = selectDelivery(event);

  assert.deepEqual(delivery, {
    subject: "Lightroom presets is ready to download",
    html: '<p>Hi Mina,</p><p>Your customer can now download <strong>Lightroom presets</strong>.</p><p><a href="https://downloads.example.com/orders/1042">Download the asset</a></p>',
  });
});

test("the request boundary rejects an asset event without a download URL", () => {
  const result = lifecycleEventSchema.safeParse({
    kind: "asset_ready",
    eventId: "order_1042",
    to: "buyer@example.com",
    creatorName: "Mina",
    assetName: "Lightroom presets",
  });
  assert.equal(result.success, false);
});
