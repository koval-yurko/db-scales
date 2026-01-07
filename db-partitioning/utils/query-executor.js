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

    // Highlight partition pruning
    const planText = result.rows.map(row => row['QUERY PLAN']).join('\n');
    const hasPartitionPruning = planText.includes('Partitions') || planText.includes('never executed');

    if (hasPartitionPruning) {
      console.log('✓ Partition pruning is active');
    } else {
      console.log('⚠ No partition pruning detected');
    }

    return result;
  } catch (error) {
    console.error('Error executing EXPLAIN:', error.message);
    throw error;
  }
}

module.exports = { executeQuery, showExplain };
