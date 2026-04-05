const BASE = "/api";

async function request(method: string, path: string, body?: any) {
  const opts: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "BirdDog",  // CSRF protection — server requires this on mutating requests
    },
    credentials: "include",
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE}${path}`, opts);

  if (res.status === 401) {
    // Redirect to login
    window.location.hash = "#/login";
    throw new Error("Not authenticated");
  }

  // Safely parse JSON — handle cases where server returns non-JSON
  let data: any;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(text || `Request failed (${res.status})`);
  }

  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export const api = {
  get: (path: string) => request("GET", path),
  post: (path: string, body: any) => request("POST", path, body),
  put: (path: string, body: any) => request("PUT", path, body),
  patch: (path: string, body: any) => request("PATCH", path, body),
  del: (path: string) => request("DELETE", path),
};

// Auth helpers
export const auth = {
  login: (username: string, password: string) =>
    request("POST", "/auth/login", { username, password }),
  logout: () => request("POST", "/auth/logout"),
  me: () => request("GET", "/auth/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    request("POST", "/auth/change-password", { currentPassword, newPassword }),
};
