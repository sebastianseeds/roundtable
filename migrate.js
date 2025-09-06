const { db } = require('./database.js');

const migrations = [
  {
    name: 'Add campaign settings columns',
    sql: `
      ALTER TABLE games ADD COLUMN rule_system TEXT DEFAULT 'dnd5e';
      ALTER TABLE games ADD COLUMN grid_type TEXT DEFAULT 'square';
      ALTER TABLE games ADD COLUMN default_grid_size INTEGER DEFAULT 50;
      ALTER TABLE games ADD COLUMN vision_enabled BOOLEAN DEFAULT 0;
      ALTER TABLE games ADD COLUMN token_settings TEXT DEFAULT '{}';
      ALTER TABLE games ADD COLUMN character_sheet_template TEXT DEFAULT 'dnd5e';
      ALTER TABLE games ADD COLUMN deletion_requested BOOLEAN DEFAULT 0;
      ALTER TABLE games ADD COLUMN deletion_requested_at DATETIME;
    `
  }
];

async function runMigrations() {
  console.log('Running database migrations...');
  
  for (const migration of migrations) {
    try {
      console.log(`Running: ${migration.name}`);
      
      // Split by semicolon and run each statement
      const statements = migration.sql.split(';').filter(stmt => stmt.trim());
      
      for (const statement of statements) {
        if (statement.trim()) {
          await new Promise((resolve, reject) => {
            db.run(statement.trim(), (err) => {
              if (err && !err.message.includes('duplicate column name')) {
                console.warn(`Warning for statement "${statement.trim().substring(0, 50)}...": ${err.message}`);
              }
              resolve(); // Continue even if column already exists
            });
          });
        }
      }
      
      console.log(`✓ Completed: ${migration.name}`);
    } catch (err) {
      console.error(`✗ Failed: ${migration.name}`, err);
    }
  }
  
  console.log('Migration completed!');
  
  // Verify the new schema
  db.all('PRAGMA table_info(games)', (err, columns) => {
    if (err) {
      console.error('Error checking schema:', err);
      return;
    }
    console.log('\nUpdated games table columns:', columns.map(col => col.name));
    db.close();
    process.exit(0);
  });
}

runMigrations().catch(console.error);