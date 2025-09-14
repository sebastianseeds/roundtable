#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'roundtable.db');
const db = new sqlite3.Database(dbPath);

console.log('🔧 Creating character_sheets table...');

db.run(`
  CREATE TABLE IF NOT EXISTS character_sheets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    rule_system TEXT DEFAULT 'dnd5e',
    character_name TEXT,
    character_data TEXT, -- JSON blob containing all character sheet data
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(game_id, user_id) -- One character sheet per user per game
  )
`, (err) => {
  if (err) {
    console.error('❌ Failed to create character_sheets table:', err);
    process.exit(1);
  } else {
    console.log('✅ character_sheets table created successfully!');
  }
  
  db.close();
  process.exit(0);
});