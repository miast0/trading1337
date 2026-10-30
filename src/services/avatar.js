const crypto = require('node:crypto');

function avatarColor(username) {
  return `#${crypto.createHash('md5').update(username).digest('hex').slice(0, 6)}`;
}

module.exports = { avatarColor };
