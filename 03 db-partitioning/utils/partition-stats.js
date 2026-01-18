async function getPartitionStats(client, parentTable) {
  console.log(`\nPartition Statistics for: ${parentTable}`);
  console.log('-'.repeat(80));

  try {
    // Get partition information using pg_inherits
    const query = `
      SELECT
        child.relname AS partition_name,
        pg_size_pretty(pg_total_relation_size(child.oid)) AS size,
        (SELECT COUNT(*) FROM ONLY pg_class c WHERE c.oid = child.oid) AS row_estimate
      FROM pg_inherits
      JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
      JOIN pg_class child ON pg_inherits.inhrelid = child.oid
      WHERE parent.relname = $1
      ORDER BY child.relname;
    `;

    const result = await client.query(query, [parentTable]);

    if (result.rows.length === 0) {
      console.log('No partitions found (table may not be partitioned).');
      return;
    }

    // Get actual row counts for each partition
    const partitionData = [];
    for (const row of result.rows) {
      try {
        const countResult = await client.query(`SELECT COUNT(*) FROM "${row.partition_name}"`);
        partitionData.push({
          partition_name: row.partition_name,
          size: row.size,
          row_count: countResult.rows[0].count
        });
      } catch (err) {
        partitionData.push({
          partition_name: row.partition_name,
          size: row.size,
          row_count: 'error'
        });
      }
    }

    console.table(partitionData);

    // Get total statistics for parent table
    try {
      const totalResult = await client.query(`
        SELECT
          COUNT(*) as total_rows,
          pg_size_pretty(pg_total_relation_size($1::regclass)) as total_size
        FROM "${parentTable}"
      `, [parentTable]);
      console.log(`\nTotal: ${totalResult.rows[0].total_rows} rows, ${totalResult.rows[0].total_size}`);
    } catch (err) {
      console.log(`\nPartitions: ${partitionData.length}`);
    }
  } catch (error) {
    console.error(`Error getting partition stats for ${parentTable}:`, error.message);
  }
}

async function showPartitionTree(client, parentTable) {
  console.log(`\nPartition Hierarchy for: ${parentTable}`);
  console.log('-'.repeat(80));

  try {
    const query = `
      SELECT
        nmsp_parent.nspname AS parent_schema,
        parent.relname AS parent,
        nmsp_child.nspname AS child_schema,
        child.relname AS child
      FROM pg_inherits
      JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
      JOIN pg_class child ON pg_inherits.inhrelid = child.oid
      JOIN pg_namespace nmsp_parent ON nmsp_parent.oid = parent.relnamespace
      JOIN pg_namespace nmsp_child ON nmsp_child.oid = child.relnamespace
      WHERE parent.relname = $1
      ORDER BY child.relname;
    `;

    const result = await client.query(query, [parentTable]);

    if (result.rows.length === 0) {
      console.log('No partition hierarchy found.');
      return;
    }

    console.table(result.rows);
  } catch (error) {
    console.error(`Error getting partition tree for ${parentTable}:`, error.message);
  }
}

module.exports = { getPartitionStats, showPartitionTree };
