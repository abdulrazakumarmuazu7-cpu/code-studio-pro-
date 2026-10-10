import { config } from '../config.js';

export function createAPIClient({ base = config.apiBase } = {}) {
  return {
    base,
    async request(path, options = {}) {
      const response = await fetch(`${base}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error?.message || 'Request failed');
      }

      return data;
    }
  };
}

export default createAPIClient;
