import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import PropertyAutocomplete from '../components/PropertyAutocomplete';
import FieldError from '../components/FieldError';
import FormSummaryError from '../components/FormSummaryError';

export default function ScheduleVisit() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const [lead, setLead] = useState(null);
    const [selectedPropertyId, setSelectedPropertyId] = useState(null);
    const [selectedPropertyName, setSelectedPropertyName] = useState('');
    const [isPropertySelected, setIsPropertySelected] = useState(false);
    const [visitDate, setVisitDate] = useState('');
    const [agents, setAgents] = useState([]);
    const [selectedAgent, setSelectedAgent] = useState('');
    const [isFirstVisit, setIsFirstVisit] = useState(false);
    const [error, setError] = useState('');
    const [fieldErrors, setFieldErrors] = useState({});
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [formSubmitAttempted, setFormSubmitAttempted] = useState(false);

    useEffect(() => {
        // Fetch lead details
        api.get(`/leads/${id}`)
            .then(res => {
                setLead(res.data.lead);
                // Check if this is the first visit (no site visits yet = baton pass needed)
                const visits = res.data.site_visits || [];
                setIsFirstVisit(visits.length === 0);
            })
            .catch(err => setError(err.response?.data?.error || 'Failed to load lead'));

        // Fetch agents for baton pass dropdown
        api.get('/admin/users/by-role?role=agent')
            .then(res => {
                const data = Array.isArray(res.data) ? res.data : (res.data?.users || []);
                setAgents(data.filter(u => u.is_active !== 0));
            })
            .catch(() => setAgents([]));
    }, [id]);

    const today = new Date().toISOString().split('T')[0];

    const handlePropertySelect = (name, propertyId, selected, suggestionsExist) => {
        setSelectedPropertyName(name || '');
        setSelectedPropertyId(propertyId || null);
        setIsPropertySelected(!!selected);
        if (formSubmitAttempted) {
            if (!selected) setFieldErrors(p => ({ ...p, property: 'You must select a valid property from the list' }));
            else setFieldErrors(p => ({ ...p, property: '' }));
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setFormSubmitAttempted(true);
        setError('');

        const errs = {};
        if (!isPropertySelected || !selectedPropertyId) {
            errs.property = 'You must select a valid property from the list';
        }
        if (!visitDate) errs.visitDate = 'Please select a visit date';
        else if (visitDate < today) errs.visitDate = 'Please select today or a future date';

        // Baton pass: require agent if first visit and user is telecaller
        if (isFirstVisit && (user?.role === 'telecaller' || user?.role === 'admin' || user?.role === 'manager') && !selectedAgent) {
            errs.agent = 'Please assign an agent for site visits';
        }

        setFieldErrors(errs);
        if (Object.keys(errs).length > 0) return;

        setLoading(true);
        try {
            await api.post(`/visits/${id}/schedule`, {
                site_name: selectedPropertyName,
                visit_date: visitDate,
                property_id: selectedPropertyId,
                assigned_agent: selectedAgent ? parseInt(selectedAgent) : undefined,
            });
            setSuccess(true);
            setTimeout(() => navigate(`/leads/${id}`), 1500);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to schedule visit');
        } finally { setLoading(false); }
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
                    <h1 className="text-xl font-bold text-gray-800 mb-2">Schedule Site Visit</h1>
                    {lead && <p className="text-sm text-gray-500 mb-6">{lead.name} — Lead #{lead.id}</p>}

                    {success && (
                        <div className="bg-green-50 text-green-600 px-4 py-3 rounded-lg text-sm mb-4">
                            ✅ Site visit scheduled!
                            {selectedAgent && ' Agent has been assigned.'}
                            {' '}Pipeline moved to "Site Visit Scheduled".
                        </div>
                    )}

                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm mb-4">{error}</div>
                    )}

                    {!success && (
                        <form onSubmit={handleSubmit} noValidate>
                            <FormSummaryError show={formSubmitAttempted && Object.values(fieldErrors).some(e => e)} />

                            {/* Strict Property Selection */}
                            <div className="mb-4">
                                <label className="form-label">Select Property *</label>
                                <PropertyAutocomplete
                                    onSelect={handlePropertySelect}
                                    strictMode={true}
                                    placeholder="🔍 Search available properties..."
                                />
                                <FieldError message={fieldErrors.property} />
                            </div>

                            {/* Visit Date */}
                            <div className="mb-4">
                                <label className="form-label">Visit Date *</label>
                                <input type="date" className={`input-field ${fieldErrors.visitDate ? 'border-red-400' : ''}`}
                                    min={today} value={visitDate}
                                    onChange={(e) => { setVisitDate(e.target.value); setFieldErrors(p => ({ ...p, visitDate: '' })); }} />
                                <FieldError message={fieldErrors.visitDate} />
                            </div>

                            {/* Agent Baton Pass — shown on first visit */}
                            {isFirstVisit && (
                                <div className="mb-4">
                                    <label className="form-label">Assign Agent for Site Visits *</label>
                                    <select
                                        className={`input-field ${fieldErrors.agent ? 'border-red-400' : ''}`}
                                        value={selectedAgent}
                                        onChange={(e) => { setSelectedAgent(e.target.value); setFieldErrors(p => ({ ...p, agent: '' })); }}
                                    >
                                        <option value="">-- Select Agent --</option>
                                        {agents.map(a => (
                                            <option key={a.id} value={a.id}>{a.username}</option>
                                        ))}
                                    </select>
                                    <FieldError message={fieldErrors.agent} />
                                    <p className="text-xs text-blue-500 mt-1">
                                        🔄 <strong>Baton Pass:</strong> This lead will be transferred to the selected agent's dashboard for all future site visits.
                                    </p>
                                </div>
                            )}

                            <div className="flex gap-3">
                                <button type="submit" disabled={loading} className="btn-primary flex-1">
                                    {loading ? 'Scheduling...' : 'Schedule Visit'}
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
