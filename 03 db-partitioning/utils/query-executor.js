async function executeQuery(client, query, params = []) {
  const startTime = Date.now();
  const result = await client.query(query, params);
  const duration = Date.now() - startTime;

  return {
    rows: result.rows,
    rowCount: result.rowCount,
    duration
  };
}

async function showExplain(client, query, params = []) {
  console.log('Query:');
  console.log(query.trim());
  console.log('\nEXPLAIN ANALYZE Output:');
  console.log('-'.repeat(80));

  try {
    const explainQuery = `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${query}`;
    const result = await client.query(explainQuery, params);

    result.rows.forEach(row => {
      console.log(row['QUERY PLAN']);
    });

    console.log('-'.repeat(80));

    // Analyze partition pruning from EXPLAIN output
    const planText = result.rows.map(row => row['QUERY PLAN']).join('\n');

    // Count how many partitions are being scanned
    const appendMatch = planText.match(/Append/g);
    const seqScanMatches = planText.match(/Seq Scan on (\w+)/g) || [];
    const indexScanMatches = planText.match(/Index.*Scan.*on (\w+)/g) || [];
    const allScans = [...seqScanMatches, ...indexScanMatches];

    // Check for pruning indicators
    const hasSubplansRemoved = planText.includes('Subplans Removed');
    const hasNeverExecuted = planText.includes('never executed');

    // If we have Append node, it's scanning multiple partitions
    const isPartitionedScan = appendMatch !== null || allScans.length > 1;

    if (isPartitionedScan) {
      const scanCount = allScans.length || 'multiple';
      if (hasSubplansRemoved || hasNeverExecuted) {
        console.log(`✓ Partition pruning ACTIVE - scanning ${scanCount} partition(s), some pruned`);
      } else {
        console.log(`ℹ Partitioned table - scanning ${scanCount} partition(s)`);
      }
    } else if (allScans.length === 1) {
      // Single partition or single table
      const tableName = allScans[0].match(/on (\w+)/)?.[1] || 'unknown';
      if (tableName.includes('_20') || tableName.includes('_p') || tableName.includes('_q')) {
        console.log(`✓ Partition pruning ACTIVE - only scanning: ${tableName}`);
      } else {
        console.log(`ℹ Single table scan: ${tableName}`);
      }
    } else {
      console.log('ℹ Query plan analyzed');
    }

    return result;
  } catch (error) {
    console.error('Error executing EXPLAIN:', error.message);
    throw error;
  }
}

module.exports = { executeQuery, showExplain };
