const { json, error, readBody } = require('../http');
const { passwordRecord } = require('../db');

function registerProfileRoutes(router, { queries }) {
  router.add('PATCH', '/api/profile', async ({ req, res, user }) => {
    const body = await readBody(req);
    if ('username' in body && body.username !== user.username) return error(res, 400, 'Username cannot be changed.');
    const email = String(body.email ?? user.email).trim().toLowerCase();
    const displayName = String(body.displayName ?? user.display_name).trim();
    const bio = String(body.bio ?? user.bio).trim();
    if (!email || !email.includes('@')) return error(res, 400, 'Enter an email address.');
    if (displayName.length < 2 || displayName.length > 40) return error(res, 400, 'Enter a name between 2 and 40 characters.');
    if (bio.length > 1000) return error(res, 400, 'Profile description must be at most 1000 characters.');
    const owner = queries.profile.emailOwner(email);
    if (owner && owner.id !== user.id) return error(res, 409, 'That email is already registered.');
    const password = String(body.password || '');
    if (password && password !== String(body.confirmPassword || '')) return error(res, 400, 'Passwords do not match.');
    const record = password ? passwordRecord(password) : { hash: user.password_hash, salt: user.password_salt };
    queries.profile.update(user.id, email, displayName, bio, record.hash, record.salt);
    return json(res, 200, { user: queries.users.safeUser(queries.users.findById(user.id), user.id) });
  });
}

module.exports = { registerProfileRoutes };
