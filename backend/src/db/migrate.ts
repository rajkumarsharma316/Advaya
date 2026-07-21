import { pool } from './pool';
import fs from 'fs';
import path from 'path';

async function migrate() {
  try {
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
    await pool.query(schemaSql);
    console.log('✅ Base database schema applied successfully');

    const filesSqlPath = path.join(__dirname, 'schema_files.sql');
    if (fs.existsSync(filesSqlPath)) {
      const filesSql = fs.readFileSync(filesSqlPath, 'utf-8');
      await pool.query(filesSql);
      console.log('✅ Files database schema applied successfully');
    }

    const groupsSqlPath = path.join(__dirname, 'schema_groups_unified.sql');
    if (fs.existsSync(groupsSqlPath)) {
      const groupsSql = fs.readFileSync(groupsSqlPath, 'utf-8');
      await pool.query(groupsSql);
      console.log('✅ Groups database schema applied successfully');
    }
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
