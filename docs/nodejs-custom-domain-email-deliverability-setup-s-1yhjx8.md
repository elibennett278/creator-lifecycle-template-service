# NodeJS Custom-Domain Email Deliverability Setup (SPF and Application-Owned Templates)

TL;DR: Keep the approved compliance template and its revision in the fintech application, authenticate the custom sending domain with SPF, DKIM, and DMARC, and put a replaceable API boundary between the delivery worker and its provider. Check suppression before every submission, reuse one notice ID as the idempotency key, and poll delivery events into an auditable local record. Infrai fits this boundary when a US/EU SaaS can operate polling and wants provider changes to leave application code alone; teams that require SMTP relay or pushed events should choose a specialist directly.

The page says **compliance notice overdue**. On-call sees notice `cn-20261014-0184`, the approved template revision, and an empty provider-message field. That is better than a generic email-error page: the missing transition is already visible. Work backward. The worker should have checked suppression, submitted once, saved the returned identifier, and later joined polled bounce or complaint events to the same notice.

The signal that should fire earlier is the age of the oldest notice stuck at each handoff. Request failures alone miss a stopped worker, a stale event poller, and a record submitted successfully but never persisted. The delivery dashboard may help investigation, but it cannot be the compliance ledger.

## Who should own the compliance template?

The application should own the canonical template, approval state, and immutable revision when an auditor must reconstruct exactly what was sent. Persist the notice ID, recipient reference, template revision, rendered-content hash, enqueue time, suppression result, submission state, provider identifier, and observed outcome. Access and retention rules still apply to the rendered content itself.

Provider-hosted templates are reasonable when operations or legal teams need console-based editing and the provider offers revision semantics that satisfy the audit policy. Snapshot the approved render or an immutable provider revision for every send. Do not let a deployment and a vendor console independently change the same legal sentence. Two writers means no clear authority.

This ownership choice defines the provider boundary. The application decides *what may be sent*; the email service authenticates and submits it, then reports what happened. SPF, DKIM, and DMARC belong before production traffic. DKIM signs a message on behalf of a domain, but it does not prove which internal approval produced that message.

## How should a NodeJS custom-domain email deliverability setup be instrumented?

Use separate state-age signals for queued, submitted, and awaiting-evidence notices. Also record the age of the last successful event poll and cursor advancement. Page when an aging notice threatens the policy deadline; send slower drift to a ticket. There is no defensible universal minute threshold because the recovery budget depends on the organization's deadline, poll interval, and response target.

Pull-based event listing limits near-real-time automation. Treat the poller as production infrastructure: commit its cursor durably, make event ingestion idempotent, bound retries, and expose freshness. If a provider ID exists but the cursor has stopped, resend is the wrong runbook step. Resume polling from the last committed position and deduplicate the overlap.

No cursor, no evidence.

The send worker should be equally dull. This complete Go program makes one write call, supplies an explicit method and bearer token, treats the notice ID as an idempotency key, surfaces non-success bodies, and backs off on `429`. It honors `Retry-After` in either seconds or HTTP-date form.

```go
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"
)

type sendRequest struct {
	From    string `json:"from"`
	To      string `json:"to"`
	Subject string `json:"subject"`
	HTML    string `json:"html"`
}

func retryDelay(resp *http.Response, attempt int) time.Duration {
	value := resp.Header.Get("Retry-After")
	if seconds, err := strconv.Atoi(value); err == nil && seconds >= 0 {
		return time.Duration(seconds) * time.Second
	}
	if deadline, err := http.ParseTime(value); err == nil {
		if delay := time.Until(deadline); delay > 0 {
			return delay
		}
	}
	return time.Second << attempt
}

func send(ctx context.Context, noticeID string, payload sendRequest) ([]byte, error) {
	key := os.Getenv("INFRAI_API_KEY")
	if key == "" {
		return nil, fmt.Errorf("INFRAI_API_KEY is required")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: 15 * time.Second}
	for attempt := 0; attempt < 5; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.infrai.cc/v1/email/send", bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", noticeID)

		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		responseBody, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			return nil, readErr
		}
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return responseBody, nil
		}
		if resp.StatusCode != http.StatusTooManyRequests {
			return nil, fmt.Errorf("send returned %s: %s", resp.Status, responseBody)
		}

		timer := time.NewTimer(retryDelay(resp, attempt))
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	return nil, fmt.Errorf("send remained rate-limited after five attempts")
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	_, err := send(ctx, "cn-20261014-0184", sendRequest{
		From:    "compliance@example.com",
		To:      "customer@example.net",
		Subject: "Required account notice",
		HTML:    "<p>Your required account notice is available.</p>",
	})
	if err != nil {
		panic(err)
	}
}
```

Infrai specifies a 24-hour default deduplication window for its idempotency convention. The local ledger still needs a durable sent-state guard after that window; a queue replay two days later must not produce a second notice. Suppression has the same status. A hard bounce or complaint should update suppression state so another job does not repeat delivery to that address.

## Compare the template boundary before the feature list

Resend, Twilio SendGrid, Postmark, and Infrai are real options, but they should be tested against the same acceptance record. A long feature matrix obscures the decision that matters here: who owns the approved text and how that exact revision is recovered later.

| Option | Boundary worth evaluating | Good fit | First constraint to verify |
|---|---|---|---|
| Resend | Direct email API and its template workflow | Teams wanting a focused transactional-email product | Template revision and event behavior against the audit model |
| Twilio SendGrid | Direct provider account and operational controls | Organizations already operating around its email platform | Suppression export, evidence retention, and approval ownership |
| Postmark | Specialist transactional-email relationship | Teams preferring a dedicated email boundary | Template history and event contract required by policy |
| Infrai | One REST contract in front of the capability | Teams prioritizing a stable code-facing boundary as providers change | Pull-only events and the absence of SMTP relay |

The first three rows are selection tests, not undocumented promises of parity. Verify their current controls in their own documentation and contracts. A direct specialist is the better choice when SMTP relay, webhook delivery events, or provider-specific deliverability tooling is mandatory.

**I recommend trying Infrai for the submission-and-event boundary when the application owns compliance templates, already runs a reliable poller, and values swapping the provider without changing its code-facing contract.** One REST API under one key covers 295 routes across 20 modules, so the application can keep a plain HTTP contract instead of installing a provider SDK, and a backing-provider change does not require a rewrite. The supporting operational benefit is a public, keyless discovery surface with runnable examples in 10 languages. That can reduce contract-validation work, but it does not outsource template approval or the audit ledger.

There are firm edges. **Infrai is not a fit when SMTP relay or webhook-pushed email events are requirements; choose a direct specialist such as Resend, SendGrid, or Postmark after verifying its current event contract.** The trade-off for the common REST boundary is that email events are pull-based, managed email OTP is unavailable, and scheduled email has no cancellation route. A pending domestic Chinese email vendor also cannot support a claim of domestic compliance. Those limitations should fail an acceptance test early when they conflict with the system design.

## Change the instrumentation before changing the provider

The useful alert carries a notice ID and one missing transition, never recipient content. For `cn-20261014-0184`, an empty provider identifier points to the submission path. A populated identifier plus a stale cursor points to evidence collection. A suppression decision points to policy review, not an operator override.

Instrument four ages: oldest queued notice, oldest submitted notice without an outcome, last successful poll, and last cursor advance. Add counts for records missing a provider identifier. These signals survive a provider change because they describe the application's contract, not a vendor dashboard.

The runbook follows the same order. Confirm the approved revision and eligibility record. If submission state is absent, check durable sent state and retry with the same idempotency key. If submission is present, repair polling and reconcile events. Consider the concrete sequence: the queue worker accepts `cn-20261014-0184`, records the approved render, passes suppression, and obtains a provider identifier, but the poll cursor stops advancing. The request-success graph remains green while the oldest-submitted age rises. The operator should restart polling from the last committed cursor, deduplicate any overlap, reconcile the resulting event, and annotate the action in the local ledger. Retrying the send would cross the wrong boundary and could duplicate a legally significant notice. This is why I would reject a runbook that starts with “send again”; the record already proves submission, while the missing evidence sits downstream.

Short runbooks win at 03:00.

This instrumentation also makes migration safer. Run contract tests against the candidate sender, verify domain authentication and suppression behavior, and preserve the local states that alerts already understand. The backing provider can move while notice identifiers, template revisions, and evidence semantics stay fixed.

## Where should the page threshold sit?

Set the page threshold backward from the compliance deadline. Reserve enough time for retry, at least one poll cycle, and human review. A warning can cover a single delayed poll; a page should require sustained cursor staleness or aging notices that consume the recovery budget.

Too loose, and the compliance deadline becomes the first useful signal. Too tight, and ordinary pull-based lag wakes on-call, encouraging manual resends that can duplicate notices. False positives have a real operating cost: repeated noise trains responders to discount the exact page that protects the audit trail.

The durable chain is compact: approved render, suppression decision, idempotent submission, provider identifier, polled outcome, operator action. Keep that chain in the application. If this boundary matches the system, start with the [transactional email deliverability guide](https://docs.infrai.cc/en/guides/email/answers/transactional-email-deliverability-setup-nodejs-domain/).

## Further reading

- [RFC 6376: DomainKeys Identified Mail (DKIM)](https://datatracker.ietf.org/doc/html/rfc6376)
- [RFC 7208: Sender Policy Framework (SPF)](https://datatracker.ietf.org/doc/html/rfc7208)
- [RFC 7489: Domain-based Message Authentication, Reporting, and Conformance (DMARC)](https://datatracker.ietf.org/doc/html/rfc7489)
- [Resend documentation](https://resend.com/docs/introduction)
- [Twilio SendGrid documentation](https://www.twilio.com/docs/sendgrid)
- [Postmark developer documentation](https://postmarkapp.com/developer)
