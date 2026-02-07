const REGIONS = [
  'US-EAST', 'US-WEST', 'EU-WEST', 'EU-CENT', 'APAC-NE',
  'APAC-SE', 'SA-EAST', 'AF-SOUTH', 'ME-WEST', 'OC-EAST',
];

const STATUSES = ['pending', 'processing', 'completed', 'shipped', 'delivered', 'cancelled'];
const TIERS = ['standard', 'premium', 'enterprise'];

const CATEGORIES = [
  'Electronics', 'Clothing', 'Books', 'Home & Garden', 'Sports',
  'Toys', 'Food & Beverage', 'Health', 'Automotive', 'Office',
];

const PRODUCT_NAMES = [
  'Widget Pro', 'Gadget Plus', 'Device Max', 'Tool Elite', 'Component X',
  'Module Y', 'System Z', 'Kit Alpha', 'Pack Beta', 'Set Gamma',
  'Unit Delta', 'Block Epsilon', 'Frame Zeta', 'Board Eta', 'Panel Theta',
  'Chip Iota', 'Disc Kappa', 'Rod Lambda', 'Coil Mu', 'Bolt Nu',
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDecimal(min, max, decimals = 2) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals));
}

function generateUser(id) {
  const region = randomElement(REGIONS);
  return {
    email: `user${id}@example.com`,
    name: `User ${id}`,
    region_code: region,
    tier: randomElement(TIERS),
  };
}

function generateProduct(id) {
  const catIndex = (id - 1) % CATEGORIES.length;
  const nameIndex = (id - 1) % PRODUCT_NAMES.length;
  const variant = Math.ceil(id / PRODUCT_NAMES.length);
  return {
    name: `${PRODUCT_NAMES[nameIndex]}${variant > 1 ? ' v' + variant : ''}`,
    category: CATEGORIES[catIndex],
    price: randomDecimal(5, 500),
  };
}

function selectUserForOrder(userCount, hotUserPercentage = 20) {
  const hotUserCount = Math.floor(userCount * (hotUserPercentage / 100));
  const isHotUser = Math.random() < 0.8;

  if (isHotUser && hotUserCount > 0) {
    return randomInt(1, hotUserCount);
  }
  return randomInt(1, userCount);
}

function generateOrder(userId, userRegion) {
  const status = randomElement(STATUSES);
  const totalAmount = randomDecimal(10, 2000);
  const daysAgo = randomInt(0, 365);
  const createdAt = new Date(Date.now() - daysAgo * 86400000);

  return {
    user_id: userId,
    region: userRegion,
    status,
    total_amount: totalAmount,
    created_at: createdAt,
  };
}

function generateOrderItems(orderId, productCount) {
  const itemCount = randomInt(1, 5);
  const items = [];
  const usedProducts = new Set();

  for (let i = 0; i < itemCount; i++) {
    let productId;
    do {
      productId = randomInt(1, productCount);
    } while (usedProducts.has(productId));
    usedProducts.add(productId);

    const quantity = randomInt(1, 10);
    const unitPrice = randomDecimal(5, 500);
    items.push({
      order_id: orderId,
      product_id: productId,
      quantity,
      unit_price: unitPrice,
      line_total: parseFloat((quantity * unitPrice).toFixed(2)),
    });
  }

  return items;
}

module.exports = {
  REGIONS, STATUSES, TIERS, CATEGORIES,
  randomInt, randomElement, randomDecimal,
  generateUser, generateProduct, selectUserForOrder,
  generateOrder, generateOrderItems,
};
