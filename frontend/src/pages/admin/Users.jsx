import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';

export default function Users() {
    const navigate = useNavigate();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get('/admin/users')
            .then(res => setUsers(res.data))
            .catch(err => console.error(err))
            .finally(() => setLoading(false));
    }, []);

    const handleToggle = async (id) => {
        try {
            const res = await api.patch(`/admin/users/${id}/toggle`);
            setUsers(prev => prev.map(u => u.id === id ? { ...u, is_active: res.data.is_active } : u));
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to toggle user');
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Delete this user permanently?')) return;
        try {
            await api.delete(`/admin/users/${id}`);
            setUsers(prev => prev.filter(u => u.id !== id));
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to delete user');
        }
    };

    const roleBadge = (role) => {
        const styles = {
            admin: 'bg-red-100 text-red-600',
            manager: 'bg-purple-100 text-purple-600',
            agent: 'bg-blue-100 text-blue-600',
        };
        return (
            <span className={`${styles[role] || styles.agent} px-2 py-0.5 rounded-full text-xs font-semibold`}>
                {role}
            </span>
        );
    };

    if (loading) {
        return (
            <div className="p-4 sm:p-8 flex justify-center py-20">
                <div className="animate-spin rounded-full h-10 w-10 border-4 border-accent border-t-transparent"></div>
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-6 lg:p-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
                <h1 className="text-xl sm:text-2xl font-bold text-gray-800">Manage Users</h1>
                <button onClick={() => navigate('/admin/users/add')} className="btn-primary text-sm">+ Add User</button>
            </div>

            <div className="bg-white rounded-2xl shadow-card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                            <tr>
                                <th className="px-5 py-3 font-medium text-left">ID</th>
                                <th className="px-5 py-3 font-medium text-left">Username</th>
                                <th className="px-5 py-3 font-medium text-left">Role</th>
                                <th className="px-5 py-3 font-medium text-left">Status</th>
                                <th className="px-5 py-3 font-medium text-left hidden sm:table-cell">Created</th>
                                <th className="px-5 py-3 font-medium text-left">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(u => (
                                <tr key={u.id} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                                    <td className="px-5 py-3 text-gray-700 font-medium">{u.id}</td>
                                    <td className="px-5 py-3 text-gray-800 font-semibold">{u.username}</td>
                                    <td className="px-5 py-3">{roleBadge(u.role)}</td>
                                    <td className="px-5 py-3">
                                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${u.is_active ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                                            {u.is_active ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 text-gray-500 hidden sm:table-cell">
                                        {u.created_at ? new Date(u.created_at).toLocaleDateString('en-IN') : 'N/A'}
                                    </td>
                                    <td className="px-5 py-3">
                                        <div className="flex gap-2 flex-wrap">
                                            <button onClick={() => navigate(`/admin/users/edit/${u.id}`)} className="text-accent hover:underline text-xs font-medium">Edit</button>
                                            <button onClick={() => handleToggle(u.id)} className="text-orange-500 hover:underline text-xs font-medium">
                                                {u.is_active ? 'Deactivate' : 'Activate'}
                                            </button>
                                            <button onClick={() => handleDelete(u.id)} className="text-red-500 hover:underline text-xs font-medium">Delete</button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
