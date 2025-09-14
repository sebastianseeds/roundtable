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
          has_grail BOOLEAN DEFAULT 0,
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
      `);

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

  static async addParticipant(gameId, userId, role = 'knight', characterName = null) {
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO game_participants (game_id, user_id, role, character_name) VALUES (?, ?, ?, ?)',
        [gameId, userId, role, characterName],
        function(err) {
          if (err) reject(err);
          else resolve({ gameId, userId, role, characterName });
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
  
  static async updateCharacterName(gameId, userId, characterName) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE game_participants SET character_name = ? WHERE game_id = ? AND user_id = ?',
        [characterName, gameId, userId],
        function(err) {
          if (err) reject(err);
          else resolve({ gameId, userId, characterName });
        }
      );
    });
  }

  static async getParticipants(gameId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT u.id, u.username, u.email, gp.role, gp.character_name, gp.has_grail, gp.joined_at
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
    const allowedFields = ['map_image', 'tokens', 'grid_size', 'notes', 'map_width', 'map_height', 'grail_modifiers'];
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

  static async assignGrail(gameId, userId, assignerId) {
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        // First, remove grail from all participants in this game
        db.run(
          'UPDATE game_participants SET has_grail = 0 WHERE game_id = ?',
          [gameId],
          (err) => {
            if (err) {
              reject(err);
              return;
            }
            
            // Then assign grail to the specified user
            db.run(
              'UPDATE game_participants SET has_grail = 1 WHERE game_id = ? AND user_id = ?',
              [gameId, userId],
              function(err) {
                if (err) reject(err);
                else resolve({ gameId, userId, hasGrail: true });
              }
            );
          }
        );
      });
    });
  }

  static async removeGrail(gameId, userId, assignerId) {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE game_participants SET has_grail = 0 WHERE game_id = ? AND user_id = ?',
        [gameId, userId],
        function(err) {
          if (err) reject(err);
          else resolve({ gameId, userId, hasGrail: false });
        }
      );
    });
  }
}

class Macro {
  static async create(userId, gameId, name, formula, description = null) {
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO macros (user_id, game_id, name, formula, description) 
         VALUES (?, ?, ?, ?, ?)`,
        [userId, gameId, name, formula, description],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, userId, gameId, name, formula, description });
        }
      );
    });
  }

  static async findByUserAndGame(userId, gameId) {
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM macros WHERE user_id = ? AND game_id = ? ORDER BY name',
        [userId, gameId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  static async delete(id, userId) {
    return new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM macros WHERE id = ? AND user_id = ?',
        [id, userId],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        }
      );
    });
  }

  static async update(id, userId, updates) {
    const fields = [];
    const values = [];
    
    if (updates.name) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.formula) {
      fields.push('formula = ?');
      values.push(updates.formula);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }
    
    if (fields.length === 0) {
      return Promise.resolve(false);
    }
    
    values.push(id, userId);
    
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE macros SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
        values,
        function(err) {
          if (err) reject(err);
          else resolve(this.changes > 0);
        }
      );
    });
  }
}

class CharacterSheet {
  static async create(gameId, userId, ruleSystem = 'dnd5e', characterName = '', characterData = {}) {
    return new Promise((resolve, reject) => {
      const dataJson = JSON.stringify(characterData);
      db.run(
        `INSERT INTO character_sheets (game_id, user_id, rule_system, character_name, character_data, updated_at) 
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [gameId, userId, ruleSystem, characterName, dataJson],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, gameId, userId, ruleSystem, characterName, characterData });
        }
      );
    });
  }

  static async findByGameAndUser(gameId, userId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT * FROM character_sheets WHERE game_id = ? AND user_id = ?`,
        [gameId, userId],
        (err, row) => {
          if (err) reject(err);
          else if (row) {
            resolve({
              ...row,
              character_data: JSON.parse(row.character_data || '{}')
            });
          } else {
            resolve(null);
          }
        }
      );
    });
  }

  static async findAllByGame(gameId) {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT cs.*, u.username FROM character_sheets cs
         JOIN users u ON cs.user_id = u.id 
         WHERE cs.game_id = ?`,
        [gameId],
        (err, rows) => {
          if (err) reject(err);
          else {
            const sheets = rows.map(row => ({
              ...row,
              character_data: JSON.parse(row.character_data || '{}')
            }));
            resolve(sheets);
          }
        }
      );
    });
  }

  static async update(gameId, userId, characterName, characterData) {
    return new Promise((resolve, reject) => {
      const dataJson = JSON.stringify(characterData);
      db.run(
        `UPDATE character_sheets 
         SET character_name = ?, character_data = ?, updated_at = CURRENT_TIMESTAMP
         WHERE game_id = ? AND user_id = ?`,
        [characterName, dataJson, gameId, userId],
        function(err) {
          if (err) reject(err);
          else if (this.changes === 0) {
            // No existing sheet, create new one
            CharacterSheet.create(gameId, userId, 'dnd5e', characterName, characterData)
              .then(resolve)
              .catch(reject);
          } else {
            resolve({ gameId, userId, characterName, characterData });
          }
        }
      );
    });
  }

  static async delete(gameId, userId) {
    return new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM character_sheets WHERE game_id = ? AND user_id = ?`,
        [gameId, userId],
        function(err) {
          if (err) reject(err);
          else resolve({ deleted: this.changes > 0 });
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
  CharacterSheet,
  Macro
};