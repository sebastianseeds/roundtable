const { db, User } = require('./database.js');

async function setupDev() {
  console.log('Setting up dev environment...');
  
  try {
    // Add is_dev column if it doesn't exist
    await new Promise((resolve) => {
      db.run('ALTER TABLE users ADD COLUMN is_dev BOOLEAN DEFAULT 0', (err) => {
        if (err && !err.message.includes('duplicate column name')) {
          console.warn('Warning adding is_dev column:', err.message);
        }
        resolve();
      });
    });
    
    // Create dev user
    console.log('Creating dev user...');
    
    try {
      const devUser = await User.create('dev', 'dev@roundtable.local', 'devpass123');
      console.log('Dev user created with ID:', devUser.id);
      
      // Set as dev user
      await new Promise((resolve, reject) => {
        db.run('UPDATE users SET is_dev = 1 WHERE username = ?', ['dev'], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      console.log('✓ Dev user setup complete!');
      console.log('');
      console.log('Dev Login Credentials:');
      console.log('  Username: dev');
      console.log('  Password: devpass123');
      console.log('');
      console.log('Dev features:');
      console.log('  - Instant campaign deletion (⚡ Dev Delete button)');
      console.log('  - Additional dev tools (future)');
      
    } catch (err) {
      if (err.message.includes('UNIQUE')) {
        console.log('Dev user already exists, updating permissions...');
        await new Promise((resolve, reject) => {
          db.run('UPDATE users SET is_dev = 1 WHERE username = ?', ['dev'], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        console.log('✓ Dev permissions updated!');
      } else {
        throw err;
      }
    }
    
  } catch (err) {
    console.error('Error setting up dev environment:', err);
  }
  
  db.close();
}

setupDev();