const { config } = require('./config');

const REGIONS = [
  { code: 'US-EAST', name: 'US East', timezone: 'America/New_York', currency: 'USD' },
  { code: 'US-WEST', name: 'US West', timezone: 'America/Los_Angeles', currency: 'USD' },
  { code: 'EU-WEST', name: 'Europe West', timezone: 'Europe/London', currency: 'EUR' },
  { code: 'EU-CENT', name: 'Europe Central', timezone: 'Europe/Berlin', currency: 'EUR' },
  { code: 'APAC-NE', name: 'Asia Pacific Northeast', timezone: 'Asia/Tokyo', currency: 'JPY' },
  { code: 'APAC-SE', name: 'Asia Pacific Southeast', timezone: 'Asia/Singapore', currency: 'SGD' },
  { code: 'SA-EAST', name: 'South America East', timezone: 'America/Sao_Paulo', currency: 'BRL' },
  { code: 'AF-SOUTH', name: 'Africa South', timezone: 'Africa/Johannesburg', currency: 'ZAR' },
  { code: 'ME-WEST', name: 'Middle East West', timezone: 'Asia/Dubai', currency: 'AED' },
  { code: 'OC-EAST', name: 'Oceania East', timezone: 'Australia/Sydney', currency: 'AUD' },
];

const STATUSES = ['pending', 'processing', 'completed', 'shipped', 'delivered', 'cancelled'];
const TIERS = ['standard', 'premium', 'enterprise'];
const PRODUCTS = [
  'Widget Pro', 'Gadget Plus', 'Device Max', 'Tool Elite', 'Component X',
  'Module Y', 'System Z', 'Kit Alpha', 'Pack Beta', 'Set Gamma'
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDecimal(min, max, decimals = 2) {
  const num = Math.random() * (max - min) + min;
  return parseFloat(num.toFixed(decimals));
}

function generateEmail(index) {
  const domains = ['example.com', 'test.org', 'demo.net', 'sample.io'];
  return `user${index}@${randomElement(domains)}`;
}

function generateUser(id) {
  return {
    id,
    email: generateEmail(id),
    name: `User ${id}`,
    region_code: randomElement(REGIONS).code,
    tier: randomElement(TIERS),
  };
}

function generateOrder(userId, userRegion) {
  return {
    user_id: userId,
    region: userRegion,
    product_id: randomInt(1, 100),
    quantity: randomInt(1, 10),
    amount: randomDecimal(10, 1000),
    status: randomElement(STATUSES),
    metadata: JSON.stringify({
      source: randomElement(['web', 'mobile', 'api']),
      campaign: randomElement(['organic', 'paid', 'referral', null]),
    }),
  };
}

function generateOrderItem(userId, orderId) {
  return {
    user_id: userId,
    order_id: orderId,
    product_name: randomElement(PRODUCTS),
    quantity: randomInt(1, 5),
    unit_price: randomDecimal(5, 200),
  };
}

// Generate users with hot user distribution (20% users generate 80% orders)
function selectUserForOrder(userCount, hotUserPercentage = 20) {
  const hotUserCount = Math.floor(userCount * (hotUserPercentage / 100));
  const isHotUser = Math.random() < 0.8; // 80% chance to pick from hot users

  if (isHotUser && hotUserCount > 0) {
    return randomInt(1, hotUserCount);
  }
  return randomInt(1, userCount);
}

module.exports = {
  REGIONS,
  STATUSES,
  TIERS,
  PRODUCTS,
  randomInt,
  randomElement,
  randomDecimal,
  generateUser,
  generateOrder,
  generateOrderItem,
  selectUserForOrder,
};
