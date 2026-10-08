import axios from 'axios';

const API = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api'
});

API.interceptors.request.use(config => {
  // Prevent token contamination on public/unauthenticated requests
  if (config.skipAuth) {
    if (config.headers) {
      delete config.headers.Authorization;
    }
    return config;
  }

  const token = localStorage.getItem('kisan_token');
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default API;
