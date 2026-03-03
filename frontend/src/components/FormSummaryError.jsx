export default function FormSummaryError({ show }) {
    if (!show) return null;
    return (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-red-600 text-sm flex items-center gap-2">
            <span>⚠️</span>
            <span>Please fix the errors highlighted below before submitting.</span>
        </div>
    );
}
