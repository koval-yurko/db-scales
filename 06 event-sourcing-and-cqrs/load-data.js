const { query, closePool } = require('./utils/sql-runner');
const { config } = require('./utils/config');

const DEPOSIT_DESCRIPTIONS = [
  'Salary payment', 'Direct deposit', 'Cash deposit', 'Refund', 'Bonus payment',
];
const WITHDRAWAL_DESCRIPTIONS = [
  'ATM withdrawal', 'Grocery store', 'Gas station', 'Restaurant', 'Online purchase',
];
const FEE_DESCRIPTIONS = ['Monthly maintenance fee', 'Overdraft fee', 'Wire transfer fee'];

function randomBetween(min, max) {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  const intervalMs = parseInt(process.argv[2] || '100');
  const durationSec = parseInt(process.argv[3] || '60');

  console.log('═══════════════════════════════════════════════════════');
  console.log('CONTINUOUS EVENT GENERATOR');
  console.log('═══════════════════════════════════════════════════════\n');
  console.log(`  Interval: ${intervalMs}ms`);
  console.log(`  Duration: ${durationSec}s`);
  console.log(`  Press Ctrl+C to stop\n`);

  // Get account info
  const accountsResult = await query('SELECT id FROM accounts WHERE status = $$active$$ ORDER BY id');
  const accountIds = accountsResult.rows.map(r => r.id);
  const hotCount = Math.floor(accountIds.length * config.seed.hotAccountPct / 100);
  const hotIds = accountIds.slice(0, hotCount);
  const coldIds = accountIds.slice(hotCount);

  let eventCount = 0;
  let transferCounter = 0;
  const startTime = Date.now();
  let running = true;

  process.on('SIGINT', () => {
    console.log('\n  Shutting down gracefully...');
    running = false;
  });

  while (running && (Date.now() - startTime) < durationSec * 1000) {
    try {
      // Pick account (60% hot, 40% cold)
      const isHot = Math.random() < 0.6;
      const pool = isHot ? hotIds : coldIds;
      const accountId = pool[Math.floor(Math.random() * pool.length)];

      // Get current state
      const stateResult = await query(`
        SELECT COALESCE(MAX(sequence_number), 0) AS max_seq,
               (SELECT balance_after FROM account_events WHERE account_id = $1
                ORDER BY sequence_number DESC LIMIT 1) AS balance
        FROM account_events WHERE account_id = $1
      `, [accountId]);

      const maxSeq = parseInt(stateResult.rows[0].max_seq);
      const balance = parseFloat(stateResult.rows[0].balance || '0');

      // Pick event type
      const roll = Math.random() * 100;
      let eventType, amount, metadata;

      if (roll < 35) {
        // Deposit
        eventType = 'money_deposited';
        amount = randomBetween(50, 3000);
        metadata = { description: randomElement(DEPOSIT_DESCRIPTIONS) };
      } else if (roll < 60) {
        // Withdrawal
        amount = Math.min(randomBetween(20, 500), balance * 0.3);
        if (amount < 5) {
          eventType = 'money_deposited';
          amount = randomBetween(50, 3000);
          metadata = { description: randomElement(DEPOSIT_DESCRIPTIONS) };
        } else {
          eventType = 'money_withdrawn';
          metadata = { description: randomElement(WITHDRAWAL_DESCRIPTIONS) };
        }
      } else if (roll < 80) {
        // Transfer
        let counterpartyId;
        do {
          counterpartyId = accountIds[Math.floor(Math.random() * accountIds.length)];
        } while (counterpartyId === accountId);

        amount = Math.min(randomBetween(25, 1000), balance * 0.3);
        if (amount < 10) {
          eventType = 'money_deposited';
          amount = randomBetween(50, 3000);
          metadata = { description: randomElement(DEPOSIT_DESCRIPTIONS) };
        } else {
          transferCounter++;
          const transferId = `TXF-LIVE-${String(transferCounter).padStart(6, '0')}`;
          eventType = 'transfer_sent';

          // Get counterparty state
          const cpState = await query(`
            SELECT COALESCE(MAX(sequence_number), 0) AS max_seq,
                   (SELECT balance_after FROM account_events WHERE account_id = $1
                    ORDER BY sequence_number DESC LIMIT 1) AS balance
            FROM account_events WHERE account_id = $1
          `, [counterpartyId]);

          const cpMaxSeq = parseInt(cpState.rows[0].max_seq);
          const cpBalance = parseFloat(cpState.rows[0].balance || '0');

          // Sender
          const senderBal = Math.round((balance - amount) * 100) / 100;
          await query(`
            INSERT INTO account_events (account_id, event_type, amount, balance_after, sequence_number, metadata)
            VALUES ($1, 'transfer_sent', $2, $3, $4, $5)
          `, [accountId, amount, senderBal, maxSeq + 1,
              JSON.stringify({ description: `Transfer to Account ${counterpartyId}`, counterparty_account_id: counterpartyId, transfer_id: transferId })]);

          // Receiver
          const receiverBal = Math.round((cpBalance + amount) * 100) / 100;
          await query(`
            INSERT INTO account_events (account_id, event_type, amount, balance_after, sequence_number, metadata)
            VALUES ($1, 'transfer_received', $2, $3, $4, $5)
          `, [counterpartyId, amount, receiverBal, cpMaxSeq + 1,
              JSON.stringify({ description: `Transfer from Account ${accountId}`, counterparty_account_id: accountId, transfer_id: transferId })]);

          eventCount += 2;
          if (eventCount % 10 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            console.log(`  [${elapsed}s] Events: ${eventCount} | Last: transfer $${amount} Account ${accountId} → ${counterpartyId}`);
          }

          await new Promise(resolve => setTimeout(resolve, intervalMs));
          continue;
        }
      } else if (roll < 90) {
        eventType = 'fee_charged';
        amount = randomBetween(2, 25);
        metadata = { description: randomElement(FEE_DESCRIPTIONS) };
      } else {
        eventType = 'interest_applied';
        amount = Math.round(balance * randomBetween(0.001, 0.003) * 100) / 100;
        if (amount < 0.01) amount = 0.01;
        metadata = { description: 'Interest credit' };
      }

      // Calculate new balance
      const isCredit = ['money_deposited', 'transfer_received', 'interest_applied'].includes(eventType);
      const newBalance = isCredit
        ? Math.round((balance + amount) * 100) / 100
        : Math.round((balance - amount) * 100) / 100;

      await query(`
        INSERT INTO account_events (account_id, event_type, amount, balance_after, sequence_number, metadata)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [accountId, eventType, amount, newBalance, maxSeq + 1, JSON.stringify(metadata)]);

      eventCount++;
      if (eventCount % 10 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        console.log(`  [${elapsed}s] Events: ${eventCount} | Last: ${eventType} $${amount} Account ${accountId}`);
      }
    } catch (err) {
      if (err.code === '23505') {
        // Unique violation (concurrent sequence) - skip and retry
        continue;
      }
      console.error('  Error:', err.message);
    }

    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n  Finished: ${eventCount} events in ${totalTime}s (${(eventCount / parseFloat(totalTime)).toFixed(1)} events/sec)`);

  await closePool();
}

main().catch(err => {
  console.error('Error:', err);
  closePool().then(() => process.exit(1));
});
