import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, ReferenceLine, Brush
} from 'recharts';
import { format, parseISO } from 'date-fns';
import api from '../api/axios';

const SERIES = {
    total: { color: '#6366f1', label: 'Total', gradient: 'gT' },
    hot: { color: '#ef4444', label: 'Hot', gradient: 'gH' },
    warm: { color: '#f97316', label: 'Warm', gradient: 'gW' },
    cold: { color: '#3b82f6', label: 'Cold', gradient: 'gC' },
    confirmed: { color: '#22c55e', label: 'Confirmed', gradient: 'gF' }
};

const RANGES = [
    { value: '1D', label: '1D', granularity: 'day' },
    { value: '1W', label: '1W', granularity: 'day' },
    { value: '1M', label: '1M', granularity: 'day' },
    { value: '3M', label: '3M', granularity: 'month' },
    { value: '1Y', label: '1Y', granularity: 'month' },
    { value: 'All', label: 'All', granularity: 'year' }
];

function formatXTick(period, range) {
    if (!period) return '';
    try {
        if (range === '1D') {
            const hour = parseInt((period.split('T')[1] || '0'));
            if (isNaN(hour)) return '';
            if (hour === 0) return '12AM';
            if (hour === 12) return '12PM';
            return hour < 12 ? `${hour}AM` : `${hour - 12}PM`;
        }
        if (range === '1W' || range === '1M') return format(parseISO(period), 'd MMM');
        if (range === '3M' || range === '1Y') return format(parseISO(period + '-01'), 'MMM \'yy');
        if (range === 'All') return period; // Just the year "2025"
        return format(parseISO(period + '-01'), "MMM ''yy");
    } catch { return period; }
}

export function formatFullPeriod(period, range) {
    if (!period) return '';
    try {
        if (range === '1D') {
            const hour = parseInt((period.split('T')[1] || '0'));
            const dateStr = period.split('T')[0];
            const timeStr = hour === 0 ? '12:00 AM' : hour === 12 ? '12:00 PM' : hour < 12 ? `${hour}:00 AM` : `${hour - 12}:00 PM`;
            return `${format(parseISO(dateStr), 'dd MMM yyyy')} ${timeStr}`;
        }
        if (range === '1W' || range === '1M') return format(parseISO(period), 'dd MMM yyyy');
        if (range === 'All') return `Year ${period}`;
        return format(parseISO(period + '-01'), 'MMMM yyyy');
    } catch { return period; }
}

const GFTooltip = ({ active, payload, label, range, activeSeries, onHover }) => {
    useEffect(() => {
        if (active && payload?.length) {
            const d = payload[0]?.payload;
            if (d) onHover?.(d);
        }
    }, [active, payload]);

    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;
    const cfg = SERIES[activeSeries];

    return (
        <div className="bg-gray-900 text-white rounded-xl shadow-2xl px-4 py-3 text-sm border border-gray-700 pointer-events-none">
            <p className="text-gray-400 text-xs mb-2 font-medium">{formatFullPeriod(label, range)}</p>
            <p className="font-bold text-lg" style={{ color: cfg?.color }}>
                {d[activeSeries] ?? 0}
                <span className="text-xs text-gray-400 ml-1 font-normal">{cfg?.label}</span>
            </p>
            {activeSeries !== 'total' && <p className="text-gray-400 text-xs mt-1">Total: {d.total ?? 0}</p>}
        </div>
    );
};

export default function LeadTimelineGraph({ onPeriodSelect, selectedPeriod, onHoverChange }) {
    const [range, setRange] = useState('1D');
    const [granularity, setGranularity] = useState('day');
    const [activeSeries, setActiveSeries] = useState('total');
    const [timelineData, setTimelineData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [hoveredData, setHoveredData] = useState(null);
    const [brushIndices, setBrushIndices] = useState(null);

    const visibleData = useMemo(() => {
        if (!brushIndices || timelineData.length === 0) return timelineData;
        return timelineData.slice(brushIndices.startIndex, brushIndices.endIndex + 1);
    }, [timelineData, brushIndices]);

    const latestPoint = visibleData[visibleData.length - 1];
    const firstPoint = visibleData[0];
    const displayData = hoveredData || latestPoint;
    const displayValue = displayData?.[activeSeries] ?? 0;

    // Propagate hover state to parent for cursor-sync
    useEffect(() => {
        if (onHoverChange) onHoverChange(hoveredData);
    }, [hoveredData]);

    const cfg = SERIES[activeSeries];

    const fetchTimeline = useCallback(async () => {
        setLoading(true); setError(null); setHoveredData(null);
        try {
            const apiRange = { '1D': '1D', '1W': '7d', '1M': '30d', '3M': '90d', '1Y': '1y', 'All': 'all' }[range] || '1y';
            const apiGran = range === '1D' ? 'day_hour' : granularity;
            const res = await api.get(`/leads/timeline?granularity=${apiGran}&range=${apiRange}`);
            setTimelineData(res.data?.data || []);
            setBrushIndices(null);
        } catch (err) {
            console.error(err); setError('Failed to load data'); setTimelineData([]);
        } finally { setLoading(false); }
    }, [range, granularity]);

    useEffect(() => { fetchTimeline(); }, [fetchTimeline]);

    const handleRangeChange = (opt) => {
        setRange(opt.value); setGranularity(opt.granularity);
        if (onPeriodSelect) onPeriodSelect(null, opt.granularity, opt.value);
        setBrushIndices(null); setHoveredData(null);
    };

    const handleChartClick = (data) => {
        if (!data?.activePayload?.length) return;
        const period = data.activePayload[0]?.payload?.period;
        if (period && onPeriodSelect) onPeriodSelect(period, range === '1D' ? 'day_hour' : granularity, range);
    };

    const periodStats = useMemo(() => {
        if (selectedPeriod) {
            return timelineData.find(d => d.period === selectedPeriod) || null;
        }
        return visibleData.reduce((acc, d) => ({
            total: (acc.total || 0) + (d.total || 0),
            hot: (acc.hot || 0) + (d.hot || 0),
            warm: (acc.warm || 0) + (d.warm || 0),
            cold: (acc.cold || 0) + (d.cold || 0),
            confirmed: (acc.confirmed || 0) + (d.confirmed || 0)
        }), {});
    }, [selectedPeriod, timelineData, visibleData]);

    return (
        <div className="bg-white rounded-2xl shadow-card p-5 sm:p-6 mb-6">

            {/* Header: title + series pills */}
            <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Lead Timeline</p>
                <div className="flex gap-1">
                    {Object.entries(SERIES).map(([key, s]) => (
                        <button key={key} onClick={() => setActiveSeries(key)}
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-all border
                                ${activeSeries === key ? 'text-white border-transparent shadow-sm' : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'}`}
                            style={activeSeries === key ? { background: s.color, borderColor: s.color } : {}}>
                            {s.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Big number (Google Finance) */}
            <div className="mb-5">
                <div className="flex items-baseline gap-3">
                    <span className="text-5xl font-bold text-gray-900 tabular-nums leading-none">{displayValue}</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                    {hoveredData ? formatFullPeriod(hoveredData.period, range) : `${SERIES[activeSeries].label} leads — ${range}`}
                    {selectedPeriod && !hoveredData && (
                        <span className="ml-2 text-indigo-400">• Selected: {formatFullPeriod(selectedPeriod, range)}</span>
                    )}
                </p>
            </div>

            {/* Chart area */}
            {loading ? (
                <div className="h-52 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-2">
                        <div className="animate-spin w-6 h-6 border-4 border-t-transparent rounded-full" style={{ borderColor: cfg.color, borderTopColor: 'transparent' }}></div>
                        <p className="text-xs text-gray-400">Loading...</p>
                    </div>
                </div>
            ) : error ? (
                <div className="h-52 flex items-center justify-center text-center">
                    <div>
                        <p className="text-red-400 text-sm">{error}</p>
                        <button onClick={fetchTimeline} className="text-xs text-accent mt-2 hover:underline">Retry</button>
                    </div>
                </div>
            ) : timelineData.length === 0 ? (
                <div className="h-52 flex items-center justify-center text-center">
                    <div>
                        <p className="text-4xl mb-2">📈</p>
                        <p className="text-gray-400 text-sm">No data yet. Add leads to see the timeline.</p>
                    </div>
                </div>
            ) : (
                <>
                    {/* Main area chart */}
                    <ResponsiveContainer width="100%" height={220}>
                        <AreaChart data={visibleData} onClick={handleChartClick}
                            onMouseLeave={() => setHoveredData(null)}
                            margin={{ top: 5, right: 5, left: -20, bottom: 0 }} style={{ cursor: 'crosshair' }}>
                            <defs>
                                {Object.entries(SERIES).map(([key, s]) => (
                                    <linearGradient key={key} id={s.gradient} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={s.color} stopOpacity={0.2} />
                                        <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                                    </linearGradient>
                                ))}
                            </defs>
                            <CartesianGrid horizontal={true} vertical={false} stroke="#f1f5f9" strokeDasharray="" />
                            <XAxis dataKey="period" tickFormatter={(p) => formatXTick(p, range)}
                                tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                                interval="preserveStartEnd" minTickGap={40} />
                            <YAxis orientation="right" allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }}
                                axisLine={false} tickLine={false} width={35} />
                            <Tooltip content={<GFTooltip range={range} activeSeries={activeSeries} onHover={setHoveredData} />}
                                cursor={{ stroke: cfg.color, strokeWidth: 1, strokeDasharray: '4 2', strokeOpacity: 0.6 }} />
                            {selectedPeriod && visibleData.some(d => d.period === selectedPeriod) && (
                                <ReferenceLine x={selectedPeriod} stroke={cfg.color} strokeWidth={1.5} strokeDasharray="3 3" />
                            )}
                            <Area type="monotone" dataKey={activeSeries} stroke={cfg.color} strokeWidth={2}
                                fill={`url(#${cfg.gradient})`} dot={false}
                                activeDot={{ r: 4, fill: cfg.color, stroke: 'white', strokeWidth: 2 }} animationDuration={400} />
                            {Object.entries(SERIES).filter(([k]) => k !== activeSeries).map(([key, s]) => (
                                <Area key={key} type="monotone" dataKey={key} stroke={s.color} strokeWidth={0.75}
                                    strokeOpacity={0.2} fill="none" dot={false} activeDot={false} animationDuration={400} />
                            ))}
                        </AreaChart>
                    </ResponsiveContainer>

                    {/* Mini brush chart */}
                    <div className="mt-1">
                        <ResponsiveContainer width="100%" height={40}>
                            <AreaChart data={timelineData} margin={{ top: 0, right: 5, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="miniGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={cfg.color} stopOpacity={0.3} />
                                        <stop offset="100%" stopColor={cfg.color} stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <Area type="monotone" dataKey={activeSeries} stroke={cfg.color} strokeWidth={1}
                                    fill="url(#miniGrad)" dot={false} animationDuration={400} />
                                <Brush dataKey="period" height={28} stroke={cfg.color} strokeOpacity={0.3}
                                    fill="#f8fafc" travellerWidth={5} onChange={setBrushIndices} tickFormatter={() => ''}>
                                    <AreaChart>
                                        <Area type="monotone" dataKey={activeSeries} stroke={cfg.color} strokeWidth={1}
                                            fill="url(#miniGrad)" dot={false} />
                                    </AreaChart>
                                </Brush>
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>

                    {/* Range buttons */}
                    <div className="flex justify-end gap-1 mt-3">
                        {RANGES.map(opt => (
                            <button key={opt.value} onClick={() => handleRangeChange(opt)}
                                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all
                                    ${range === opt.value ? 'text-white shadow-sm' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'}`}
                                style={range === opt.value ? { background: cfg.color } : {}}>
                                {opt.label}
                            </button>
                        ))}
                    </div>

                    {/* Period stats bar */}
                    <div className="grid grid-cols-5 gap-2 mt-4 pt-4 border-t border-gray-100">
                        {Object.entries(SERIES).map(([key, s]) => {
                            const val = periodStats?.[key] ?? 0;
                            return (
                                <button key={key} onClick={() => setActiveSeries(key)}
                                    className={`text-center py-2 px-1 rounded-xl transition-all ${activeSeries === key ? 'bg-gray-50 shadow-sm' : 'hover:bg-gray-50'}`}>
                                    <p className="text-xl font-bold tabular-nums" style={{ color: s.color }}>{val}</p>
                                    <p className="text-xs text-gray-400">{s.label}</p>
                                    {selectedPeriod && <p className="text-xs text-gray-300 leading-tight">this period</p>}
                                </button>
                            );
                        })}
                    </div>

                    {/* Selected period bar */}
                    {selectedPeriod && (
                        <div className="mt-3 flex items-center justify-between bg-indigo-50 rounded-xl px-4 py-2">
                            <span className="text-xs text-indigo-600 font-medium">📅 {formatFullPeriod(selectedPeriod, range)}</span>
                            <button onClick={() => onPeriodSelect && onPeriodSelect(null, granularity, range)}
                                className="text-xs text-indigo-400 hover:text-indigo-600">Clear ✕</button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
