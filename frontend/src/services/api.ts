const origin = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
let csrfToken = "";
export const setCsrfToken = (value: string) => {
  csrfToken = value;
};
export const apiUrl = (path: string) => `${origin}${path}`;
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body) headers.set("Content-Type", "application/json");
  if (options.method && !["GET", "HEAD"].includes(options.method.toUpperCase()))
    headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(apiUrl(`/api${path}`), {
    ...options,
    headers,
    credentials: "include",
  });
  const result = (await response.json().catch(() => null)) as {
    data?: T;
    error?: {
      message?: string;
      code?: string;
      details?: {
        fieldErrors?: Record<string, string[]>;
        formErrors?: string[];
      };
    };
  } | null;
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event("session-expired"));
    const details = result?.error?.details;
    const fields = Object.entries(details?.fieldErrors ?? {}).flatMap(
      ([field, messages]) =>
        messages.map(
          (message) =>
            `${field.replace(/([A-Z])/g, " $1").toLowerCase()}: ${message}`,
        ),
    );
    const messages = [...(details?.formErrors ?? []), ...fields];
    throw new ApiError(
      messages.length
        ? messages.slice(0, 3).join(" · ")
        : (result?.error?.message ??
            `Request failed (${response.status}). Please try again.`),
      response.status,
      result?.error?.code,
    );
  }
  if (!result || !("data" in result))
    throw new ApiError(
      "The server returned an unexpected response.",
      response.status,
    );
  return result.data as T;
}
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
