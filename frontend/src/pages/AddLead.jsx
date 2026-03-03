import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import LocationSelector from '../components/LocationSelector';
import StatusBadge from '../components/StatusBadge';
import FieldError from '../components/FieldError';
import FormSummaryError from '../components/FormSummaryError';

const VALIDATORS = {
    name: (v) => {
        if (!v || v.trim().length < 2 || v.trim().length > 60) return 'Name must be 2–60 characters and contain only letters';
        if (!/^[a-zA-Z\s]+$/.test(v.trim())) return 'Name must be 2–60 characters and contain only letters';
        return '';
    },
    phone: (v) => {
        if (!v) return 'Enter a valid 10-digit Indian mobile number starting with 6-9';
        if (!/^[6-9]\d{9}$/.test(v)) return 'Enter a valid 10-digit Indian mobile number starting with 6-9';
        return '';
    },
    email: (v) => {
        if (!v) return '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Enter a valid email address';
        return '';
    },
    preferred_property_type: (v) => (!v ? 'Please select a preferred property type' : ''),
    preferred_state: (v) => (!v ? 'Please select a state' : ''),
    preferred_city: (v) => (!v ? 'Please select a city' : ''),
    preferred_area: (v) => {
        if (!v || v.trim().length < 2) return 'Please enter your preferred area/locality';
        return '';
    },
    budget_range: (v) => (!v ? 'Please select a budget range' : ''),
    funding_source: (v) => (!v ? 'Please select a funding source' : ''),
    urgency: (v) => (!v ? 'Please select a timeline' : ''),
    occupation: (v) => (!v ? 'Please select an occupation' : ''),
    purchase_purpose: (v) => (!v ? 'Please select a purchase purpose' : ''),
};

// Default extra_details structures per property type
const EXTRA_DEFAULTS = {
    Flat: { bhk_config: '', floor_pref: '', furnishing: '' },
    Villa: { configuration: '', private_garden: false, parking: 1 },
    Plot: { plot_size: '', zoning: '', road_width: '' }
};

// ── Section panel wrapper (defined OUTSIDE component to prevent re-mount) ──
const Section = ({ title, icon, children }) => (
    <div className="bg-white border border-gray-100 rounded-xl p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-500 uppercase tracking-wider mb-5">
            {icon && <span className="text-base">{icon}</span>}
            {title}
        </h2>
        {children}
    </div>
);

export default function AddLead() {
    const navigate = useNavigate();
    const [form, setForm] = useState({
        name: '', phone: '', email: '',
        preferred_property_type: '', preferred_state: '', preferred_city: '',
        preferred_area: '', budget_range: '', funding_source: 'Self-Funded',
        urgency: 'Immediate', matched_property_id: '',
        occupation: '', purchase_purpose: '',
        possession_timeline: 'Immediate',
    });
    const [extraDetails, setExtraDetails] = useState({});
    const [properties, setProperties] = useState([]);
    const [errors, setErrors] = useState({});
    const [touched, setTouched] = useState({});
    const [serverError, setServerError] = useState('');
    const [loading, setLoading] = useState(false);
    const [duplicate, setDuplicate] = useState(null);
    const [phoneNotice, setPhoneNotice] = useState(null);
    const [formSubmitAttempted, setFormSubmitAttempted] = useState(false);

    useEffect(() => {
        api.get('/properties?available=1').then(res => setProperties(res.data)).catch(() => { });
    }, []);

    const validateField = (name, value) => {
        if (VALIDATORS[name]) return VALIDATORS[name](value);
        return '';
    };

    const handleChange = (e) => {
        let { name, value } = e.target;
        if (name === 'phone') { value = value.replace(/\D/g, '').slice(0, 10); setDuplicate(null); setPhoneNotice(null); }
        if (name === 'name') { value = value.replace(/\b\w/g, c => c.toUpperCase()); }
        if (name === 'email') { value = value.toLowerCase(); }
        setForm(prev => ({ ...prev, [name]: value }));

        // When property type changes, reset extra details to defaults
        if (name === 'preferred_property_type') {
            setExtraDetails(EXTRA_DEFAULTS[value] || {});
        }

        if (touched[name] || formSubmitAttempted) {
            setErrors(prev => ({ ...prev, [name]: validateField(name, value) }));
        }
    };

    const handleExtraChange = (e) => {
        const { name, value, type, checked } = e.target;
        setExtraDetails(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleBlur = async (e) => {
        const { name, value } = e.target;
        setTouched(prev => ({ ...prev, [name]: true }));
        setErrors(prev => ({ ...prev, [name]: validateField(name, value) }));

        if (name === 'phone' && /^[6-9]\d{9}$/.test(value)) {
            try {
                const res = await api.get(`/leads/check-phone?phone=${value}`);
                if (res.data.exists) {
                    if (res.data.can_add) {
                        setDuplicate(null);
                        setPhoneNotice({
                            type: res.data.status === 'Not Interested' ? 'warning' : 'info',
                            status: res.data.status,
                            total: res.data.total_inquiries,
                            name: res.data.name,
                        });
                    } else {
                        setPhoneNotice(null);
                        setDuplicate(res.data);
                    }
                } else {
                    setDuplicate(null);
                    setPhoneNotice(null);
                }
            } catch { /* ignore */ }
        }
    };

    const handleLocationChange = (state, city, area) => {
        setForm(prev => ({ ...prev, preferred_state: state, preferred_city: city, preferred_area: area }));
        if (formSubmitAttempted || touched.preferred_state) {
            setErrors(prev => ({
                ...prev,
                preferred_state: validateField('preferred_state', state),
                preferred_city: validateField('preferred_city', city),
                preferred_area: validateField('preferred_area', area),
            }));
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setFormSubmitAttempted(true);
        setServerError('');

        const newErrors = {};
        Object.keys(VALIDATORS).forEach(k => {
            const err = validateField(k, form[k]);
            if (err) newErrors[k] = err;
        });
        setErrors(newErrors);
        if (Object.keys(newErrors).length > 0) return;
        if (duplicate) return;

        setLoading(true);
        try {
            const payload = { ...form };
            if (!payload.matched_property_id) delete payload.matched_property_id;
            if (!payload.email) delete payload.email;

            // Attach extra_details as object (backend will JSON.stringify)
            if (form.preferred_property_type && EXTRA_DEFAULTS[form.preferred_property_type]) {
                payload.extra_details = extraDetails;
            }

            await api.post('/leads', payload);
            navigate('/dashboard');
        } catch (err) {
            if (err.response?.status === 409 && err.response?.data?.error === 'duplicate') {
                setDuplicate(err.response.data.existing_lead);
            } else if (err.response?.data?.errors) {
                const serverErrs = {};
                err.response.data.errors.forEach(e => { serverErrs[e.field] = e.message; });
                setErrors(prev => ({ ...prev, ...serverErrs }));
            } else {
                setServerError(err.response?.data?.error || err.response?.data?.message || 'Failed to add lead');
            }
        } finally { setLoading(false); }
    };

    const formatLakhs = (price) => (!price ? '0.00' : (price / 100000).toFixed(2));
    const formatDate = (d) => (!d ? 'N/A' : new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
    const fieldClass = (name) => `input-field ${errors[name] ? 'border-red-400 focus:ring-red-300' : (touched[name] && !errors[name] && form[name] ? 'border-green-400' : '')}`;

    const propType = form.preferred_property_type;

    return (
        <div className="bg-gray-50 min-h-full">
            {/* ── Page Header with Breadcrumbs ── */}
            <div className="bg-white border-b border-gray-200">
                <div className="px-6 sm:px-8 py-5">
                    <nav className="text-xs text-gray-400 mb-1">
                        <span className="hover:text-accent cursor-pointer" onClick={() => navigate('/dashboard')}>Dashboard</span>
                        <span className="mx-1.5">/</span>
                        <span className="hover:text-accent cursor-pointer" onClick={() => navigate('/dashboard')}>Leads</span>
                        <span className="mx-1.5">/</span>
                        <span className="text-gray-600 font-medium">Add New Lead</span>
                    </nav>
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-xl sm:text-2xl font-bold text-gray-800">Add New Lead</h1>
                            <p className="text-sm text-gray-400 mt-0.5">Fill in the buyer's details to create a new lead entry</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Form Content Area ── */}
            <div className="px-6 sm:px-8 py-6">
                <FormSummaryError show={formSubmitAttempted && Object.values(errors).some(e => e)} />

                {serverError && (
                    <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm mb-5">{serverError}</div>
                )}

                <form onSubmit={handleSubmit} noValidate>
                    <div className="space-y-6">

                        {/* ━━━━━━━━━━ SECTION 1: Basic Information ━━━━━━━━━━ */}
                        <Section title="Basic Information" icon="👤">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div>
                                    <label className="form-label">Full Name *</label>
                                    <input type="text" name="name" className={fieldClass('name')}
                                        value={form.name} onChange={handleChange} onBlur={handleBlur}
                                        placeholder="Enter full name" />
                                    <FieldError message={errors.name} />
                                </div>
                                <div>
                                    <label className="form-label">Phone Number *</label>
                                    <input type="text" name="phone" className={fieldClass('phone')} maxLength={10}
                                        value={form.phone} onChange={handleChange} onBlur={handleBlur}
                                        placeholder="10-digit mobile number" />
                                    <FieldError message={errors.phone} />

                                    {duplicate && (
                                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mt-2 text-sm">
                                            <p className="font-semibold text-amber-700 mb-2">⚠️ Active lead already exists with this number.</p>
                                            <div className="space-y-1 text-gray-700">
                                                <p><span className="text-gray-500">Name:</span> <span className="font-medium">{duplicate.name}</span></p>
                                                <p><span className="text-gray-500">Stage:</span> <span className="font-medium">{duplicate.status}</span></p>
                                                <p className="flex items-center gap-1"><span className="text-gray-500">Status:</span> <StatusBadge status={duplicate.ml_status || 'Cold'} /></p>
                                                <p><span className="text-gray-500">Added:</span> {formatDate(duplicate.created_at)}</p>
                                            </div>
                                            <button type="button" onClick={() => navigate(`/leads/${duplicate.id}`)}
                                                className="btn-primary text-xs mt-3">View Existing Lead →</button>
                                        </div>
                                    )}

                                    {phoneNotice && phoneNotice.type === 'warning' && (
                                        <div className="bg-green-50 border border-green-200 rounded-xl p-3 mt-2 text-sm text-green-700">
                                            <p className="font-medium">ℹ️ This number was previously marked Not Interested.</p>
                                            <p>A new lead will be created and linked to the previous inquiry history.</p>
                                            <p className="text-xs mt-1">Previous inquiries: {phoneNotice.total} times</p>
                                        </div>
                                    )}
                                    {phoneNotice && phoneNotice.type === 'info' && (
                                        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mt-2 text-sm text-blue-700">
                                            <p className="font-medium">ℹ️ This number has a Booking Confirmed lead.</p>
                                            <p>A new lead will be created and linked. Previous inquiries: {phoneNotice.total} times</p>
                                        </div>
                                    )}
                                </div>
                                <div className="md:col-span-2">
                                    <label className="form-label">Email Address</label>
                                    <input type="email" name="email" className={fieldClass('email')}
                                        value={form.email} onChange={handleChange} onBlur={handleBlur}
                                        placeholder="email@example.com (optional)" />
                                    <FieldError message={errors.email} />
                                </div>
                            </div>
                        </Section>

                        {/* ━━━━━━━━━━ SECTION 2: Buyer Profile ━━━━━━━━━━ */}
                        <Section title="Buyer Profile" icon="💼">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div>
                                    <label className="form-label">Occupation *</label>
                                    <select name="occupation" className={fieldClass('occupation')}
                                        value={form.occupation} onChange={handleChange} onBlur={handleBlur}>
                                        <option value="">-- Select Occupation --</option>
                                        <option value="Salaried">Salaried</option>
                                        <option value="Business">Business</option>
                                        <option value="Professional">Professional</option>
                                        <option value="Retired">Retired</option>
                                    </select>
                                    <FieldError message={errors.occupation} />
                                </div>
                                <div>
                                    <label className="form-label">Purchase Purpose *</label>
                                    <select name="purchase_purpose" className={fieldClass('purchase_purpose')}
                                        value={form.purchase_purpose} onChange={handleChange} onBlur={handleBlur}>
                                        <option value="">-- Select Purpose --</option>
                                        <option value="Self-Use">Self-Use</option>
                                        <option value="Investment">Investment</option>
                                    </select>
                                    <FieldError message={errors.purchase_purpose} />
                                </div>
                            </div>
                        </Section>

                        {/* ━━━━━━━━━━ SECTION 3: Property Preferences ━━━━━━━━━━ */}
                        <Section title="Property Preferences" icon="🏠">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
                                <div>
                                    <label className="form-label">Preferred Property Type *</label>
                                    <select name="preferred_property_type" className={fieldClass('preferred_property_type')}
                                        value={form.preferred_property_type} onChange={handleChange} onBlur={handleBlur}>
                                        <option value="">-- Select Type --</option>
                                        <option value="Flat">Flat</option>
                                        <option value="Villa">Villa</option>
                                        <option value="Plot">Plot</option>
                                    </select>
                                    <FieldError message={errors.preferred_property_type} />
                                </div>
                                <div>
                                    <label className="form-label">Match to Company Property</label>
                                    <select name="matched_property_id" className="input-field"
                                        value={form.matched_property_id} onChange={handleChange}>
                                        <option value="">-- Select (Optional) --</option>
                                        {properties.map(p => (
                                            <option key={p.id} value={p.id}>
                                                {p.property_name} — {p.property_type} — {p.city} — ₹{formatLakhs(p.price_inr)} L
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* ── Dynamic Fields per Property Type ── */}
                            {propType === 'Flat' && (
                                <div className="bg-indigo-50/60 border border-indigo-100 rounded-lg p-4 mb-5">
                                    <p className="text-xs font-semibold text-indigo-600 uppercase mb-3">🏢 Flat Details</p>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                        <div>
                                            <label className="form-label text-xs">BHK Configuration</label>
                                            <select name="bhk_config" className="input-field"
                                                value={extraDetails.bhk_config || ''} onChange={handleExtraChange}>
                                                <option value="">-- Select --</option>
                                                <option value="1 BHK">1 BHK</option>
                                                <option value="2 BHK">2 BHK</option>
                                                <option value="3 BHK">3 BHK</option>
                                                <option value="4+ BHK">4+ BHK</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="form-label text-xs">Floor Preference</label>
                                            <select name="floor_pref" className="input-field"
                                                value={extraDetails.floor_pref || ''} onChange={handleExtraChange}>
                                                <option value="">-- Select --</option>
                                                <option value="Low (1-4)">Low (1-4)</option>
                                                <option value="Mid (5-10)">Mid (5-10)</option>
                                                <option value="High (11+)">High (11+)</option>
                                                <option value="Any">Any</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="form-label text-xs">Furnishing</label>
                                            <select name="furnishing" className="input-field"
                                                value={extraDetails.furnishing || ''} onChange={handleExtraChange}>
                                                <option value="">-- Select --</option>
                                                <option value="Unfurnished">Unfurnished</option>
                                                <option value="Semi-Furnished">Semi-Furnished</option>
                                                <option value="Fully Furnished">Fully Furnished</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {propType === 'Villa' && (
                                <div className="bg-emerald-50/60 border border-emerald-100 rounded-lg p-4 mb-5">
                                    <p className="text-xs font-semibold text-emerald-600 uppercase mb-3">🏡 Villa Details</p>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                        <div>
                                            <label className="form-label text-xs">Configuration</label>
                                            <select name="configuration" className="input-field"
                                                value={extraDetails.configuration || ''} onChange={handleExtraChange}>
                                                <option value="">-- Select --</option>
                                                <option value="3 BHK Villa">3 BHK Villa</option>
                                                <option value="4 BHK Villa">4 BHK Villa</option>
                                                <option value="5+ BHK Villa">5+ BHK Villa</option>
                                                <option value="Duplex">Duplex</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="form-label text-xs">Private Garden</label>
                                            <label className="flex items-center gap-2 mt-2">
                                                <input type="checkbox" name="private_garden"
                                                    checked={!!extraDetails.private_garden}
                                                    onChange={handleExtraChange}
                                                    className="w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500" />
                                                <span className="text-sm text-gray-600">Yes, required</span>
                                            </label>
                                        </div>
                                        <div>
                                            <label className="form-label text-xs">Parking Slots</label>
                                            <input type="number" name="parking" className="input-field" min="0" max="10"
                                                value={extraDetails.parking ?? 1} onChange={handleExtraChange}
                                                placeholder="e.g. 2" />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {propType === 'Plot' && (
                                <div className="bg-amber-50/60 border border-amber-100 rounded-lg p-4 mb-5">
                                    <p className="text-xs font-semibold text-amber-600 uppercase mb-3">📐 Plot Details</p>
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                        <div>
                                            <label className="form-label text-xs">Plot Size (sq.ft)</label>
                                            <input type="number" name="plot_size" className="input-field" min="0"
                                                value={extraDetails.plot_size || ''} onChange={handleExtraChange}
                                                placeholder="e.g. 1200" />
                                        </div>
                                        <div>
                                            <label className="form-label text-xs">Zoning</label>
                                            <select name="zoning" className="input-field"
                                                value={extraDetails.zoning || ''} onChange={handleExtraChange}>
                                                <option value="">-- Select --</option>
                                                <option value="Residential">Residential</option>
                                                <option value="Commercial">Commercial</option>
                                                <option value="Agricultural">Agricultural</option>
                                                <option value="Mixed">Mixed Use</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="form-label text-xs">Road Width (ft)</label>
                                            <input type="number" name="road_width" className="input-field" min="0"
                                                value={extraDetails.road_width || ''} onChange={handleExtraChange}
                                                placeholder="e.g. 30" />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Location sub-section */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div className="md:col-span-2">
                                    <LocationSelector
                                        label="Preferred Location"
                                        selectedState={form.preferred_state}
                                        selectedCity={form.preferred_city}
                                        selectedArea={form.preferred_area}
                                        onLocationChange={handleLocationChange}
                                    />
                                    <FieldError message={errors.preferred_state || errors.preferred_city} />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="form-label">Preferred Area *</label>
                                    <input type="text" name="preferred_area" className={fieldClass('preferred_area')}
                                        value={form.preferred_area} onChange={handleChange} onBlur={handleBlur}
                                        placeholder="e.g. Andheri East" />
                                    <FieldError message={errors.preferred_area} />
                                </div>
                            </div>
                        </Section>

                        {/* ━━━━━━━━━━ SECTION 4: Financial & Timeline ━━━━━━━━━━ */}
                        <Section title="Financial & Timeline Details" icon="💰">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div>
                                    <label className="form-label">Budget Range *</label>
                                    <select name="budget_range" className={fieldClass('budget_range')}
                                        value={form.budget_range} onChange={handleChange} onBlur={handleBlur}>
                                        <option value="">-- Select Budget Range --</option>
                                        <option value="20-40">20-40 Lakhs</option>
                                        <option value="40-60">40-60 Lakhs</option>
                                        <option value="60-80">60-80 Lakhs</option>
                                        <option value="80-100">80-100 Lakhs</option>
                                        <option value="1Cr+">1 Cr+</option>
                                    </select>
                                    <FieldError message={errors.budget_range} />
                                </div>
                                <div>
                                    <label className="form-label">Funding Source *</label>
                                    <select name="funding_source" className={fieldClass('funding_source')}
                                        value={form.funding_source} onChange={handleChange} onBlur={handleBlur}>
                                        <option value="">-- Select --</option>
                                        <option value="Self-Funded">Self-Funded</option>
                                        <option value="Home Loan">Home Loan</option>
                                    </select>
                                    <FieldError message={errors.funding_source} />
                                </div>
                                <div>
                                    <label className="form-label">Timeline to Buy *</label>
                                    <select name="urgency" className={fieldClass('urgency')}
                                        value={form.urgency} onChange={handleChange} onBlur={handleBlur}>
                                        <option value="">-- Select --</option>
                                        <option value="Immediate">Immediate</option>
                                        <option value="3 Months">3 Months</option>
                                        <option value="1 Year">1 Year</option>
                                    </select>
                                    <FieldError message={errors.urgency} />
                                </div>
                                <div>
                                    <label className="form-label">Possession Timeline</label>
                                    <select name="possession_timeline" className="input-field"
                                        value={form.possession_timeline} onChange={handleChange}>
                                        <option value="Immediate">Immediate / Ready</option>
                                        <option value="Ready">Ready to Move</option>
                                        <option value="Under-Construction">Under Construction</option>
                                    </select>
                                </div>
                            </div>
                        </Section>
                    </div>

                    {/* ── Sticky Action Footer ── */}
                    <div className="sticky bottom-0 bg-gray-50 pt-4 pb-2 mt-6 -mx-6 sm:-mx-8 px-6 sm:px-8 border-t border-gray-200">
                        <div className="flex gap-3 justify-end">
                            <button type="button" onClick={() => navigate('/dashboard')}
                                className="btn-secondary px-6">Cancel</button>
                            <button type="submit" disabled={loading || !!duplicate}
                                className="btn-primary px-8 disabled:opacity-50">
                                {loading ? (
                                    <span className="flex items-center gap-2">
                                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                        Adding...
                                    </span>
                                ) : 'Add Lead'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
