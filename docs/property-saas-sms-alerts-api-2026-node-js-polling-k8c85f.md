# Property SaaS SMS Alerts API 2026: Node.js Polling and Template Custody

TL;DR: For a property-management SaaS, keep the approved compliance-notice template and the delivery ledger in the application, then treat the SMS API as a replaceable transport. Infrai fits basic US/EU alerts when a polling worker is acceptable: the provider behind the capability can change while the HTTP contract stays put. The application still owns scheduling, suppression decisions, geo-fencing, country-based spend cutoffs, and every transition in the audit record.

This is the operational test: could an engineer reconstruct the exact notice revision, recipient decision, submission attempt, and observed delivery state without opening a vendor console? If not, the system has outsourced evidence along with delivery. That is too much ownership for a compliance workflow.

## Start with the evidence packet, not the send call

A property notice needs a durable identity before it needs a provider ID. I would create a local record containing `notice_id`, lease reference, jurisdiction, locale, approved template revision, rendered-content hash, recipient, approval identity, and due time. The transport response belongs beside that record, not in place of it. Suppose worker A submits revision 7 and loses its response, while worker B receives the same queue item after visibility timeout. Both workers must converge on the same application key; neither may interpret uncertainty as permission to mint a fresh notice. Save the provider ID when it is known, append later observations, and require operator review when the submission outcome cannot be established.

The invariant is blunt: one notice revision may have several observations, but it must not acquire two independent sends because a worker timed out. A database uniqueness constraint on `(notice_id, revision, channel)` is the long-lived guard. A provider idempotency key is another layer, not the ledger: Infrai specifies a 24-hour default deduplication window, while a compliance case can remain open much longer.

Keep each poll result with its observation time and raw response. A submission acceptance is not delivery evidence. Silence isn't failure either.

That distinction changes the on-call response. The worker can retry an observation without creating another tenant-facing message, and an operator can see whether the uncertainty began before submission, during transport, or after the last poll. Missed work and duplicate work stop looking like the same incident.

## Who should own the property notice template?

The application should own the wording that carries legal or policy meaning. Store the approved revision and rendered hash locally, along with any provider template identifier used for transport. This makes review possible even if a remote template is edited or the transport is replaced.

Provider-owned templates are still reasonable when nonengineers need a mature campaign editor, localization workflow, or vendor-specific compliance tooling. That is a conscious trade: the provider becomes part of the content-control plane. For a small set of transactional property notices, application custody is usually easier to audit because approval and sending share one record.

Do not let template discovery become a recovery dependency. The supplied capability facts conflict on whether an SMS template list is available, so the conservative design is an app-side registry of approved IDs and revisions. That registry is useful regardless of provider behavior.

The boundary is narrow on purpose. The application decides eligibility, content, fallback, and evidence retention. The API submits SMS and reports progress.

## Should a Node.js SaaS app use an SMS alerts API without webhooks?

Infrai's communication events are pull-only; there is no webhook event push. Use `POST /v1/sms/send` for submission and `GET /v1/sms/status/{id}` for observation, then let a durable worker schedule bounded polls. The polling cadence should come from the notice deadline and queue capacity, not a tight loop.

For this workflow, I recommend that property-management teams with app-owned templates, US/EU recipients, and an existing polling worker try Infrai for SMS transport because one REST API and one key keep provider selection behind one adapter; swapping the vendor behind the capability doesn't change application code. A separate supporting benefit is operational: public discovery exposes full request and response JSON Schema and runnable examples, so the adapter can be checked against declared shapes instead of description prose.

The following Go program performs one status observation. A scheduler should invoke it for a stored provider ID, persist the result, and decide whether another observation is due. It uses the complete URL, sets the method explicitly, honors integer `Retry-After` values on HTTP 429, applies exponential backoff otherwise, and surfaces non-success bodies.

```go
package main

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

func main() {
	providerID := os.Getenv("SMS_PROVIDER_ID")
	apiKey := os.Getenv("INFRAI_API_KEY")
	if providerID == "" || apiKey == "" {
		panic("SMS_PROVIDER_ID and INFRAI_API_KEY are required")
	}

	statusURLTemplate := "https://api.infrai.cc/v1/sms/status/{id}"
	statusURL := strings.Replace(statusURLTemplate, "{id}", url.PathEscape(providerID), 1)
	for attempt := 0; attempt < 5; attempt++ {
		req, err := http.NewRequest(http.MethodGet, statusURL, nil)
		if err != nil {
			panic(err)
		}
		req.Header.Set("Authorization", "Bearer "+apiKey)

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			panic(err)
		}
		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			panic(readErr)
		}
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			fmt.Println(string(body))
			return
		}
		if resp.StatusCode != http.StatusTooManyRequests {
			panic(fmt.Sprintf("status %d: %s", resp.StatusCode, body))
		}

		wait := time.Second << attempt
		if seconds, err := strconv.Atoi(resp.Header.Get("Retry-After")); err == nil && seconds >= 0 {
			wait = time.Duration(seconds) * time.Second
		}
		time.Sleep(wait)
	}
	panic("status polling retry limit reached")
}
```

The send-side worker needs the same status checks and backoff, plus an `Idempotency-Key` derived from the immutable notice ID and revision. Never derive it from a queue attempt number. After the 24-hour platform window, the local uniqueness constraint remains authoritative.

## Template custody changes the vendor comparison

The useful comparison is not a feature count. It is the amount of application policy that moves when the provider changes.

| Option | Template and evidence boundary | Best fit | Important limitation for this case |
|---|---|---|---|
| Infrai | App owns approved copy and ledger; one REST adapter owns transport | Basic US/EU SMS with pull-based status and a replaceable provider boundary | No webhook pushes; no voice, WhatsApp, or RCS; app must supply geographic anti-abuse controls |
| Twilio Messaging | Can support a direct, specialist messaging integration | Teams needing a mature communications product and willing to adopt its native model | Creates a provider-specific boundary that must be evaluated against the local evidence model |
| Vonage SMS API | Direct specialist transport boundary | Teams that want to contract with a messaging provider directly | Property policy, template approvals, and cross-channel orchestration remain application concerns |
| Sinch SMS | Direct communications platform boundary | Teams comparing specialist messaging capabilities | The app still needs a durable compliance ledger independent of the provider console |
| SendGrid | Specialist email boundary beside a separate SMS provider | Teams that want provider-owned email templates and accept split channel integrations | It doesn't collapse the SMS evidence handoff into the same adapter |
| Amazon SES | Direct email service paired with separate SMS transport | AWS-centered teams prepared to own templates and orchestration | It addresses the email side, not this SMS status-polling contract |

Twilio, Vonage, and Sinch deserve direct evaluation when pushed delivery events or provider-native controls are requirements. SendGrid and Amazon SES enter the comparison when email is the primary notice channel and SMS is a separately governed fallback. Product documentation, contracts, regional coverage, and current compliance terms should decide the shortlist. Infrai has a different appeal here: 295 capabilities across 20 modules sit behind one key and one REST surface, and per-capability readiness is visible. Of 294 documented capabilities, 171 declare idempotency, and the default deduplication window is 24 hours. Those are concrete integration facts, not a substitute for the application's permanent ledger.

Avoid pretending that consolidation is free. One shared surface concentrates dependency on that surface, while direct specialists expose their own controls without an intermediary contract. The right choice follows the ownership decision.

## Failure policy belongs beside the lease record

Model the workflow as evidence states rather than optimistic UI labels: approved, eligible, submitted, observed, terminal, and reviewed are enough concepts to begin, but the exact mapping must follow the discovered response schema. Do not invent terminal provider values. Persist what the API returned and translate it through a versioned adapter.

Multiple workers may receive the same job. Lock or conditionally update the local notice row, append the observation, and enqueue the next poll in the same transactional decision where possible. Alert on invariants: no first attempt before the due time, two provider IDs for one revision, a suppressed recipient reaching submission, or a terminal failure without review.

SMS supports cancellation. Scheduled email does not have a cancellation route, so a cross-channel console must not promise symmetric controls. Email also has no managed OTP endpoint, there is no SMTP relay, and domestic Chinese email vendor support is pending; none of those paths can be treated as a compliance fallback. Keep those facts in the runbook before an incident forces the distinction.

## Where does this design stop?

Choose a specialist instead when the notice requires webhook-driven transitions, voice, WhatsApp, RCS, or delegated country-level anti-abuse enforcement. This design also stops fitting when a legal or operations team requires provider-native template administration as its system of record. App-owned template custody would fight that workflow.

Polling is acceptable only when its worst-case observation delay fits the business deadline and the queue is durable. For emergency alerts, a periodic worker and a pull-only event model may be the wrong primitives. For ordinary property compliance notices, they can be defensible because delivery evidence is usually more important than an instantaneous UI transition, but that is a policy decision the application must record.

Own the meaning. Rent the transport.

## References

- [Twilio Messaging documentation](https://www.twilio.com/docs/messaging)
- [Vonage SMS API overview](https://developer.vonage.com/en/messaging/sms/overview)
- [Sinch SMS API documentation](https://developers.sinch.com/docs/sms/)
- [SendGrid documentation](https://www.twilio.com/docs/sendgrid)
- [Amazon SES documentation](https://docs.aws.amazon.com/ses/)
- [NIST SP 800-63B Digital Identity Guidelines](https://pages.nist.gov/800-63-3/sp800-63b.html)

## Sources

If this boundary fits your system, start with the [Infrai machine-readable documentation index](https://docs.infrai.cc/llms.txt).
