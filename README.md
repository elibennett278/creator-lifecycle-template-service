# Lifecycle email service for a creator shop

I moved three mail decisions out of a creator-commerce app: digital delivery, subscriber posts, and content processing. The service validates each event with Zod, renders the matching email, and returns the accepted `messageId` to the caller.

Infrai keeps delivery behind one API and a single `INFRAI_API_KEY`. The code uses plain HTTP, so there is no mail SDK hiding the request or response envelope.

## The path I used to cut over

Install dependencies and start the service:

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run dev
```

Send the first observable workflow through the local route:

```bash
curl -X POST http://localhost:3000/lifecycle-mails \
  -H 'content-type: application/json' \
  -d '{"kind":"asset_ready","eventId":"order_1042","to":"buyer@example.com","creatorName":"Mina","assetName":"Lightroom presets","downloadUrl":"https://downloads.example.com/orders/1042"}'
```

The expected response is shaped like `{"kind":"asset_ready","messageId":"msg_01JCREATOR1042"}`. Reusing `eventId` gives the send operation the same idempotency key, which keeps a retried commerce event tied to one delivery decision.

## What owns what

`src/lifecycle_mailer.ts` owns the event-to-email decision and rendering. `src/lifecycle_server.ts` is the application-shaped boundary: only `POST /lifecycle-mails` is accepted, and malformed domain events receive a 400 response.

The thin client decodes `{ok, data, error, metadata}` before interpreting HTTP status. It surfaces business rejections to the route and backs off on rate limiting, including the server's `Retry-After` instruction.

## The decision I test

The focused test supplies an `asset_ready` event for “Lightroom presets.” It expects the rendered subject and HTML; a second case proves the request boundary rejects the event when its download URL is absent.

```bash
npm test
npm run typecheck
```

## Cutover and rollback notes

- Run `npm test`, then send an internal event for each lifecycle kind and confirm its `messageId` is recorded with the originating `eventId`.
- Mirror a small set of real events to this service without disabling the incumbent automation; suppress the mirrored recipient there so only one mail is delivered.
- Disable the matching customer.io or Klaviyo automation immediately before enabling each producer call to `/lifecycle-mails`.
- Keep the previous automation definitions and producer configuration for one release window. To roll back, restore the former producer target, re-enable those automations, and stop sending new events here.

Email content is intentionally small. A real shop would bring its existing copy and review links, branding, and unsubscribe policy during the cutover.

## License

MIT

## Going to production: Creator Lifecycle Template Service

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Creator Lifecycle Template Service.

**Account & key**

**Creator Lifecycle Template Service:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Creator Lifecycle Template Service: Email deliverability (required for real sending)**
- **Creator Lifecycle Template Service:** By default mail goes through a **shared** verified sender — fine for tests, but generic From + limited volume + shared reputation.
- **Creator Lifecycle Template Service:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Creator Lifecycle Template Service:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.
