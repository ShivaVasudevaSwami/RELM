export default function UrgencyTag({ urgency }) {
    const urgencyMap = {
        'Immediate': 'urgency-immediate',
        '3 Months': 'urgency-3-months',
        '1 Year': 'urgency-1-year',
    };

    const className = urgencyMap[urgency] || 'urgency-1-year';

    return (
        <span className={`${className} inline-block`}>
            {urgency || 'N/A'}
        </span>
    );
}
