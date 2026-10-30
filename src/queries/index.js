const { createUsersQueries } = require('./users');
const { createPortfolioQueries } = require('./portfolio');
const { createTradesQueries } = require('./trades');
const { createCommunityQueries } = require('./community');
const { createLoginQueries } = require('./login');
const { createRegistrationQueries } = require('./registration');
const { createTradingQueries } = require('./trading');
const { createProfileQueries } = require('./profile');
const { createSearchQueries } = require('./search');

function createQueries(db) {
  return {
    users: createUsersQueries(db),
    portfolio: createPortfolioQueries(db),
    trades: createTradesQueries(db),
    community: createCommunityQueries(db),
    login: createLoginQueries(db),
    registration: createRegistrationQueries(db),
    trading: createTradingQueries(db),
    profile: createProfileQueries(db),
    search: createSearchQueries(db),
  };
}

module.exports = { createQueries };
