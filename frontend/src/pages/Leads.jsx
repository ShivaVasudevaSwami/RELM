import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import ImportLeadsModal from '../components/ImportLeadsModal';
import GoogleFormsModal from '../components/GoogleFormsModal';

export default function Leads() {
    const navigate = useNavigate();
    const { isAdmin, isAdminOrManager } = useAuth();
    const [allLeads, setAllLeads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [mlFilter, setMlFilter] = useState('All');
    const [stageFilter, setStageFilter] = useState('All Stages');
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const PER_PAGE = 20;
    const [showImportModal, setShowImportModal] = useState(false);
    const [showFormsModal, setShowFormsModal] = useState(false);

    useEffect(() => { fetchLeads(); }, []);

    const fetchLeads = async () => {
        setLoading(true);
        try {
            const res = await api.get('/leads');
            setAllLeads(Array.isArray(res.data) ? res.data : []);
        } catch (err) {
            console.error('Failed to fetch leads:', err);
            setAllLeads([]);
        } finally { setLoading(false); }
    };

    const handleMarkNotInterested = async (id) => {
        if (!window.confirm('Mark this lead as Not Interested? This will set ML status to Cold.')) return;
        try {
            await api.put(`/leads/${id}/status`, { status: 'Not Interested' });
            setAllLeads(prev => prev.map(l =>
                l.id === id ? { ...l, status: 'Not Interested', ml_status: 'Cold' } : l
            ));
        } catch (err) { alert(err.response?.data?.error || 'Failed to update lead'); }
    };

    const formatDate = (d) => {
        if (!d) return '—';
        return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    // Client-side filtering
    const filteredLeads = allLeads.filter(l => {
        if (!l) return false;
        if (mlFilter !== 'All' && l.ml_status !== mlFilter) return false;
        if (stageFilter !== 'All Stages' && l.status !== stageFilter) return false;
        if (search.trim()) {
            const s = search.toLowerCase();
            const nameMatch = (l.name || '').toLowerCase().includes(s);
            const phoneMatch = (l.phone || '').includes(s);
            const emailMatch = (l.email || '').toLowerCase().includes(s);
            if (!nameMatch && !phoneMatch && !emailMatch) return false;
        }
        return true;
    });

    const totalPages = Math.ceil(filteredLeads.length / PER_PAGE);
    const paginatedLeads = filteredLeads.slice((page - 1) * PER_PAGE, page * PER_PAGE);

    useEffect(() => { setPage(1); }, [mlFilter, stageFilter, search]);

    const hotCount = allLeads.filter(l => l.ml_status === 'Hot').length;
    const warmCount = allLeads.filter(l => l.ml_status === 'Warm').length;
    const coldCount = allLeads.filter(l => l.ml_status === 'Cold').length;

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
                <h1 className="text-xl sm:text-2xl font-bold text-gray-800">Leads</h1>
                <div className="flex gap-2 flex-wrap">
                    <button onClick={() => setShowFormsModal(true)}
                        className="flex items-center gap-2 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 font-medium px-4 py-2 rounded-lg transition-colors text-sm">
                        🔗 Add Form
                    </button>
                    <button onClick={() => setShowImportModal(true)}
                        className="flex items-center gap-2 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 font-medium px-4 py-2 rounded-lg transition-colors text-sm">
                        📂 Add via CSV/XLSX
                    </button>
                    <button onClick={() => navigate('/leads/add')} className="btn-primary text-sm">+ Add Lead</button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <input type="text" placeholder="Search name, phone, email..." value={search}
                    onChange={(e) => setSearch(e.target.value)} className="input-field w-full sm:w-64" />
                <div className="flex gap-2 overflow-x-auto pb-1">
                    {[
                        { label: 'All', value: 'All', count: allLeads.length },
                        { label: 'Hot', value: 'Hot', count: hotCount },
                        { label: 'Warm', value: 'Warm', count: warmCount },
                        { label: 'Cold', value: 'Cold', count: coldCount },
                    ].map(({ label, value, count }) => (
                        <button key={value} onClick={() => setMlFilter(value)}
                            className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${mlFilter === value ? 'bg-accent text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                            {label} <span className="text-xs opacity-70">({count})</span>
                        </button>
                    ))}
                </div>
                <select value={stageFilter} onChange={e => setStageFilter(e.target.value)} className="input-field w-auto text-sm">
                    <option>All Stages</option>
                    <option>New Inquiry</option>
                    <option>Contacted</option>
                    <option>Site Visit Scheduled</option>
                    <option>Site Visited</option>
                    <option>Negotiation</option>
                    <option>Booking Confirmed</option>
                    <option>Not Interested</option>
                </select>
            </div>

            <p className="text-sm text-gray-500 mb-4">
                Showing {paginatedLeads.length} of {filteredLeads.length} leads
                {mlFilter !== 'All' && ` • ML: ${mlFilter}`}
                {stageFilter !== 'All Stages' && ` • Stage: ${stageFilter}`}
                {search && ` • Search: "${search}"`}
            </p>

            {/* Table */}
            <div className="bg-white rounded-2xl shadow-card overflow-hidden">
                <div className="overflow-x-auto">
                    {paginatedLeads.length === 0 ? (
                        <div className="text-center py-12 text-gray-400">
                            <div className="text-4xl mb-3">🔍</div>
                            <p className="text-lg">No leads match your filters</p>
                            <p className="text-sm mt-1">Try changing the ML status filter or clearing your search</p>
                            {(mlFilter !== 'All' || stageFilter !== 'All Stages') && (
                                <button onClick={() => { setMlFilter('All'); setStageFilter('All Stages'); setSearch(''); }}
                                    className="btn-secondary mt-4 text-sm">Clear All Filters</button>
                            )}
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                                <tr>
                                    <th className="px-4 py-3 font-medium text-left">#</th>
                                    <th className="px-4 py-3 font-medium text-left">Name</th>
                                    <th className="px-4 py-3 font-medium text-left">Phone</th>
                                    <th className="px-4 py-3 font-medium text-left hidden md:table-cell">Email</th>
                                    <th className="px-4 py-3 font-medium text-left">Pipeline</th>
                                    <th className="px-4 py-3 font-medium text-left">ML</th>
                                    <th className="px-4 py-3 font-medium text-left">Urgency</th>
                                    <th className="px-4 py-3 font-medium text-left hidden lg:table-cell">Matched</th>
                                    <th className="px-4 py-3 font-medium text-left hidden lg:table-cell">Agent</th>
                                    <th className="px-4 py-3 font-medium text-left">Added</th>
                                    <th className="px-4 py-3 font-medium text-left">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginatedLeads.map(l => {
                                    const isNI = l.status === 'Not Interested';
                                    const isBC = l.status === 'Booking Confirmed';
                                    const mlColor = l.ml_status === 'Hot' ? 'text-red-500 bg-red-50'
                                        : l.ml_status === 'Warm' ? 'text-orange-500 bg-orange-50'
                                            : 'text-blue-500 bg-blue-50';
                                    return (
                                        <tr key={l.id} className={`border-t border-gray-100 transition-colors
                                            ${isBC ? 'bg-green-50' : isNI ? 'bg-gray-50 opacity-60' : 'hover:bg-gray-50'}`}>
                                            <td className={`px-4 py-3 ${isNI ? 'text-gray-400' : 'text-gray-500'}`}>{l.id}</td>
                                            <td className={`px-4 py-3 font-semibold ${isBC ? 'text-green-700 font-bold' : isNI ? 'text-gray-400' : 'text-gray-800'}`}>
                                                {isBC ? '✓ ' : ''}{l.name}
                                            </td>
                                            <td className={`px-4 py-3 ${isNI ? 'text-gray-400' : 'text-gray-600'}`}>{l.phone}</td>
                                            <td className={`px-4 py-3 hidden md:table-cell ${isNI ? 'text-gray-400' : 'text-gray-500'}`}>{l.email || '—'}</td>
                                            <td className="px-4 py-3">
                                                <span className={`text-sm ${isBC ? 'text-green-600 font-bold' : isNI ? 'text-gray-400' : 'text-gray-700'}`}>
                                                    {l.status || 'New Inquiry'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${mlColor}`}>
                                                    {l.ml_status || 'Cold'}
                                                </span>
                                            </td>
                                            <td className={`px-4 py-3 ${isNI ? 'text-gray-400' : 'text-gray-700'}`}>{l.urgency || '—'}</td>
                                            <td className={`px-4 py-3 hidden lg:table-cell ${isNI ? 'text-gray-400' : 'text-gray-500'}`}>
                                                {l.matched_property_name || '—'}
                                            </td>
                                            <td className={`px-4 py-3 hidden lg:table-cell ${isNI ? 'text-gray-400' : 'text-gray-500'}`}>{l.agent_name || '—'}</td>
                                            <td className={`px-4 py-3 ${isNI ? 'text-gray-400' : 'text-gray-500'}`}>{formatDate(l.created_at)}</td>
                                            <td className="px-4 py-3">
                                                <div className="flex gap-2">
                                                    <button onClick={() => navigate(`/leads/${l.id}`)}
                                                        className="text-accent hover:underline text-xs font-medium">View</button>
                                                    {!isNI && !isBC && (
                                                        <button onClick={() => handleMarkNotInterested(l.id)}
                                                            className="text-red-500 hover:underline text-xs font-medium">✗</button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="flex justify-center items-center gap-2 mt-4">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                        className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40">← Prev</button>
                    <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                        className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-40">Next →</button>
                </div>
            )}

            {/* Modals */}
            <ImportLeadsModal
                isOpen={showImportModal}
                onClose={() => setShowImportModal(false)}
                onImportComplete={() => { setShowImportModal(false); fetchLeads(); }}
            />
            <GoogleFormsModal
                isOpen={showFormsModal}
                onClose={() => setShowFormsModal(false)}
            />
        </div>
    );
}
