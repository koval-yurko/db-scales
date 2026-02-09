const { config } = require('./config');

const FIRST_NAMES = [
  'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
  'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
  'Thomas', 'Sarah', 'Christopher', 'Karen', 'Charles', 'Lisa', 'Daniel', 'Nancy',
  'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra', 'Donald', 'Ashley',
  'Steven', 'Dorothy', 'Paul', 'Kimberly', 'Andrew', 'Emily', 'Joshua', 'Donna',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
];

const DEPOSIT_DESCRIPTIONS = [
  'Salary payment', 'Direct deposit', 'Cash deposit', 'Refund', 'Bonus payment',
  'Freelance income', 'Dividend payment', 'Insurance payout', 'Tax refund', 'Gift',
];

const WITHDRAWAL_DESCRIPTIONS = [
  'ATM withdrawal', 'Grocery store', 'Gas station', 'Restaurant', 'Online purchase',
  'Utility bill', 'Rent payment', 'Insurance premium', 'Subscription', 'Medical bill',
];

const FEE_DESCRIPTIONS = [
  'Monthly maintenance fee', 'Overdraft fee', 'Wire transfer fee', 'ATM fee',
  'Account service fee', 'Paper statement fee',
];

function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min, max) {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function generateAccounts() {
  const { checking, savings, business } = config.seed;
  const accounts = [];
  let id = 1;

  const types = [
    ...Array(checking).fill('checking'),
    ...Array(savings).fill('savings'),
    ...Array(business).fill('business'),
  ];

  // Shuffle
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [types[i], types[j]] = [types[j], types[i]];
  }

  for (const type of types) {
    const firstName = randomElement(FIRST_NAMES);
    const lastName = randomElement(LAST_NAMES);
    accounts.push({
      id: id,
      account_number: `ACC-${String(id).padStart(4, '0')}`,
      holder_name: type === 'business'
        ? `${lastName} ${randomElement(['LLC', 'Inc', 'Corp', 'Ltd', 'Group'])}`
        : `${firstName} ${lastName}`,
      account_type: type,
      currency: 'USD',
    });
    id++;
  }

  return accounts;
}

/**
 * Generator that yields batches of events to avoid holding all events in memory.
 * Each yield produces an array of event objects up to `batchSize` in length.
 */
function* generateEventBatches(accounts, totalEvents, batchSize = 10000) {
  const { hotAccountPct } = config.seed;
  const { deposit, withdrawal, transfer, fee, interest } = config.eventDist;

  const hotCount = Math.floor(accounts.length * hotAccountPct / 100);
  const hotAccountIds = accounts.slice(0, hotCount).map(a => a.id);
  const coldAccountIds = accounts.slice(hotCount).map(a => a.id);

  // Per-account state tracking
  const accountState = {};
  for (const acc of accounts) {
    accountState[acc.id] = { sequence: 0, balance: 0 };
  }

  let transferCounter = 0;

  // Start date: 12 months ago
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 12);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date();
  const dateRange = endDate.getTime() - startDate.getTime();

  // --- Batch 0: account_opened events ---
  let batch = [];
  for (const acc of accounts) {
    const state = accountState[acc.id];
    const initialDeposit = acc.account_type === 'business'
      ? randomBetween(5000, 50000)
      : acc.account_type === 'savings'
        ? randomBetween(1000, 10000)
        : randomBetween(100, 5000);

    state.sequence = 1;
    state.balance = initialDeposit;

    const openedAt = new Date(startDate.getTime() + Math.random() * dateRange * 0.05);
    batch.push({
      account_id: acc.id,
      event_type: 'account_opened',
      amount: initialDeposit,
      balance_after: initialDeposit,
      sequence_number: 1,
      metadata: JSON.stringify({ description: 'Account opened with initial deposit' }),
      created_at: openedAt,
    });

    if (batch.length >= batchSize) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length > 0) {
    yield batch;
    batch = [];
  }

  // --- Remaining events, generated in chronological time slices ---
  const remaining = totalEvents - accounts.length;
  const hotEventCount = Math.floor(remaining * 0.6);
  const coldEventCount = remaining - hotEventCount;

  // We generate events in time-slice order to get roughly chronological output
  // without needing a global sort of all events.
  const NUM_SLICES = 100;
  const sliceDuration = dateRange / NUM_SLICES;
  const hotPerSlice = Math.ceil(hotEventCount / NUM_SLICES);
  const coldPerSlice = Math.ceil(coldEventCount / NUM_SLICES);

  let hotRemaining = hotEventCount;
  let coldRemaining = coldEventCount;

  function pickAccount(isHot) {
    const pool = isHot ? hotAccountIds : coldAccountIds;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function pickEventType() {
    const roll = Math.random() * 100;
    if (roll < deposit) return 'money_deposited';
    if (roll < deposit + withdrawal) return 'money_withdrawn';
    if (roll < deposit + withdrawal + transfer) return 'transfer';
    if (roll < deposit + withdrawal + transfer + fee) return 'fee_charged';
    if (roll < deposit + withdrawal + transfer + fee + interest) return 'interest_applied';
    return 'money_deposited';
  }

  function createDepositEvent(accountId, state, timestamp) {
    const amount = randomBetween(50, 5000);
    state.sequence++;
    state.balance = Math.round((state.balance + amount) * 100) / 100;
    return [{
      account_id: accountId,
      event_type: 'money_deposited',
      amount,
      balance_after: state.balance,
      sequence_number: state.sequence,
      metadata: JSON.stringify({ description: randomElement(DEPOSIT_DESCRIPTIONS) }),
      created_at: timestamp,
    }];
  }

  function createEvent(accountId, timestamp) {
    const state = accountState[accountId];
    const eventType = pickEventType();

    if (eventType === 'transfer') {
      let counterpartyId;
      do {
        counterpartyId = accounts[Math.floor(Math.random() * accounts.length)].id;
      } while (counterpartyId === accountId);

      const counterState = accountState[counterpartyId];
      const maxTransfer = Math.min(state.balance * 0.5, 5000);
      if (maxTransfer < 10) {
        return createDepositEvent(accountId, state, timestamp);
      }

      const amount = randomBetween(10, Math.max(10, maxTransfer));
      transferCounter++;
      const transferId = `TXF-${String(transferCounter).padStart(6, '0')}`;

      state.sequence++;
      state.balance = Math.round((state.balance - amount) * 100) / 100;
      const senderEvent = {
        account_id: accountId,
        event_type: 'transfer_sent',
        amount,
        balance_after: state.balance,
        sequence_number: state.sequence,
        metadata: JSON.stringify({
          description: `Transfer to Account ${counterpartyId}`,
          counterparty_account_id: counterpartyId,
          transfer_id: transferId,
        }),
        created_at: timestamp,
      };

      counterState.sequence++;
      counterState.balance = Math.round((counterState.balance + amount) * 100) / 100;
      const receiverEvent = {
        account_id: counterpartyId,
        event_type: 'transfer_received',
        amount,
        balance_after: counterState.balance,
        sequence_number: counterState.sequence,
        metadata: JSON.stringify({
          description: `Transfer from Account ${accountId}`,
          counterparty_account_id: accountId,
          transfer_id: transferId,
        }),
        created_at: new Date(timestamp.getTime() + 1),
      };

      return [senderEvent, receiverEvent];
    }

    if (eventType === 'money_withdrawn') {
      const maxWithdrawal = Math.min(state.balance * 0.3, 2000);
      if (maxWithdrawal < 5) {
        return createDepositEvent(accountId, state, timestamp);
      }
      const amount = randomBetween(5, Math.max(5, maxWithdrawal));
      state.sequence++;
      state.balance = Math.round((state.balance - amount) * 100) / 100;
      return [{
        account_id: accountId,
        event_type: 'money_withdrawn',
        amount,
        balance_after: state.balance,
        sequence_number: state.sequence,
        metadata: JSON.stringify({ description: randomElement(WITHDRAWAL_DESCRIPTIONS) }),
        created_at: timestamp,
      }];
    }

    if (eventType === 'fee_charged') {
      const amount = randomBetween(2, 35);
      state.sequence++;
      state.balance = Math.round((state.balance - amount) * 100) / 100;
      return [{
        account_id: accountId,
        event_type: 'fee_charged',
        amount,
        balance_after: state.balance,
        sequence_number: state.sequence,
        metadata: JSON.stringify({ description: randomElement(FEE_DESCRIPTIONS) }),
        created_at: timestamp,
      }];
    }

    if (eventType === 'interest_applied') {
      const rate = accountState[accountId].balance > 0 ? randomBetween(0.001, 0.005) : 0;
      const amount = Math.round(state.balance * rate * 100) / 100;
      if (amount < 0.01) {
        return createDepositEvent(accountId, state, timestamp);
      }
      state.sequence++;
      state.balance = Math.round((state.balance + amount) * 100) / 100;
      return [{
        account_id: accountId,
        event_type: 'interest_applied',
        amount,
        balance_after: state.balance,
        sequence_number: state.sequence,
        metadata: JSON.stringify({ description: 'Monthly interest credit' }),
        created_at: timestamp,
      }];
    }

    return createDepositEvent(accountId, state, timestamp);
  }

  for (let slice = 0; slice < NUM_SLICES; slice++) {
    const sliceStart = startDate.getTime() + slice * sliceDuration;

    const hotInSlice = Math.min(hotPerSlice, hotRemaining);
    const coldInSlice = Math.min(coldPerSlice, coldRemaining);

    // Generate hot events for this time slice
    for (let i = 0; i < hotInSlice; i++) {
      const accountId = pickAccount(true);
      const timestamp = new Date(sliceStart + Math.random() * sliceDuration);
      const newEvents = createEvent(accountId, timestamp);
      for (const e of newEvents) batch.push(e);
      if (batch.length >= batchSize) {
        yield batch;
        batch = [];
      }
    }
    hotRemaining -= hotInSlice;

    // Generate cold events for this time slice
    for (let i = 0; i < coldInSlice; i++) {
      const accountId = pickAccount(false);
      const timestamp = new Date(sliceStart + Math.random() * sliceDuration);
      const newEvents = createEvent(accountId, timestamp);
      for (const e of newEvents) batch.push(e);
      if (batch.length >= batchSize) {
        yield batch;
        batch = [];
      }
    }
    coldRemaining -= coldInSlice;
  }

  // Flush remaining
  if (batch.length > 0) {
    yield batch;
  }
}

module.exports = { generateAccounts, generateEventBatches };
