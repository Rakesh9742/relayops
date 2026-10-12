export async function api<T = any>(path: string, data?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...(data !== undefined
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      : {}),
  });
  const body = await res.json();
  if (!res.ok)
    throw Object.assign(new Error(body.error ?? "Something went wrong"), {
      status: res.status,
    });
  return body;
}
