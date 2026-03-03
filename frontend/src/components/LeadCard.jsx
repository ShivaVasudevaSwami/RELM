import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import StatusBadge from './StatusBadge';
import UrgencyTag from './UrgencyTag';

export default function LeadCard({ lead }) {
    const navigate = useNavigate();
    const { isAdmin, isAdminOrManager } = useAuth();

    const isNotInterested = lead.status === 'Not Interested';
    const isBookingConfirmed = lead.status === 'Booking Confirmed';
    const isVip = lead.is_vip === 1;
    const isOverdue = lead.next_follow_up && new Date(lead.next_follow_up) < new Date() && !isNotInterested && !isBookingConfirmed;

    const formatBudgetRange = (range) => {
        if (!range) return 'N/A';
        if (range === '1Cr+') return '₹1 Cr+';
        if (range === '50+') return '₹50+ Lakhs';
        return `₹${range} Lakhs`;
    };

    const formatFollowUp = (d) => {
        if (!d) return '';
        const dt = new Date(d);
        return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
            + ', ' + dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    };

    return (
        <div className={`card relative
      ${isBookingConfirmed || isVip ? 'border-2 border-amber-400 bg-amber-50 shadow-amber-100' : ''}
      ${isNotInterested && !isVip ? 'grayscale opacity-75 bg-gray-50' : ''}
      ${isOverdue ? 'ring-2 ring-red-400 animate-pulse' : ''}
    `}>
            {isNotInterested && !isVip && (
                <div className="text-xs font-bold text-gray-300 uppercase tracking-widest text-center mb-2 border border-gray-200 rounded-full py-0.5 flex items-center justify-center gap-1">
                    ❌ CLOSED
                </div>
            )}

            {(isBookingConfirmed || isVip) && (
                <div className="absolute top-3 right-3">
                    <span className="bg-amber-500 text-white text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1 shadow-md">
                        🏆 {isVip ? 'VIP' : 'CONVERTED'}
                    </span>
                </div>
            )}

            {isOverdue && !isBookingConfirmed && !isVip && (
                <div className="absolute top-3 right-3">
                    <span className="bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1">
                        ⏰ Overdue
                    </span>
                </div>
            )}

            <div className="flex items-start justify-between mb-3">
                <div className="min-w-0 flex-1">
                    <h3 className={`text-base font-bold truncate ${isBookingConfirmed || isVip ? 'text-amber-800' : 'text-gray-800'}`}>
                        {lead.name}
                    </h3>
                    <p className="text-sm text-gray-500">{lead.phone}</p>
                    {lead.email && <p className="text-xs text-gray-400 truncate">{lead.email}</p>}
                </div>
                {!isNotInterested && !isBookingConfirmed && !isVip && (
                    <StatusBadge status={lead.ml_status || 'Cold'} />
                )}
                {(isBookingConfirmed || isVip) && (
                    <StatusBadge status="Gold" />
                )}
            </div>

            <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="text-sm font-semibold text-accent">{formatBudgetRange(lead.budget_range)}</span>
                {lead.urgency && !isNotInterested && <UrgencyTag urgency={lead.urgency} />}
                {isVip && lead.lifetime_value > 0 && (
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                        LTV: ₹{(lead.lifetime_value / 100000).toFixed(1)}L
                    </span>
                )}
            </div>

            <p className="text-xs text-gray-500 mb-1">
                Stage: <span className={`font-medium ${isBookingConfirmed || isVip ? 'text-amber-700' : 'text-gray-700'}`}>
                    {isVip && lead.status !== 'Booking Confirmed' ? `${lead.status} (VIP)` : lead.status || 'New Inquiry'}
                </span>
            </p>

            {lead.preferred_city && (
                <p className="text-sm text-gray-600 truncate">
                    {lead.preferred_area ? `${lead.preferred_area}, ` : ''}{lead.preferred_city}
                    {lead.preferred_state ? `, ${lead.preferred_state}` : ''}
                </p>
            )}

            {lead.next_follow_up && !isBookingConfirmed && !isNotInterested && (
                <p className={`text-xs mt-1 ${isOverdue ? 'text-red-600 font-semibold' : 'text-blue-500'}`}>
                    📅 Follow-up: {formatFollowUp(lead.next_follow_up)}
                </p>
            )}

            {(isAdmin || isAdminOrManager) && lead.agent_name && (
                <p className="text-xs text-gray-400 mt-1">Agent: {lead.agent_name}</p>
            )}

            <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100 flex-wrap">
                <button onClick={() => navigate(`/leads/${lead.id}`)}
                    className="btn-secondary text-xs px-3 py-1.5">
                    {isNotInterested || isBookingConfirmed ? 'View Details' : 'View'}
                </button>
                {!isNotInterested && !isBookingConfirmed && (
                    <>
                        <button onClick={() => navigate(`/leads/${lead.id}/status`)}
                            className="btn-primary text-xs px-3 py-1.5">Update Status</button>
                        <button onClick={() => navigate(`/leads/${lead.id}/schedule-visit`)}
                            className="btn-secondary text-xs px-3 py-1.5">Site Visit</button>
                    </>
                )}
            </div>
        </div>
    );
}

