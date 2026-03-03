import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { format, parseISO } from 'date-fns';
import LeadTimelineGraph, { formatFullPeriod } from '../components/LeadTimelineGraph';
import LeadCard from '../components/LeadCard';
import DashboardSwitcher from '../components/DashboardSwitcher';
import api from '../api/axios';
import { useNavigate } from 'react-router-dom';

// ── ML Filter helper (pure function) ────────────────────────
function filterByMl(leads, filter) {
    if (filter === 'All') return leads;
    if (filter === 'Gold') return leads.filter(l => l?.is_vip === 1 || l?.ml_status === 'Gold');
    if (filter === 'Hot') return leads.filter(l => l?.ml_status === 'Hot' && l?.status !== 'Booking Confirmed' && !l?.is_vip);
    return leads.filter(l => l?.ml_status === filter);
}

// ── SQLite timestamp → correct JS Date ──────────────────────
// SQLite CURRENT_TIMESTAMP = "YYYY-MM-DD HH:MM:SS" (UTC, NO Z suffix!)
// JS new Date("YYYY-MM-DD HH:MM:SS") treats it as LOCAL time → wrong!
// We append "Z" to force UTC interpretation, then getHours() gives correct local hour.
function toLocalDate(ts) {
    if (!ts) return null;
    const s = String(ts).trim();
    if (s.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(s)) return new Date(s);
    return new Date(s.replace(' ', 'T') + 'Z');
}

function localDateStr(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Period matcher — filters leads by a graph bucket ────────
function matchesPeriod(lead, period, range) {
    if (!lead?.created_at || !period) return false;
    const d = toLocalDate(lead.created_at);
    if (!d || isNaN(d.getTime())) return false;
    const ld = localDateStr(d);
    const lh = String(d.getHours()).padStart(2, '0');

    if (range === '1D') {
        const [pDate, pHour] = period.split('T');
        return ld === pDate && lh === pHour;
    }
    if (range === '1W' || range === '1M') {
        return ld === period.slice(0, 10);
    }
    if (range === 'All') {
        // period = "2026" → match year
        return ld.slice(0, 4) === period.slice(0, 4);
    }
    // 3M / 1Y → match month
    return ld.slice(0, 7) === period.slice(0, 7);
}

export default function Dashboard() {
    const [allLeads, setAllLeads] = useState([]);
    const [mlFilter, setMlFilter] = useState('All');
    const [selectedPeriod, setSelectedPeriod] = useState(null);
    const [selectedGranularity, setSelectedGranularity] = useState('day');
    const [selectedRange, setSelectedRange] = useState('1D');
    const [periodLoading, setPeriodLoading] = useState(false);
    const [soldCount, setSoldCount] = useState(0);
    const [statsLoading, setStatsLoading] = useState(true);
    const [isPeriodSelected, setIsPeriodSelected] = useState(false);
    const [hoveredStats, setHoveredStats] = useState(null);
    const periodLeadsRef = useRef([]);
    const navigate = useNavigate();

    useEffect(() => { fetchAllLeads(); fetchProperties(); }, []);

    const fetchAllLeads = async () => {
        try {
            setStatsLoading(true);
            const res = await api.get('/leads');
            setAllLeads(Array.isArray(res.data) ? res.data : []);
        } catch (err) { console.error(err); setAllLeads([]); }
        finally { setStatsLoading(false); }
    };

    const fetchProperties = async () => {
        try {
            const res = await api.get('/properties');
            setSoldCount((Array.isArray(res.data) ? res.data : []).filter(p => p?.is_available === 0).length);
        } catch { setSoldCount(0); }
    };

    // ── Period click (locks filter) ─────────────────────────
    const handlePeriodSelect = useCallback(async (period, granularity, range) => {
        if (granularity) setSelectedGranularity(granularity);
        if (range) setSelectedRange(range);

        if (!period) {
            setSelectedPeriod(null); setIsPeriodSelected(false);
            periodLeadsRef.current = [];
            return;
        }

        setSelectedPeriod(period); setIsPeriodSelected(true); setPeriodLoading(true);
        try {
            const gran = (range === '1D' || granularity === 'day_hour') ? 'day_hour' : granularity;
            const res = await api.get(`/leads/by-period?period=${period}&granularity=${gran}`);
            periodLeadsRef.current = Array.isArray(res.data?.leads) ? res.data.leads : [];
        } catch (err) { console.error(err); periodLeadsRef.current = []; }
        finally { setPeriodLoading(false); }
    }, []);

    // ═══════════════════════════════════════════════════════
    // THE CORE: useMemo-based visible leads (60 FPS hover)
    // ═══════════════════════════════════════════════════════
    const visibleLeads = useMemo(() => {
        let source;

        // Priority 1: Hovering on graph → filter by hovered bucket
        if (hoveredStats?.period) {
            source = allLeads.filter(l => matchesPeriod(l, hoveredStats.period, selectedRange));
        }
        // Priority 2: Clicked/locked period → use fetched period leads
        else if (isPeriodSelected && periodLeadsRef.current.length > 0) {
            source = periodLeadsRef.current;
        }
        // Priority 3: Default → today's leads (local timezone)
        else {
            const todayStr = localDateStr(new Date());
            source = selectedRange === '1D'
                ? allLeads.filter(l => {
                    const d = toLocalDate(l.created_at);
                    return d && localDateStr(d) === todayStr;
                })
                : allLeads;
        }

        // Apply ML filter on top
        return filterByMl(source, mlFilter).sort((a, b) =>
            new Date(b.created_at) - new Date(a.created_at)
        );
    }, [allLeads, hoveredStats, isPeriodSelected, selectedRange, mlFilter]);

    const confirmedCount = allLeads.filter(l => l?.status === 'Booking Confirmed').length;

    // ── Stat counts (hover-aware) ───────────────────────────
    const getCount = (status) => {
        if (hoveredStats) {
            if (status === 'All') return hoveredStats.total || 0;
            if (status === 'Gold') return hoveredStats.confirmed || 0;
            if (status === 'Hot') return hoveredStats.hot || 0;
            if (status === 'Warm') return hoveredStats.warm || 0;
            if (status === 'Cold') return hoveredStats.cold || 0;
            return 0;
        }
        const source = isPeriodSelected ? periodLeadsRef.current : allLeads;
        if (status === 'All') return source.length;
        if (status === 'Gold') return source.filter(l => l?.is_vip === 1 || l?.ml_status === 'Gold').length;
        if (status === 'Hot') return source.filter(l => l?.ml_status === 'Hot' && l?.status !== 'Booking Confirmed' && !l?.is_vip).length;
        return source.filter(l => l?.ml_status === status).length;
    };

    // ── Section header text ─────────────────────────────────
    const sectionTitle = hoveredStats?.period
        ? `Leads at ${formatFullPeriod(hoveredStats.period, selectedRange)}`
        : isPeriodSelected
            ? `Leads in ${formatFullPeriod(selectedPeriod, selectedRange)}`
            : "Today's Leads";

    return (
        <div className="p-4 sm:p-6 lg:p-8 min-h-screen">

            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
                <button onClick={() => navigate('/leads/add')} className="btn-primary text-sm">+ Add Lead</button>
            </div>

            {/* 5 Big Number Stats — hover-reactive */}
            <div className="grid grid-cols-5 gap-3 mb-6">
                <div className="bg-white rounded-2xl shadow-card p-4 text-center">
                    <p className="text-3xl font-bold text-gray-800">{statsLoading ? '—' : getCount('All')}</p>
                    <p className="text-xs text-gray-400 mt-1">{hoveredStats ? '🔍 This Point' : 'Total'}</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-2xl shadow-card p-4 text-center">
                    <p className="text-3xl font-bold text-red-500">{statsLoading ? '—' : getCount('Hot')}</p>
                    <p className="text-xs text-gray-400 mt-1">🔥 Hot</p>
                </div>
                <div className="bg-orange-50 border border-orange-200 rounded-2xl shadow-card p-4 text-center">
                    <p className="text-3xl font-bold text-orange-500">{statsLoading ? '—' : getCount('Warm')}</p>
                    <p className="text-xs text-gray-400 mt-1">🟠 Warm</p>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-2xl shadow-card p-4 text-center">
                    <p className="text-3xl font-bold text-blue-500">{statsLoading ? '—' : getCount('Cold')}</p>
                    <p className="text-xs text-gray-400 mt-1">🔵 Cold</p>
                </div>
                <div className="bg-amber-50 border border-amber-300 rounded-2xl shadow-card p-4 text-center">
                    <p className="text-3xl font-bold text-amber-600">{statsLoading ? '—' : getCount('Gold')}</p>
                    <p className="text-xs text-gray-400 mt-1">🏆 Gold</p>
                </div>
            </div>

            {/* Role-Based Dashboard Section */}
            <DashboardSwitcher />

            {/* Timeline Graph — master controller */}
            <LeadTimelineGraph
                onPeriodSelect={handlePeriodSelect}
                selectedPeriod={selectedPeriod}
                onHoverChange={setHoveredStats}
            />

            {/* Lead Cards Section — reactive to hover/click */}
            <div className="bg-white rounded-2xl shadow-card p-4 sm:p-6">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">{sectionTitle}</h2>
                        <p className="text-sm text-gray-400 mt-0.5">
                            {periodLoading ? 'Loading...' : `${visibleLeads.length} lead${visibleLeads.length !== 1 ? 's' : ''}${mlFilter !== 'All' ? ` • ${mlFilter}` : ''}`}
                        </p>
                    </div>
                    <div className="flex gap-2 flex-wrap items-center">
                        {['All', 'Hot', 'Warm', 'Cold', 'Gold'].map(f => (
                            <button key={f} onClick={() => setMlFilter(f)}
                                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors
                                    ${mlFilter === f
                                        ? f === 'Gold' ? 'bg-amber-500 text-white' : 'bg-accent text-white'
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                                {f} <span className="ml-1 text-xs opacity-70">({getCount(f)})</span>
                            </button>
                        ))}
                        {isPeriodSelected && (
                            <button onClick={() => handlePeriodSelect(null, selectedGranularity, selectedRange)}
                                className="px-3 py-1.5 rounded-full text-sm bg-indigo-100 text-indigo-600 hover:bg-indigo-200 transition-colors">
                                📅 Clear Period ✕
                            </button>
                        )}
                    </div>
                </div>

                {periodLoading ? (
                    <div className="flex justify-center py-16">
                        <div className="animate-spin w-8 h-8 border-4 border-accent border-t-transparent rounded-full"></div>
                    </div>
                ) : visibleLeads.length === 0 ? (
                    <div className="text-center py-16">
                        <p className="text-5xl mb-4">{hoveredStats ? '📊' : isPeriodSelected ? '📅' : '🔍'}</p>
                        <p className="text-gray-500 text-lg mb-1">
                            {hoveredStats ? 'No leads added during this period' : isPeriodSelected ? 'No leads found for this period' : 'No leads added today'}
                        </p>
                        {!hoveredStats && !isPeriodSelected && (
                            <button onClick={() => navigate('/leads/add')} className="btn-primary mt-4 inline-block">+ Add Your First Lead</button>
                        )}
                        {isPeriodSelected && !hoveredStats && (
                            <button onClick={() => handlePeriodSelect(null, selectedGranularity, selectedRange)}
                                className="mt-3 text-accent text-sm hover:underline">Clear period filter</button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-5">
                        {visibleLeads.map(lead => <LeadCard key={lead.id} lead={lead} />)}
                    </div>
                )}
            </div>
        </div>
    );
}
