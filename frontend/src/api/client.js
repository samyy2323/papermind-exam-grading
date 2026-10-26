import axios from 'axios';
import { API_BASE_URL } from './config';

export const AUTH_KEY = 'papermind.auth';

export const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000,
});

http.interceptors.request.use((config) => {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    const token = raw ? JSON.parse(raw).token : null;
    if (token) config.headers.Authorization = `Bearer ${token}`;
  } catch {
    /* ignore */
  }
  return config;
});

// An expired or invalid session sends the user back to the sign-in page.
http.interceptors.response.use(
  (res) => res,
  (err) => {
    const isAuthCall = err.config?.url?.startsWith('/auth/');
    if (err.response?.status === 401 && !isAuthCall) {
      try {
        localStorage.removeItem(AUTH_KEY);
      } catch {
        /* ignore */
      }
      if (window.location.pathname !== '/login') window.location.assign('/login');
    }
    return Promise.reject(err);
  },
);

export const data = (promise) => promise.then((res) => res.data);
