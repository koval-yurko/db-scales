-- Projection queries (fast — pre-computed read models)

-- Q1: Single account balance (instant lookup)
SELECT current_balance, total_deposits, total_withdrawals, transaction_count
FROM proj_account_balances
WHERE account_id = 1;

-- Q2: All account balances
SELECT account_id, account_number, holder_name, current_balance
FROM proj_account_balances
ORDER BY current_balance DESC;

-- Q3: Monthly statement for account 1
SELECT statement_month, opening_balance, closing_balance,
       total_credits, total_debits, transaction_count,
       fees_charged, interest_earned
FROM proj_monthly_statements
WHERE account_id = 1
ORDER BY statement_month;

-- Q4: Recent transaction history for account 1
SELECT event_type, description, debit, credit, balance_after, counterparty, created_at
FROM proj_transaction_history
WHERE account_id = 1
ORDER BY created_at DESC
LIMIT 20;

-- Q5: Top accounts by balance
SELECT account_number, holder_name, account_type, current_balance, transaction_count
FROM proj_account_balances
ORDER BY current_balance DESC
LIMIT 10;
