import { useState, useEffect, useCallback } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const STATUS_STYLES = {
    Active: 'bg-blue-50 border-blue-200 text-blue-800',
    Converted: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    Rejected: 'bg-gray-50 border-gray-200 text-gray-500',
    'Rejected - Property Sold': 'bg-red-50 border-red-200 text-red-600'
};

const STATUS_BADGE = {
    Active: '🔵 Active',
    Converted: '✅ Booked',
    Rejected: '❌ Rejected',
    'Rejected - Property Sold': '🔴 Sold to Another'
};

const TIER_BADGE = {
    2: { label: '🟡 Tier 2: Reserved', cls: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
    3: { label: '⚪ Tier 3: Interested', cls: 'bg-gray-100 text-gray-600 border-gray-300' }
};

function formatLakhs(price) {
    if (!price) return '—';
    const num = parseFloat(price);
    if (num >= 10000000) return `₹${(num / 10000000).toFixed(2)} Cr`;
    return `₹${(num / 100000).toFixed(1)} L`;
}

function formatCountdown(targetDate) {
    if (!targetDate) return null;
    const diff = new Date(targetDate).getTime() - Date.now();
    if (diff <= 0) return '⏰ Expired';
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
    return `${hours}h ${mins}m`;
}

export default function NegotiationHub({ leadId, onStatusChange }) {
    const { user } = useAuth();
    const canBook = user?.role !== 'telecaller';
    const isManagerOrAdmin = user?.role === 'manager' || user?.role === 'admin';

    const [negotiations, setNegotiations] = useState([]);
    const [bookings, setBookings] = useState([]);
    const [reservations, setReservations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [actionLoading, setActionLoading] = useState(null);

    // Add negotiation form
    const [showAdd, setShowAdd] = useState(false);
    const [properties, setProperties] = useState([]);
    const [addForm, setAddForm] = useState({ property_id: '', offered_price: '', agent_notes: '', tier: 3 });
    const [searchTerm, setSearchTerm] = useState('');

    const fetchAll = useCallback(async () => {
        try {
            const [negRes, resRes] = await Promise.all([
                api.get(`/negotiations/${leadId}`),
                api.get(`/reservations/lead/${leadId}`)
            ]);
            setNegotiations(negRes.data.negotiations || []);
            setBookings(negRes.data.bookings || []);
            setReservations(resRes.data.reservations || []);
            setError('');
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load data');
        } finally { setLoading(false); }
    }, [leadId]);

    // Fetch on mount + 5s polling
    useEffect(() => {
        fetchAll();
        const interval = setInterval(fetchAll, 5000);
        return () => clearInterval(interval);
    }, [fetchAll]);

    // Force re-render for countdown timers every 30s
    const [, setTick] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => setTick(t => t + 1), 30000);
        return () => clearInterval(timer);
    }, []);

    // Fetch available properties for "Add Negotiation"
    const handleOpenAdd = async () => {
        setShowAdd(true);
        try {
            const res = await api.get('/properties');
            setProperties((res.data || []).filter(p => p.is_available && p.availability_status !== 'Sold'));
        } catch { setProperties([]); }
    };

    const handleAddNegotiation = async () => {
        if (!addForm.property_id) return;
        setActionLoading('add');
        try {
            // Create negotiation
            await api.post('/negotiations', {
                lead_id: leadId,
                property_id: parseInt(addForm.property_id),
                offered_price: parseFloat(addForm.offered_price) || 0,
                agent_notes: addForm.agent_notes
            });
            // Create reservation if tier selected and agent has permission
            if (canBook && addForm.tier) {
                try {
                    await api.post('/reservations', {
                        lead_id: parseInt(leadId),
                        property_id: parseInt(addForm.property_id),
                        tier: parseInt(addForm.tier)
                    });
                } catch { /* reservation is optional enhancement */ }
            }
            setShowAdd(false);
            setAddForm({ property_id: '', offered_price: '', agent_notes: '', tier: 3 });
            setSearchTerm('');
            fetchAll();
            if (onStatusChange) onStatusChange();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to add negotiation');
        } finally { setActionLoading(null); }
    };

    const handleUpdatePrice = async (negId, newPrice) => {
        try {
            await api.put(`/negotiations/${negId}`, { offered_price: parseFloat(newPrice) || 0 });
            fetchAll();
        } catch (err) {
            setError(err.response?.data?.error || 'Update failed');
        }
    };

    const handleReject = async (negId) => {
        if (!window.confirm('Reject this negotiation?')) return;
        setActionLoading(negId);
        try {
            await api.put(`/negotiations/${negId}/reject`);
            fetchAll();
            if (onStatusChange) onStatusChange();
        } catch (err) {
            setError(err.response?.data?.error || 'Rejection failed');
        } finally { setActionLoading(null); }
    };

    const handleBook = async (negId) => {
        if (!window.confirm('⚠️ Confirm Booking?\nThis will mark the property as SOLD and auto-reject all other negotiations for it.')) return;
        setActionLoading(negId);
        try {
            const res = await api.post(`/negotiations/${negId}/book`);
            fetchAll();
            if (onStatusChange) onStatusChange();
            if (res.data.domino_affected > 0) {
                alert(`✅ Booking Confirmed!\n\n${res.data.domino_affected} other negotiation(s) were auto-rejected.`);
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Booking failed');
        } finally { setActionLoading(null); }
    };

    // ── Reservation Actions ──
    const handleChallenge = async (reservationId) => {
        if (!window.confirm('⚔️ Challenge this reservation?\nThe holder will have 2 hours to complete booking or lose the reservation.')) return;
        setActionLoading(`challenge-${reservationId}`);
        try {
            await api.post(`/reservations/${reservationId}/challenge`, { challenger_lead_id: parseInt(leadId) });
            fetchAll();
            if (onStatusChange) onStatusChange();
        } catch (err) {
            setError(err.response?.data?.error || 'Challenge failed');
        } finally { setActionLoading(null); }
    };

    const handleExtend = async (reservationId, comment) => {
        setActionLoading(`extend-${reservationId}`);
        try {
            await api.put(`/reservations/${reservationId}/extend`, { manager_comment: comment || undefined });
            fetchAll();
        } catch (err) {
            setError(err.response?.data?.error || 'Extension failed');
        } finally { setActionLoading(null); }
    };

    const handleForceRelease = async (reservationId) => {
        const reason = window.prompt('Enter reason for force-release (required):');
        if (!reason || reason.trim().length < 5) return;
        setActionLoading(`force-${reservationId}`);
        try {
            await api.put(`/reservations/${reservationId}/force-release`, { reason });
            fetchAll();
            if (onStatusChange) onStatusChange();
        } catch (err) {
            setError(err.response?.data?.error || 'Force-release failed');
        } finally { setActionLoading(null); }
    };

    const filteredProperties = properties.filter(p =>
        p.property_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.city?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Build reservation lookup by property_id
    const resByProperty = {};
    reservations.forEach(r => { resByProperty[r.property_id] = r; });

    if (loading) {
        return (
            <div className="bg-white border border-gray-100 rounded-xl p-6">
                <div className="flex items-center gap-3">
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-indigo-500 border-t-transparent"></div>
                    <span className="text-sm text-gray-500">Loading Negotiation Hub...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white border border-gray-100 rounded-xl p-5 sm:p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider">
                    <span className="text-base">🏢</span> Negotiation Hub
                    {negotiations.filter(n => n.status === 'Active').length > 0 && (
                        <span className="bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full ml-2">
                            {negotiations.filter(n => n.status === 'Active').length} Active
                        </span>
                    )}
                    {bookings.length > 0 && (
                        <span className="bg-emerald-100 text-emerald-700 text-xs px-2 py-0.5 rounded-full">
                            {bookings.length} Booked
                        </span>
                    )}
                    {reservations.filter(r => r.tier === 2).length > 0 && (
                        <span className="bg-yellow-100 text-yellow-700 text-xs px-2 py-0.5 rounded-full">
                            🔒 Reserved
                        </span>
                    )}
                </h2>
                {canBook && (
                    <button onClick={handleOpenAdd}
                        className="text-xs font-medium bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors">
                        + Add Negotiation
                    </button>
                )}
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm p-3 rounded-lg mb-4">
                    {error}
                    <button onClick={() => setError('')} className="ml-2 text-red-500">✕</button>
                </div>
            )}

            {/* Add Negotiation Panel */}
            {showAdd && (
                <div className="bg-indigo-50/60 border border-indigo-100 rounded-lg p-4 mb-5">
                    <p className="text-xs font-semibold text-indigo-600 uppercase mb-3">Add Property to Negotiate</p>
                    <input type="text" placeholder="Search properties..."
                        className="input-field mb-3 text-sm"
                        value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                    <select className="input-field mb-3 text-sm" value={addForm.property_id}
                        onChange={e => setAddForm(f => ({ ...f, property_id: e.target.value }))}>
                        <option value="">-- Select Property --</option>
                        {filteredProperties.map(p => (
                            <option key={p.id} value={p.id}>
                                {p.property_name} — {p.property_type} — {p.city} — {formatLakhs(p.price_inr)}
                                {p.availability_status === 'Reserved' ? ' [RESERVED]' : ''}
                            </option>
                        ))}
                    </select>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                        <input type="number" placeholder="Offered Price (₹)" className="input-field text-sm"
                            value={addForm.offered_price}
                            onChange={e => setAddForm(f => ({ ...f, offered_price: e.target.value }))} />
                        <input type="text" placeholder="Agent Notes" className="input-field text-sm"
                            value={addForm.agent_notes}
                            onChange={e => setAddForm(f => ({ ...f, agent_notes: e.target.value }))} />
                        {canBook && (
                            <select className="input-field text-sm" value={addForm.tier}
                                onChange={e => setAddForm(f => ({ ...f, tier: parseInt(e.target.value) }))}>
                                <option value={3}>Tier 3: Interested</option>
                                <option value={2}>Tier 2: Soft-Block (Reserve)</option>
                            </select>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <button onClick={handleAddNegotiation}
                            disabled={actionLoading === 'add' || !addForm.property_id}
                            className="text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 px-4 py-2 rounded-lg disabled:opacity-50 transition-colors">
                            {actionLoading === 'add' ? 'Adding...' : 'Add Negotiation'}
                        </button>
                        <button onClick={() => { setShowAdd(false); setSearchTerm(''); }}
                            className="text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 px-4 py-2 rounded-lg transition-colors">
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Negotiation Cards */}
            {negotiations.length === 0 && bookings.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                    <p className="text-3xl mb-2">🏗️</p>
                    <p className="text-sm">No negotiations yet. Add a property to start negotiating.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {negotiations.map(neg => (
                        <NegotiationCard key={neg.id} neg={neg}
                            reservation={resByProperty[neg.property_id]}
                            canBook={canBook}
                            isManagerOrAdmin={isManagerOrAdmin}
                            actionLoading={actionLoading}
                            onUpdatePrice={handleUpdatePrice}
                            onReject={handleReject}
                            onBook={handleBook}
                            onChallenge={handleChallenge}
                            onExtend={handleExtend}
                            onForceRelease={handleForceRelease} />
                    ))}
                </div>
            )}

            {/* Bookings Summary */}
            {bookings.length > 0 && (
                <div className="mt-5 pt-5 border-t border-gray-100">
                    <p className="text-xs font-semibold text-emerald-600 uppercase mb-3">✅ Confirmed Bookings</p>
                    <div className="space-y-2">
                        {bookings.map(b => (
                            <div key={b.id} className="flex items-center justify-between bg-emerald-50 border border-emerald-100 rounded-lg p-3">
                                <div>
                                    <p className="text-sm font-medium text-emerald-800">{b.property_name}</p>
                                    <p className="text-xs text-emerald-600">{b.property_type} · {b.city}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm font-semibold text-emerald-700">{formatLakhs(b.final_price)}</p>
                                    <p className="text-xs text-emerald-500">{new Date(b.booking_date).toLocaleDateString()}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Individual Negotiation Card (with Reservation Overlay) ──
function NegotiationCard({ neg, reservation, canBook, isManagerOrAdmin, actionLoading,
    onUpdatePrice, onReject, onBook, onChallenge, onExtend, onForceRelease }) {
    const [editPrice, setEditPrice] = useState(false);
    const [price, setPrice] = useState(neg.offered_price || '');
    const [extendComment, setExtendComment] = useState('');
    const [showExtend, setShowExtend] = useState(false);
    const isActive = neg.status === 'Active';
    const styleClass = STATUS_STYLES[neg.status] || STATUS_STYLES.Active;
    const badge = STATUS_BADGE[neg.status] || neg.status;

    const tierInfo = reservation ? TIER_BADGE[reservation.tier] : null;
    const countdown = reservation ? formatCountdown(reservation.expires_at) : null;
    const rofrCountdown = reservation?.rofr_deadline ? formatCountdown(reservation.rofr_deadline) : null;

    return (
        <div className={`border rounded-lg p-4 transition-all ${styleClass}`}>
            {/* Reservation Tier Badge */}
            {tierInfo && isActive && (
                <div className={`flex items-center justify-between mb-2 px-2 py-1 rounded border text-xs ${tierInfo.cls}`}>
                    <span className="font-semibold">{tierInfo.label}</span>
                    {countdown && <span className="font-mono">{countdown}</span>}
                </div>
            )}

            {/* ROFR Alert */}
            {rofrCountdown && isActive && (
                <div className="bg-red-100 border border-red-300 text-red-800 text-xs px-3 py-2 rounded mb-2 flex items-center justify-between">
                    <span className="font-semibold">⚔️ ROFR Challenge Active!</span>
                    <span className="font-mono">{rofrCountdown} remaining</span>
                </div>
            )}

            <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-semibold truncate">{neg.property_name}</p>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-white/70 border whitespace-nowrap">{badge}</span>
                    </div>
                    <p className="text-xs opacity-70">{neg.property_type} · {neg.city}, {neg.state} · {formatLakhs(neg.price_inr)} list</p>

                    {/* Competition Alert */}
                    {isActive && neg.negotiation_count > 1 && (
                        <p className="text-xs mt-1 font-medium text-amber-600">
                            ⚠️ {neg.negotiation_count - 1} other lead(s) negotiating
                            {neg.negotiation_count >= 3 && <span className="ml-1 text-red-600 font-bold">🔥 High Competition</span>}
                        </p>
                    )}

                    {!neg.is_available && neg.status === 'Active' && (
                        <p className="text-xs mt-1 font-medium text-red-600">🔴 Property no longer available</p>
                    )}
                </div>

                {/* Price */}
                <div className="text-right shrink-0">
                    {isActive && editPrice ? (
                        <div className="flex items-center gap-1">
                            <input type="number" value={price}
                                onChange={e => setPrice(e.target.value)}
                                className="w-28 text-xs border rounded px-2 py-1"
                                placeholder="Offered ₹" />
                            <button onClick={() => { onUpdatePrice(neg.id, price); setEditPrice(false); }}
                                className="text-xs text-indigo-600 font-medium">Save</button>
                        </div>
                    ) : (
                        <div>
                            <p className="text-sm font-semibold">{neg.offered_price ? formatLakhs(neg.offered_price) : '—'}</p>
                            <p className="text-xs opacity-60">offered</p>
                            {isActive && (
                                <button onClick={() => setEditPrice(true)}
                                    className="text-xs text-indigo-500 hover:underline mt-0.5">Edit</button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Notes */}
            {neg.agent_notes && (
                <p className="text-xs mt-2 opacity-60 italic">📝 {neg.agent_notes}</p>
            )}

            {/* Actions */}
            {isActive && canBook && (
                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-current/10">
                    <button onClick={() => onReject(neg.id)}
                        disabled={actionLoading === neg.id}
                        className="text-xs font-medium bg-white/80 text-red-500 border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                        ✕ Reject
                    </button>
                    <button onClick={() => onBook(neg.id)}
                        disabled={actionLoading === neg.id || !neg.is_available}
                        className="text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                        {actionLoading === neg.id ? '...' : '✓ Confirm Booking'}
                    </button>

                    {/* Reservation Actions */}
                    {reservation && reservation.tier === 2 && (
                        <>
                            {reservation.extension_count < 2 && (
                                showExtend ? (
                                    <div className="flex items-center gap-1">
                                        {reservation.extension_count >= 1 && (
                                            <input type="text" placeholder="Manager comment..."
                                                value={extendComment} onChange={e => setExtendComment(e.target.value)}
                                                className="text-xs border rounded px-2 py-1 w-36" />
                                        )}
                                        <button onClick={() => { onExtend(reservation.id, extendComment); setShowExtend(false); setExtendComment(''); }}
                                            disabled={actionLoading === `extend-${reservation.id}`}
                                            className="text-xs text-indigo-600 font-medium">✓</button>
                                        <button onClick={() => setShowExtend(false)}
                                            className="text-xs text-gray-400">✕</button>
                                    </div>
                                ) : (
                                    <button onClick={() => setShowExtend(true)}
                                        className="text-xs font-medium bg-white/80 text-indigo-500 border border-indigo-200 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors">
                                        🔄 Extend ({reservation.extension_count}/2)
                                    </button>
                                )
                            )}
                        </>
                    )}

                    {/* Manager Force-Release */}
                    {isManagerOrAdmin && reservation && reservation.tier === 2 && (
                        <button onClick={() => onForceRelease(reservation.id)}
                            disabled={actionLoading === `force-${reservation.id}`}
                            className="text-xs font-medium bg-white/80 text-orange-500 border border-orange-200 hover:bg-orange-50 px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors">
                            🔓 Force Release
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
