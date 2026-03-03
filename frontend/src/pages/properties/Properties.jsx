import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

export default function Properties() {
    const navigate = useNavigate();
    const { isAdminOrManager } = useAuth();
    const [properties, setProperties] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('All');

    useEffect(() => { fetchProperties(); }, []);

    const fetchProperties = async () => {
        try {
            const res = await api.get('/properties');
            setProperties(Array.isArray(res.data) ? res.data : []);
        } catch (err) {
            console.error('Error loading properties', err);
        } finally { setLoading(false); }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Delete this property permanently?')) return;
        try {
            await api.delete(`/properties/${id}`);
            setProperties(prev => prev.filter(p => p.id !== id));
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to delete property');
        }
    };

    const handleToggleAvailability = async (propertyId, currentStatus) => {
        const newStatus = currentStatus === 1 ? 0 : 1;
        const confirmMsg = newStatus === 0
            ? 'Mark this property as Sold?'
            : 'Mark this property as Available again?';
        if (!window.confirm(confirmMsg)) return;
        try {
            await api.put(`/properties/${propertyId}`, { is_available: newStatus });
            setProperties(prev => prev.map(p =>
                p.id === propertyId ? { ...p, is_available: newStatus } : p
            ));
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to update property status.');
        }
    };

    const formatLakhs = (price) => (!price ? '0.00' : (price / 100000).toFixed(2));

    const typeBadge = (type) => {
        const colors = {
            Flat: 'bg-blue-100 text-blue-600',
            Villa: 'bg-purple-100 text-purple-600',
            Plot: 'bg-green-100 text-green-600',
        };
        return (
            <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-semibold ${colors[type] || 'bg-gray-100 text-gray-600'}`}>
                {type}
            </span>
        );
    };

    const filtered = properties.filter(p => {
        if (!p) return false;
        if (filter === 'All') return true;
        if (filter === 'Available') return p.is_available === 1;
        if (filter === 'Sold') return p.is_available === 0;
        return p.property_type === filter;
    });

    const totalCount = properties.length;
    const availableCount = properties.filter(p => p.is_available === 1).length;
    const soldCount = properties.filter(p => p.is_available === 0).length;
    const flatCount = properties.filter(p => p.property_type === 'Flat').length;

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
                <h1 className="text-xl sm:text-2xl font-bold text-gray-800">Properties</h1>
                {isAdminOrManager && (
                    <button onClick={() => navigate('/properties/add')} className="btn-primary text-sm">+ Add Property</button>
                )}
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
                <div className="stat-card">
                    <span className="text-2xl font-bold text-gray-800">{totalCount}</span>
                    <span className="text-sm text-gray-500">Total</span>
                </div>
                <div className="stat-card">
                    <span className="text-2xl font-bold text-green-600">{availableCount}</span>
                    <span className="text-sm text-gray-500">Available</span>
                </div>
                <div className="stat-card">
                    <span className="text-2xl font-bold text-red-500">{soldCount}</span>
                    <span className="text-sm text-gray-500">Sold</span>
                </div>
                <div className="stat-card">
                    <span className="text-2xl font-bold text-blue-500">{flatCount}</span>
                    <span className="text-sm text-gray-500">Flats</span>
                </div>
            </div>

            {/* Filter Buttons */}
            <div className="flex gap-2 mb-6 flex-wrap overflow-x-auto pb-1">
                {['All', 'Flat', 'Villa', 'Plot', 'Available', 'Sold'].map(f => (
                    <button key={f} onClick={() => setFilter(f)}
                        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${filter === f ? 'bg-accent text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}>{f}</button>
                ))}
            </div>

            {filtered.length === 0 ? (
                <div className="bg-white rounded-2xl shadow-card p-12 text-center text-gray-400">No properties found.</div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
                    {filtered.map(p => {
                        const isSold = p.is_available === 0;
                        return (
                            <div key={p.id} className={`card relative ${isSold ? 'opacity-80 border-2 border-red-200 bg-red-50/50' : 'border-2 border-transparent'}`}>
                                {/* Status Badge — top right */}
                                <div className="absolute top-3 right-3">
                                    {isSold ? (
                                        <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">🔴 SOLD</span>
                                    ) : (
                                        <span className="bg-green-100 text-green-600 text-xs font-semibold px-2 py-1 rounded-full">✓ Available</span>
                                    )}
                                </div>

                                <div className="flex items-start justify-between mb-2 pr-20">
                                    <h3 className="text-base font-bold text-gray-800 truncate flex-1">{p.property_name}</h3>
                                    {typeBadge(p.property_type)}
                                </div>
                                <p className="text-sm text-gray-600 mb-1">{p.area}, {p.city}, {p.state}</p>
                                <div className="flex items-center gap-3 mb-2">
                                    <span className="text-lg font-bold text-accent">₹{formatLakhs(p.price_inr)} Lakhs</span>
                                    <span className="text-sm text-gray-400">{p.size_sqft} sq.ft.</span>
                                </div>
                                <div className="flex items-center gap-2 mb-3">
                                    {p.added_by_name && <span className="text-xs text-gray-400">Added by: {p.added_by_name}</span>}
                                </div>
                                {p.description && <p className="text-xs text-gray-400 mb-3 line-clamp-2">{p.description}</p>}
                                <div className="flex gap-2 pt-3 border-t border-gray-100 flex-wrap">
                                    <button onClick={() => navigate(`/properties/${p.id}`)}
                                        className="bg-blue-50 text-blue-600 hover:bg-blue-100 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
                                        View Details
                                    </button>
                                    {isAdminOrManager && (
                                        <>
                                            <button onClick={() => navigate(`/properties/edit/${p.id}`)} className="btn-secondary text-xs px-3 py-1.5">Edit</button>
                                            <button
                                                onClick={() => handleToggleAvailability(p.id, p.is_available)}
                                                className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${isSold
                                                    ? 'bg-green-100 text-green-600 hover:bg-green-200'
                                                    : 'bg-red-100 text-red-600 hover:bg-red-200'
                                                    }`}
                                            >
                                                {isSold ? '✓ Mark Available' : '✗ Mark Sold'}
                                            </button>
                                            <button onClick={() => handleDelete(p.id)} className="btn-danger text-xs px-3 py-1.5">Delete</button>
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
