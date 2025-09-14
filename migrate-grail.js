const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'roundtable.db');
const db = new sqlite3.Database(dbPath);

console.log('🔄 Adding grail system to existing database...');

db.serialize(() => {
    // Check if the column already exists
    db.all("PRAGMA table_info(game_participants)", (err, columns) => {
        if (err) {
            console.error('❌ Error checking table structure:', err);
            return;
        }
        
        const hasGrailColumn = columns.some(col => col.name === 'has_grail');
        
        if (!hasGrailColumn) {
            console.log('📝 Adding has_grail column to game_participants table...');
            db.run("ALTER TABLE game_participants ADD COLUMN has_grail BOOLEAN DEFAULT 0", (err) => {
                if (err) {
                    console.error('❌ Error adding has_grail column:', err);
                } else {
                    console.log('✅ Successfully added has_grail column');
                }
                db.close();
            });
        } else {
            console.log('✅ has_grail column already exists');
            db.close();
        }
    });
});