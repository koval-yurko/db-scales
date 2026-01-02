const { Client } = require('pg');

class TableCopier {
  constructor(sourceConfig, targetProcessor) {
    this.sourceConfig = sourceConfig;
    this.targetProcessor = targetProcessor;
    this.copiedRows = {
      total: 0,
      byTable: {}
    };
  }

  async copyAllTables(tableNames) {
    const client = new Client({
      host: this.sourceConfig.host,
      port: this.sourceConfig.port,
      database: this.sourceConfig.database,
      user: this.sourceConfig.user,
      password: this.sourceConfig.password,
    });

    try {
      await client.connect();
      console.log('\n========================================');
      console.log('PHASE 1: Initial Table Copy');
      console.log('========================================\n');

      for (const tableName of tableNames) {
        await this.copyTable(client, tableName);
      }

      console.log('\n========================================');
      console.log('Initial Copy Complete');
      console.log('========================================');
      console.log(`Total rows copied: ${this.copiedRows.total}`);
      for (const [table, count] of Object.entries(this.copiedRows.byTable)) {
        console.log(`  ${table}: ${count} rows`);
      }
      console.log('========================================\n');

      return this.copiedRows;
    } finally {
      await client.end();
    }
  }

  async copyTable(client, tableName) {
    console.log(`Copying table: ${tableName}...`);

    // Get table schema
    const schemaResult = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position
    `, [tableName]);

    const columns = schemaResult.rows.map(r => r.column_name);

    // Get all rows from the table
    const query = `SELECT * FROM ${tableName}`;
    const result = await client.query(query);

    console.log(`  Found ${result.rows.length} rows`);

    // Process each row through the target processor
    for (const row of result.rows) {
      await this.targetProcessor.processInsert(tableName, row);
    }

    this.copiedRows.byTable[tableName] = result.rows.length;
    this.copiedRows.total += result.rows.length;

    console.log(`  ✓ ${tableName} copied (${result.rows.length} rows)\n`);
  }

  getStats() {
    return {
      ...this.copiedRows,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = TableCopier;
