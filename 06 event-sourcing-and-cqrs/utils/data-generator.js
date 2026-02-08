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

function generateEvents(accounts, totalEvents) {
  const { hotAccountPct } = config.seed;
  const { deposit, withdrawal, transfer, fee, interest } = config.eventDist;

  // Designate hot accounts (15% of accounts get 60% of events)
  const hotCount = Math.floor(accounts.length * hotAccountPct / 100);
  const hotAccountIds = accounts.slice(0, hotCount).map(a => a.id);
  const coldAccountIds = accounts.slice(hotCount).map(a => a.id);

  // Per-account state tracking
  const accountState = {};
  for (const acc of accounts) {
    accountState[acc.id] = { sequence: 0, balance: 0, opened: false };
  }

  const events = [];
  let transferCounter = 0;

  // Start date: 12 months ago
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - 12);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date();
  const dateRange = endDate.getTime() - startDate.getTime();

  // First, open all accounts with initial deposits
  for (const acc of accounts) {
    const state = accountState[acc.id];
    const initialDeposit = acc.account_type === 'business'
      ? randomBetween(5000, 50000)
      : acc.account_type === 'savings'
        ? randomBetween(1000, 10000)
        : randomBetween(100, 5000);

    state.sequence = 1;
    state.balance = initialDeposit;
    state.opened = true;

    const openedAt = new Date(startDate.getTime() + Math.random() * dateRange * 0.05);
    events.push({
      account_id: acc.id,
      event_type: 'account_opened',
      amount: initialDeposit,
      balance_after: initialDeposit,
      sequence_number: 1,
      metadata: JSON.stringify({ description: 'Account opened with initial deposit' }),
      created_at: openedAt,
    });
  }

  // Generate remaining events
  const remaining = totalEvents - accounts.length;
  const hotEventCount = Math.floor(remaining * 0.6);
  const coldEventCount = remaining - hotEventCount;

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
    return 'money_deposited'; // fallback
  }

  function createEvent(accountId, timestamp) {
    const state = accountState[accountId];
    const eventType = pickEventType();

    if (eventType === 'transfer') {
      // Pick a different account as counterparty
      let counterpartyId;
      do {
        counterpartyId = accounts[Math.floor(Math.random() * accounts.length)].id;
      } while (counterpartyId === accountId);

      const counterState = accountState[counterpartyId];
      const maxTransfer = Math.min(state.balance * 0.5, 5000);
      if (maxTransfer < 10) {
        // Not enough balance, do a deposit instead
        return createDepositEvent(accountId, state, timestamp);
      }

      const amount = randomBetween(10, Math.max(10, maxTransfer));
      transferCounter++;
      const transferId = `TXF-${String(transferCounter).padStart(6, '0')}`;

      // Sender event
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

      // Receiver event
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
        created_at: new Date(timestamp.getTime() + 1), // 1ms later
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

    // Default: deposit
    return createDepositEvent(accountId, state, timestamp);
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

  // Generate hot events
  for (let i = 0; i < hotEventCount; i++) {
    const accountId = pickAccount(true);
    const timestamp = new Date(startDate.getTime() + Math.random() * dateRange);
    const newEvents = createEvent(accountId, timestamp);
    events.push(...newEvents);
  }

  // Generate cold events
  for (let i = 0; i < coldEventCount; i++) {
    const accountId = pickAccount(false);
    const timestamp = new Date(startDate.getTime() + Math.random() * dateRange);
    const newEvents = createEvent(accountId, timestamp);
    events.push(...newEvents);
  }

  // Sort by created_at for realistic ordering
  events.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());

  return events;
}

module.exports = { generateAccounts, generateEvents };
