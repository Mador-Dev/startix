import axios from "axios";

const getToken = (): string | null => {
  try {
    const raw = localStorage.getItem("auth-storage");
    if (!raw) return null;
    return JSON.parse(raw)?.state?.token ?? null;
  } catch {
    return null;
  }
};

const baseURL =
  (import.meta.env.VITE_AGENTS_API_BASE_URL as string | undefined)?.trim() ||
  "http://localhost:8090/api";

export const agentsApiClient = axios.create({
  baseURL,
  timeout: 30000,
});

agentsApiClient.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers["Authorization"] = `Bearer ${token}`;
  }
  return config;
});

agentsApiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("auth-storage");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);
