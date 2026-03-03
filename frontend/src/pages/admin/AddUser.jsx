import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import FieldError from '../../components/FieldError';
import FormSummaryError from '../../components/FormSummaryError';
import { useAuth } from '../../context/AuthContext';

const VALIDATORS = {
    username: (v) => {
        if (!v || v.length < 3 || v.length > 30) return 'Username must be 3–30 characters';
        if (!/^[a-zA-Z0-9_]+$/.test(v)) return 'Username must contain only letters, numbers, and underscores';
        return '';
    },
    password: (v) => {
        if (!v || v.length < 8) return 'Password must be at least 8 characters';
        if (!/^(?=.*[A-Za-z])(?=.*\d)/.test(v)) return 'Password must contain both letters and numbers';
        return '';
    },
    confirmPassword: (v, form) => {
        if (v !== form.password) return 'Passwords do not match';
        return '';
    },
};

export default function AddUser() {
    const navigate = useNavigate();
    const { user: currentUser } = useAuth();
    const [form, setForm] = useState({ username: '', password: '', confirmPassword: '', role: 'telecaller' });
    const [errors, setErrors] = useState({});
    const [serverError, setServerError] = useState('');
    const [loading, setLoading] = useState(false);
    const [formSubmitAttempted, setFormSubmitAttempted] = useState(false);

    const validateField = (name, value) => {
        if (name === 'confirmPassword') return VALIDATORS.confirmPassword(value, form);
        return VALIDATORS[name] ? VALIDATORS[name](value) : '';
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setForm(prev => ({ ...prev, [name]: value }));
        if (formSubmitAttempted) setErrors(p => ({ ...p, [name]: validateField(name, value) }));
    };

    const handleBlur = (e) => {
        setErrors(p => ({ ...p, [e.target.name]: validateField(e.target.name, e.target.value) }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setFormSubmitAttempted(true);
        setServerError('');

        const newErrors = {};
        ['username', 'password', 'confirmPassword'].forEach(k => {
            const err = validateField(k, form[k]);
            if (err) newErrors[k] = err;
        });
        setErrors(newErrors);
        if (Object.keys(newErrors).length > 0) return;

        setLoading(true);
        try {
            await api.post('/admin/users', {
                username: form.username,
                password: form.password,
                role: form.role,
            });
            navigate('/admin/users');
        } catch (err) {
            if (err.response?.data?.errors) {
                const se = {};
                err.response.data.errors.forEach(e => { se[e.field] = e.message; });
                setErrors(p => ({ ...p, ...se }));
            } else {
                setServerError(err.response?.data?.error || 'Failed to create user');
            }
        } finally { setLoading(false); }
    };

    const fieldClass = (name) => `input-field ${errors[name] ? 'border-red-400' : ''}`;

    return (
        <div className="p-4 sm:p-8">
            <div className="w-full max-w-md mx-auto mt-4 sm:mt-10 px-0">
                <div className="card p-4 sm:p-8">
                    <h1 className="text-xl font-bold text-gray-800 mb-6">Add New User</h1>
                    <FormSummaryError show={formSubmitAttempted && Object.values(errors).some(e => e)} />
                    {serverError && <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm mb-4">{serverError}</div>}

                    <form onSubmit={handleSubmit} noValidate>
                        <div className="mb-4">
                            <label className="form-label">Username *</label>
                            <input type="text" name="username" className={fieldClass('username')}
                                value={form.username} onChange={handleChange} onBlur={handleBlur}
                                placeholder="Letters, numbers, underscores" />
                            <FieldError message={errors.username} />
                        </div>

                        <div className="mb-4">
                            <label className="form-label">Password *</label>
                            <input type="password" name="password" className={fieldClass('password')}
                                value={form.password} onChange={handleChange} onBlur={handleBlur}
                                placeholder="Min 8 chars, must include letter + number" />
                            <FieldError message={errors.password} />
                        </div>

                        <div className="mb-4">
                            <label className="form-label">Confirm Password *</label>
                            <input type="password" name="confirmPassword" className={fieldClass('confirmPassword')}
                                value={form.confirmPassword} onChange={handleChange} onBlur={handleBlur} />
                            <FieldError message={errors.confirmPassword} />
                        </div>

                        <div className="mb-6">
                            <label className="form-label">Role</label>
                            <select name="role" className="input-field" value={form.role} onChange={handleChange}>
                                <option value="telecaller">Tele-caller</option>
                                <option value="agent">Agent</option>
                                <option value="manager">Manager</option>
                                {currentUser?.role === 'admin' && (
                                    <option value="admin">Admin</option>
                                )}
                            </select>
                            <p className="text-xs text-gray-400 mt-1">
                                {form.role === 'telecaller' && '📞 Owns "Inquiry" to "Qualified". Must fill Quality Gate fields before scheduling a visit.'}
                                {form.role === 'agent' && '🏠 Owns "Site Visit" to "Booking". Can flag junk leads.'}
                                {form.role === 'manager' && '📊 Property CRUD, Analytics, ROFR Overrides, Bulk Reassignment.'}
                                {form.role === 'admin' && '⚙️ Full system access. User CRUD, Master Audit Logs.'}
                            </p>
                        </div>

                        <div className="flex gap-3">
                            <button type="submit" disabled={loading} className="btn-primary flex-1">
                                {loading ? 'Creating...' : 'Create User'}
                            </button>
                            <button type="button" onClick={() => navigate('/admin/users')} className="btn-secondary">Cancel</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
