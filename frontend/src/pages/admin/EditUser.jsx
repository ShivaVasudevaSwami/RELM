import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../api/axios';
import FieldError from '../../components/FieldError';
import FormSummaryError from '../../components/FormSummaryError';

const VALIDATORS = {
    username: (v) => {
        if (!v || v.length < 3 || v.length > 30) return 'Username must be 3–30 characters';
        if (!/^[a-zA-Z0-9_]+$/.test(v)) return 'Username must contain only letters, numbers, and underscores';
        return '';
    },
    password: (v) => {
        if (!v) return ''; // optional on edit
        if (v.length < 8) return 'Password must be at least 8 characters';
        if (!/^(?=.*[A-Za-z])(?=.*\d)/.test(v)) return 'Password must contain both letters and numbers';
        return '';
    },
    confirmPassword: (v, form) => {
        if (!form.password) return '';
        if (v !== form.password) return 'Passwords do not match';
        return '';
    },
};

export default function EditUser() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [form, setForm] = useState({ username: '', role: 'agent', password: '', confirmPassword: '' });
    const [errors, setErrors] = useState({});
    const [serverError, setServerError] = useState('');
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(true);
    const [formSubmitAttempted, setFormSubmitAttempted] = useState(false);

    useEffect(() => {
        api.get(`/admin/users/${id}`)
            .then(res => setForm(prev => ({ ...prev, username: res.data.username, role: res.data.role })))
            .catch(err => setServerError(err.response?.data?.error || 'Failed to load user'))
            .finally(() => setFetching(false));
    }, [id]);

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
        const err1 = validateField('username', form.username);
        if (err1) newErrors.username = err1;
        if (form.password) {
            const errP = validateField('password', form.password);
            if (errP) newErrors.password = errP;
            const errC = validateField('confirmPassword', form.confirmPassword);
            if (errC) newErrors.confirmPassword = errC;
        }
        setErrors(newErrors);
        if (Object.keys(newErrors).length > 0) return;

        setLoading(true);
        try {
            const payload = { username: form.username, role: form.role };
            if (form.password) payload.password = form.password;
            await api.put(`/admin/users/${id}`, payload);
            navigate('/admin/users');
        } catch (err) {
            if (err.response?.data?.errors) {
                const se = {};
                err.response.data.errors.forEach(e => { se[e.field] = e.message; });
                setErrors(p => ({ ...p, ...se }));
            } else {
                setServerError(err.response?.data?.error || 'Failed to update user');
            }
        } finally { setLoading(false); }
    };

    const fieldClass = (name) => `input-field ${errors[name] ? 'border-red-400' : ''}`;

    if (fetching) {
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
                    <h1 className="text-xl font-bold text-gray-800 mb-6">Edit User</h1>
                    <FormSummaryError show={formSubmitAttempted && Object.values(errors).some(e => e)} />
                    {serverError && <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm mb-4">{serverError}</div>}

                    <form onSubmit={handleSubmit} noValidate>
                        <div className="mb-4">
                            <label className="form-label">Username *</label>
                            <input type="text" name="username" className={fieldClass('username')}
                                value={form.username} onChange={handleChange} onBlur={handleBlur} />
                            <FieldError message={errors.username} />
                        </div>

                        <div className="mb-4">
                            <label className="form-label">Role *</label>
                            <select name="role" className="input-field" value={form.role} onChange={handleChange}>
                                <option value="agent">Agent</option>
                                <option value="manager">Manager</option>
                                <option value="admin">Admin</option>
                            </select>
                        </div>

                        <div className="mb-4">
                            <label className="form-label">New Password <span className="text-gray-400">(leave blank to keep current)</span></label>
                            <input type="password" name="password" className={fieldClass('password')}
                                value={form.password} onChange={handleChange} onBlur={handleBlur}
                                placeholder="Min 8 chars, must include letter + number" />
                            <FieldError message={errors.password} />
                        </div>

                        <div className="mb-6">
                            <label className="form-label">Confirm New Password</label>
                            <input type="password" name="confirmPassword" className={fieldClass('confirmPassword')}
                                value={form.confirmPassword} onChange={handleChange} onBlur={handleBlur} />
                            <FieldError message={errors.confirmPassword} />
                        </div>

                        <div className="flex gap-3">
                            <button type="submit" disabled={loading} className="btn-primary flex-1">
                                {loading ? 'Saving...' : 'Save Changes'}
                            </button>
                            <button type="button" onClick={() => navigate('/admin/users')} className="btn-secondary">Cancel</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
