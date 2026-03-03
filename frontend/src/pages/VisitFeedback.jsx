import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api/axios';
import PropertyAutocomplete from '../components/PropertyAutocomplete';
import FieldError from '../components/FieldError';
import FormSummaryError from '../components/FormSummaryError';

export default function VisitFeedback() {
    const { id, visitId } = useParams();
    const navigate = useNavigate();
    const [postVisitStatus, setPostVisitStatus] = useState('');
    const [feedbackNotes, setFeedbackNotes] = useState('');
    const [newPropertyId, setNewPropertyId] = useState(null);
    const [newPropertyName, setNewPropertyName] = useState('');
    const [isNewPropertySelected, setIsNewPropertySelected] = useState(false);
    const [error, setError] = useState('');
    const [fieldErrors, setFieldErrors] = useState({});
    const [loading, setLoading] = useState(false);
    const [formSubmitAttempted, setFormSubmitAttempted] = useState(false);

    const handleNewPropertySelect = (name, propertyId, selected) => {
        setNewPropertyName(name || '');
        setNewPropertyId(propertyId || null);
        setIsNewPropertySelected(!!selected);
        if (formSubmitAttempted) {
            if (!selected && postVisitStatus === 'Want Another') {
                setFieldErrors(p => ({ ...p, newProperty: 'Select a property for the next visit' }));
            } else {
                setFieldErrors(p => ({ ...p, newProperty: '' }));
            }
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setFormSubmitAttempted(true);
        setError('');

        const errs = {};
        if (!postVisitStatus) errs.postVisitStatus = 'Please select a post-visit status';
        if (!feedbackNotes || feedbackNotes.trim().length < 10) errs.feedbackNotes = 'Please enter at least 10 characters of feedback';

        // If "Want Another", require new property selection
        if (postVisitStatus === 'Want Another' && !isNewPropertySelected) {
            errs.newProperty = 'Select a property for the next visit';
        }

        setFieldErrors(errs);
        if (Object.keys(errs).length > 0) return;

        setLoading(true);
        try {
            await api.put(`/visits/${visitId}/feedback`, {
                post_visit_status: postVisitStatus,
                feedback_notes: feedbackNotes,
                new_property_id: postVisitStatus === 'Want Another' ? newPropertyId : undefined,
                new_property_name: postVisitStatus === 'Want Another' ? newPropertyName : undefined,
            });

            // After "Want Another", redirect to schedule-visit so agent can schedule next one
            if (postVisitStatus === 'Want Another') {
                navigate(`/leads/${id}/schedule-visit`);
            } else {
                navigate(`/leads/${id}`);
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to submit feedback');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-4 sm:p-8">
            <div className="w-full max-w-lg mx-auto mt-4 sm:mt-10 px-0">
                <div className="card p-4 sm:p-8">
                    <h1 className="text-xl font-bold text-gray-800 mb-6">Post-Visit Feedback</h1>
                    <p className="text-sm text-gray-500 mb-6">Lead #{id} — Visit #{visitId}</p>

                    {error && (
                        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm mb-4">{error}</div>
                    )}

                    <form onSubmit={handleSubmit} noValidate>
                        <FormSummaryError show={formSubmitAttempted && Object.values(fieldErrors).some(e => e)} />

                        <div className="mb-4">
                            <label className="form-label">Post-Visit Status *</label>
                            <select
                                className={`input-field ${fieldErrors.postVisitStatus ? 'border-red-400' : ''}`}
                                value={postVisitStatus}
                                onChange={(e) => { setPostVisitStatus(e.target.value); setFieldErrors(p => ({ ...p, postVisitStatus: '' })); }}
                            >
                                <option value="">-- Select Status --</option>
                                <option value="Not Interested">Not Interested</option>
                                <option value="Interested">Interested</option>
                                <option value="Want Another">Want Another Property</option>
                            </select>
                            <FieldError message={fieldErrors.postVisitStatus} />
                        </div>

                        {/* Want Another: Show property picker for next visit */}
                        {postVisitStatus === 'Want Another' && (
                            <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl p-4">
                                <label className="form-label text-blue-700">🔄 Select Next Property to Visit *</label>
                                <PropertyAutocomplete
                                    onSelect={handleNewPropertySelect}
                                    strictMode={true}
                                    placeholder="🔍 Search available properties..."
                                />
                                <FieldError message={fieldErrors.newProperty} />
                                <p className="text-xs text-blue-500 mt-2">
                                    A new site visit will be created and the pipeline will reset to "Site Visit Scheduled".
                                    The lead stays with the same assigned agent.
                                </p>
                            </div>
                        )}

                        {postVisitStatus === 'Not Interested' && (
                            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-600">
                                ⚠️ This will mark the lead as <strong>Not Interested</strong> and set status to <strong>Cold</strong>.
                            </div>
                        )}

                        <div className="mb-6">
                            <label className="form-label">Feedback / Notes *</label>
                            <textarea
                                className={`input-field h-28 resize-none ${fieldErrors.feedbackNotes ? 'border-red-400' : ''}`}
                                value={feedbackNotes}
                                onChange={(e) => { setFeedbackNotes(e.target.value); setFieldErrors(p => ({ ...p, feedbackNotes: '' })); }}
                                placeholder="Enter feedback notes (min 5 characters)..."
                            />
                            <FieldError message={fieldErrors.feedbackNotes} />
                        </div>

                        <div className="flex gap-3">
                            <button type="submit" disabled={loading} className="btn-primary flex-1 disabled:opacity-50">
                                {loading ? 'Submitting...' : postVisitStatus === 'Want Another' ? 'Submit & Schedule Next Visit' : 'Submit Feedback'}
                            </button>
                            <button type="button" onClick={() => navigate(`/leads/${id}`)} className="btn-secondary">Cancel</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
