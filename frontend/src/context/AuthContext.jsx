import { createContext, useContext, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        api.get('/auth/me')
            .then(res => setUser(res.data.user))
            .catch(() => setUser(null))
            .finally(() => setLoading(false));
    }, []);

    const login = async (credentials) => {
        const res = await api.post('/auth/login', credentials);
        setUser(res.data.user);
        navigate('/dashboard');
        return res.data;
    };

    const logout = async () => {
        await api.post('/auth/logout');
        setUser(null);
        navigate('/login');
    };

    const isAdmin = user?.role === 'admin';
    const isAdminOrManager = user?.role === 'admin' || user?.role === 'manager';
    const isTelecaller = user?.role === 'telecaller';
    const isAgent = user?.role === 'agent';

    return (
        <AuthContext.Provider value={{ user, loading, login, logout, isAdmin, isAdminOrManager, isTelecaller, isAgent }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
}
