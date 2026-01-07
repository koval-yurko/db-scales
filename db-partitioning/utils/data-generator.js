// Helper functions
function randomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(startDate, endDate) {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  return new Date(start + Math.random() * (end - start));
}

function randomPrice(min = 10, max = 1000) {
  return (Math.random() * (max - min) + min).toFixed(2);
}

// Data arrays
const eventTypes = ['login', 'logout', 'page_view', 'purchase', 'signup', 'profile_update', 'search', 'cart_add'];
const regions = ['US', 'CA', 'MX', 'UK', 'DE', 'FR', 'IT', 'ES', 'JP', 'CN', 'AU', 'IN', 'SG'];
const categories = ['electronics', 'computers', 'clothing', 'shoes', 'accessories', 'books', 'home', 'garden'];
const statuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
const firstNames = ['John', 'Jane', 'Michael', 'Emily', 'David', 'Sarah', 'Robert', 'Lisa', 'William', 'Jennifer'];
const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];

// Generators
function generateEventLog() {
  return {
    eventType: randomElement(eventTypes),
    userId: randomInt(1, 10000),
    eventData: JSON.stringify({ session_id: `sess_${randomInt(1000, 9999)}`, page: `/page${randomInt(1, 50)}` }),
    ipAddress: `${randomInt(1,255)}.${randomInt(1,255)}.${randomInt(1,255)}.${randomInt(1,255)}`,
    createdAt: randomDate('2024-01-01', '2024-12-31')
  };
}

function generateUser() {
  const firstName = randomElement(firstNames);
  const lastName = randomElement(lastNames);
  const username = `${firstName.toLowerCase()}_${lastName.toLowerCase()}_${randomInt(100, 999)}`;
  return {
    username,
    email: `${username}@example.com`,
    countryCode: randomElement(regions),
    registrationDate: randomDate('2024-01-01', '2024-12-31'),
    status: randomElement(['active', 'inactive', 'suspended'])
  };
}

function generateOrder() {
  return {
    orderNumber: `ORD-${randomInt(100000, 999999)}`,
    userId: randomInt(1, 10000),
    productId: randomInt(1, 500),
    region: randomElement(regions),
    orderTotal: randomPrice(20, 5000),
    orderStatus: randomElement(statuses)
  };
}

function generateSale() {
  const saleDate = randomDate('2024-01-01', '2024-12-31');
  const category = randomElement(categories);
  const quantity = randomInt(1, 10);
  const unitPrice = parseFloat(randomPrice(10, 500));
  const totalAmount = (quantity * unitPrice).toFixed(2);

  return {
    saleDate,
    productCategory: category,
    productId: randomInt(1, 500),
    quantity,
    unitPrice: unitPrice.toFixed(2),
    totalAmount,
    storeId: randomInt(1, 100)
  };
}

module.exports = {
  randomElement,
  randomInt,
  randomDate,
  randomPrice,
  generateEventLog,
  generateUser,
  generateOrder,
  generateSale,
  eventTypes,
  regions,
  categories,
  statuses
};
