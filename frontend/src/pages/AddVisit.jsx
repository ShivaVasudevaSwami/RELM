import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import StatusBadge from '../components/StatusBadge';

export default function AddVisit() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [lead, setLead] = useState(null);
    const [form, setForm] = useState({
        site_name: '',
        visit_date: '',
        feedback_notes: '',
        post_visit_status: 'Interested',
    });
    const [newStatus, setNewStatus] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        api.get(`/leads/${id}`)
            .then(res => setLead(res.data.lead))
            .catch(err => setError(err.response?.data?.error || 'Failed to load lead'));
    }, [id]);

    const handleChange = (e) => {
        setForm({ ...form, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const res = await api.post(`/visits/${id}`, form);
            setNewStatus(res.data.new_status);
            setSuccess(true);
            setTimeout(() => navigate(`/leads/${id}`), 2000);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to add visit');
        } finally {
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
                    <h1 className="text-xl font-bold text-gray-800 mb-2">Add Site Visit</h1>
                    {lead && (
                        <p className="text-sm text-gray-500 mb-6">
                            {lead.name} — Current: <StatusBadge status={lead.ml_status || 'Cold'} />
                        </p>
                    )}

                    {success && (
                        <div className="bg-green-50 text-green-600 px-4 py-3 rounded-lg text-sm mb-4 flex items-center gap-2">
                            Status updated to <StatusBadge status={newStatus} />
                        </div>
                    )}

                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm mb-4">{error}</div>
                    )}

                    {!success && (
                        <form onSubmit={handleSubmit}>
                            <div className="mb-4">
                                <label className="form-label">Site Name *</label>
                                <input type="text" name="site_name" className="input-field" value={form.site_name} onChange={handleChange} required />
                            </div>
                            <div className="mb-4">
                                <label className="form-label">Visit Date *</label>
                                <input type="date" name="visit_date" className="input-field" value={form.visit_date} onChange={handleChange} required />
                            </div>
                            <div className="mb-4">
                                <label className="form-label">Feedback / Notes</label>
                                <textarea name="feedback_notes" className="input-field h-28 resize-none" value={form.feedback_notes} onChange={handleChange} />
                            </div>
                            <div className="mb-6">
                                <label className="form-label">Post-Visit Status *</label>
                                <select name="post_visit_status" className="input-field" value={form.post_visit_status} onChange={handleChange} required>
                                    <option value="Not Interested">Not Interested</option>
                                    <option value="Interested">Interested</option>
                                    <option value="Want Another">Want Another</option>
                                </select>
                            </div>
                            <div className="flex gap-3">
                                <button type="submit" disabled={loading} className="btn-primary flex-1">
                                    {loading ? 'Submitting...' : 'Submit & Predict'}
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
