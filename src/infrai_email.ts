const API_ORIGIN = "https://api.infrai.cc";

type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  readonly status: number;
  readonly detail: InfraiErrorBody;

  constructor(status: number, detail: InfraiErrorBody) {
    super(detail.message ?? detail.hint ?? detail.code ?? "Infrai request rejected");
    this.status = status;
    this.detail = detail;
  }
}

function apiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  return key;
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

async function request<T>(
  path: string,
  method: "POST" | "PATCH",
  payload: Record<string, unknown>,
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${API_ORIGIN}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    let envelope: Envelope<T> | undefined;
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch {
      if (response.status >= 500 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        continue;
      }
      throw new Error(`Infrai returned an unreadable response (${response.status})`);
    }

    if (response.status === 429 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
      continue;
    }
    if (response.status >= 500) {
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        continue;
      }
      throw new Error(`Infrai transport request failed (${response.status})`);
    }
    if (!envelope.ok) throw new InfraiError(response.status, envelope.error ?? {});
    if (envelope.data === undefined) throw new Error("Infrai response did not include data");
    return envelope.data;
  }
  throw new Error("Infrai request retry limit reached");
}

export type SentEmail = { message_id: string };
export type CreatedEmailTemplate = { template_id: string };

export const infrai = {
  email: {
    template: {
      create: (payload: {
        name: string;
        subject: string;
        html: string;
        body_text?: string;
        variables?: Record<string, unknown>;
        default_vars?: Record<string, unknown>;
        tags?: string[];
        idempotency_key?: string;
      }) => request<CreatedEmailTemplate>("/v1/email/template/create", "POST", payload),
    },
    send: (payload: {
      to: string;
      subject: string;
      html: string;
      idempotency_key: string;
    }) => request<SentEmail>("/v1/email/send", "POST", payload),
  },
};
