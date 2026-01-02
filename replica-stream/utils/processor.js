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
      const { tag, table, new: newData, old: oldData } = event;

      if (!table) {
        return { success: true, skipped: true };
      }

      switch (tag) {
        case 'insert':
          return await this.processInsert(table, newData);

        case 'update':
          return await this.processUpdate(table, oldData, newData);

        case 'delete':
          return await this.processDelete(table, oldData);

        default:
          console.log(`[UNKNOWN] Event type: ${tag}`);
          return { success: true, skipped: true };
      }
    } catch (error) {
      console.error('Error processing event:', error.message);
      console.error('Event details:', JSON.stringify(event, null, 2));
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
