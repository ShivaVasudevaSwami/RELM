import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import LocationSelector from '../../components/LocationSelector';
import FieldError from '../../components/FieldError';
import FormSummaryError from '../../components/FormSummaryError';

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

const VALIDATORS = {
    property_name: (v) => (!v || v.trim().length < 2 || v.trim().length > 100 ? 'Property name is required (2–100 characters)' : ''),
    property_type: (v) => (!['Flat', 'Villa', 'Plot'].includes(v) ? 'Please select a property type' : ''),
    state: (v) => (!v ? 'Please select a state' : ''),
    city: (v) => (!v ? 'Please select a city' : ''),
    location: (v) => (!v || v.trim().length < 2 ? 'Please enter the property location/area' : ''),
    price_inr: (v) => (!v || parseFloat(v) < 100000 ? 'Enter a valid price (minimum ₹1 Lakh)' : ''),
    size_sqft: (v) => (!v || parseFloat(v) <= 0 ? 'Enter a valid size in square feet' : ''),
};

// ── Symmetric defaults — mirrors AddLead.jsx EXTRA_DEFAULTS exactly ──
const EXTRA_DEFAULTS = {
    Flat: { bhk_config: '', floor_pref: '', furnishing: '' },
    Villa: { configuration: '', private_garden: false, parking: 1 },
    Plot: { plot_size: '', zoning: '', road_width: '' }
};

export default function AddProperty() {
    const navigate = useNavigate();
    const [form, setForm] = useState({
        property_name: '', property_type: 'Flat', description: '',
        location: '', area: '', city: '', state: '', country: 'India',
        price_inr: '', size_sqft: '',
    });
    const [extraDetails, setExtraDetails] = useState({ ...EXTRA_DEFAULTS.Flat });
    const [errors, setErrors] = useState({});
    const [serverError, setServerError] = useState('');
    const [loading, setLoading] = useState(false);
    const [formSubmitAttempted, setFormSubmitAttempted] = useState(false);

    const validateField = (name, value) => VALIDATORS[name] ? VALIDATORS[name](value) : '';

    const handleChange = (e) => {
        const { name, value } = e.target;
        setForm(prev => ({ ...prev, [name]: value }));

        // When property_type changes, reset extraDetails to the default for that type
        if (name === 'property_type' && EXTRA_DEFAULTS[value]) {
            setExtraDetails({ ...EXTRA_DEFAULTS[value] });
        }

        if (formSubmitAttempted) setErrors(p => ({ ...p, [name]: validateField(name, value) }));
    };

    const handleExtraChange = (e) => {
        const { name, value, type, checked } = e.target;
        setExtraDetails(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleBlur = (e) => {
        setErrors(p => ({ ...p, [e.target.name]: validateField(e.target.name, e.target.value) }));
    };

    const handleLocationChange = (state, city, area) => {
        setForm(prev => ({ ...prev, state, city, area }));
        if (formSubmitAttempted) {
            setErrors(p => ({ ...p, state: validateField('state', state), city: validateField('city', city) }));
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setFormSubmitAttempted(true); setServerError('');
        const newErrors = {};
        Object.keys(VALIDATORS).forEach(k => { const err = validateField(k, form[k]); if (err) newErrors[k] = err; });
        setErrors(newErrors);
        if (Object.keys(newErrors).length > 0) return;

        setLoading(true);
        try {
            await api.post('/properties', {
                ...form,
                price_inr: parseFloat(form.price_inr),
                size_sqft: parseFloat(form.size_sqft),
                extra_details: JSON.stringify(extraDetails)
            });
            navigate('/properties');
        } catch (err) {
            if (err.response?.data?.errors) {
                const se = {};
                err.response.data.errors.forEach(e => { se[e.field] = e.message; });
                setErrors(p => ({ ...p, ...se }));
            } else { setServerError(err.response?.data?.error || 'Failed to add property'); }
        } finally { setLoading(false); }
    };

    const fieldClass = (name) => `input-field ${errors[name] ? 'border-red-400' : ''}`;
    const propType = form.property_type;

    return (
        <div className="bg-gray-50 min-h-full">
            {/* ── Page Header with Breadcrumbs ── */}
            <div className="bg-white border-b border-gray-200">
                <div className="px-6 sm:px-8 py-5">
                    <nav className="text-xs text-gray-400 mb-1">
                        <span className="hover:text-accent cursor-pointer" onClick={() => navigate('/dashboard')}>Dashboard</span>
                        <span className="mx-1.5">/</span>
                        <span className="hover:text-accent cursor-pointer" onClick={() => navigate('/properties')}>Properties</span>
                        <span className="mx-1.5">/</span>
                        <span className="text-gray-600 font-medium">Add New Property</span>
                    </nav>
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-xl sm:text-2xl font-bold text-gray-800">Add New Property</h1>
                            <p className="text-sm text-gray-400 mt-0.5">Register a property listing into the RE-LM inventory</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Form Content Area ── */}
            <div className="px-6 sm:px-8 py-6">
                <FormSummaryError show={formSubmitAttempted && Object.values(errors).some(e => e)} />
                {serverError && <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm mb-5">{serverError}</div>}

                <form onSubmit={handleSubmit} noValidate>
                    <div className="space-y-6">

                        {/* ━━━━━━━━━━ SECTION 1: Property Details ━━━━━━━━━━ */}
                        <Section title="Property Details" icon="🏗️">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div className="md:col-span-2">
                                    <label className="form-label">Property Name *</label>
                                    <input type="text" name="property_name" className={fieldClass('property_name')}
                                        value={form.property_name} onChange={handleChange} onBlur={handleBlur}
                                        placeholder="e.g. Lodha Palava City" />
                                    <FieldError message={errors.property_name} />
                                </div>
                                <div>
                                    <label className="form-label">Property Type *</label>
                                    <select name="property_type" className={fieldClass('property_type')}
                                        value={form.property_type} onChange={handleChange}>
                                        <option value="Flat">Flat / Apartment</option>
                                        <option value="Villa">Villa</option>
                                        <option value="Plot">Plot</option>
                                    </select>
                                    <FieldError message={errors.property_type} />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="form-label">Description</label>
                                    <textarea name="description" className="input-field" rows="3"
                                        value={form.description} onChange={handleChange}
                                        placeholder="Brief description of the property (optional)"></textarea>
                                </div>
                            </div>
                        </Section>

                        {/* ━━━━━━━━━━ SECTION 2: Specifications (Dynamic) ━━━━━━━━━━ */}
                        <Section title={`${propType} Specifications`} icon={propType === 'Flat' ? '🏢' : propType === 'Villa' ? '🏡' : '📐'}>
                            {propType === 'Flat' && (
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    <div>
                                        <label className="form-label text-xs">BHK Configuration *</label>
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
                                        <label className="form-label text-xs">Floor Number</label>
                                        <select name="floor_pref" className="input-field"
                                            value={extraDetails.floor_pref || ''} onChange={handleExtraChange}>
                                            <option value="">-- Select --</option>
                                            <option value="Low (1-4)">Low (1-4)</option>
                                            <option value="Mid (5-10)">Mid (5-10)</option>
                                            <option value="High (11+)">High (11+)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="form-label text-xs">Furnishing Status *</label>
                                        <select name="furnishing" className="input-field"
                                            value={extraDetails.furnishing || ''} onChange={handleExtraChange}>
                                            <option value="">-- Select --</option>
                                            <option value="Unfurnished">Unfurnished</option>
                                            <option value="Semi-Furnished">Semi-Furnished</option>
                                            <option value="Fully Furnished">Fully Furnished</option>
                                        </select>
                                    </div>
                                </div>
                            )}

                            {propType === 'Villa' && (
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    <div>
                                        <label className="form-label text-xs">Configuration *</label>
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
                                                className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500" />
                                            <span className="text-sm text-gray-600">Yes, available</span>
                                        </label>
                                    </div>
                                    <div>
                                        <label className="form-label text-xs">Parking Slots</label>
                                        <input type="number" name="parking" className="input-field" min="0" max="10"
                                            value={extraDetails.parking ?? 1} onChange={handleExtraChange}
                                            placeholder="e.g. 2" />
                                    </div>
                                </div>
                            )}

                            {propType === 'Plot' && (
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    <div>
                                        <label className="form-label text-xs">Plot Size (sq.ft) *</label>
                                        <input type="number" name="plot_size" className="input-field" min="0"
                                            value={extraDetails.plot_size || ''} onChange={handleExtraChange}
                                            placeholder="e.g. 1200" />
                                    </div>
                                    <div>
                                        <label className="form-label text-xs">Zoning *</label>
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
                            )}
                        </Section>

                        {/* ━━━━━━━━━━ SECTION 3: Location ━━━━━━━━━━ */}
                        <Section title="Location" icon="📍">
                            <div className="mb-4">
                                <LocationSelector label=""
                                    selectedState={form.state} selectedCity={form.city} selectedArea={form.area}
                                    onLocationChange={handleLocationChange} />
                                <FieldError message={errors.state || errors.city} />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div>
                                    <label className="form-label">Country</label>
                                    <input type="text" name="country" className="input-field" value={form.country} onChange={handleChange} />
                                </div>
                                <div>
                                    <label className="form-label">Location / Street *</label>
                                    <input type="text" name="location" className={fieldClass('location')}
                                        value={form.location} onChange={handleChange} onBlur={handleBlur}
                                        placeholder="Specific street or locality" />
                                    <FieldError message={errors.location} />
                                </div>
                            </div>
                        </Section>

                        {/* ━━━━━━━━━━ SECTION 4: Financial Details ━━━━━━━━━━ */}
                        <Section title="Financial Details" icon="💰">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                <div>
                                    <label className="form-label">Price in INR *</label>
                                    <input type="number" name="price_inr" className={fieldClass('price_inr')}
                                        value={form.price_inr} onChange={handleChange} onBlur={handleBlur} min="0" step="any"
                                        placeholder="e.g. 5000000" />
                                    {form.price_inr > 0 && <p className="text-sm text-accent mt-1 font-medium">= ₹{(form.price_inr / 100000).toFixed(2)} Lakhs</p>}
                                    <FieldError message={errors.price_inr} />
                                </div>
                                <div>
                                    <label className="form-label">Size in sq.ft. *</label>
                                    <input type="number" name="size_sqft" className={fieldClass('size_sqft')}
                                        value={form.size_sqft} onChange={handleChange} onBlur={handleBlur} min="0" step="any"
                                        placeholder="e.g. 1200" />
                                    <FieldError message={errors.size_sqft} />
                                </div>
                            </div>
                        </Section>
                    </div>

                    {/* ── Sticky Action Footer ── */}
                    <div className="sticky bottom-0 bg-gray-50 pt-4 pb-2 mt-6 -mx-6 sm:-mx-8 px-6 sm:px-8 border-t border-gray-200">
                        <div className="flex gap-3 justify-end">
                            <button type="button" onClick={() => navigate('/properties')}
                                className="btn-secondary px-6">Cancel</button>
                            <button type="submit" disabled={loading}
                                className="btn-primary px-8 disabled:opacity-50">
                                {loading ? (
                                    <span className="flex items-center gap-2">
                                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                                        Adding...
                                    </span>
                                ) : 'Add Property'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
