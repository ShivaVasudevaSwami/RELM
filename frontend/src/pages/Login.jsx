import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function Login() {
    const { login } = useAuth();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await login({ username, password });
        } catch (err) {
            setError(err.response?.data?.error || 'Login failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-surface flex items-center justify-center">
            <div className="bg-white rounded-2xl shadow-card p-10 w-full max-w-sm">
                <h1 className="text-2xl font-bold text-navy-900 text-center mb-2">
                    🏠 RE-LM
                </h1>
                <p className="text-sm text-gray-400 text-center mb-8">
                    Real Estate Lead Management
                </p>

                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm mb-4">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label htmlFor="username" className="form-label">Username</label>
                        <input
                            id="username"
                            type="text"
                            className="input-field"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                            autoFocus
                        />
                    </div>

                    <div className="mb-6">
                        <label htmlFor="password" className="form-label">Password</label>
                        <input
                            id="password"
                            type="password"
                            className="input-field"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="btn-primary w-full flex items-center justify-center gap-2"
                    >
                        {loading && (
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                        )}
                        {loading ? 'Signing in...' : 'Sign In'}
                    </button>
                </form>
            </div>
        </div>
    );
}
