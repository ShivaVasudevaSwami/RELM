import { useState, useEffect } from 'react';
import api from '../api/axios';

const GOOGLE_APPS_SCRIPT = `// RE-LM v4.1 Google Forms Integration Script
// Paste this in: Google Form > three-dot menu > Script editor

function onFormSubmit(e) {
  // ============================================================
  // STEP 1: Replace this URL with your webhook URL from RE-LM
  // ============================================================
  var WEBHOOK_URL = "YOUR_WEBHOOK_URL_HERE";

  // ============================================================
  // STEP 2: Map your form question titles to RE-LM field names
  // v4.1 includes Occupation, Purpose, and BHK/Config for
  // enhanced lead scoring and property matching.
  // ============================================================
  var FIELD_MAP = {
    "Full Name":          "name",
    "Phone Number":       "phone",
    "Email":              "email",
    "Occupation":         "occupation",
    "Purchase Purpose":   "purchase_purpose",
    "Property Type":      "preferred_property_type",
    "BHK/Config Needed":  "bhk_config",
    "State":              "preferred_state",
    "City":               "preferred_city",
    "Area/Locality":      "preferred_area",
    "Budget Range":       "budget_range",
    "Funding Source":     "funding_source",
    "Timeline to Buy":    "urgency"
  };

  // ============================================================
  // DO NOT EDIT BELOW THIS LINE
  // ============================================================
  try {
    var formResponse = e.response;
    var itemResponses = formResponse.getItemResponses();
    var payload = {};

    itemResponses.forEach(function(itemResponse) {
      var question = itemResponse.getItem().getTitle();
      var answer = itemResponse.getResponse();
      if (FIELD_MAP[question]) {
        payload[FIELD_MAP[question]] = answer;
      } else {
        payload[question] = answer;
      }
    });

    var options = {
      method: "POST",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(WEBHOOK_URL, options);
    var responseCode = response.getResponseCode();

    if (responseCode === 200) {
      Logger.log("Lead created: " + response.getContentText());
    } else if (responseCode === 409) {
      Logger.log("Duplicate lead: " + response.getContentText());
    } else {
      Logger.log("Error " + responseCode + ": " + response.getContentText());
    }
  } catch(error) {
    Logger.log("Script error: " + error.toString());
  }
}`;

export default function GoogleFormsModal({ isOpen, onClose }) {
    const [activeTab, setActiveTab] = useState('forms');
    const [forms, setForms] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newFormName, setNewFormName] = useState('');
    const [addError, setAddError] = useState('');
    const [copiedToken, setCopiedToken] = useState(null);
    const [guideStep, setGuideStep] = useState(1);

    useEffect(() => { if (isOpen) fetchForms(); }, [isOpen]);

    if (!isOpen) return null;

    const fetchForms = async () => {
        try {
            setLoading(true);
            const res = await api.get('/forms');
            setForms(Array.isArray(res.data) ? res.data : []);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };

    const handleAddForm = async () => {
        if (!newFormName.trim()) { setAddError('Please enter a form name'); return; }
        try {
            setLoading(true);
            const res = await api.post('/forms', { form_name: newFormName.trim() });
            setForms(prev => [res.data, ...prev]);
            setNewFormName(''); setShowAddForm(false); setAddError('');
        } catch (err) { setAddError(err.response?.data?.error || 'Failed to add form'); }
        finally { setLoading(false); }
    };

    const handleRemoveForm = async (formId, formName) => {
        if (!window.confirm(`Remove "${formName}" connection?`)) return;
        try { await api.delete(`/forms/${formId}`); setForms(prev => prev.filter(f => f.id !== formId)); }
        catch (err) { console.error(err); }
    };

    const handleToggle = async (formId) => {
        try {
            const res = await api.patch(`/forms/${formId}/toggle`);
            setForms(prev => prev.map(f => f.id === formId ? { ...f, is_active: res.data.is_active } : f));
        } catch (err) { console.error(err); }
    };

    const copyToClipboard = (text, id) => {
        navigator.clipboard.writeText(text);
        setCopiedToken(id);
        setTimeout(() => setCopiedToken(null), 2000);
    };

    const guideSteps = [
        {
            title: 'Create your Google Form', icon: '📝',
            content: (
                <div className="space-y-3 text-sm text-gray-600">
                    <p>Create a Google Form with these recommended question titles (v4.1 professional fields):</p>
                    <div className="bg-gray-50 rounded-xl p-3 space-y-1 font-mono text-xs">
                        {[
                            { q: 'Full Name', type: 'Short answer', required: true },
                            { q: 'Phone Number', type: 'Short answer', required: true },
                            { q: 'Email', type: 'Short answer', required: false },
                            { q: 'Occupation', type: 'Multiple choice: Salaried/Business/Professional/Retired', required: false },
                            { q: 'Purchase Purpose', type: 'Multiple choice: Self-Use/Investment', required: false },
                            { q: 'Property Type', type: 'Multiple choice: Flat/Villa/Plot', required: false },
                            { q: 'BHK/Config Needed', type: 'Multiple choice: 1 BHK/2 BHK/3 BHK/4+ BHK', required: false },
                            { q: 'State', type: 'Short answer', required: false },
                            { q: 'City', type: 'Short answer', required: false },
                            { q: 'Area/Locality', type: 'Short answer', required: false },
                            { q: 'Budget Range', type: 'Multiple choice: 20-40/40-60/60-80/80-100/1Cr+', required: false },
                            { q: 'Funding Source', type: 'Multiple choice: Self-Funded/Home Loan', required: false },
                            { q: 'Timeline to Buy', type: 'Multiple choice: Immediate/3 Months/1 Year', required: false }
                        ].map(({ q, type, required }) => (
                            <div key={q} className="flex gap-2">
                                <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${required ? 'bg-red-500' : 'bg-gray-300'}`}></span>
                                <div>
                                    <span className="font-semibold text-gray-800">{q}</span>
                                    {required && <span className="text-red-500 ml-1">*</span>}
                                    <span className="text-gray-400 ml-2">— {type}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                    <p className="text-xs text-red-500">* Name and Phone Number are required.</p>
                    <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-xs text-green-700 mt-2">
                        <p className="font-semibold">💡 Scoring Boost:</p>
                        <p className="mt-1">Capturing <strong>Occupation</strong> and <strong>BHK/Config</strong> in your Google Form will automatically result in a <strong>higher Lead Temperature</strong> (Hot/Warm) upon entry, as the Scoring Engine uses these fields for its initial calculation.</p>
                    </div>
                </div>
            )
        },
        {
            title: 'Add this form in RE-LM', icon: '🔗',
            content: (
                <div className="space-y-3 text-sm text-gray-600">
                    <p>Go to the <strong>Connected Forms</strong> tab and click <strong>"+ Add New Form"</strong>.</p>
                    <p>Enter a name for your form (e.g. "Mumbai Property Enquiry Form").</p>
                    <p>Click <strong>Add Form</strong>. RE-LM will generate a unique <strong>Webhook URL</strong>.</p>
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs">
                        <p className="text-blue-700 font-medium">📋 Copy the Webhook URL — you&apos;ll need it in the next step.</p>
                        <p className="text-blue-500 mt-1">It looks like: http://localhost:3001/api/forms/webhook/abc123...</p>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700 mt-2">
                        <p className="font-semibold">📌 v4.1 Auto-Features:</p>
                        <p className="mt-1">• Incoming leads are <strong>auto-assigned</strong> to the Telecaller with the lowest workload (Round-Robin).</p>
                        <p>• The <strong>Scoring Engine</strong> runs immediately to set Hot/Warm/Cold status.</p>
                    </div>
                </div>
            )
        },
        {
            title: 'Open Google Apps Script', icon: '⚙️',
            content: (
                <div className="space-y-3 text-sm text-gray-600">
                    <p>In your Google Form:</p>
                    <ol className="space-y-2 list-none">
                        {['Click the ⋮ (three dots) menu in the top right',
                            'Select "Script editor"',
                            'A new Apps Script tab will open',
                            'Delete any existing code in the editor',
                            'Go to the next step to paste the script'
                        ].map((s, i) => (
                            <li key={i} className="flex gap-3">
                                <span className="bg-accent text-white text-xs w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                                <span>{s}</span>
                            </li>
                        ))}
                    </ol>
                </div>
            )
        },
        {
            title: 'Paste the Apps Script code', icon: '📋',
            content: (
                <div className="space-y-3 text-sm text-gray-600">
                    <p>Copy the <strong>v4.1 script</strong> below and paste it into the Apps Script editor:</p>
                    <div className="relative">
                        <pre className="bg-gray-900 text-green-400 text-xs p-4 rounded-xl overflow-x-auto max-h-48 overflow-y-auto leading-relaxed">
                            {GOOGLE_APPS_SCRIPT}
                        </pre>
                        <button onClick={() => copyToClipboard(GOOGLE_APPS_SCRIPT, 'script')}
                            className="absolute top-2 right-2 bg-gray-700 hover:bg-gray-600 text-white text-xs px-2 py-1 rounded transition-colors">
                            {copiedToken === 'script' ? '✓ Copied!' : '📋 Copy'}
                        </button>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
                        <p className="font-semibold">⚠️ Important: Replace the placeholder URL</p>
                        <p className="mt-1">In the script, find this line:</p>
                        <code className="block bg-amber-100 px-2 py-1 rounded mt-1 font-mono">var WEBHOOK_URL = &quot;YOUR_WEBHOOK_URL_HERE&quot;;</code>
                        <p className="mt-1">Replace <code>YOUR_WEBHOOK_URL_HERE</code> with the Webhook URL from RE-LM (Step 2).</p>
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-700 mt-2">
                        <p className="font-semibold">🆕 v4.1 FIELD_MAP includes:</p>
                        <p className="mt-1"><code>Occupation</code>, <code>Purchase Purpose</code>, and <code>BHK/Config Needed</code> — these fields feed directly into the Scoring Engine and Mirrored Property Matching.</p>
                    </div>
                </div>
            )
        },
        {
            title: 'Set up the trigger', icon: '⚡',
            content: (
                <div className="space-y-3 text-sm text-gray-600">
                    <p>Now set up the trigger so the script runs on form submit:</p>
                    <ol className="space-y-2 list-none">
                        {['Click "Save project" (Ctrl+S)',
                            'Click "Triggers" in the left sidebar (clock icon)',
                            'Click "+ Add Trigger" (bottom right)',
                            'Set: Choose function → onFormSubmit',
                            'Set: Select event source → From form',
                            'Set: Select event type → On form submit',
                            'Click "Save" — authorize permissions if prompted',
                            'Grant all requested permissions'
                        ].map((s, i) => (
                            <li key={i} className="flex gap-3">
                                <span className="bg-green-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                                <span>{s}</span>
                            </li>
                        ))}
                    </ol>
                </div>
            )
        },
        {
            title: 'Test it!', icon: '🧪',
            content: (
                <div className="space-y-3 text-sm text-gray-600">
                    <p>Test your integration:</p>
                    <ol className="space-y-2 list-none">
                        {['Open your Google Form preview link',
                            'Fill in the form with test data (valid 10-digit phone)',
                            'Include Occupation and BHK/Config for best results',
                            'Submit the form',
                            'Check RE-LM Leads page — new lead should appear with a temperature score',
                            'In Apps Script, check View → Logs for errors'
                        ].map((s, i) => (
                            <li key={i} className="flex gap-3">
                                <span className="bg-blue-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                                <span>{s}</span>
                            </li>
                        ))}
                    </ol>
                    <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-green-700 text-xs mt-2">
                        <p className="font-semibold">✓ Troubleshooting Tips:</p>
                        <p className="mt-1">• Make sure all RE-LM servers are running (Frontend + Backend)</p>
                        <p>• Check that the Webhook URL in script is correct</p>
                        <p>• Question titles must match FIELD_MAP in script exactly</p>
                        <p>• Check Apps Script logs: View → Logs</p>
                        <p>• Phone must be 10 digits starting with 6, 7, 8, or 9</p>
                        <p>• Budget must be exactly: 20-40, 40-60, 60-80, 80-100, or 1Cr+</p>
                    </div>
                    <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-purple-700 text-xs mt-2">
                        <p className="font-semibold">🔮 What happens automatically:</p>
                        <p className="mt-1">1. Lead is created with all v4.1 fields</p>
                        <p>2. Assigned to a Telecaller via Round-Robin</p>
                        <p>3. Scoring Engine calculates initial Hot/Warm/Cold</p>
                        <p>4. BHK/Config saved to extra_details for property matching</p>
                    </div>
                </div>
            )
        }
    ];

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">Google Forms Integration</h2>
                        <p className="text-sm text-gray-400">Auto-import leads from Google Forms • v4.1 Professional Fields</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl w-8 h-8 flex items-center justify-center">✕</button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-100 px-6">
                    {[{ id: 'forms', label: '🔗 Connected Forms' }, { id: 'guide', label: '📖 Setup Guide' }].map(tab => (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors mr-4
                                ${activeTab === tab.id ? 'border-accent text-accent' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-4">

                    {/* CONNECTED FORMS TAB */}
                    {activeTab === 'forms' && (
                        <div className="space-y-4">
                            {!showAddForm ? (
                                <button onClick={() => setShowAddForm(true)}
                                    className="w-full border-2 border-dashed border-gray-300 rounded-xl py-3 text-sm text-gray-400 hover:border-accent hover:text-accent transition-colors">
                                    + Add New Form Connection
                                </button>
                            ) : (
                                <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                                    <p className="text-sm font-semibold text-gray-700">Add New Form</p>
                                    <input type="text" value={newFormName} onChange={e => setNewFormName(e.target.value)}
                                        placeholder="Form name (e.g. Mumbai Enquiry Form)"
                                        className="input-field" onKeyDown={e => e.key === 'Enter' && handleAddForm()} />
                                    {addError && <p className="text-red-500 text-xs">⚠ {addError}</p>}
                                    <div className="flex gap-2">
                                        <button onClick={handleAddForm} disabled={loading} className="btn-primary text-sm py-1.5">
                                            {loading ? 'Adding...' : 'Add Form'}
                                        </button>
                                        <button onClick={() => { setShowAddForm(false); setNewFormName(''); setAddError(''); }}
                                            className="btn-secondary text-sm py-1.5">Cancel</button>
                                    </div>
                                </div>
                            )}

                            {loading && forms.length === 0 ? (
                                <div className="text-center py-8 text-gray-400">Loading...</div>
                            ) : forms.length === 0 ? (
                                <div className="text-center py-8">
                                    <div className="text-4xl mb-2">🔗</div>
                                    <p className="text-gray-500">No forms connected yet</p>
                                    <p className="text-gray-400 text-sm mt-1">Add a form above, then follow the Setup Guide</p>
                                </div>
                            ) : (
                                forms.map(form => (
                                    <div key={form.id} className={`border rounded-xl p-4 space-y-3 ${form.is_active ? 'border-green-200 bg-green-50/30' : 'border-gray-200 bg-gray-50/50 opacity-60'}`}>
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <p className="font-semibold text-gray-800">{form.form_name}</p>
                                                <p className="text-xs text-gray-400 mt-0.5">
                                                    Added {new Date(form.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                    {form.added_by_username && ` by ${form.added_by_username}`}
                                                </p>
                                            </div>
                                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${form.is_active ? 'bg-green-100 text-green-600' : 'bg-gray-200 text-gray-500'}`}>
                                                {form.is_active ? '● Active' : '○ Inactive'}
                                            </span>
                                        </div>
                                        <div>
                                            <p className="text-xs text-gray-400 mb-1 font-medium">WEBHOOK URL</p>
                                            <div className="flex gap-2">
                                                <code className="flex-1 bg-gray-100 text-xs px-3 py-2 rounded-lg text-gray-600 truncate font-mono">{form.webhook_url}</code>
                                                <button onClick={() => copyToClipboard(form.webhook_url, form.id)}
                                                    className="bg-accent text-white text-xs px-3 py-1 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap">
                                                    {copiedToken === form.id ? '✓ Copied!' : '📋 Copy'}
                                                </button>
                                            </div>
                                        </div>
                                        <div className="flex gap-2 pt-1">
                                            <button onClick={() => handleToggle(form.id)}
                                                className={`text-xs px-3 py-1 rounded-lg transition-colors ${form.is_active ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-green-100 text-green-600 hover:bg-green-200'}`}>
                                                {form.is_active ? 'Deactivate' : 'Activate'}
                                            </button>
                                            <button onClick={() => handleRemoveForm(form.id, form.form_name)}
                                                className="text-xs px-3 py-1 rounded-lg bg-red-100 text-red-600 hover:bg-red-200 transition-colors">🗑 Remove</button>
                                            <button onClick={() => setActiveTab('guide')}
                                                className="text-xs px-3 py-1 rounded-lg bg-blue-100 text-blue-600 hover:bg-blue-200 transition-colors">📖 Setup Guide</button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}

                    {/* SETUP GUIDE TAB */}
                    {activeTab === 'guide' && (
                        <div className="space-y-4">
                            <div className="flex gap-1 overflow-x-auto pb-1">
                                {guideSteps.map((s, i) => (
                                    <button key={i} onClick={() => setGuideStep(i + 1)}
                                        className={`flex-shrink-0 text-xs px-3 py-1.5 rounded-full transition-colors
                                            ${guideStep === i + 1 ? 'bg-accent text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                                        {s.icon} Step {i + 1}
                                    </button>
                                ))}
                            </div>

                            {guideSteps[guideStep - 1] && (
                                <div className="bg-white border border-gray-200 rounded-xl p-5">
                                    <div className="flex items-center gap-3 mb-4">
                                        <span className="text-3xl">{guideSteps[guideStep - 1].icon}</span>
                                        <div>
                                            <p className="text-xs text-gray-400 uppercase tracking-wide">Step {guideStep} of {guideSteps.length}</p>
                                            <h3 className="font-bold text-gray-800">{guideSteps[guideStep - 1].title}</h3>
                                        </div>
                                    </div>
                                    {guideSteps[guideStep - 1].content}
                                </div>
                            )}

                            <div className="flex justify-between">
                                <button onClick={() => setGuideStep(s => Math.max(1, s - 1))} disabled={guideStep === 1}
                                    className="btn-secondary text-sm disabled:opacity-40">← Previous</button>
                                <span className="text-sm text-gray-400 self-center">{guideStep} / {guideSteps.length}</span>
                                <button onClick={() => setGuideStep(s => Math.min(guideSteps.length, s + 1))} disabled={guideStep === guideSteps.length}
                                    className="btn-primary text-sm disabled:opacity-40">Next →</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
