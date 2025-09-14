require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const session = require('express-session');
const { initDatabase, User, Game, CharacterSheet, Macro } = require('./database');
const { generateToken, authenticateToken, requireRole, socketAuth } = require('./auth');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  maxHttpBufferSize: 10 * 1024 * 1024, // 10MB to allow for larger map images
  pingTimeout: 60000
});

app.use(express.static('public'));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields required' });
    }
    
    const user = await User.create(username, email, password);
    const token = generateToken(user);
    
    req.session.token = token;
    res.json({ user, token });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      res.status(400).json({ error: 'Username or email already exists' });
    } else {
      res.status(500).json({ error: 'Registration failed' });
    }
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = await User.authenticate(username, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = generateToken(user);
    req.session.token = token;
    res.json({ user, token });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Logged out successfully' });
});

app.get('/api/user', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/games', authenticateToken, async (req, res) => {
  try {
    const games = await Game.findByUser(req.user.id);
    res.json({ games });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

app.post('/api/games', authenticateToken, async (req, res) => {
  try {
    const { name, description, settings } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Game name required' });
    }
    
    const game = await Game.create(name, description, req.user.id, settings);
    res.json({ game });
  } catch (err) {
    console.error('Create game error:', err);
    res.status(500).json({ error: 'Failed to create game' });
  }
});

app.get('/api/games/:gameId', authenticateToken, async (req, res) => {
  try {
    const game = await Game.findById(req.params.gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    const userRole = await Game.getUserRole(req.params.gameId, req.user.id);
    if (!userRole) {
      return res.status(403).json({ error: 'Not authorized to view this game' });
    }
    
    const participants = await Game.getParticipants(req.params.gameId);
    const state = await Game.getState(req.params.gameId);
    
    res.json({ game, participants, state, userRole });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch game' });
  }
});

app.post('/api/games/:gameId/join', authenticateToken, async (req, res) => {
  try {
    const { gameId } = req.params;
    const { characterName } = req.body;
    
    const existing = await Game.getUserRole(gameId, req.user.id);
    if (existing) {
      return res.status(400).json({ error: 'Already in this game' });
    }
    
    await Game.addParticipant(gameId, req.user.id, 'knight', characterName);
    res.json({ message: 'Joined game successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to join game' });
  }
});

app.post('/api/games/:gameId/participants/:userId/role', 
  authenticateToken, 
  requireRole('king'), 
  async (req, res) => {
  try {
    const { gameId, userId } = req.params;
    const { role } = req.body;
    
    if (!['king', 'knight'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    
    await Game.updateParticipantRole(gameId, userId, role);
    res.json({ message: 'Role updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update role' });
  }
});

app.put('/api/games/:gameId/character-name', authenticateToken, async (req, res) => {
  try {
    const { gameId } = req.params;
    const { characterName } = req.body;
    
    if (!characterName) {
      return res.status(400).json({ error: 'Character name is required' });
    }
    
    await Game.updateCharacterName(gameId, req.user.id, characterName);
    res.json({ message: 'Character name updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update character name' });
  }
});

app.get('/api/games/:gameId/characters', authenticateToken, async (req, res) => {
  try {
    const characters = await CharacterSheet.findByUserAndGame(req.user.id, req.params.gameId);
    res.json({ characters });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch characters' });
  }
});

app.post('/api/games/:gameId/characters', authenticateToken, async (req, res) => {
  try {
    const character = await CharacterSheet.create(req.user.id, req.params.gameId, req.body);
    res.json({ character });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create character' });
  }
});

// Macro endpoints
app.get('/api/games/:gameId/macros', authenticateToken, async (req, res) => {
  try {
    const macros = await Macro.findByUserAndGame(req.user.id, req.params.gameId);
    res.json({ macros });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch macros' });
  }
});

app.post('/api/games/:gameId/macros', authenticateToken, async (req, res) => {
  try {
    const { name, formula, description } = req.body;
    
    if (!name || !formula) {
      return res.status(400).json({ error: 'Name and formula are required' });
    }
    
    const macro = await Macro.create(req.user.id, req.params.gameId, name, formula, description);
    res.json({ macro });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE constraint')) {
      res.status(400).json({ error: 'A macro with this name already exists' });
    } else {
      res.status(500).json({ error: 'Failed to create macro' });
    }
  }
});

app.delete('/api/games/:gameId/macros/:macroId', authenticateToken, async (req, res) => {
  try {
    const deleted = await Macro.delete(req.params.macroId, req.user.id);
    if (deleted) {
      res.json({ message: 'Macro deleted successfully' });
    } else {
      res.status(404).json({ error: 'Macro not found' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete macro' });
  }
});

app.put('/api/characters/:characterId', authenticateToken, async (req, res) => {
  try {
    const character = await CharacterSheet.update(req.params.characterId, req.body);
    res.json({ character });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update character' });
  }
});

app.put('/api/games/:gameId/settings', authenticateToken, async (req, res) => {
  try {
    const { gameId } = req.params;
    const game = await Game.findById(gameId);
    
    if (!game || game.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the campaign owner can update settings' });
    }
    
    await Game.updateSettings(gameId, req.user.id, req.body);
    res.json({ message: 'Settings updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

app.post('/api/games/:gameId/grail/assign/:userId', 
  authenticateToken, 
  requireRole('king'), 
  async (req, res) => {
  try {
    const { gameId, userId } = req.params;
    
    const game = await Game.findById(gameId);
    if (!game || game.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the Monarch can assign the grail' });
    }
    
    await Game.assignGrail(gameId, userId, req.user.id);
    res.json({ message: 'Grail assigned successfully' });
  } catch (err) {
    console.error('Failed to assign grail:', err);
    res.status(500).json({ error: 'Failed to assign grail' });
  }
});

app.post('/api/games/:gameId/grail/remove/:userId', 
  authenticateToken, 
  requireRole('king'), 
  async (req, res) => {
  try {
    const { gameId, userId } = req.params;
    
    const game = await Game.findById(gameId);
    if (!game || game.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the Monarch can remove the grail' });
    }
    
    await Game.removeGrail(gameId, userId, req.user.id);
    res.json({ message: 'Grail removed successfully' });
  } catch (err) {
    console.error('Failed to remove grail:', err);
    res.status(500).json({ error: 'Failed to remove grail' });
  }
});

app.post('/api/games/:gameId/grail/modifiers', 
  authenticateToken, 
  requireRole('king'), 
  async (req, res) => {
  try {
    const { gameId } = req.params;
    const { rollModifiers, damageModifiers, customMessage } = req.body;
    
    const game = await Game.findById(gameId);
    if (!game || game.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the Monarch can set grail modifiers' });
    }
    
    const modifiers = {
      rollModifiers: rollModifiers || [],
      damageModifiers: damageModifiers || [],
      customMessage: customMessage || ''
    };
    
    await Game.updateState(gameId, 'grail_modifiers', JSON.stringify(modifiers));
    res.json({ message: 'Grail modifiers updated successfully', modifiers });
  } catch (err) {
    console.error('Failed to update grail modifiers:', err);
    res.status(500).json({ error: 'Failed to update grail modifiers' });
  }
});

app.get('/api/games/:gameId/grail/modifiers', 
  authenticateToken, 
  async (req, res) => {
  try {
    const { gameId } = req.params;
    
    const game = await Game.findById(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    // Allow access if user is the monarch OR if user has the grail
    const isMonarch = game.owner_id === req.user.id;
    const participants = await Game.getParticipants(gameId);
    const participant = participants.find(p => p.id === req.user.id);
    const hasGrail = participant?.has_grail;
    
    if (!isMonarch && !hasGrail) {
      return res.status(403).json({ error: 'Only the Monarch or grail holder can view grail modifiers' });
    }
    
    const state = await Game.getState(gameId);
    const modifiers = state.grail_modifiers ? JSON.parse(state.grail_modifiers) : {
      rollModifiers: [],
      damageModifiers: [],
      customMessage: ''
    };
    
    res.json({ modifiers });
  } catch (err) {
    console.error('Failed to get grail modifiers:', err);
    res.status(500).json({ error: 'Failed to get grail modifiers' });
  }
});

// Character Sheet endpoints
app.get('/api/games/:gameId/character-sheet', authenticateToken, async (req, res) => {
  try {
    const { gameId } = req.params;
    
    // Verify the user is part of this game
    const game = await Game.findById(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    const participants = await Game.getParticipants(gameId);
    const participant = participants.find(p => p.id === req.user.id);
    const isMonarch = game.owner_id === req.user.id;
    
    if (!participant && !isMonarch) {
      return res.status(403).json({ error: 'You are not part of this game' });
    }
    
    // Get character sheet for this user in this game
    const characterSheet = await CharacterSheet.findByGameAndUser(gameId, req.user.id);
    
    res.json({ characterSheet });
  } catch (err) {
    console.error('Failed to get character sheet:', err);
    res.status(500).json({ error: 'Failed to get character sheet' });
  }
});

app.post('/api/games/:gameId/character-sheet', authenticateToken, async (req, res) => {
  try {
    const { gameId } = req.params;
    const { characterName, characterData } = req.body;
    
    // Verify the user is part of this game
    const game = await Game.findById(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    const participants = await Game.getParticipants(gameId);
    const participant = participants.find(p => p.id === req.user.id);
    const isMonarch = game.owner_id === req.user.id;
    
    if (!participant && !isMonarch) {
      return res.status(403).json({ error: 'You are not part of this game' });
    }
    
    // Save or update character sheet
    await CharacterSheet.update(gameId, req.user.id, characterName, characterData);
    
    res.json({ message: 'Character sheet saved successfully' });
  } catch (err) {
    console.error('Failed to save character sheet:', err);
    res.status(500).json({ error: 'Failed to save character sheet' });
  }
});

app.get('/api/games/:gameId/all-character-sheets', authenticateToken, async (req, res) => {
  try {
    const { gameId } = req.params;
    
    // Verify the user is the game owner (DM/Monarch)
    const game = await Game.findById(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    
    if (game.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the game owner can view all character sheets' });
    }
    
    // Get all character sheets for this game
    const characterSheets = await CharacterSheet.findAllByGame(gameId);
    
    res.json({ characterSheets });
  } catch (err) {
    console.error('Failed to get all character sheets:', err);
    res.status(500).json({ error: 'Failed to get all character sheets' });
  }
});

app.post('/api/games/:gameId/request-deletion', authenticateToken, async (req, res) => {
  try {
    const { gameId } = req.params;
    const game = await Game.findById(gameId);
    
    if (!game || game.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the campaign owner can request deletion' });
    }
    
    await Game.requestDeletion(gameId, req.user.id);
    res.json({ message: 'Deletion requested. You have 7 days to cancel or confirm.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to request deletion' });
  }
});

app.post('/api/games/:gameId/cancel-deletion', authenticateToken, async (req, res) => {
  try {
    const { gameId } = req.params;
    const game = await Game.findById(gameId);
    
    if (!game || game.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the campaign owner can cancel deletion' });
    }
    
    await Game.cancelDeletion(gameId, req.user.id);
    res.json({ message: 'Deletion request cancelled' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel deletion' });
  }
});

app.delete('/api/games/:gameId/confirm-deletion', authenticateToken, async (req, res) => {
  try {
    const { gameId } = req.params;
    const { confirmationText } = req.body;
    
    if (confirmationText !== 'DELETE MY CAMPAIGN PERMANENTLY') {
      return res.status(400).json({ error: 'Confirmation text does not match' });
    }
    
    const game = await Game.findById(gameId);
    
    if (!game || game.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the campaign owner can delete the campaign' });
    }
    
    const deleted = await Game.permanentDelete(gameId, req.user.id);
    
    if (deleted) {
      res.json({ message: 'Campaign permanently deleted' });
    } else {
      res.status(400).json({ error: 'Campaign deletion failed. Make sure deletion was requested first.' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

app.delete('/api/games/:gameId/dev-delete', authenticateToken, async (req, res) => {
  try {
    const { gameId } = req.params;
    
    if (!req.user.is_dev) {
      return res.status(403).json({ error: 'Dev access required' });
    }
    
    const game = await Game.findById(gameId);
    
    if (!game || game.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the campaign owner can delete the campaign' });
    }
    
    const deleted = await Game.devDelete(gameId, req.user.id);
    
    if (deleted) {
      res.json({ message: 'Campaign instantly deleted (dev mode)' });
    } else {
      res.status(400).json({ error: 'Campaign deletion failed' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

io.use(socketAuth);

io.on('connection', (socket) => {
  console.log('User connected:', socket.user.username);
  
  // Debug: Log all events received by this socket
  const originalOn = socket.on.bind(socket);
  socket.on = function(event, handler) {
    if (event !== 'disconnect' && event !== 'disconnecting') {
      const wrappedHandler = function(...args) {
        console.log(`🎯 Socket event received: '${event}' from ${socket.user?.username}`);
        return handler.apply(this, args);
      };
      return originalOn(event, wrappedHandler);
    }
    return originalOn(event, handler);
  };

  socket.on('join-game', async (gameId) => {
    const userRole = await Game.getUserRole(gameId, socket.user.id);
    
    if (!userRole) {
      socket.emit('error', 'Not authorized for this game');
      return;
    }
    
    socket.join(gameId);
    socket.gameId = gameId;
    socket.userRole = userRole;
    
    await Game.updateLastPlayed(gameId);
    
    const state = await Game.getState(gameId);
    console.log(`📤 Sending game-state to ${socket.user.username}:`, {
      gameId: gameId,
      hasMapImage: !!state?.map_image,
      mapImageLength: state?.map_image?.length || 0,
      tokensCount: state?.tokens?.length || 0,
      mapWidth: state?.map_width,
      mapHeight: state?.map_height
    });
    
    socket.emit('game-state', state);
    
    socket.to(gameId).emit('user-joined', {
      username: socket.user.username,
      role: userRole
    });
    
    console.log(`${socket.user.username} joined game ${gameId} as ${userRole}`);
  });

  console.log(`🔧 Registering map upload handler for user ${socket.user.username}`);
  
  socket.on('update-map', async ({ gameId, mapImage }) => {
    if (socket.userRole !== 'king') {
      socket.emit('error', 'Only Kings can update the map');
      return;
    }
    
    console.log(`Received map update for game ${gameId}, image size: ${mapImage?.length || 0} chars`);
    
    try {
      await Game.updateState(gameId, 'map_image', mapImage);
      socket.to(gameId).emit('map-updated', mapImage);
      console.log(`Map successfully updated for game ${gameId}`);
    } catch (error) {
      console.error(`Failed to update map for game ${gameId}:`, error);
      socket.emit('error', 'Failed to save map');
    }
  });

  socket.on('update-token', async ({ gameId, token }) => {
    const state = await Game.getState(gameId);
    const tokens = state.tokens || [];
    
    if (socket.userRole === 'knight' && token.type === 'monster') {
      socket.emit('error', 'Knights cannot move monster tokens');
      return;
    }
    
    const existingIndex = tokens.findIndex(t => t.id === token.id);
    if (existingIndex !== -1) {
      tokens[existingIndex] = token;
    } else {
      tokens.push(token);
    }
    
    await Game.updateState(gameId, 'tokens', tokens);
    socket.to(gameId).emit('token-updated', token);
  });

  socket.on('remove-token', async ({ gameId, tokenId }) => {
    if (socket.userRole !== 'king') {
      socket.emit('error', 'Only Kings can remove tokens');
      return;
    }
    
    const state = await Game.getState(gameId);
    const tokens = (state.tokens || []).filter(t => t.id !== tokenId);
    
    await Game.updateState(gameId, 'tokens', tokens);
    socket.to(gameId).emit('token-removed', tokenId);
  });

  socket.on('update-map-dimensions', async ({ gameId, mapWidth, mapHeight }) => {
    if (socket.userRole !== 'king') {
      socket.emit('error', 'Only Kings can update map dimensions');
      return;
    }
    
    await Game.updateState(gameId, 'map_width', mapWidth);
    await Game.updateState(gameId, 'map_height', mapHeight);
    socket.to(gameId).emit('map-dimensions-updated', { mapWidth, mapHeight });
  });
  
  socket.on('grail-updated', ({ gameId }) => {
    if (socket.userRole !== 'king') {
      socket.emit('error', 'Only Monarchs can update grail assignments');
      return;
    }
    
    socket.to(gameId).emit('grail-updated');
  });
  
  socket.on('roll', async (rollData) => {
    // Get the character name for this user
    const participants = await Game.getParticipants(rollData.gameId);
    const participant = participants.find(p => p.id === socket.user.id);
    const characterName = participant?.character_name || socket.user.username;
    
    // Add character name to roll data
    const rollWithCharacterName = {
      ...rollData,
      characterName: characterName
    };
    
    // Broadcast roll to all players in the game
    io.to(rollData.gameId).emit('roll-result', rollWithCharacterName);
  });
  
  socket.on('chat', async ({ gameId, content }) => {
    // Get the character name for this user
    const participants = await Game.getParticipants(gameId);
    const participant = participants.find(p => p.id === socket.user.id);
    const characterName = participant?.character_name || socket.user.username;
    
    const message = {
      sender: characterName,
      senderRole: socket.userRole,
      content: content,
      timestamp: new Date().toISOString(),
      type: 'public'
    };
    
    io.to(gameId).emit('chat-message', message);
  });
  
  socket.on('whisper', async ({ gameId, target, content }) => {
    // Find the target user's socket
    const participants = await Game.getParticipants(gameId);
    
    // Get sender's character name
    const sender = participants.find(p => p.id === socket.user.id);
    const senderCharacterName = sender?.character_name || socket.user.username;
    
    // Check for special aliases
    let targetUser;
    const targetLower = target.toLowerCase();
    if (targetLower === 'dm' || targetLower === 'monarch') {
      // Find the monarch
      targetUser = participants.find(p => p.role === 'king');
      if (!targetUser) {
        socket.emit('chat-message', {
          type: 'system',
          content: 'No Monarch found in this game'
        });
        return;
      }
    } else {
      // Try to find by character name first, then by username
      targetUser = participants.find(p => 
        (p.character_name && p.character_name.toLowerCase() === target.toLowerCase()) || 
        p.username.toLowerCase() === target.toLowerCase()
      );
    }
    
    if (!targetUser) {
      socket.emit('chat-message', {
        type: 'system',
        content: `User '${target}' not found in this game`
      });
      return;
    }
    
    // Find target's socket ID
    const targetSocket = [...io.sockets.sockets.values()].find(
      s => s.user && s.user.id === targetUser.id && s.gameId === gameId
    );
    
    if (!targetSocket) {
      socket.emit('chat-message', {
        type: 'system',
        content: `${target} is not online`
      });
      return;
    }
    
    const targetCharacterName = targetUser.character_name || targetUser.username;
    
    const whisperMessage = {
      sender: senderCharacterName,
      senderRole: socket.userRole,
      target: targetCharacterName,
      content: content,
      timestamp: new Date().toISOString()
    };
    
    targetSocket.emit('whisper-message', whisperMessage);
  });

  socket.on('disconnect', () => {
    if (socket.gameId) {
      socket.to(socket.gameId).emit('user-left', {
        username: socket.user.username,
        role: socket.userRole
      });
    }
    console.log('User disconnected:', socket.user.username);
  });
});

initDatabase().then(() => {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});