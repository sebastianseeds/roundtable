const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, 'roundtable.db');
const db = new sqlite3.Database(dbPath);

const initDatabase = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          is_dev BOOLEAN DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS games (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          owner_id INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_played DATETIME DEFAULT CURRENT_TIMESTAMP,
          map_data TEXT,
          settings TEXT,
          rule_system TEXT DEFAULT 'dnd5e',
          grid_type TEXT DEFAULT 'square',
          default_grid_size INTEGER DEFAULT 50,
          vision_enabled BOOLEAN DEFAULT 0,
          token_settings TEXT DEFAULT '{}',
          character_sheet_template TEXT DEFAULT 'dnd5e',
          deletion_requested BOOLEAN DEFAULT 0,
          deletion_requested_at DATETIME,
          FOREIGN KEY (owner_id) REFERENCES users (id)
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS game_participants (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          game_id TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('king', 'knight')),
          character_name TEXT,
          character_data TEXT,
          joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users (id),
          UNIQUE(game_id, user_id)
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS game_state (
          game_id TEXT PRIMARY KEY,
          map_image TEXT,
          tokens TEXT,
          grid_size INTEGER DEFAULT 50,
          notes TEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE CASCADE
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS character_sheets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          game_id TEXT NOT NULL,
          name TEXT NOT NULL,
          class TEXT,
          level INTEGER DEFAULT 1,
          race TEXT,
          stats TEXT,
          inventory TEXT,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id),
          FOREIGN KEY (game_id) REFERENCES games (id) ON DELETE CASCADE
        )
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
};

class User {
  static async create(username, email, password) {
    const hashedPassword = await bcrypt.hash(password, 10);
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
        [username, email, hashedPassword],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, username, email });
        }
      );
    });
  }

  static async findByUsername(username) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM users WHERE username = ?',
        [username],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  static async findById(id) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT id, username, email, is_dev, created_at FROM users WHERE id = ?',
        [id],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  static async authenticate(username, password) {
    const user = await this.findByUsername(username);
    if (!user) return null;
    
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return null;
    
    return { id: user.id, username: user.username, email: user.email, is_dev: user.is_dev };
  }
}

class Game {
  static async create(name, description, ownerId, settings = {}) {
    const gameId = require('uuid').v4();
    const {
      ruleSystem = 'dnd5e',
      gridType = 'square',
      defaultGridSize = 50,
      visionEnabled = false,
      tokenSettings = {},
      characterSheetTemplate = 'dnd5e'
    } = settings;
    
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO games (id, name, description, owner_id, rule_system, grid_type, 
         default_grid_size, vision_enabled, token_settings, character_sheet_template) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [gameId, name, description, ownerId, ruleSystem, gridType, 
         defaultGridSize, visionEnabled, JSON.stringify(tokenSettings), characterSheetTemplate],
        function(err) {
          if (err) reject(err);
          else {
            db.run(
              'INSERT INTO game_participants (game_id, user_id, role) VALUES (?, ?, ?)',
              [gameId, ownerId, 'king'],
              (err) => {
                if (err) reject(err);
                else {
                  db.run(
                    'INSERT INTO game_state (game_id) VALUES (?)',
                    [gameId],
                    (err) => {
                      if (err) reject(err);
                      else resolve({ id: gameId, name, description, ownerId });
                    }
                  );
                }
              }
            );
          }
        }
      );
    });
  }

  static async findById(id) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT g.*, u.username as owner_name 
         FROM games g 
         JOIN users u ON g.owner_id = u.id 
         WHERE g.id = ?`,
        [id],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  static async findByUser(userId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT g.*, gp.role, gp.character_name, u.username as owner_name
         FROM games g
         JOIN game_participants gp ON g.id = gp.game_id
         JOIN users u ON g.owner_id = u.id
         WHERE gp.user_id = ?
         ORDER BY g.last_played DESC`,
        [userId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  static async addParticipant(gameId, userId, role = 'knight') {
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO game_participants (game_id, user_id, role) VALUES (?, ?, ?)',
        [gameId, userId, role],
        function(err) {
          if (err) reject(err);
          else resolve({ gameId, userId, role });
        }
      );
    });
  }

  static async updateParticipantRole(gameId, userId, role) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE game_participants SET role = ? WHERE game_id = ? AND user_id = ?',
        [role, gameId, userId],
        function(err) {
          if (err) reject(err);
          else resolve({ gameId, userId, role });
        }
      );
    });
  }

  static async getParticipants(gameId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT u.id, u.username, u.email, gp.role, gp.character_name, gp.joined_at
         FROM game_participants gp
         JOIN users u ON gp.user_id = u.id
         WHERE gp.game_id = ?`,
        [gameId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  static async getUserRole(gameId, userId) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT role FROM game_participants WHERE game_id = ? AND user_id = ?',
        [gameId, userId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row ? row.role : null);
        }
      );
    });
  }

  static async getState(gameId) {
    return new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM game_state WHERE game_id = ?',
        [gameId],
        (err, row) => {
          if (err) {
            console.error(`Database error getting state for game ${gameId}:`, err);
            reject(err);
          } else {
            console.log(`📊 Database getState for game ${gameId}:`, {
              found: !!row,
              hasMapImage: !!(row?.map_image),
              mapImageLength: row?.map_image?.length || 0,
              mapWidth: row?.map_width,
              mapHeight: row?.map_height,
              tokensLength: row?.tokens?.length || 0
            });
            
            if (row && row.tokens) {
              row.tokens = JSON.parse(row.tokens || '[]');
            }
            resolve(row || {});
          }
        }
      );
    });
  }

  static async updateState(gameId, field, value) {
    const updateValue = field === 'tokens' ? JSON.stringify(value) : value;
    
    // Define allowed fields to prevent SQL injection
    const allowedFields = ['map_image', 'tokens', 'grid_size', 'notes', 'map_width', 'map_height'];
    if (!allowedFields.includes(field)) {
      throw new Error(`Invalid field: ${field}`);
    }
    
    return new Promise((resolve, reject) => {
      const sql = `UPDATE game_state SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE game_id = ?`;
      console.log(`Updating game state: ${field} for game ${gameId} (value length: ${updateValue?.length || 'null'})`);
      
      db.run(sql, [updateValue, gameId], function(err) {
        if (err) {
          console.error(`Database error updating ${field}:`, err);
          reject(err);
        } else {
          console.log(`Successfully updated ${field}, rows changed: ${this.changes}`);
          resolve({ gameId, field, value });
        }
      });
    });
  }

  static async updateLastPlayed(gameId) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE games SET last_played = CURRENT_TIMESTAMP WHERE id = ?',
        [gameId],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  static async requestDeletion(gameId, ownerId) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE games SET deletion_requested = 1, deletion_requested_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_id = ?',
        [gameId, ownerId],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  static async cancelDeletion(gameId, ownerId) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE games SET deletion_requested = 0, deletion_requested_at = NULL WHERE id = ? AND owner_id = ?',
        [gameId, ownerId],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  static async permanentDelete(gameId, ownerId) {
    return new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM games WHERE id = ? AND owner_id = ? AND deletion_requested = 1',
        [gameId, ownerId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        }
      );
    });
  }

  static async devDelete(gameId, ownerId) {
    return new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM games WHERE id = ? AND owner_id = ?',
        [gameId, ownerId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        }
      );
    });
  }

  static async updateSettings(gameId, ownerId, settings) {
    const {
      ruleSystem,
      gridType,
      defaultGridSize,
      visionEnabled,
      tokenSettings,
      characterSheetTemplate
    } = settings;
    
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE games SET 
         rule_system = COALESCE(?, rule_system),
         grid_type = COALESCE(?, grid_type),
         default_grid_size = COALESCE(?, default_grid_size),
         vision_enabled = COALESCE(?, vision_enabled),
         token_settings = COALESCE(?, token_settings),
         character_sheet_template = COALESCE(?, character_sheet_template)
         WHERE id = ? AND owner_id = ?`,
        [
          ruleSystem,
          gridType,
          defaultGridSize,
          visionEnabled,
          tokenSettings ? JSON.stringify(tokenSettings) : null,
          characterSheetTemplate,
          gameId,
          ownerId
        ],
        function(err) {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }
}

class CharacterSheet {
  static async create(userId, gameId, characterData) {
    return new Promise((resolve, reject) => {
      const { name, class: charClass, level, race, stats, inventory, notes } = characterData;
      db.run(
        `INSERT INTO character_sheets (user_id, game_id, name, class, level, race, stats, inventory, notes) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, gameId, name, charClass, level || 1, race, 
         JSON.stringify(stats || {}), JSON.stringify(inventory || []), notes || ''],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, ...characterData });
        }
      );
    });
  }

  static async findByUserAndGame(userId, gameId) {
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM character_sheets WHERE user_id = ? AND game_id = ?',
        [userId, gameId],
        (err, rows) => {
          if (err) reject(err);
          else {
            rows.forEach(row => {
              if (row.stats) row.stats = JSON.parse(row.stats);
              if (row.inventory) row.inventory = JSON.parse(row.inventory);
            });
            resolve(rows);
          }
        }
      );
    });
  }

  static async update(id, updates) {
    const fields = [];
    const values = [];
    
    Object.keys(updates).forEach(key => {
      if (['stats', 'inventory'].includes(key)) {
        fields.push(`${key} = ?`);
        values.push(JSON.stringify(updates[key]));
      } else {
        fields.push(`${key} = ?`);
        values.push(updates[key]);
      }
    });
    
    values.push(id);
    
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE character_sheets SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        values,
        function(err) {
          if (err) reject(err);
          else resolve({ id, ...updates });
        }
      );
    });
  }
}

module.exports = {
  db,
  initDatabase,
  User,
  Game,
  CharacterSheet
};