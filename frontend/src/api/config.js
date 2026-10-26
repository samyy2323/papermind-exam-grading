// The Vite dev server proxies /api to the FastAPI backend; set VITE_API_BASE_URL to point elsewhere.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
