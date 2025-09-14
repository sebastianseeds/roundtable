#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'roundtable.db');
const db = new sqlite3.Database(dbPath);

console.log('🔧 Adding macros table to database...');

db.run(`
  CREATE TABLE IF NOT EXISTS macros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    game_id TEXT NOT NULL,
    name TEXT NOT NULL,
    formula TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE CASCADE,
    UNIQUE(user_id, game_id, name)
  )
`, (err) => {
  if (err) {
    console.error('❌ Failed to create macros table:', err);
    process.exit(1);
  } else {
    console.log('✅ Macros table created successfully!');
    
    // Add some default macros for existing users in their games
    console.log('📝 You can now add macros through the game interface');
    
    db.close();
    process.exit(0);
  }
});