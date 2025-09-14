#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'roundtable.db');
const db = new sqlite3.Database(dbPath);

console.log('🔧 Adding grail_modifiers column to game_state table...');

db.run(`
  ALTER TABLE game_state ADD COLUMN grail_modifiers TEXT DEFAULT '{}'
`, (err) => {
  if (err) {
    if (err.message.includes('duplicate column name')) {
      console.log('✅ Column already exists, skipping...');
    } else {
      console.error('❌ Failed to add grail_modifiers column:', err);
      process.exit(1);
    }
  } else {
    console.log('✅ grail_modifiers column added successfully!');
  }
  
  db.close();
  process.exit(0);
});