const jwt = require('jsonwebtoken');
const { User, Game } = require('./database');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
};

const authenticateToken = async (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1] || req.session?.token;
  
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  
  const user = await User.findById(decoded.id);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  
  req.user = user;
  next();
};

const requireRole = (role) => {
  return async (req, res, next) => {
    const gameId = req.params.gameId || req.body.gameId;
    
    if (!gameId) {
      return res.status(400).json({ error: 'Game ID required' });
    }
    
    const userRole = await Game.getUserRole(gameId, req.user.id);
    
    if (!userRole) {
      return res.status(403).json({ error: 'Not a participant in this game' });
    }
    
    if (role === 'king' && userRole !== 'king') {
      return res.status(403).json({ error: 'King permissions required' });
    }
    
    req.userRole = userRole;
    next();
  };
};

const socketAuth = async (socket, next) => {
  const token = socket.handshake.auth.token;
  
  if (!token) {
    return next(new Error('Authentication required'));
  }
  
  const decoded = verifyToken(token);
  if (!decoded) {
    return next(new Error('Invalid or expired token'));
  }
  
  const user = await User.findById(decoded.id);
  if (!user) {
    return next(new Error('User not found'));
  }
  
  socket.user = user;
  next();
};

module.exports = {
  generateToken,
  verifyToken,
  authenticateToken,
  requireRole,
  socketAuth
};