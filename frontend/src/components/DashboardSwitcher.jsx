import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';

/**
 * DashboardSwitcher — Shows role-specific content section on Dashboard.
 *
 * Telecaller → "Today's Call Queue" (sorted by next_follow_up)
 * Agent      → "Site Visit Schedule" (today's visits with BHK/size details)
 * Manager/Admin → Team analytics panels
 */
export default function DashboardSwitcher() {
    const { user, isTelecaller, isAgent } = useAuth();
    const navigate = useNavigate();

    if (isTelecaller) return <TelecallerQueue />;
    if (isAgent) return <AgentSchedule />;
    return <ManagerPanel />;
}

// ─── TELECALLER: Today's Call Queue ─────────────────────────

function TelecallerQueue() {
    const [leads, setLeads] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        api.get('/leads')
            .then(res => {
                const data = Array.isArray(res.data) ? res.data : (res.data?.leads || []);
                // Sort by next_follow_up ASC (overdue first, then upcoming)
                const sorted = data
                    .filter(l => l.status !== 'Not Interested' && l.status !== 'Booking Confirmed')
                    .sort((a, b) => {
                        if (!a.next_follow_up && !b.next_follow_up) return 0;
                        if (!a.next_follow_up) return 1;
                        if (!b.next_follow_up) return -1;
                        return new Date(a.next_follow_up) - new Date(b.next_follow_up);
                    });
                setLeads(sorted);
            })
            .catch(() => setLeads([]))
            .finally(() => setLoading(false));
    }, []);

    const now = new Date();
    const fifteenMinsAgo = new Date(now.getTime() - 15 * 60 * 1000);
    const overdue = leads.filter(l => l.next_follow_up && new Date(l.next_follow_up) < now);
    const vipReInquiries = leads.filter(l => l.is_vip === 1 && !overdue.includes(l));
    const newLeads = leads.filter(l =>
        l.created_at && new Date(l.created_at) > fifteenMinsAgo
        && !overdue.includes(l) && !vipReInquiries.includes(l));
    const upcoming = leads.filter(l =>
        l.next_follow_up && new Date(l.next_follow_up) >= now
        && !vipReInquiries.includes(l) && !newLeads.includes(l));
    const noFollowUp = leads.filter(l =>
        !l.next_follow_up && !vipReInquiries.includes(l) && !newLeads.includes(l));

    const getScoreColor = (status) => {
        if (status === 'Gold') return 'text-amber-600 bg-amber-50';
        if (status === 'Hot') return 'text-red-500 bg-red-50';
        if (status === 'Warm') return 'text-orange-500 bg-orange-50';
        return 'text-blue-500 bg-blue-50';
    };

    const CallCard = ({ lead }) => {
        const isOverdue = lead.next_follow_up && new Date(lead.next_follow_up) < now;
        const isVip = lead.is_vip === 1;
        return (
            <div
                onClick={() => navigate(`/leads/${lead.id}`)}
                className={`p-4 rounded-xl border cursor-pointer transition-all hover:shadow-md
                    ${isVip ? 'border-amber-300 bg-amber-50/50' : ''}
                    ${isOverdue && !isVip ? 'border-red-300 bg-red-50/50 animate-pulse' : ''}
                    ${!isOverdue && !isVip ? 'border-gray-100 bg-white hover:border-accent/30' : ''}`}
            >
                <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-gray-800 text-sm">
                        {isVip && '⭐ '}{lead.name}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getScoreColor(lead.ml_status)}`}>
                        {lead.ml_status}
                    </span>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-400">
                    <span>📞 {lead.phone}</span>
                    <span>📋 {lead.status}</span>
                </div>
                {lead.next_follow_up && (
                    <div className={`mt-2 text-xs font-medium ${isOverdue ? 'text-red-600' : 'text-green-600'}`}>
                        {isOverdue ? '⏰ OVERDUE: ' : '📅 '}{new Date(lead.next_follow_up).toLocaleString()}
                    </div>
                )}
                {lead.last_call_status && (
                    <div className="mt-1 text-xs text-gray-400">Last call: {lead.last_call_status}</div>
                )}
            </div>
        );
    };

    if (loading) return <div className="text-center py-8 text-gray-400">Loading call queue...</div>;

    return (
        <div className="card p-5 mb-6">
            <h2 className="text-lg font-bold text-gray-800 mb-4">📞 Today's Call Queue</h2>

            {overdue.length > 0 && (
                <div className="mb-4">
                    <h3 className="text-sm font-semibold text-red-600 mb-2">🔴 Overdue ({overdue.length})</h3>
                    <div className="grid gap-2">
                        {overdue.map(l => <CallCard key={l.id} lead={l} />)}
                    </div>
                </div>
            )}

            {newLeads.length > 0 && (
                <div className="mb-4">
                    <h3 className="text-sm font-semibold text-purple-600 mb-2">🆕 New Leads {'<'}15 min ({newLeads.length})</h3>
                    <div className="grid gap-2">
                        {newLeads.map(l => <CallCard key={l.id} lead={l} />)}
                    </div>
                </div>
            )}

            {vipReInquiries.length > 0 && (
                <div className="mb-4">
                    <h3 className="text-sm font-semibold text-amber-600 mb-2">⭐ VIP Re-inquiries ({vipReInquiries.length})</h3>
                    <div className="grid gap-2">
                        {vipReInquiries.map(l => <CallCard key={l.id} lead={l} />)}
                    </div>
                </div>
            )}

            {upcoming.length > 0 && (
                <div className="mb-4">
                    <h3 className="text-sm font-semibold text-green-600 mb-2">🟢 Upcoming ({upcoming.length})</h3>
                    <div className="grid gap-2">
                        {upcoming.map(l => <CallCard key={l.id} lead={l} />)}
                    </div>
                </div>
            )}

            {noFollowUp.length > 0 && (
                <div>
                    <h3 className="text-sm font-semibold text-gray-500 mb-2">⚪ No Follow-up Set ({noFollowUp.length})</h3>
                    <div className="grid gap-2">
                        {noFollowUp.map(l => <CallCard key={l.id} lead={l} />)}
                    </div>
                </div>
            )}

            {leads.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No leads assigned to you.</p>}
        </div>
    );
}

// ─── AGENT: Site Visit Schedule ─────────────────────────────

function AgentSchedule() {
    const [visits, setVisits] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        // Fetch leads assigned to agent, then extract pending visits
        api.get('/leads')
            .then(async (res) => {
                const leads = Array.isArray(res.data) ? res.data : (res.data?.leads || []);
                const allVisits = [];

                for (const lead of leads) {
                    try {
                        const detail = await api.get(`/leads/${lead.id}`);
                        const sv = detail.data.site_visits || [];
                        sv.forEach(v => {
                            allVisits.push({ ...v, lead_name: lead.name, lead_phone: lead.phone, lead_id: lead.id });
                        });
                    } catch { /* skip */ }
                }

                // Sort by visit_date, pending visits first
                allVisits.sort((a, b) => {
                    if (!a.post_visit_status && b.post_visit_status) return -1;
                    if (a.post_visit_status && !b.post_visit_status) return 1;
                    return new Date(a.visit_date) - new Date(b.visit_date);
                });

                setVisits(allVisits);
            })
            .catch(() => setVisits([]))
            .finally(() => setLoading(false));
    }, []);

    const parseExtra = (raw) => {
        if (!raw) return {};
        if (typeof raw === 'object') return raw;
        try { return JSON.parse(raw); } catch { return {}; }
    };

    if (loading) return <div className="text-center py-8 text-gray-400">Loading visit schedule...</div>;

    const pendingVisits = visits.filter(v => !v.post_visit_status);
    const completedVisits = visits.filter(v => v.post_visit_status);

    return (
        <div className="card p-5 mb-6">
            <h2 className="text-lg font-bold text-gray-800 mb-4">🏠 Site Visit Schedule</h2>

            {pendingVisits.length > 0 && (
                <div className="mb-4">
                    <h3 className="text-sm font-semibold text-blue-600 mb-2">📅 Pending Visits ({pendingVisits.length})</h3>
                    <div className="space-y-3">
                        {pendingVisits.map(v => (
                            <div key={v.id}
                                className="flex items-start gap-4 p-4 rounded-xl border border-blue-200 bg-blue-50/50 cursor-pointer hover:shadow-md transition-all"
                                onClick={() => navigate(`/leads/${v.lead_id}`)}
                            >
                                <div className="w-1 h-16 bg-blue-500 rounded-full flex-shrink-0"></div>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between">
                                        <span className="font-semibold text-gray-800 text-sm">{v.lead_name}</span>
                                        <span className="text-xs text-blue-600 font-medium">
                                            {new Date(v.visit_date).toLocaleDateString()}
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-600 mt-0.5">🏢 {v.site_name}</p>
                                    <p className="text-xs text-gray-400 mt-1">📞 {v.lead_phone}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {completedVisits.length > 0 && (
                <div>
                    <h3 className="text-sm font-semibold text-gray-500 mb-2">✅ Completed ({completedVisits.length})</h3>
                    <div className="space-y-2">
                        {completedVisits.slice(0, 5).map(v => (
                            <div key={v.id}
                                className="flex items-center gap-3 p-3 rounded-lg border border-gray-100 text-sm cursor-pointer hover:bg-surface/80"
                                onClick={() => navigate(`/leads/${v.lead_id}`)}
                            >
                                <span className="text-gray-600 flex-1">{v.lead_name} · {v.site_name}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full ${v.post_visit_status === 'Interested' ? 'bg-green-100 text-green-600' : v.post_visit_status === 'Not Interested' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                                    {v.post_visit_status}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {visits.length === 0 && <p className="text-sm text-gray-400 text-center py-4">No visits scheduled yet.</p>}
        </div>
    );
}

// ─── MANAGER: Team Analytics Panel ──────────────────────────

function ManagerPanel() {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get('/leads')
            .then(res => {
                const leads = Array.isArray(res.data) ? res.data : (res.data?.leads || []);
                const now = new Date();
                const stagnant = leads.filter(l => {
                    if (l.status === 'Not Interested' || l.status === 'Booking Confirmed') return false;
                    if (!l.last_interaction_at) return true;
                    const days = (now - new Date(l.last_interaction_at)) / (1000 * 60 * 60 * 24);
                    return days > 3;
                });

                setStats({
                    total: leads.length,
                    hot: leads.filter(l => l.ml_status === 'Hot').length,
                    warm: leads.filter(l => l.ml_status === 'Warm').length,
                    cold: leads.filter(l => l.ml_status === 'Cold').length,
                    stagnant: stagnant.length,
                    overdue: leads.filter(l => l.next_follow_up && new Date(l.next_follow_up) < now
                        && l.status !== 'Not Interested' && l.status !== 'Booking Confirmed').length,
                    confirmed: leads.filter(l => l.status === 'Booking Confirmed').length,
                    pipeline: {
                        'New Inquiry': leads.filter(l => l.status === 'New Inquiry').length,
                        'Contacted': leads.filter(l => l.status === 'Contacted').length,
                        'Qualified': leads.filter(l => l.status === 'Qualified').length,
                        'Site Visit Scheduled': leads.filter(l => l.status === 'Site Visit Scheduled').length,
                        'Site Visited': leads.filter(l => l.status === 'Site Visited').length,
                        'Negotiation': leads.filter(l => l.status === 'Negotiation').length,
                    }
                });
            })
            .catch(() => setStats(null))
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="text-center py-8 text-gray-400">Loading analytics...</div>;
    if (!stats) return null;

    const pipelineStages = Object.entries(stats.pipeline);
    const maxCount = Math.max(...pipelineStages.map(([, v]) => v), 1);

    return (
        <div className="card p-5 mb-6">
            <h2 className="text-lg font-bold text-gray-800 mb-4">📊 Team Analytics</h2>

            {/* Score Distribution */}
            <div className="grid grid-cols-3 gap-3 mb-5">
                <div className="text-center p-3 rounded-xl bg-red-50 border border-red-100">
                    <div className="text-2xl font-bold text-red-500">{stats.hot}</div>
                    <div className="text-xs text-gray-500">🔴 Hot</div>
                </div>
                <div className="text-center p-3 rounded-xl bg-orange-50 border border-orange-100">
                    <div className="text-2xl font-bold text-orange-500">{stats.warm}</div>
                    <div className="text-xs text-gray-500">🟠 Warm</div>
                </div>
                <div className="text-center p-3 rounded-xl bg-blue-50 border border-blue-100">
                    <div className="text-2xl font-bold text-blue-500">{stats.cold}</div>
                    <div className="text-xs text-gray-500">🔵 Cold</div>
                </div>
            </div>

            {/* Alerts */}
            <div className="grid grid-cols-2 gap-3 mb-5">
                {stats.stagnant > 0 && (
                    <div className="p-3 rounded-xl bg-yellow-50 border border-yellow-200">
                        <div className="text-xl font-bold text-yellow-600">{stats.stagnant}</div>
                        <div className="text-xs text-gray-500">⚠️ Stagnant Leads</div>
                    </div>
                )}
                {stats.overdue > 0 && (
                    <div className="p-3 rounded-xl bg-red-50 border border-red-200">
                        <div className="text-xl font-bold text-red-600">{stats.overdue}</div>
                        <div className="text-xs text-gray-500">⏰ Overdue Follow-ups</div>
                    </div>
                )}
            </div>

            {/* Pipeline Funnel */}
            <h3 className="text-sm font-semibold text-gray-600 mb-3">Pipeline Funnel</h3>
            <div className="space-y-2">
                {pipelineStages.map(([stage, count]) => (
                    <div key={stage} className="flex items-center gap-3">
                        <span className="text-xs text-gray-500 w-32 flex-shrink-0 truncate">{stage}</span>
                        <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-gradient-to-r from-accent to-indigo-400 rounded-full transition-all duration-500"
                                style={{ width: `${(count / maxCount) * 100}%` }}
                            ></div>
                        </div>
                        <span className="text-xs font-semibold text-gray-700 w-6 text-right">{count}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
