import axios from 'axios';

// In production (Render), frontend is served by the same Express server,
// so we use a relative URL. In development, we point to localhost:3001.
const baseURL = import.meta.env.PROD
    ? '/api'
    : 'http://localhost:3001/api';

const api = axios.create({
    baseURL,
    withCredentials: true,
    headers: {
        'Content-Type': 'application/json'
    }
});

export default api;
