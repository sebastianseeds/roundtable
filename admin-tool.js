#!/usr/bin/env node

const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const readline = require('readline');
const path = require('path');

const dbPath = path.join(__dirname, 'roundtable.db');
const db = new sqlite3.Database(dbPath);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function listUsers() {
  console.log('\n📋 All Registered Users:\n');
  db.all(`
    SELECT id, username, email, is_dev, 
           datetime(created_at, 'localtime') as created 
    FROM users 
    ORDER BY id
  `, (err, rows) => {
    if (err) {
      console.error('Error:', err);
      return;
    }
    
    console.table(rows.map(r => ({
      ID: r.id,
      Username: r.username,
      Email: r.email,
      Role: r.is_dev ? '👑 DEVELOPER' : 'Regular User',
      Created: r.created
    })));
    
    mainMenu();
  });
}

async function resetPassword() {
  const username = await prompt('\n🔑 Enter username to reset password: ');
  
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err || !user) {
      console.log('❌ User not found!');
      mainMenu();
      return;
    }
    
    console.log(`\nResetting password for: ${user.username} (${user.email})`);
    const newPassword = await prompt('Enter new password: ');
    
    if (newPassword.length < 6) {
      console.log('❌ Password must be at least 6 characters!');
      mainMenu();
      return;
    }
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, user.id], (err) => {
      if (err) {
        console.log('❌ Error updating password:', err);
      } else {
        console.log('✅ Password successfully reset!');
        console.log(`\n📝 Login credentials:`);
        console.log(`   Username: ${user.username}`);
        console.log(`   Password: ${newPassword}`);
      }
      mainMenu();
    });
  });
}

async function deleteUser() {
  const username = await prompt('\n🗑️  Enter username to DELETE: ');
  
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err || !user) {
      console.log('❌ User not found!');
      mainMenu();
      return;
    }
    
    console.log(`\n⚠️  WARNING: About to delete user:`);
    console.log(`   Username: ${user.username}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Role: ${user.is_dev ? 'DEVELOPER' : 'Regular User'}`);
    
    const confirm = await prompt('\nType "DELETE" to confirm: ');
    
    if (confirm !== 'DELETE') {
      console.log('❌ Deletion cancelled');
      mainMenu();
      return;
    }
    
    // Delete user and all their game participations
    db.serialize(() => {
      db.run('DELETE FROM game_participants WHERE user_id = ?', [user.id]);
      db.run('DELETE FROM character_sheets WHERE user_id = ?', [user.id]);
      db.run('DELETE FROM users WHERE id = ?', [user.id], (err) => {
        if (err) {
          console.log('❌ Error deleting user:', err);
        } else {
          console.log('✅ User successfully deleted!');
        }
        mainMenu();
      });
    });
  });
}

async function resetDevPassword() {
  console.log('\n🔐 Resetting DEVELOPER account password...\n');
  
  const newPassword = await prompt('Enter new password for dev account: ');
  
  if (newPassword.length < 6) {
    console.log('❌ Password must be at least 6 characters!');
    mainMenu();
    return;
  }
  
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  
  // Check if dev account exists
  db.get('SELECT * FROM users WHERE username = ?', ['dev'], async (err, user) => {
    if (!user) {
      // Create dev account if it doesn't exist
      db.run(
        'INSERT INTO users (username, email, password, is_dev) VALUES (?, ?, ?, ?)',
        ['dev', 'dev@roundtable.local', hashedPassword, 1],
        function(err) {
          if (err) {
            console.log('❌ Error creating dev account:', err);
          } else {
            console.log('✅ Dev account created successfully!');
            console.log(`\n📝 Developer login credentials:`);
            console.log(`   Username: dev`);
            console.log(`   Password: ${newPassword}`);
          }
          mainMenu();
        }
      );
    } else {
      // Update existing dev account
      db.run('UPDATE users SET password = ?, is_dev = 1 WHERE username = ?', 
        [hashedPassword, 'dev'], 
        (err) => {
          if (err) {
            console.log('❌ Error updating password:', err);
          } else {
            console.log('✅ Dev password successfully reset!');
            console.log(`\n📝 Developer login credentials:`);
            console.log(`   Username: dev`);
            console.log(`   Password: ${newPassword}`);
          }
          mainMenu();
        }
      );
    }
  });
}

async function promoteToAdmin() {
  const username = await prompt('\n👑 Enter username to promote to DEVELOPER: ');
  
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err || !user) {
      console.log('❌ User not found!');
      mainMenu();
      return;
    }
    
    if (user.is_dev) {
      console.log('ℹ️  User is already a developer!');
      mainMenu();
      return;
    }
    
    db.run('UPDATE users SET is_dev = 1 WHERE id = ?', [user.id], (err) => {
      if (err) {
        console.log('❌ Error promoting user:', err);
      } else {
        console.log(`✅ ${user.username} is now a DEVELOPER!`);
      }
      mainMenu();
    });
  });
}

async function demoteFromAdmin() {
  const username = await prompt('\n⬇️  Enter username to demote from DEVELOPER: ');
  
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err || !user) {
      console.log('❌ User not found!');
      mainMenu();
      return;
    }
    
    if (!user.is_dev) {
      console.log('ℹ️  User is already a regular user!');
      mainMenu();
      return;
    }
    
    db.run('UPDATE users SET is_dev = 0 WHERE id = ?', [user.id], (err) => {
      if (err) {
        console.log('❌ Error demoting user:', err);
      } else {
        console.log(`✅ ${user.username} is now a regular user`);
      }
      mainMenu();
    });
  });
}

async function mainMenu() {
  console.log('\n========================================');
  console.log('   🎲 ROUND TABLE ADMIN TOOL 🎲');
  console.log('========================================\n');
  console.log('1. List all users');
  console.log('2. Reset user password');
  console.log('3. Delete user');
  console.log('4. Reset/Create dev account password');
  console.log('5. Promote user to developer');
  console.log('6. Demote user from developer');
  console.log('0. Exit\n');
  
  const choice = await prompt('Choose an option: ');
  
  switch(choice) {
    case '1':
      await listUsers();
      break;
    case '2':
      await resetPassword();
      break;
    case '3':
      await deleteUser();
      break;
    case '4':
      await resetDevPassword();
      break;
    case '5':
      await promoteToAdmin();
      break;
    case '6':
      await demoteFromAdmin();
      break;
    case '0':
      console.log('\n👋 Goodbye!\n');
      process.exit(0);
    default:
      console.log('❌ Invalid option');
      mainMenu();
  }
}

// Start the tool
console.clear();
mainMenu();