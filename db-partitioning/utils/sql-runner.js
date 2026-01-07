const fs = require('fs');
const path = require('path');

async function executeSqlFile(client, filePath) {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.join(process.cwd(), filePath);

  console.log(`Executing SQL file: ${path.basename(filePath)}`);

  if (!fs.existsSync(absolutePath)) {
    console.error(`✗ File not found: ${absolutePath}`);
    return { success: false, error: new Error('File not found') };
  }

  const sql = fs.readFileSync(absolutePath, 'utf8');

  try {
    await client.query(sql);
    console.log(`✓ Successfully executed: ${path.basename(filePath)}`);
    return { success: true };
  } catch (error) {
    console.error(`✗ Error executing ${path.basename(filePath)}:`, error.message);
    return { success: false, error };
  }
}

async function executeSqlFiles(client, fileList) {
  const results = [];
  for (const file of fileList) {
    const result = await executeSqlFile(client, file);
    results.push({ file, ...result });

    if (!result.success) {
      console.error(`\nExecution stopped due to error in ${path.basename(file)}`);
      break;
    }
  }
  return results;
}

module.exports = { executeSqlFile, executeSqlFiles };
