function isAdminOrManager(req, res, next) {
    if (req.session && req.session.user &&
        (req.session.user.role === 'admin' || req.session.user.role === 'manager')) {
        return next();
    }
    return res.status(403).json({ error: 'Admin or Manager access required.' });
}

module.exports = isAdminOrManager;
