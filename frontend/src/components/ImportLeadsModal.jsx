import { useState, useRef } from 'react';
import api from '../api/axios';

export default function ImportLeadsModal({ isOpen, onClose, onImportComplete }) {
    const [step, setStep] = useState(1);
    const [file, setFile] = useState(null);
    const [dragging, setDragging] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [previewData, setPreviewData] = useState(null);
    const [importResults, setImportResults] = useState(null);
    const [showFilter, setShowFilter] = useState('all');
    const fileInputRef = useRef(null);

    if (!isOpen) return null;

    const reset = () => {
        setStep(1); setFile(null); setError('');
        setPreviewData(null); setImportResults(null); setShowFilter('all');
    };

    const handleClose = () => { reset(); onClose(); };

    const handleFileSelect = (selectedFile) => {
        if (!selectedFile) return;
        const ext = selectedFile.name.split('.').pop().toLowerCase();
        if (!['csv', 'xlsx', 'xls'].includes(ext)) {
            setError('Please select a .csv or .xlsx file only'); return;
        }
        if (selectedFile.size > 5 * 1024 * 1024) {
            setError('File size must be under 5MB'); return;
        }
        setFile(selectedFile); setError('');
    };

    const handleDrop = (e) => {
        e.preventDefault(); setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) handleFileSelect(f);
    };

    const handlePreview = async () => {
        if (!file) { setError('Please select a file first'); return; }
        setLoading(true); setError('');
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await api.post('/import/preview', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setPreviewData(res.data); setStep(2);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to parse file');
        } finally { setLoading(false); }
    };

    const handleConfirmImport = async () => {
        if (!previewData) return;
        const validRows = previewData.rows.filter(r => r.isValid);
        if (validRows.length === 0) {
            setError('No valid rows to import.'); return;
        }
        setLoading(true); setError('');
        try {
            const res = await api.post('/import/confirm', { rows: validRows });
            setImportResults(res.data); setStep(3);
            if (onImportComplete) onImportComplete();
        } catch (err) {
            setError(err.response?.data?.error || 'Import failed');
        } finally { setLoading(false); }
    };

    const handleDownloadTemplate = () => {
        window.open('/api/import/template', '_blank');
    };

    const displayRows = previewData?.rows?.filter(r => {
        if (showFilter === 'all') return true;
        if (showFilter === 'errors') return !r.isValid;
        if (showFilter === 'duplicates') return r.isDuplicate;
        if (showFilter === 'vip') return r.isVip;
        return true;
    }) || [];

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">Import Leads from CSV / XLSX</h2>
                        <p className="text-sm text-gray-400 mt-0.5">
                            Step {step} of 3 —{step === 1 ? ' Upload File' : step === 2 ? ' Preview & Validate' : ' Import Complete'}
                        </p>
                    </div>
                    <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none w-8 h-8 flex items-center justify-center">✕</button>
                </div>

                {/* Progress bar */}
                <div className="px-6 pt-4">
                    <div className="flex gap-2 mb-4">
                        {[1, 2, 3].map(s => (
                            <div key={s} className={`h-1.5 flex-1 rounded-full transition-all ${s <= step ? 'bg-accent' : 'bg-gray-200'}`} />
                        ))}
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 pb-6">

                    {error && (
                        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm mb-4 flex items-center gap-2">
                            <span>⚠️</span><span>{error}</span>
                        </div>
                    )}

                    {/* STEP 1: Upload */}
                    {step === 1 && (
                        <div className="space-y-4">
                            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center justify-between">
                                <div>
                                    <p className="text-blue-700 font-medium text-sm">📋 Download Sample Template</p>
                                    <p className="text-blue-500 text-xs mt-0.5">Use this template to format your data correctly</p>
                                </div>
                                <button onClick={handleDownloadTemplate}
                                    className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors">⬇ Download</button>
                            </div>

                            <div className="bg-gray-50 rounded-xl p-4">
                                <p className="text-sm font-semibold text-gray-700 mb-2">v4.1 Column Headers:</p>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                                    {[
                                        { col: 'Full Name', req: true }, { col: 'Phone Number', req: true },
                                        { col: 'Email Address', req: false }, { col: 'Occupation', req: false },
                                        { col: 'Purchase Purpose', req: false },
                                        { col: 'Preferred Property Type', req: false },
                                        { col: 'Preferred State', req: false }, { col: 'Preferred City', req: false },
                                        { col: 'Preferred Area', req: false }, { col: 'Budget Range', req: false },
                                        { col: 'Funding Source', req: false }, { col: 'Timeline to Buy', req: false },
                                        { col: 'BHK_or_Config', req: false }, { col: 'Size_or_Floor', req: false },
                                        { col: 'Extra_Spec', req: false },
                                    ].map(({ col, req }) => (
                                        <span key={col} className={`text-xs px-2 py-1 rounded font-mono ${req ? 'bg-red-100 text-red-700 font-semibold' : 'bg-gray-200 text-gray-600'}`}>
                                            {col}{req ? ' *' : ''}
                                        </span>
                                    ))}
                                </div>
                                <p className="text-xs text-gray-400 mt-2">* Required. Others are optional but improve lead scoring.</p>
                            </div>

                            <div className="bg-amber-50 rounded-xl p-4 text-xs text-amber-700">
                                <p className="font-semibold mb-1">Valid Values:</p>
                                <p>Property Type: <code>Flat</code> / <code>Villa</code> / <code>Plot</code></p>
                                <p>Budget Range: <code>20-40</code> / <code>40-60</code> / <code>60-80</code> / <code>80-100</code> / <code>1Cr+</code> (Lakhs)</p>
                                <p>Occupation: <code>Salaried</code> / <code>Business</code> / <code>Professional</code> / <code>Retired</code></p>
                                <p>Purchase Purpose: <code>Self-Use</code> / <code>Investment</code></p>
                                <p>Funding: <code>Self-Funded</code> / <code>Home Loan</code></p>
                                <p>Timeline: <code>Immediate</code> / <code>3 Months</code> / <code>1 Year</code></p>
                                <p>Phone: 10-digit Indian mobile starting with 6-9</p>
                            </div>

                            <div className="bg-green-50 rounded-xl p-4 text-xs text-green-700">
                                <p className="font-semibold mb-1">💡 Scoring Engine Tip:</p>
                                <p>Providing accurate <strong>Occupation</strong>, <strong>Budget</strong>, and <strong>BHK/Config</strong> data during import allows the RE-LM v4.1 Scoring Engine to prioritize leads instantly.</p>
                                <p className="mt-1">Ensure CSV headers match the template exactly to enable mirrored property matching.</p>
                            </div>

                            <div
                                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                                onDragLeave={() => setDragging(false)}
                                onDrop={handleDrop}
                                onClick={() => fileInputRef.current?.click()}
                                className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${dragging ? 'border-accent bg-accent/5' : 'border-gray-300 hover:border-accent hover:bg-gray-50'}`}
                            >
                                <div className="text-5xl mb-3">📂</div>
                                <p className="text-gray-600 font-medium">Drag & drop your CSV or XLSX file here</p>
                                <p className="text-gray-400 text-sm mt-1">or click to browse</p>
                                <p className="text-gray-300 text-xs mt-2">Maximum 500 rows • 5MB file size limit</p>
                                {file && (
                                    <div className="mt-4 bg-green-50 border border-green-200 rounded-xl px-4 py-2 inline-block">
                                        <p className="text-green-700 text-sm font-medium">✓ {file.name} ({(file.size / 1024).toFixed(1)} KB)</p>
                                    </div>
                                )}
                                <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
                                    onChange={(e) => handleFileSelect(e.target.files[0])} />
                            </div>
                        </div>
                    )}

                    {/* STEP 2: Preview */}
                    {step === 2 && previewData && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-4 gap-3">
                                <div className="bg-gray-50 rounded-xl p-3 text-center">
                                    <p className="text-2xl font-bold text-gray-800">{previewData.total}</p>
                                    <p className="text-xs text-gray-500">Total Rows</p>
                                </div>
                                <div className="bg-green-50 rounded-xl p-3 text-center">
                                    <p className="text-2xl font-bold text-green-600">{previewData.valid - (previewData.duplicates || 0)}</p>
                                    <p className="text-xs text-gray-500">🟢 Ready</p>
                                </div>
                                <div className="bg-amber-50 rounded-xl p-3 text-center">
                                    <p className="text-2xl font-bold text-amber-500">{previewData.duplicates || 0}</p>
                                    <p className="text-xs text-gray-500">🟡 Duplicates</p>
                                </div>
                                <div className="bg-red-50 rounded-xl p-3 text-center">
                                    <p className="text-2xl font-bold text-red-500">{previewData.invalid}</p>
                                    <p className="text-xs text-gray-500">🔴 Errors</p>
                                </div>
                            </div>

                            <div className="flex gap-2 items-center">
                                {[{ key: 'all', label: 'All', count: previewData.total }, { key: 'errors', label: '🔴 Errors', count: previewData.invalid }, { key: 'duplicates', label: '🟡 Duplicates', count: previewData.duplicates || 0 }, { key: 'vip', label: '⭐ VIP', count: previewData.rows?.filter(r => r.isVip).length || 0 }].map(f => (
                                    <button key={f.key} onClick={() => setShowFilter(f.key)}
                                        className={`text-xs px-3 py-1 rounded-full transition-colors ${showFilter === f.key
                                                ? f.key === 'errors' ? 'bg-red-500 text-white'
                                                    : f.key === 'duplicates' ? 'bg-amber-500 text-white'
                                                        : f.key === 'vip' ? 'bg-amber-600 text-white'
                                                            : 'bg-accent text-white'
                                                : 'bg-gray-100 text-gray-600'}`}>
                                        {f.label} ({f.count})
                                    </button>
                                ))}
                            </div>

                            <div className="overflow-x-auto border border-gray-200 rounded-xl max-h-64">
                                <table className="w-full text-xs">
                                    <thead className="bg-gray-50 sticky top-0">
                                        <tr>
                                            <th className="px-3 py-2 text-left">Row</th>
                                            <th className="px-3 py-2 text-left">Status</th>
                                            <th className="px-3 py-2 text-left">Name</th>
                                            <th className="px-3 py-2 text-left">Phone</th>
                                            <th className="px-3 py-2 text-left">Type</th>
                                            <th className="px-3 py-2 text-left">Budget</th>
                                            <th className="px-3 py-2 text-left">Occupation</th>
                                            <th className="px-3 py-2 text-left">Issues</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {displayRows.map((row, i) => {
                                            const bgClass = !row.isValid ? 'bg-red-50'
                                                : row.isVip ? 'bg-amber-50'
                                                    : row.isDuplicate ? 'bg-yellow-50'
                                                        : 'bg-white';
                                            return (
                                                <tr key={i} className={`border-t border-gray-100 ${bgClass}`}>
                                                    <td className="px-3 py-2 text-gray-400">{row.rowIndex}</td>
                                                    <td className="px-3 py-2">
                                                        {!row.isValid
                                                            ? <span className="text-red-500 font-medium">🔴 Error</span>
                                                            : row.isVip
                                                                ? <span className="text-amber-600 font-medium">⭐ VIP</span>
                                                                : row.isDuplicate
                                                                    ? <span className="text-yellow-600 font-medium">🟡 Duplicate</span>
                                                                    : <span className="text-green-600 font-medium">🟢 Ready</span>}
                                                    </td>
                                                    <td className="px-3 py-2 font-medium text-gray-800">{row.name || '—'}</td>
                                                    <td className="px-3 py-2 text-gray-600">{row.phone || '—'}</td>
                                                    <td className="px-3 py-2 text-gray-600">{row.preferred_property_type || '—'}</td>
                                                    <td className="px-3 py-2 text-gray-600">{row.budget_range ? `₹${row.budget_range}L` : '—'}</td>
                                                    <td className="px-3 py-2 text-gray-600">{row.occupation || '—'}</td>
                                                    <td className="px-3 py-2">
                                                        {row.errors?.length > 0 && <div className="text-red-500">{row.errors.map((e, ei) => <p key={ei}>• {e}</p>)}</div>}
                                                        {row.warnings?.length > 0 && <div className="text-amber-500">{row.warnings.map((w, wi) => <p key={wi}>⚠ {w}</p>)}</div>}
                                                        {row.isDuplicate && row.existingLeadId && (
                                                            <a href={`/leads/${row.existingLeadId}`} target="_blank" rel="noreferrer"
                                                                className="text-xs text-accent underline mt-1 inline-block">
                                                                View Lead #{row.existingLeadId}
                                                            </a>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            {previewData.valid === 0 && (
                                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center text-red-600 text-sm">
                                    ⚠️ No valid rows found. Please fix errors and re-upload.
                                </div>
                            )}
                        </div>
                    )}

                    {/* STEP 3: Results */}
                    {step === 3 && importResults && (
                        <div className="space-y-4 text-center">
                            <div className="text-6xl mb-2">{importResults.imported > 0 ? '🎉' : '⚠️'}</div>
                            <h3 className="text-xl font-bold text-gray-800">Import Complete</h3>
                            <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto">
                                <div className="bg-green-50 rounded-xl p-3">
                                    <p className="text-2xl font-bold text-green-600">{importResults.imported}</p>
                                    <p className="text-xs text-gray-500">Imported</p>
                                </div>
                                <div className="bg-amber-50 rounded-xl p-3">
                                    <p className="text-2xl font-bold text-amber-500">{importResults.duplicates}</p>
                                    <p className="text-xs text-gray-500">Duplicates</p>
                                </div>
                                <div className="bg-red-50 rounded-xl p-3">
                                    <p className="text-2xl font-bold text-red-500">{importResults.skipped}</p>
                                    <p className="text-xs text-gray-500">Skipped</p>
                                </div>
                            </div>
                            {importResults.imported > 0 && (
                                <p className="text-green-600 text-sm">✓ {importResults.imported} leads added with status "New Inquiry"</p>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center">
                    <button onClick={step > 1 ? () => { setStep(s => s - 1); setError(''); } : handleClose} className="btn-secondary">
                        {step === 1 ? 'Cancel' : '← Back'}
                    </button>
                    <div className="flex gap-3">
                        {step === 1 && (
                            <button onClick={handlePreview} disabled={!file || loading}
                                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
                                {loading ? 'Parsing...' : 'Preview →'}
                            </button>
                        )}
                        {step === 2 && (
                            <button onClick={handleConfirmImport} disabled={loading || previewData?.valid === 0}
                                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
                                {loading ? 'Importing...' : `Import ${previewData?.valid || 0} Valid Leads →`}
                            </button>
                        )}
                        {step === 3 && <button onClick={handleClose} className="btn-primary">Done ✓</button>}
                    </div>
                </div>
            </div>
        </div>
    );
}
