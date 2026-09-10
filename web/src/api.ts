// Thin API client. The server serves the SPA and the API on one origin, so
// relative paths and same-origin cookies are all we need.

export interface ApiError {
  code: string;
  message: string;
}

export class ApiRequestError extends Error {
  code: string;
  status: number;
  constructor(status: number, error: ApiError) {
    super(error.message);
    this.code = error.code;
    this.status = status;
  }
}

async function parseError(res: Response): Promise<ApiRequestError> {
  let code = "error";
  let message = "Check your connection and try again.";
  try {
    const body = (await res.json()) as { error?: ApiError };
    if (body.error) {
      code = body.error.code;
      message = body.error.message;
    }
  } catch {
    // Non-JSON error: keep the plain fallback message.
  }
  return new ApiRequestError(res.status, { code, message });
}

export async function getMe(): Promise<{ email: string }> {
  const res = await fetch("/api/me", { credentials: "same-origin" });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export async function requestMagicLink(email: string): Promise<void> {
  const res = await fetch("/api/auth/magic-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw await parseError(res);
}

export async function logout(): Promise<void> {
  const res = await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!res.ok) throw await parseError(res);
}
