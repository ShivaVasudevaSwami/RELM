import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function AdminManagerRoute() {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-surface">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-accent border-t-transparent"></div>
            </div>
        );
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (user.role !== 'admin' && user.role !== 'manager') {
        return <Navigate to="/dashboard" replace />;
    }

    return <Outlet />;
}
