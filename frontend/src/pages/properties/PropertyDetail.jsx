import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

export default function PropertyDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { isAdminOrManager } = useAuth();
    const [property, setProperty] = useState(null);
    const [matchingLeads, setMatchingLeads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [toggling, setToggling] = useState(false);

    useEffect(() => {
        api.get(`/properties/${id}`)
            .then(res => {
                setProperty(res.data.property);
                setMatchingLeads(res.data.matchingLeads || []);
            })
            .catch(err => setError(err.response?.data?.error || 'Failed to load property'))
            .finally(() => setLoading(false));
    }, [id]);

    const formatLakhs = (price) => (!price ? '0.00' : (price / 100000).toFixed(2));
    const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

    const handleToggle = async () => {
        if (!property) return;
        const newStatus = property.is_available === 1 ? 0 : 1;
        const msg = newStatus === 0 ? 'Mark this property as Sold?' : 'Mark this property as Available again?';
        if (!window.confirm(msg)) return;
        setToggling(true);
        try {
            await api.put(`/properties/${id}`, { is_available: newStatus });
            setProperty(prev => ({ ...prev, is_available: newStatus }));
        } catch (err) {
            alert(err.response?.data?.error || 'Failed to update');
        } finally { setToggling(false); }
    };

    const parseExtra = (raw) => {
        if (!raw) return null;
        try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
        catch { return null; }
    };

    if (loading) {
        return (
            <div className="p-4 sm:p-8 flex justify-center py-20">
                <div className="animate-spin rounded-full h-10 w-10 border-4 border-accent border-t-transparent"></div>
            </div>
        );
    }

    if (error || !property) {
        return (
            <div className="p-4 sm:p-8">
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">{error || 'Property not found'}</div>
            </div>
        );
    }

    const isSold = property.is_available === 0;
    const extra = parseExtra(property.extra_details);
    const propType = property.property_type;
    const colorMap = { Flat: 'blue', Villa: 'blue', Plot: 'blue' };
    const iconMap = { Flat: '🏢', Villa: '🏡', Plot: '📐' };
    const color = colorMap[propType] || 'gray';

    return (
        <div className="p-4 sm:p-6 lg:p-8">
            {/* ── Header Section ── */}
            <div className="bg-white rounded-2xl shadow-card p-4 sm:p-8 mb-6">
                <div className="flex flex-col sm:flex-row items-start justify-between gap-4 mb-4">
                    <div>
                        <div className="flex items-center gap-3 flex-wrap">
                            <h1 className="text-xl sm:text-2xl font-bold text-gray-800">{property.property_name}</h1>
                            <span className={`inline-block text-xs px-2.5 py-1 rounded-full font-semibold ${propType === 'Flat' ? 'bg-blue-100 text-blue-600' :
                                propType === 'Villa' ? 'bg-purple-100 text-purple-600' :
                                    'bg-green-100 text-green-600'
                                }`}>
                                {propType}
                            </span>
                        </div>
                        <p className="text-sm text-gray-500 mt-1">Property #{property.id}</p>
                    </div>
                    <div className="text-left sm:text-right">
                        {isSold ? (
                            <span className="inline-flex items-center gap-1 bg-red-500 text-white text-sm font-bold px-4 py-2 rounded-full">🔴 SOLD</span>
                        ) : (
                            <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-sm font-bold px-4 py-2 rounded-full">🟢 AVAILABLE</span>
                        )}
                    </div>
                </div>

                {/* Price & Location Hero */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                    <div className="bg-gradient-to-br from-accent/10 to-accent/5 rounded-xl p-4">
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Price</p>
                        <p className="text-xl font-bold text-accent">₹{formatLakhs(property.price_inr)} Lakhs</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4">
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Location</p>
                        <p className="text-sm font-semibold text-gray-800">{property.location}</p>
                        <p className="text-xs text-gray-500">{property.area}, {property.city}, {property.state}</p>
                    </div>
                    <div className="bg-gray-50 rounded-xl p-4">
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Size</p>
                        <p className="text-lg font-bold text-gray-800">{property.size_sqft} sq.ft.</p>
                    </div>
                </div>

                {property.description && (
                    <div className="bg-gray-50 rounded-xl p-4 mb-4">
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Description</p>
                        <p className="text-sm text-gray-700">{property.description}</p>
                    </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-2 sm:gap-3">
                    <button onClick={() => navigate('/properties')} className="btn-secondary text-sm">← Back to Properties</button>
                    {isAdminOrManager && (
                        <>
                            <button onClick={() => navigate(`/properties/edit/${id}`)} className="btn-primary text-sm">Edit Property</button>
                            <button onClick={handleToggle} disabled={toggling}
                                className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors ${isSold
                                    ? 'bg-green-100 text-green-600 hover:bg-green-200'
                                    : 'bg-red-100 text-red-600 hover:bg-red-200'
                                    }`}>
                                {toggling ? 'Updating...' : (isSold ? '✓ Mark Available' : '✗ Mark Sold')}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* ── Specifications Card (Blue) ── */}
            {extra && Object.keys(extra).length > 0 && (
                <div className={`bg-${color}-50 border border-${color}-200 rounded-2xl p-4 sm:p-6 mb-6`}>
                    <p className={`text-xs font-semibold text-${color}-600 uppercase mb-4`}>{iconMap[propType] || '📋'} {propType} Specifications</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                        {Object.entries(extra)
                            .filter(([, v]) => v !== '' && v !== null && v !== undefined)
                            .map(([k, v]) => (
                                <div key={k} className="bg-white rounded-xl p-3 shadow-sm">
                                    <p className="text-xs text-gray-500 capitalize mb-1">{k.replace(/_/g, ' ')}</p>
                                    <p className="text-sm font-semibold text-gray-800">
                                        {typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}
                                    </p>
                                </div>
                            ))}
                    </div>
                </div>
            )}

            {/* ── Back-Office Details ── */}
            <div className="bg-white rounded-2xl shadow-card p-4 sm:p-6 mb-6">
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Back-Office Details</h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                        <p className="text-xs text-gray-400 uppercase">Added By</p>
                        <p className="text-sm font-semibold text-gray-800 mt-1">{property.added_by_name || '—'}</p>
                    </div>
                    <div>
                        <p className="text-xs text-gray-400 uppercase">Created</p>
                        <p className="text-sm font-semibold text-gray-800 mt-1">{formatDate(property.created_at)}</p>
                    </div>
                    <div>
                        <p className="text-xs text-gray-400 uppercase">Last Updated</p>
                        <p className="text-sm font-semibold text-gray-800 mt-1">{formatDate(property.updated_at)}</p>
                    </div>
                    <div>
                        <p className="text-xs text-gray-400 uppercase">Country</p>
                        <p className="text-sm font-semibold text-gray-800 mt-1">{property.country || 'India'}</p>
                    </div>
                </div>
            </div>

            {/* ── Reverse Matching: Active Leads ── */}
            <div className="mb-6">
                <h2 className="text-lg font-semibold text-gray-700 mb-4 border-l-4 border-accent pl-4">
                    🔍 Matching Active Leads
                    <span className="ml-2 text-sm font-normal text-gray-400">({matchingLeads.length} found)</span>
                </h2>
                <div className="bg-white rounded-2xl shadow-card overflow-hidden">
                    {matchingLeads.length === 0 ? (
                        <p className="text-gray-400 text-sm p-5">No active leads match this property's specs.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                                    <tr>
                                        <th className="px-5 py-3 font-medium text-left">Lead Name</th>
                                        <th className="px-5 py-3 font-medium text-left">Phone</th>
                                        <th className="px-5 py-3 font-medium text-left">Budget</th>
                                        <th className="px-5 py-3 font-medium text-left">Location</th>
                                        <th className="px-5 py-3 font-medium text-left">Status</th>
                                        <th className="px-5 py-3 font-medium text-left">Match</th>
                                        <th className="px-5 py-3 font-medium text-left">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {matchingLeads.map(lead => {
                                        // Determine match badges
                                        const badges = [];
                                        if (lead.preferred_property_type === propType) badges.push('Type');
                                        if (lead.preferred_city === property.city) badges.push('City');
                                        // BHK matching
                                        const leadExtra = parseExtra(lead.extra_details);
                                        if (leadExtra && extra) {
                                            const leadBhk = leadExtra.bhk_config || leadExtra.configuration;
                                            const propBhk = extra.bhk_config || extra.configuration;
                                            if (leadBhk && propBhk && leadBhk === propBhk) badges.push('BHK');
                                        }
                                        return (
                                            <tr key={lead.id} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                                                <td className="px-5 py-3 font-medium text-gray-800">{lead.name}</td>
                                                <td className="px-5 py-3 text-gray-600">{lead.phone}</td>
                                                <td className="px-5 py-3 text-gray-600">{lead.budget_range ? (lead.budget_range === '1Cr+' ? '₹1 Cr+' : `₹${lead.budget_range} L`) : '—'}</td>
                                                <td className="px-5 py-3 text-gray-600">{lead.preferred_area || lead.preferred_city || '—'}</td>
                                                <td className="px-5 py-3">
                                                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${lead.ml_status === 'Hot' ? 'bg-red-100 text-red-600' :
                                                        lead.ml_status === 'Warm' ? 'bg-orange-100 text-orange-600' :
                                                            'bg-blue-100 text-blue-600'
                                                        }`}>{lead.ml_status || 'Cold'}</span>
                                                </td>
                                                <td className="px-5 py-3">
                                                    <div className="flex flex-wrap gap-1">
                                                        {badges.map(b => (
                                                            <span key={b} className="text-[10px] bg-accent/10 text-accent px-1.5 py-0.5 rounded font-semibold">{b}</span>
                                                        ))}
                                                        {badges.length === 0 && <span className="text-xs text-gray-400">—</span>}
                                                    </div>
                                                </td>
                                                <td className="px-5 py-3">
                                                    <button
                                                        onClick={() => navigate(`/leads/${lead.id}`)}
                                                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-white hover:bg-accent/90 transition-colors shadow-sm">
                                                        📞 Contact
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
