async function getPartitionStats(client, parentTable) {
  console.log(`\nPartition Statistics for: ${parentTable}`);
  console.log('-'.repeat(80));

  try {
    // Get partition information with sizes and row counts
    const query = `
      SELECT
        pt.tablename AS partition_name,
        pg_size_pretty(pg_total_relation_size(pt.schemaname||'.'||pt.tablename)) AS size,
        (SELECT COUNT(*)
         FROM ONLY (pt.schemaname||'.'||pt.tablename)::regclass) AS row_count
      FROM pg_tables pt
      WHERE pt.tablename LIKE $1 || '%'
        AND pt.tablename != $1
        AND pt.schemaname = 'public'
      ORDER BY pt.tablename;
    `;

    const result = await client.query(query, [parentTable]);

    if (result.rows.length === 0) {
      console.log('No partitions found.');
      return;
    }

    console.table(result.rows);

    // Get total statistics for parent table
    const totalQuery = `
      SELECT
        COUNT(*) as total_rows,
        pg_size_pretty(pg_total_relation_size($1::regclass)) as total_size
      FROM ${parentTable};
    `;

    const totalResult = await client.query(totalQuery, [parentTable]);
    console.log(`\nTotal: ${totalResult.rows[0].total_rows} rows, ${totalResult.rows[0].total_size}`);
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
