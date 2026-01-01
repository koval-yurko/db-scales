class EventProcessor {
  constructor() {
    this.processedCount = {
      insert: 0,
      update: 0,
      delete: 0,
      total: 0,
    };
  }

  async processInsert(table, newData) {
    console.log(`[INSERT] ${table}:`, JSON.stringify(newData));
    this.processedCount.insert++;
    this.processedCount.total++;
    return { success: true, operation: 'INSERT', table };
  }

  async processUpdate(table, oldData, newData) {
    console.log(`[UPDATE] ${table}:`);
    console.log('  Old:', JSON.stringify(oldData));
    console.log('  New:', JSON.stringify(newData));
    this.processedCount.update++;
    this.processedCount.total++;
    return { success: true, operation: 'UPDATE', table };
  }

  async processDelete(table, oldData) {
    console.log(`[DELETE] ${table}:`, JSON.stringify(oldData));
    this.processedCount.delete++;
    this.processedCount.total++;
    return { success: true, operation: 'DELETE', table };
  }

  async processEvent(event) {
    try {
      const { tag, relation, new: newTuple, old: oldTuple } = event;

      if (!relation) {
        return { success: true, skipped: true };
      }

      const tableName = relation.tag.name;

      switch (tag) {
        case 'insert':
          return await this.processInsert(tableName, newTuple);

        case 'update':
          return await this.processUpdate(tableName, oldTuple, newTuple);

        case 'delete':
          return await this.processDelete(tableName, oldTuple);

        default:
          console.log(`[UNKNOWN] Event type: ${tag}`);
          return { success: true, skipped: true };
      }
    } catch (error) {
      console.error('Error processing event:', error.message);
      return {
        success: false,
        error: error.message,
        event,
      };
    }
  }

  getStats() {
    return {
      ...this.processedCount,
      timestamp: new Date().toISOString(),
    };
  }

  resetStats() {
    this.processedCount = {
      insert: 0,
      update: 0,
      delete: 0,
      total: 0,
    };
  }
}

module.exports = EventProcessor;
