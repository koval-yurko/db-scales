-- Phase 3: Attach triggers to account_events INSERT

DROP TRIGGER IF EXISTS trg_update_balance ON account_events;
DROP TRIGGER IF EXISTS trg_update_history ON account_events;
DROP TRIGGER IF EXISTS trg_update_statement ON account_events;

CREATE TRIGGER trg_update_balance
    AFTER INSERT ON account_events
    FOR EACH ROW EXECUTE FUNCTION update_balance_projection();

CREATE TRIGGER trg_update_history
    AFTER INSERT ON account_events
    FOR EACH ROW EXECUTE FUNCTION update_history_projection();

CREATE TRIGGER trg_update_statement
    AFTER INSERT ON account_events
    FOR EACH ROW EXECUTE FUNCTION update_statement_projection();
