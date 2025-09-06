# Round Table - Online D&D Platform

A real-time collaborative platform for playing Dungeons & Dragons online with shared maps, tokens, and interactive tools.

## Features

### Current Features
- **Real-time Shared Map** - Upload and share battle maps with all players
- **Token System** - Place and move character/monster tokens on the map
- **Grid Overlay** - Adjustable grid for tactical combat
- **Multi-room Support** - Create separate rooms for different game sessions
- **Responsive Design** - Works on desktop and tablet devices

### Planned Features
- Voice/video chat integration
- Dice rolling system with 3D animations
- Character sheets and stat tracking
- Initiative tracker
- Fog of war/vision system
- Drawing tools for DMs
- Campaign management
- Rules reference and lookup
- Custom scripts and automation

## Quick Start

### Prerequisites
- Node.js 14.0.0 or higher
- npm 6.0.0 or higher

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/round_table.git
cd round_table
```

2. Run the setup script:
```bash
./setup.sh
```

Or manually install:
```bash
npm install
```

3. Configure environment (optional):
```bash
cp .env.example .env
# Edit .env with your settings
```

4. Start the server:
```bash
npm start
```

5. Open your browser to `http://localhost:3000`

## Usage

### Creating a Game Session

1. Open the application in your browser
2. Enter a unique Room ID (e.g., "my-awesome-campaign")
3. Click "Join Room"
4. Share the Room ID with your players

### Uploading a Map

1. Click "Choose File" under Map Controls
2. Select an image file (JPG, PNG, etc.)
3. The map will automatically sync to all players in the room

### Managing Tokens

- **Add Token**: Click "Add Token" button or use the Token tool
- **Move Token**: Select tool and drag tokens around the map
- **Remove Token**: Click "Remove" next to the token in the list
- **Pan Map**: Use the Pan tool to navigate large maps

### Grid Settings

- Toggle grid visibility with the checkbox
- Adjust grid size with the slider (20-100 pixels)
- Grid settings sync across all players

## Development

### Project Structure
```
round_table/
├── server.js           # Express/Socket.io server
├── public/
│   ├── index.html     # Main HTML structure
│   ├── styles.css     # Application styles
│   └── app.js         # Client-side JavaScript
├── package.json       # Dependencies and scripts
├── setup.sh          # Installation script
└── README.md         # This file
```

### Running in Development Mode
```bash
npm run dev
```
This uses nodemon for auto-reloading during development.

### Technology Stack
- **Backend**: Node.js, Express, Socket.io
- **Frontend**: Vanilla JavaScript, HTML5 Canvas
- **Real-time**: WebSockets via Socket.io

## Docker Support

Build and run with Docker:
```bash
docker build -t round-table .
docker run -p 3000:3000 round-table
```

Or use Docker Compose:
```bash
docker-compose up
```

## Configuration

Environment variables (create `.env` file):
```
PORT=3000                 # Server port
NODE_ENV=production      # Environment (development/production)
MAX_ROOMS=100           # Maximum concurrent rooms
MAX_PLAYERS_PER_ROOM=10 # Maximum players per room
```

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Troubleshooting

### Port Already in Use
```bash
# Find process using port 3000
lsof -i :3000
# Kill the process
kill -9 <PID>
```

### Connection Issues
- Check firewall settings
- Ensure port 3000 is accessible
- Verify all players are using the same Room ID

### Performance Issues
- Reduce map image size (recommend < 5MB)
- Lower grid size for better performance
- Use Chrome/Firefox for best performance

## License

MIT License - see LICENSE file for details

## Acknowledgments

- Built for the D&D community
- Inspired by platforms like Roll20 and Foundry VTT
- Thanks to all contributors and testers

## Support

For issues, questions, or suggestions:
- Open an issue on GitHub
- Contact: your-email@example.com

---

**Happy Gaming! May your rolls be ever in your favor!**