import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/StatusBadge';
import UrgencyTag from '../components/UrgencyTag';
import NegotiationHub from '../components/NegotiationHub';

const PIPELINE_ORDER = [
    'New Inquiry', 'Contacted', 'Site Visit Scheduled',
    'Site Visited', 'Negotiation', 'Booking Confirmed'
];

export default function LeadDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { isAdmin, isAdminOrManager } = useAuth();
    const [lead, setLead] = useState(null);
    const [interactions, setInteractions] = useState([]);
    const [siteVisits, setSiteVisits] = useState([]);
    const [matchedProperty, setMatchedProperty] = useState(null);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showPropertyModal, setShowPropertyModal] = useState(false);
    const [availableProperties, setAvailableProperties] = useState([]);
    const [statusUpdating, setStatusUpdating] = useState(false);
    const [reopenReason, setReopenReason] = useState('');
    const [showReopenForm, setShowReopenForm] = useState(false);

    useEffect(() => { fetchLead(); fetchHistory(); }, [id]);

    const fetchLead = async () => {
        try {
            const res = await api.get(`/leads/${id}`);
            setLead(res.data.lead);
            setInteractions(res.data.interactions);
            setSiteVisits(res.data.site_visits);
            setMatchedProperty(res.data.matched_property);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load lead');
        } finally { setLoading(false); }
    };

    const fetchHistory = async () => {
        try {
            const res = await api.get(`/leads/${id}/history`);
            setHistory(res.data.history || []);
        } catch { /* ignore if no history */ }
    };

    const handleDelete = async () => {
        if (!window.confirm('Delete this lead permanently?')) return;
        try {
            await api.delete(`/leads/${id}`);
            navigate('/dashboard');
        } catch (err) { setError(err.response?.data?.error || 'Failed to delete lead'); }
    };

    const handlePipelineClick = async (targetStage) => {
        if (!lead) return;
        if (targetStage === 'Site Visit Scheduled') { navigate(`/leads/${id}/schedule-visit`); return; }
        if (targetStage === 'Site Visited') {
            const pendingVisit = siteVisits.find(v => !v.post_visit_status);
            if (pendingVisit) { navigate(`/leads/${id}/visit-feedback/${pendingVisit.id}`); }
            else { await advancePipeline(targetStage); }
            return;
        }
        await advancePipeline(targetStage);
    };

    const advancePipeline = async (newStatus) => {
        setStatusUpdating(true);
        try {
            const res = await api.put(`/leads/${id}/status`, { status: newStatus });
            setLead(res.data.lead);
            // If property was auto-sold, refresh matched property
            if (res.data.property_sold) {
                setMatchedProperty(res.data.sold_property);
            }
        } catch (err) { setError(err.response?.data?.error || 'Failed to advance status'); }
        finally { setStatusUpdating(false); }
    };

    const handleMarkNotInterested = async () => {
        if (!window.confirm('Mark this lead as Not Interested?')) return;
        setStatusUpdating(true);
        try {
            const res = await api.put(`/leads/${id}/status`, { status: 'Not Interested' });
            setLead(res.data.lead);
        } catch (err) { setError(err.response?.data?.error || 'Failed to update'); }
        finally { setStatusUpdating(false); }
    };

    const handleOpenPropertyModal = async () => {
        try {
            const res = await api.get('/properties?available=1');
            setAvailableProperties(Array.isArray(res.data) ? res.data : []);
            setShowPropertyModal(true);
        } catch { setError('Failed to load properties'); }
    };

    const handleMatchProperty = async (propertyId) => {
        try {
            const res = await api.put(`/leads/${id}/match-property`, { property_id: propertyId });
            setLead(res.data.lead);
            setShowPropertyModal(false);
            fetchLead();
        } catch (err) { setError(err.response?.data?.error || 'Failed to match property'); }
    };

    const formatBudgetRange = (range) => {
        if (!range) return 'N/A';
        if (range === '1Cr+') return '₹1 Cr+';
        if (range === '50+') return '₹50+ Lakhs';
        return `₹${range} Lakhs`;
    };
    const formatDate = (d) => (!d ? 'N/A' : new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
    const formatDateTime = (d) => {
        if (!d) return 'N/A';
        const dt = new Date(d);
        return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
            + ', ' + dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    };
    const formatLakhs = (price) => (!price ? '0.00' : (price / 100000).toFixed(2));

    if (loading) {
        return (
            <div className="p-4 sm:p-8 flex justify-center py-20">
                <div className="animate-spin rounded-full h-10 w-10 border-4 border-accent border-t-transparent"></div>
            </div>
        );
    }

    if (error && !lead) {
        return (
            <div className="p-4 sm:p-8">
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm">{error}</div>
            </div>
        );
    }

    const currentPipelineIdx = PIPELINE_ORDER.indexOf(lead.status);
    const isNotInterested = lead.status === 'Not Interested';
    const isBooked = lead.status === 'Booking Confirmed' || lead.status === 'Partially Booked';
    const isVip = lead.is_vip === 1;
    const isTerminal = isNotInterested || isBooked;
    const canAdvance = !isTerminal && currentPipelineIdx >= 0 && currentPipelineIdx < PIPELINE_ORDER.length - 1;
    const hasWantAnother = siteVisits.some(v => v.post_visit_status === 'Want Another');
    const hasPendingFeedback = siteVisits.some(v => !v.post_visit_status);
    const pendingVisit = siteVisits.find(v => !v.post_visit_status);

    return (
        <div className="p-4 sm:p-6 lg:p-8">
            {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm mb-4">{error}</div>
            )}

            {/* Dual Status Hero */}
            <div className="bg-white rounded-2xl shadow-card p-4 sm:p-8 mb-4 sm:mb-6">
                <div className="flex flex-col sm:flex-row items-start justify-between mb-6 gap-4">
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <h1 className="text-xl sm:text-2xl font-bold text-gray-800">{lead.name}</h1>
                            {lead.inquiry_count > 1 && (
                                <span className="text-xs bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full font-medium">
                                    🔁 Inquiry #{lead.inquiry_count}
                                </span>
                            )}
                        </div>
                        <p className="text-sm text-gray-500 mt-1">Lead #{lead.id}</p>
                    </div>
                    <div className="text-left sm:text-center">
                        <StatusBadge status={
                            lead.is_investor ? 'Ultra Hot'
                                : (isBooked || isVip) ? 'Gold'
                                    : (lead.ml_status || 'Cold')
                        } size="lg" />
                        {lead.is_investor ? (
                            <p className="text-xs text-purple-500 mt-1 font-semibold">👑 Investor</p>
                        ) : isVip ? (
                            <p className="text-xs text-amber-500 mt-1 font-semibold">🏆 VIP — Lifetime Customer</p>
                        ) : (
                            <p className="text-xs text-gray-400 mt-1">Score Status</p>
                        )}
                    </div>
                </div>

                {/* Pipeline Stepper */}
                <div className="mb-4">
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-3 font-semibold">Pipeline Stage</p>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1 flex-wrap">
                        {PIPELINE_ORDER.map((stage, idx) => {
                            let cls = 'pipeline-step-pending';
                            if (isNotInterested) { cls = 'pipeline-step-pending'; }
                            else if (idx < currentPipelineIdx) { cls = 'pipeline-step-done'; }
                            else if (idx === currentPipelineIdx) {
                                cls = stage === 'Booking Confirmed' ? 'pipeline-step-done' : 'pipeline-step-active';
                            }
                            return (
                                <div key={stage} className="flex items-center gap-1">
                                    <span className={cls}>{stage}</span>
                                    {idx < PIPELINE_ORDER.length - 1 && (
                                        <span className="text-gray-300 text-xs hidden sm:inline">→</span>
                                    )}
                                </div>
                            );
                        })}
                        {isNotInterested && (
                            <div className="flex items-center gap-1 sm:ml-2">
                                <span className="text-gray-300 text-xs hidden sm:inline">|</span>
                                <span className="pipeline-step-not-interested">Not Interested</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Pipeline Action Buttons — HIDDEN for terminal statuses */}
                {!isTerminal && (
                    <div className="flex flex-wrap gap-2 mt-4">
                        {canAdvance && (
                            <button onClick={() => handlePipelineClick(PIPELINE_ORDER[currentPipelineIdx + 1])}
                                disabled={statusUpdating} className="btn-primary text-sm">
                                {statusUpdating ? 'Updating...' : `Move to: ${PIPELINE_ORDER[currentPipelineIdx + 1]}`}
                            </button>
                        )}
                        {!isNotInterested && (
                            <button onClick={handleMarkNotInterested} disabled={statusUpdating} className="btn-danger text-sm">
                                Mark as Not Interested
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* 🔒 ARCHIVED RECORD NOTICE — Terminal statuses */}
            {isTerminal && (
                <div className={`${isBooked || isVip ? 'bg-amber-50 border-amber-300' : 'bg-gray-50 border-gray-300'} border rounded-xl px-6 py-4 mb-4`}>
                    <div className="flex items-center justify-between flex-wrap gap-3">
                        <div className="flex items-center gap-3">
                            <div className="text-3xl">{isBooked || isVip ? '🏆' : '🔒'}</div>
                            <div>
                                <p className={`font-bold text-lg ${isBooked || isVip ? 'text-amber-700' : 'text-gray-600'}`}>
                                    {isBooked ? 'Gold VIP — Booking Confirmed!' : '🔒 ARCHIVED RECORD — READ ONLY'}
                                </p>
                                <p className={`text-sm ${isBooked || isVip ? 'text-amber-600' : 'text-gray-500'}`}>
                                    {isBooked
                                        ? 'This lead has been successfully converted. Lifetime VIP status granted.'
                                        : 'This lead is closed. All actions are locked to preserve data integrity.'}
                                </p>
                                {isVip && lead.lifetime_value > 0 && (
                                    <p className="text-xs text-amber-500 mt-1 font-medium">
                                        💰 Lifetime Value: ₹{(lead.lifetime_value / 100000).toFixed(1)} Lakhs
                                    </p>
                                )}
                            </div>
                        </div>
                        {/* Manager/Admin Re-open Button */}
                        {isAdminOrManager && (
                            <div>
                                {!showReopenForm ? (
                                    <button onClick={() => setShowReopenForm(true)}
                                        className="text-sm bg-indigo-100 text-indigo-600 px-4 py-2 rounded-lg hover:bg-indigo-200 transition">
                                        🔓 Re-open Lead
                                    </button>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <input type="text" value={reopenReason} onChange={e => setReopenReason(e.target.value)}
                                            placeholder="Reason for re-opening..."
                                            className="input-field text-sm w-48" />
                                        <button onClick={async () => {
                                            if (!reopenReason.trim()) return;
                                            try {
                                                await api.put(`/leads/${id}/reopen`, { reason: reopenReason });
                                                setShowReopenForm(false); setReopenReason('');
                                                fetchLead();
                                            } catch (err) { setError(err.response?.data?.error || 'Failed to re-open'); }
                                        }} className="btn-primary text-sm" disabled={!reopenReason.trim()}>Confirm</button>
                                        <button onClick={() => { setShowReopenForm(false); setReopenReason(''); }}
                                            className="btn-secondary text-sm">Cancel</button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Property Marked as Sold Banner */}
            {isBooked && lead.matched_property_id && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-6 py-4 flex items-center gap-4 mb-6">
                    <div className="text-2xl">🏠</div>
                    <div>
                        <p className="text-amber-700 font-semibold text-sm">Property Marked as Sold</p>
                        <p className="text-amber-500 text-xs mt-0.5">
                            {matchedProperty?.property_name || 'Matched property'} has been automatically marked
                            as sold and is no longer available for new leads.
                        </p>
                    </div>
                </div>
            )}

            {/* ── Negotiation Hub — HIDDEN for terminal statuses ── */}
            {!isTerminal && (
                <div className="mb-4 sm:mb-6">
                    <NegotiationHub leadId={id} onStatusChange={fetchLead} />
                </div>
            )}

            {/* Info Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
                {[
                    { label: 'Phone', value: lead.phone },
                    { label: 'Email', value: lead.email || 'N/A' },
                    { label: 'Preferred Type', value: lead.preferred_property_type || 'N/A' },
                    { label: 'Budget Range', value: formatBudgetRange(lead.budget_range) },
                    { label: 'Funding Source', value: lead.funding_source || 'N/A' },
                    { label: 'Urgency', value: lead.urgency, isUrgency: true },
                    { label: 'Preferred State', value: lead.preferred_state || 'N/A' },
                    { label: 'Preferred City', value: lead.preferred_city || 'N/A' },
                    { label: 'Preferred Area', value: lead.preferred_area || 'N/A' },
                    { label: 'Created By', value: lead.agent_name || 'Unknown' },
                    { label: 'Date Added', value: formatDate(lead.created_at) },
                    { label: 'Matched Property', value: matchedProperty ? matchedProperty.property_name : '—' },
                ].map((item, idx) => (
                    <div key={idx} className="bg-white rounded-xl shadow-card p-4">
                        <p className="text-xs text-gray-400 uppercase tracking-wide">{item.label}</p>
                        {item.isUrgency && item.value ? (
                            <div className="mt-1"><UrgencyTag urgency={item.value} /></div>
                        ) : (
                            <p className="text-sm font-semibold text-gray-800 mt-1">{item.value}</p>
                        )}
                    </div>
                ))}
            </div>

            {/* Buyer Profile & Assignment Row */}
            {(lead.occupation || lead.purchase_purpose || lead.possession_timeline || lead.next_follow_up) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
                    {lead.occupation && (
                        <div className="bg-white rounded-xl shadow-card p-4">
                            <p className="text-xs text-gray-400 uppercase tracking-wide">Occupation</p>
                            <p className="text-sm font-semibold text-gray-800 mt-1">{lead.occupation}</p>
                        </div>
                    )}
                    {lead.purchase_purpose && (
                        <div className="bg-white rounded-xl shadow-card p-4">
                            <p className="text-xs text-gray-400 uppercase tracking-wide">Purchase Purpose</p>
                            <p className="text-sm font-semibold text-gray-800 mt-1">{lead.purchase_purpose}</p>
                        </div>
                    )}
                    {lead.possession_timeline && (
                        <div className="bg-white rounded-xl shadow-card p-4">
                            <p className="text-xs text-gray-400 uppercase tracking-wide">Possession Timeline</p>
                            <p className="text-sm font-semibold text-gray-800 mt-1">{lead.possession_timeline}</p>
                        </div>
                    )}
                    {lead.next_follow_up && (
                        <div className={`bg-white rounded-xl shadow-card p-4 ${new Date(lead.next_follow_up) < new Date() ? 'ring-2 ring-red-400 animate-pulse' : ''
                            }`}>
                            <p className="text-xs text-gray-400 uppercase tracking-wide">Next Follow-up</p>
                            <p className={`text-sm font-semibold mt-1 ${new Date(lead.next_follow_up) < new Date() ? 'text-red-600' : 'text-gray-800'
                                }`}>
                                {formatDateTime(lead.next_follow_up)}
                                {new Date(lead.next_follow_up) < new Date() && (
                                    <span className="ml-2 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">⚠ Overdue</span>
                                )}
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* Extra Details (Flat/Villa/Plot) */}
            {lead.extra_details && (() => {
                let extra;
                try { extra = typeof lead.extra_details === 'string' ? JSON.parse(lead.extra_details) : lead.extra_details; } catch { extra = null; }
                if (!extra || Object.keys(extra).length === 0) return null;
                const propType = lead.preferred_property_type;
                const colorMap = { Flat: 'indigo', Villa: 'emerald', Plot: 'amber' };
                const iconMap = { Flat: '🏢', Villa: '🏡', Plot: '📐' };
                const color = colorMap[propType] || 'gray';
                return (
                    <div className={`bg-${color}-50 border border-${color}-200 rounded-xl p-4 mb-6`}>
                        <p className={`text-xs font-semibold text-${color}-600 uppercase mb-3`}>{iconMap[propType] || '📋'} {propType} Details</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {Object.entries(extra).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => (
                                <div key={k}>
                                    <p className="text-xs text-gray-500 capitalize">{k.replace(/_/g, ' ')}</p>
                                    <p className="text-sm font-semibold text-gray-800">{typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })()}
            <div className="flex flex-wrap gap-2 sm:gap-3 mb-6 sm:mb-8">
                {!isBooked && !isNotInterested && (
                    <button onClick={() => navigate(`/leads/${id}/status`)} className="btn-primary text-sm">
                        Update Status
                    </button>
                )}
                {!isNotInterested && !isBooked && (
                    hasPendingFeedback ? (
                        <div className="flex items-center gap-2">
                            <button disabled
                                className="bg-gray-300 text-gray-500 font-medium px-4 py-2 rounded-lg text-sm cursor-not-allowed opacity-50"
                                title="Complete pending feedback first">
                                Schedule Site Visit
                            </button>
                            <span className="text-xs text-orange-500 font-medium max-w-[200px]">
                                ⚠️ Complete feedback for "{pendingVisit?.site_name}" first
                            </span>
                        </div>
                    ) : lead.status === 'New Inquiry' ? (
                        <div className="flex items-center gap-2">
                            <button disabled
                                className="bg-gray-200 text-gray-500 font-medium px-4 py-2 rounded-lg text-sm cursor-not-allowed opacity-70"
                                title="Lead must be Contacted first">
                                🔒 Schedule Site Visit
                            </button>
                            <span className="text-xs text-gray-400 font-medium max-w-[200px]">
                                Log a call to unlock
                            </span>
                        </div>
                    ) : hasWantAnother ? (
                        <button onClick={() => navigate(`/leads/${id}/schedule-visit`)}
                            className="bg-green-500 hover:bg-green-600 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm">
                            Add New Site Visit
                        </button>
                    ) : (
                        <button onClick={() => navigate(`/leads/${id}/schedule-visit`)} className="btn-secondary text-sm">
                            Schedule Site Visit
                        </button>
                    )
                )}
                <button onClick={handleOpenPropertyModal} className="btn-secondary text-sm">Match Property</button>
                <button onClick={() => navigate('/dashboard')} className="btn-secondary text-sm">← Back</button>
                {isAdmin && <button onClick={handleDelete} className="btn-danger sm:ml-auto text-sm">Delete Lead</button>}
            </div>

            {/* Call Interactions Table */}
            <div className="mb-6">
                <h2 className="text-lg font-semibold text-gray-700 mb-4">Call Interactions</h2>
                <div className="bg-white rounded-2xl shadow-card overflow-hidden">
                    {interactions.length === 0 ? (
                        <p className="text-gray-400 text-sm p-5">No call interactions recorded yet.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                                    <tr>
                                        <th className="px-5 py-3 font-medium text-left">Date & Time</th>
                                        <th className="px-5 py-3 font-medium text-left">Call Status</th>
                                        <th className="px-5 py-3 font-medium text-left">Notes</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {interactions.map((i) => (
                                        <tr key={i.id} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                                            <td className="px-5 py-3 text-gray-700">{formatDateTime(i.interaction_date)}</td>
                                            <td className="px-5 py-3 text-gray-700">{i.call_status}</td>
                                            <td className="px-5 py-3 text-gray-700">{i.feedback_notes || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {/* Site Visits Table */}
            <div className="mb-6">
                <h2 className="text-lg font-semibold text-gray-700 mb-4">Site Visits</h2>
                <div className="bg-white rounded-2xl shadow-card overflow-hidden">
                    {siteVisits.length === 0 ? (
                        <p className="text-gray-400 text-sm p-5">No site visits recorded yet.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                                    <tr>
                                        <th className="px-5 py-3 font-medium text-left">Site Name</th>
                                        <th className="px-5 py-3 font-medium text-left">Visit Date</th>
                                        <th className="px-5 py-3 font-medium text-left">Logged At</th>
                                        <th className="px-5 py-3 font-medium text-left">Feedback</th>
                                        <th className="px-5 py-3 font-medium text-left">Status</th>
                                        <th className="px-5 py-3 font-medium text-left">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {siteVisits.map((v) => (
                                        <tr key={v.id} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                                            <td className="px-5 py-3 text-gray-700">{v.site_name}</td>
                                            <td className="px-5 py-3 text-gray-700">{formatDate(v.visit_date)}</td>
                                            <td className="px-5 py-3 text-gray-700">{formatDateTime(v.logged_at)}</td>
                                            <td className="px-5 py-3 text-gray-700">{v.feedback_notes || '—'}</td>
                                            <td className="px-5 py-3">
                                                {!v.post_visit_status && (
                                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-100 text-orange-600 animate-pulse">
                                                        ⏳ Pending
                                                    </span>
                                                )}
                                                {v.post_visit_status === 'Interested' && (
                                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                                                        ✅ Interested
                                                    </span>
                                                )}
                                                {v.post_visit_status === 'Want Another' && (
                                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                                                        🔄 Want Another
                                                    </span>
                                                )}
                                                {v.post_visit_status === 'Not Interested' && (
                                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-200 text-gray-600">
                                                        ❌ Not Interested
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-5 py-3">
                                                {!v.post_visit_status ? (
                                                    <button
                                                        onClick={() => navigate(`/leads/${id}/visit-feedback/${v.id}`)}
                                                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-orange-500 text-white hover:bg-orange-600 transition-colors shadow-sm cursor-pointer">
                                                        📝 Log Feedback
                                                    </button>
                                                ) : (
                                                    <span className="text-xs text-gray-400">—</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {/* Lead History Section */}
            {history.length > 0 && (
                <div className="mb-6">
                    <h2 className="text-lg font-semibold text-gray-700 mb-4 border-l-4 border-amber-400 pl-4">Lead History</h2>
                    <div className="bg-white rounded-2xl shadow-card overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                                    <tr>
                                        <th className="px-5 py-3 font-medium text-left">Inquiry #</th>
                                        <th className="px-5 py-3 font-medium text-left">Date Added</th>
                                        <th className="px-5 py-3 font-medium text-left">Type</th>
                                        <th className="px-5 py-3 font-medium text-left">Budget</th>
                                        <th className="px-5 py-3 font-medium text-left">Stage Reached</th>
                                        <th className="px-5 py-3 font-medium text-left">Agent</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {history.map((h, idx) => (
                                        <tr key={h.id} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                                            <td className="px-5 py-3 text-gray-700 font-medium">Inquiry {history.length - idx}</td>
                                            <td className="px-5 py-3 text-gray-700">{formatDate(h.added_date)}</td>
                                            <td className="px-5 py-3 text-gray-700">{h.property_type || '—'}</td>
                                            <td className="px-5 py-3 text-gray-700">{h.budget_range ? formatBudgetRange(h.budget_range) : '—'}</td>
                                            <td className="px-5 py-3">
                                                <span className={
                                                    h.final_stage === 'Not Interested' ? 'text-red-500 font-medium' :
                                                        h.final_stage === 'Booking Confirmed' ? 'text-green-600 font-medium' :
                                                            'text-gray-500'
                                                }>{h.final_stage}</span>
                                            </td>
                                            <td className="px-5 py-3 text-gray-500">{h.added_by_username || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* Property Match Modal */}
            {showPropertyModal && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-card p-4 sm:p-8 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-lg font-bold text-gray-800">Select Property to Match</h2>
                            <button onClick={() => setShowPropertyModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
                        </div>

                        {/* Warning if current matched property is sold */}
                        {lead.matched_property_id && matchedProperty?.is_available === 0 && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-amber-600 text-xs mb-4 flex items-center gap-2">
                                <span>⚠️</span>
                                <span>The currently matched property has been marked as sold. Consider matching a different available property.</span>
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* None card */}
                            <div onClick={() => handleMatchProperty(null)}
                                className={`card cursor-pointer border-2 transition-all duration-150 p-4 ${lead.matched_property_id === null ? 'border-accent bg-accent/5' : 'border-gray-200 hover:border-gray-300'
                                    }`}>
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-xl">✕</div>
                                    <div>
                                        <p className="font-semibold text-gray-700">None</p>
                                        <p className="text-xs text-gray-400">Remove property match</p>
                                    </div>
                                </div>
                            </div>

                            {/* Only show AVAILABLE properties */}
                            {availableProperties.filter(p => p.is_available === 1).map(p => (
                                <div key={p.id} onClick={() => handleMatchProperty(p.id)}
                                    className="card cursor-pointer hover:ring-2 hover:ring-accent transition-all p-4">
                                    <h3 className="font-bold text-gray-800 text-sm">{p.property_name}</h3>
                                    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-semibold mt-1 ${p.property_type === 'Flat' ? 'bg-blue-100 text-blue-600' :
                                        p.property_type === 'Villa' ? 'bg-purple-100 text-purple-600' :
                                            'bg-green-100 text-green-600'
                                        }`}>{p.property_type}</span>
                                    <p className="text-xs text-gray-500 mt-1">{p.area}, {p.city}</p>
                                    <p className="text-sm font-semibold text-accent mt-1">₹{formatLakhs(p.price_inr)} Lakhs</p>
                                    <p className="text-xs text-gray-400">{p.size_sqft} sq.ft.</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
