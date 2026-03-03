import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import StatusBadge from '../components/StatusBadge';
import FieldError from '../components/FieldError';
import FormSummaryError from '../components/FormSummaryError';

export default function UpdateStatus() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [lead, setLead] = useState(null);
    const [callStatus, setCallStatus] = useState('');
    const [notes, setNotes] = useState('');
    const [nextFollowUp, setNextFollowUp] = useState('');
    const [error, setError] = useState('');
    const [fieldErrors, setFieldErrors] = useState({});
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [newStatus, setNewStatus] = useState('');
    const [autoMsg, setAutoMsg] = useState('');
    const [formSubmitAttempted, setFormSubmitAttempted] = useState(false);

    useEffect(() => {
        api.get(`/leads/${id}`)
            .then(res => setLead(res.data.lead))
            .catch(err => setError(err.response?.data?.error || 'Failed to load lead'));
    }, [id]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (loading) return; // Prevent double-submission if clicked twice rapidly
        setFormSubmitAttempted(true);
        setError('');

        const errs = {};
        if (!callStatus) errs.callStatus = 'Please select a call status';
        if (!nextFollowUp && callStatus !== 'Not Interested') {
            errs.nextFollowUp = 'Next follow-up date & time is required';
        }

        // Quality Gate: If notes are provided, they must be meaningful (≥ 30 chars).
        // Exceptions: 'Not Interested' and 'No Response' do not require long notes.
        const isExceptionStatus = ['Not Interested', 'No Response'].includes(callStatus);
        if (notes && notes.length < 30 && !isExceptionStatus) {
            errs.notes = 'Notes must be at least 30 characters for Stage Progression.';
        }

        setFieldErrors(errs);
        if (Object.keys(errs).length > 0) return;

        if (callStatus === 'Not Interested') {
            if (!window.confirm('This will mark the lead as Not Interested and set status to Cold. Continue?')) return;
        }

        setLoading(true);
        try {
            const res = await api.post(`/interactions/${id}`, {
                call_status: callStatus,
                feedback_notes: notes || undefined,
                next_follow_up: nextFollowUp && callStatus !== 'Not Interested' ? new Date(nextFollowUp).toISOString() : undefined
            });

            if (res.data.success) {
                setNewStatus(res.data.lead?.ml_status || res.data.new_status || callStatus);
                setSuccess(true);

                // Show auto-progression toast if pipeline was auto-updated
                if (res.data.auto_progressed && res.data.auto_message) {
                    setAutoMsg(res.data.auto_message);
                }

                setTimeout(() => navigate(`/leads/${id}`), 2000);
            } else {
                setError(res.data.error || res.data.message || 'Failed to align interaction save block');
                setLoading(false);
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to log interaction');
            setLoading(false);
        }
    };

    if (!lead && !error) {
        return (
            <div className="p-4 sm:p-8 flex justify-center py-20">
                <div className="animate-spin rounded-full h-10 w-10 border-4 border-accent border-t-transparent"></div>
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-8">
            <div className="w-full max-w-lg mx-auto mt-4 sm:mt-10 px-0">
                <div className="card p-4 sm:p-8">
                    <h1 className="text-xl font-bold text-gray-800 mb-2">Log Call Interaction</h1>
                    {lead && (
                        <p className="text-sm text-gray-500 mb-6">
                            {lead.name} — Current: <StatusBadge status={lead.ml_status || 'Cold'} />
                        </p>
                    )}

                    {success && (
                        <div className="bg-green-50 text-green-600 px-4 py-3 rounded-lg text-sm mb-4 flex items-center gap-2">
                            Call logged! Score Status: <StatusBadge status={newStatus} />
                        </div>
                    )}

                    {autoMsg && (
                        <div className="bg-amber-50 border border-amber-300 text-amber-700 px-4 py-3 rounded-lg text-sm mb-4 flex items-center gap-2 animate-pulse">
                            <span className="text-lg">⚡</span>
                            <span className="font-semibold">{autoMsg}</span>
                        </div>
                    )}

                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm mb-4">{error}</div>
                    )}

                    {!success && (
                        <form onSubmit={handleSubmit} noValidate>
                            <FormSummaryError show={formSubmitAttempted && Object.values(fieldErrors).some(e => e)} />

                            <div className="mb-4">
                                <label className="form-label">Call Status *</label>
                                <select className={`input-field ${fieldErrors.callStatus ? 'border-red-400' : ''}`}
                                    value={callStatus}
                                    onChange={(e) => { setCallStatus(e.target.value); setFieldErrors(prev => ({ ...prev, callStatus: '' })); }}>
                                    <option value="">-- Select Status --</option>
                                    <option value="No Response">No Response</option>
                                    <option value="Picked">Picked</option>
                                    <option value="Not Interested">Not Interested</option>
                                    <option value="Interested">Interested</option>
                                </select>
                                <FieldError message={fieldErrors.callStatus} />
                            </div>

                            {callStatus === 'Not Interested' && (
                                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-600">
                                    ⚠️ This will mark the lead as <strong>Not Interested</strong> and set status to <strong>Cold</strong>.
                                </div>
                            )}

                            {/* Mandatory Next Follow-Up */}
                            {callStatus !== 'Not Interested' && (
                                <div className="mb-4">
                                    <label className="form-label">Next Follow-up Date & Time *</label>
                                    <input
                                        type="datetime-local"
                                        className={`input-field ${fieldErrors.nextFollowUp ? 'border-red-400' : ''}`}
                                        value={nextFollowUp}
                                        onChange={(e) => { setNextFollowUp(e.target.value); setFieldErrors(prev => ({ ...prev, nextFollowUp: '' })); }}
                                        min={new Date().toISOString().slice(0, 16)}
                                    />
                                    <FieldError message={fieldErrors.nextFollowUp} />
                                    <p className="text-xs text-gray-400 mt-1">
                                        📅 Set when to follow up with this lead next. This creates a reminder in the dashboard.
                                    </p>
                                </div>
                            )}

                            {/* Agent Handover Hint */}
                            {callStatus === 'Interested' && lead?.status === 'Contacted' && (
                                <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-4 text-sm text-blue-700">
                                    💡 <strong>Tip:</strong> This lead is interested! Consider advancing to
                                    <strong> Site Visit Scheduled</strong> from the Lead Detail page to hand it over to an agent.
                                </div>
                            )}

                            <div className="mb-6">
                                <label className="form-label">
                                    Notes (Min. 30 characters for Stage Progression)
                                </label>
                                <textarea
                                    className={`input-field h-28 resize-none ${fieldErrors.notes ? 'border-red-400' : ''}`}
                                    value={notes}
                                    onChange={(e) => {
                                        setNotes(e.target.value);
                                        if (fieldErrors.notes) setFieldErrors(prev => ({ ...prev, notes: '' }));
                                    }}
                                    placeholder="Call notes..."
                                />
                                <FieldError message={fieldErrors.notes} />
                            </div>

                            <div className="flex gap-3">
                                <button type="submit" disabled={loading} className="btn-primary flex-1">
                                    {loading ? 'Logging...' : 'Log Interaction'}
                                </button>
                                <button type="button" onClick={() => navigate(`/leads/${id}`)} className="btn-secondary">Cancel</button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
