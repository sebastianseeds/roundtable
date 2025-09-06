class DnDMap {
    constructor() {
        this.canvas = document.getElementById('mapCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.socket = null;
        
        this.token = localStorage.getItem('token');
        this.user = null;
        this.gameId = sessionStorage.getItem('currentGame');
        this.gameInfo = null;
        this.userRole = null;
        this.participants = [];
        
        this.mapImage = null;
        this.tokens = [];
        this.selectedToken = null;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        
        this.showGrid = true;
        this.gridSize = 50;
        this.gridType = 'square';
        this.mapWidth = 500; // in feet
        this.mapHeight = 500; // in feet
        this.isPanning = false;
        this.spacePressed = false;
        
        this.panStart = null;
        this.viewOffset = { x: 0, y: 0 };
        this.zoom = 1.0;
        this.minZoom = 0.25;
        this.maxZoom = 4.0;
        
        this.tokenCounter = 0;
        
        if (!this.token || !this.gameId) {
            window.location.href = '/login.html';
            return;
        }
        
        this.init();
    }
    
    async init() {
        await this.loadGameInfo();
        this.setupCanvas();
        this.setupSocketConnection();
        this.setupEventListeners();
        this.applyRoleRestrictions();
        this.calculateGridSize();
        this.render();
    }
    
    calculateGridSize() {
        // Calculate grid size based on map dimensions
        // Each grid cell represents 5 feet in D&D
        const cellsWidth = this.mapWidth / 5;
        const cellsHeight = this.mapHeight / 5;
        
        // Calculate grid size to fit the map within the canvas
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;
        
        const gridSizeX = canvasWidth / cellsWidth;
        const gridSizeY = canvasHeight / cellsHeight;
        
        // Use the smaller dimension to ensure entire grid fits
        this.gridSize = Math.min(gridSizeX, gridSizeY);
        
        // Ensure minimum grid size for usability
        this.gridSize = Math.max(this.gridSize, 20);
    }
    
    async loadGameInfo() {
        try {
            const response = await fetch(`/api/games/${this.gameId}`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.gameInfo = data.game;
                this.userRole = data.userRole;
                this.participants = data.participants;
                this.tokens = data.state.tokens || [];
                this.mapWidth = data.state.map_width || 500;
                this.mapHeight = data.state.map_height || 500;
                this.gridType = this.gameInfo.grid_type || 'square';
                
                // Set the HTML input values
                document.getElementById('mapWidth').value = this.mapWidth;
                document.getElementById('mapHeight').value = this.mapHeight;
                
                // Get current user info from token
                const userResponse = await fetch('/api/user', {
                    headers: {
                        'Authorization': `Bearer ${this.token}`
                    }
                });
                if (userResponse.ok) {
                    const userData = await userResponse.json();
                    this.user = userData.user;
                    }
                
                document.getElementById('gameName').textContent = this.gameInfo.name;
                document.getElementById('userRole').textContent = this.userRole === 'king' ? '👑 Monarch' : '⚔️ Knight';
                document.getElementById('userRole').className = `user-role ${this.userRole}`;
                
                // Set join code for Monarchs only
                if (this.userRole === 'king') {
                    const joinCodeElement = document.getElementById('joinCode');
                    if (joinCodeElement) {
                        joinCodeElement.textContent = this.gameId;
                        // Add click to copy functionality
                        joinCodeElement.addEventListener('click', () => {
                            navigator.clipboard.writeText(this.gameId).then(() => {
                                const originalText = joinCodeElement.textContent;
                                joinCodeElement.textContent = 'Copied!';
                                joinCodeElement.style.color = '#4ecdc4';
                                setTimeout(() => {
                                    joinCodeElement.textContent = originalText;
                                    joinCodeElement.style.color = '#4ecdc4';
                                }, 1500);
                            }).catch(() => {
                                // Fallback for older browsers
                                const textArea = document.createElement('textarea');
                                textArea.value = this.gameId;
                                document.body.appendChild(textArea);
                                textArea.select();
                                document.execCommand('copy');
                                document.body.removeChild(textArea);
                                alert('Join code copied to clipboard!');
                            });
                        });
                    }
                }
                
                if (data.state.map_image) {
                    const img = new Image();
                    img.onload = () => {
                        this.mapImage = img;
                        this.render();
                    };
                    img.src = data.state.map_image;
                }
                
                this.updatePlayersList();
                this.updateGridControls();
                document.getElementById('authCheck').style.display = 'none';
                document.getElementById('app').style.display = 'flex';
            } else {
                alert('Failed to load game');
                window.location.href = '/games.html';
            }
        } catch (err) {
            console.error('Failed to load game:', err);
            window.location.href = '/games.html';
        }
    }
    
    applyRoleRestrictions() {
        if (this.userRole === 'knight') {
            document.body.classList.add('knight');
        } else {
            document.body.classList.add('king');
        }
    }
    
    setupCanvas() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }
    
    resizeCanvas() {
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
        this.render();
    }
    
    setupSocketConnection() {
        this.socket = io({
            auth: {
                token: this.token
            }
        });
        
        this.socket.on('connect', () => {
            document.getElementById('connectionStatus').textContent = 'Connected';
            document.getElementById('connectionStatus').className = 'status connected';
            this.socket.emit('join-game', this.gameId);
        });
        
        this.socket.on('disconnect', () => {
            document.getElementById('connectionStatus').textContent = 'Disconnected';
            document.getElementById('connectionStatus').className = 'status disconnected';
        });
        
        this.socket.on('error', (message) => {
            alert(message);
        });
        
        this.socket.on('game-state', (state) => {
            if (state.map_image) {
                const img = new Image();
                img.onload = () => {
                    this.mapImage = img;
                    this.render();
                };
                img.src = state.map_image;
            }
            
            this.tokens = state.tokens || [];
            this.mapWidth = state.map_width || 500;
            this.mapHeight = state.map_height || 500;
            document.getElementById('mapWidth').value = this.mapWidth;
            document.getElementById('mapHeight').value = this.mapHeight;
            this.calculateGridSize();
            this.updateTokenList();
            this.updateGridControls();
            this.render();
        });
        
        this.socket.on('user-joined', (data) => {
            this.loadParticipants();
        });
        
        this.socket.on('user-left', (data) => {
            this.loadParticipants();
        });
        
        this.socket.on('map-updated', (mapData) => {
            const img = new Image();
            img.onload = () => {
                this.mapImage = img;
                this.render();
            };
            img.src = mapData;
        });
        
        this.socket.on('token-updated', (token) => {
            const existingIndex = this.tokens.findIndex(t => t.id === token.id);
            if (existingIndex !== -1) {
                this.tokens[existingIndex] = token;
            } else {
                this.tokens.push(token);
            }
            this.updateTokenList();
            this.render();
        });
        
        this.socket.on('token-removed', (tokenId) => {
            this.tokens = this.tokens.filter(t => t.id !== tokenId);
            this.updateTokenList();
            this.render();
        });
        
        this.socket.on('map-dimensions-updated', (dimensions) => {
            this.mapWidth = dimensions.mapWidth;
            this.mapHeight = dimensions.mapHeight;
            document.getElementById('mapWidth').value = this.mapWidth;
            document.getElementById('mapHeight').value = this.mapHeight;
            this.calculateGridSize();
            this.render();
        });
    }
    
    async loadParticipants() {
        try {
            const response = await fetch(`/api/games/${this.gameId}`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.participants = data.participants;
                this.updatePlayersList();
            }
        } catch (err) {
            console.error('Failed to load participants:', err);
        }
    }
    
    updatePlayersList() {
        const playersList = document.getElementById('playersList');
        playersList.innerHTML = this.participants.map(p => `
            <div class="player-item">
                <span class="player-name">${p.username}</span>
                <span class="player-role ${p.role}">${p.role === 'king' ? '👑 Monarch' : '⚔️ Knight'}</span>
            </div>
        `).join('');
    }
    
    updateGridControls() {
        const gridToggle = document.getElementById('gridToggle');
        const mapDimensionControls = document.querySelectorAll('.control-group:has(#mapWidth), .control-group:has(#mapHeight)');
        
        if (this.gridType === 'continuous') {
            gridToggle.checked = false;
            gridToggle.disabled = true;
            this.showGrid = false;
            mapDimensionControls.forEach(control => control.style.opacity = '0.5');
        } else {
            gridToggle.disabled = false;
            mapDimensionControls.forEach(control => control.style.opacity = '1');
        }
    }
    
    setupEventListeners() {
        document.getElementById('backToGames').addEventListener('click', () => {
            window.location.href = '/games.html';
        });
        
        document.getElementById('mapUpload').addEventListener('change', (e) => {
            if (this.userRole !== 'king') {
                alert('Only the Monarch can upload maps');
                e.target.value = '';
                return;
            }
            
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                        this.mapImage = img;
                        this.render();
                        
                        if (!this.socket || !this.socket.connected) {
                            alert('Connection lost. Please refresh and try again.');
                            return;
                        }
                        
                        this.socket.emit('update-map', {
                            gameId: this.gameId,
                            mapImage: event.target.result
                        });
                    };
                    img.src = event.target.result;
                };
                reader.readAsDataURL(file);
            }
        });
        
        document.getElementById('gridToggle').addEventListener('change', (e) => {
            this.showGrid = e.target.checked;
            this.render();
        });
        
        document.getElementById('mapWidth').addEventListener('input', (e) => {
            this.mapWidth = parseInt(e.target.value);
            this.calculateGridSize();
            this.render();
            if (this.userRole === 'king') {
                this.socket.emit('update-map-dimensions', {
                    gameId: this.gameId,
                    mapWidth: this.mapWidth,
                    mapHeight: this.mapHeight
                });
            }
        });
        
        document.getElementById('mapHeight').addEventListener('input', (e) => {
            this.mapHeight = parseInt(e.target.value);
            this.calculateGridSize();
            this.render();
            if (this.userRole === 'king') {
                this.socket.emit('update-map-dimensions', {
                    gameId: this.gameId,
                    mapWidth: this.mapWidth,
                    mapHeight: this.mapHeight
                });
            }
        });
        
        document.getElementById('addPlayerToken').addEventListener('click', () => {
            const centerX = (this.canvas.width / 2 - this.viewOffset.x) / this.zoom;
            const centerY = (this.canvas.height / 2 - this.viewOffset.y) / this.zoom;
            const snapped = this.snapToGrid(centerX, centerY);
            
            const token = {
                id: `token-${Date.now()}-${this.tokenCounter++}`,
                x: snapped.x,
                y: snapped.y,
                color: this.getRandomColor(),
                label: `P${this.tokenCounter}`,
                type: 'player',
                owner: this.user?.username || 'Unknown'
            };
            this.tokens.push(token);
            this.updateTokenList();
            this.render();
            this.socket.emit('update-token', {
                gameId: this.gameId,
                token: token
            });
        });
        
        const addMonsterBtn = document.getElementById('addMonsterToken');
        if (addMonsterBtn) {
            addMonsterBtn.addEventListener('click', () => {
                if (this.userRole !== 'king') return;
                
                const centerX = (this.canvas.width / 2 - this.viewOffset.x) / this.zoom;
                const centerY = (this.canvas.height / 2 - this.viewOffset.y) / this.zoom;
                const snapped = this.snapToGrid(centerX, centerY);
                
                const token = {
                    id: `token-${Date.now()}-${this.tokenCounter++}`,
                    x: snapped.x,
                    y: snapped.y,
                    color: '#c9302c',
                    label: `M${this.tokenCounter}`,
                    type: 'monster',
                    owner: 'DM'
                };
                this.tokens.push(token);
                this.updateTokenList();
                this.render();
                this.socket.emit('update-token', {
                    gameId: this.gameId,
                    token: token
                });
            });
        }
        
        document.getElementById('clearTokens').addEventListener('click', () => {
            if (this.userRole !== 'king') return;
            
            const tokensToRemove = [...this.tokens];
            this.tokens = [];
            this.updateTokenList();
            this.render();
            tokensToRemove.forEach(token => {
                this.socket.emit('remove-token', {
                    gameId: this.gameId,
                    tokenId: token.id
                });
            });
        });
        
        
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // Disable right-click menu
        this.canvas.addEventListener('dblclick', (e) => this.handleDoubleClick(e));
        
        // Keyboard events
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        document.addEventListener('keyup', (e) => this.handleKeyUp(e));
    }
    
    canMoveToken(token) {
        if (this.userRole === 'king') return true;
        if (token.type === 'monster') return false;
        return true;
    }
    
    snapToGrid(x, y) {
        if (this.gridType === 'continuous') {
            return { x, y };
        }
        
        if (this.gridType === 'square') {
            return {
                x: Math.round(x / this.gridSize) * this.gridSize,
                y: Math.round(y / this.gridSize) * this.gridSize
            };
        }
        
        if (this.gridType === 'hexagon') {
            // Fixed hexagonal grid snapping using simpler approach
            const hexSize = this.gridSize / 2;
            const hexWidth = hexSize * 1.5; // horizontal spacing between hex centers
            const hexHeight = hexSize * Math.sqrt(3); // vertical spacing between hex rows
            
            
            // Find the nearest hex column
            const col = Math.round(x / hexWidth);
            
            // Calculate row based on column offset
            const offsetY = y - (col % 2) * (hexHeight / 2);
            const row = Math.round(offsetY / hexHeight);
            
            // Calculate the actual hex center position
            const snapX = col * hexWidth;
            const snapY = row * hexHeight + (col % 2) * (hexHeight / 2);
            
            return { x: snapX, y: snapY };
        }
        
        return { x, y };
    }
    
    getMousePosition(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left - this.viewOffset.x) / this.zoom,
            y: (e.clientY - rect.top - this.viewOffset.y) / this.zoom
        };
    }

    handleMouseDown(e) {
        const mousePos = this.getMousePosition(e);
        const x = mousePos.x;
        const y = mousePos.y;
        
        // Right-click or middle-click or space+left-click for panning
        if (e.button === 2 || e.button === 1 || (e.button === 0 && this.spacePressed)) {
            this.isPanning = true;
            this.panStart = { x: e.clientX, y: e.clientY };
            this.updateCursor();
            return;
        }
        
        // Left-click for token interaction (only if space not pressed)
        if (e.button === 0 && !this.spacePressed) {
            const clickedToken = this.getTokenAt(x, y);
            if (clickedToken && this.canMoveToken(clickedToken)) {
                this.selectedToken = clickedToken;
                this.isDragging = true;
                this.dragOffset = {
                    x: x - clickedToken.x,
                    y: y - clickedToken.y
                };
                this.updateCursor();
            }
        }
    }
    
    handleMouseMove(e) {
        const mousePos = this.getMousePosition(e);
        const x = mousePos.x;
        const y = mousePos.y;
        
        // Handle token dragging
        if (this.isDragging && this.selectedToken) {
            this.selectedToken.x = x - this.dragOffset.x;
            this.selectedToken.y = y - this.dragOffset.y;
            this.render();
        }
        
        // Handle panning
        if (this.isPanning && this.panStart) {
            this.viewOffset.x += e.clientX - this.panStart.x;
            this.viewOffset.y += e.clientY - this.panStart.y;
            this.panStart = { x: e.clientX, y: e.clientY };
            this.render();
        }
    }
    
    handleMouseUp(e) {
        if (this.isDragging && this.selectedToken) {
            // Snap token to grid when dropped
            const snapped = this.snapToGrid(this.selectedToken.x, this.selectedToken.y);
            this.selectedToken.x = snapped.x;
            this.selectedToken.y = snapped.y;
            this.render();
            
            this.socket.emit('update-token', {
                gameId: this.gameId,
                token: this.selectedToken
            });
        }
        this.isDragging = false;
        this.selectedToken = null;
        this.isPanning = false;
        this.panStart = null;
        this.updateCursor();
    }
    
    handleWheel(e) {
        e.preventDefault();
        
        const mousePos = this.getMousePosition(e);
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * zoomFactor));
        
        if (newZoom !== this.zoom) {
            // Zoom towards mouse cursor
            const rect = this.canvas.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            
            // Calculate the world position before zoom
            const worldX = (mouseX - this.viewOffset.x) / this.zoom;
            const worldY = (mouseY - this.viewOffset.y) / this.zoom;
            
            this.zoom = newZoom;
            
            // Calculate new offset to keep the mouse position fixed
            this.viewOffset.x = mouseX - worldX * this.zoom;
            this.viewOffset.y = mouseY - worldY * this.zoom;
            
                this.render();
        }
    }
    
    getTokenAt(x, y) {
        for (let i = this.tokens.length - 1; i >= 0; i--) {
            const token = this.tokens[i];
            const distance = Math.sqrt(Math.pow(x - token.x, 2) + Math.pow(y - token.y, 2));
            // Scale the hit radius by zoom level
            const hitRadius = 20 / this.zoom;
            if (distance < hitRadius) {
                return token;
            }
        }
        return null;
    }
    
    isGameOwner(username) {
        if (!username || !this.gameInfo) return false;
        const participant = this.participants.find(p => p.username === username);
        return participant && participant.user_id === this.gameInfo.owner_id;
    }
    
    getOwnerOptions(currentOwner) {
        // Get list of all participants for the ownership dropdown
        const options = [];
        
        // Add all participants as options
        this.participants.forEach(participant => {
            const isSelected = currentOwner === participant.username ? 'selected' : '';
            const displayName = participant.user_id === this.gameInfo.owner_id ? 
                `👑 ${participant.username}` : participant.username;
            options.push(`<option value="${participant.username}" ${isSelected}>${displayName}</option>`);
        });
        
        // Add current owner if not in participants list (for edge cases)
        if (currentOwner && !this.participants.find(p => p.username === currentOwner)) {
            options.push(`<option value="${currentOwner}" selected>${currentOwner} (offline)</option>`);
        }
        
        return options.join('');
    }
    
    updateTokenList() {
        const tokenList = document.getElementById('tokenList');
        tokenList.innerHTML = '';
        
        if (this.tokens.length === 0) {
            tokenList.innerHTML = '<div style="color: #808080; font-style: italic; padding: 10px;">No tokens on map</div>';
            return;
        }
        
        this.tokens.forEach(token => {
            const item = document.createElement('div');
            item.className = 'token-item';
            
            // Check if user can modify this token
            const canModify = this.userRole === 'king' || (token.type === 'player' && token.owner === this.user?.username);
            const canRemove = canModify;
            
            item.innerHTML = `
                <div class="token-header">
                    <span class="token-type-badge ${token.type}">${token.type === 'player' ? '👤' : '👹'}</span>
                    <div class="token-info">
                        ${canModify ? `
                            <input type="text" class="token-name-input" value="${token.label}" 
                                   onchange="game.updateTokenProperty('${token.id}', 'label', this.value)"
                                   placeholder="Token name">
                        ` : `
                            <span class="token-name">${token.label}</span>
                        `}
                        ${this.userRole === 'king' ? `
                            <select class="token-owner-select" onchange="game.updateTokenProperty('${token.id}', 'owner', this.value)">
                                ${this.getOwnerOptions(token.owner)}
                            </select>
                        ` : `
                            <small class="token-owner ${this.isGameOwner(token.owner) ? 'game-owner' : ''}">${this.isGameOwner(token.owner) ? '👑 ' : ''}${token.owner || 'Unknown'}</small>
                        `}
                    </div>
                </div>
                
                <div class="token-controls">
                    ${canModify ? `
                        <input type="color" class="token-color-input" value="${token.color}" 
                               onchange="game.updateTokenProperty('${token.id}', 'color', this.value)"
                               title="Change color">
                    ` : `
                        <div class="token-color-display" style="background-color: ${token.color}"></div>
                    `}
                    ${canRemove ? `<button class="btn-remove" onclick="game.removeToken('${token.id}')" title="Remove token">🗑️</button>` : ''}
                </div>
            `;
            
            tokenList.appendChild(item);
        });
    }
    
    updateTokenProperty(tokenId, property, value) {
        const token = this.tokens.find(t => t.id === tokenId);
        if (!token) return;
        
        // Check permissions - Monarchs can always modify, others only their own player tokens
        const canModify = this.userRole === 'king' || (token.type === 'player' && token.owner === this.user?.username);
        
        // Special case: only Monarchs can change ownership
        if (property === 'owner' && this.userRole !== 'king') {
            alert('Only the Monarch can change token ownership');
            return;
        }
        
        if (!canModify) {
            alert('You can only modify your own player tokens');
            return;
        }
        
        // Update the token property
        token[property] = value;
        
        // If ownership changed, refresh the token list to update permissions UI
        if (property === 'owner') {
            this.updateTokenList();
        }
        
        // Re-render the map to show updated token
        this.render();
        
        // Sync with other players
        this.socket.emit('update-token', {
            gameId: this.gameId,
            token: token
        });
    }
    
    removeToken(tokenId) {
        const token = this.tokens.find(t => t.id === tokenId);
        if (!token) return;
        
        if (this.userRole !== 'king' && (token.type === 'monster' || token.owner !== this.user?.username)) {
            alert('You can only remove your own player tokens');
            return;
        }
        
        this.tokens = this.tokens.filter(t => t.id !== tokenId);
        this.updateTokenList();
        this.render();
        this.socket.emit('remove-token', {
            gameId: this.gameId,
            tokenId: tokenId
        });
    }
    
    handleKeyDown(e) {
        if (e.code === 'Space') {
            e.preventDefault();
            this.spacePressed = true;
            this.updateCursor();
        }
    }
    
    handleKeyUp(e) {
        if (e.code === 'Space') {
            this.spacePressed = false;
            // If we were panning with space, stop panning
            if (this.isPanning) {
                this.isPanning = false;
                this.panStart = null;
            }
            this.updateCursor();
        }
    }
    
    handleDoubleClick(e) {
        // Reset zoom and center view
        this.zoom = 1.0;
        this.viewOffset = { x: 0, y: 0 };
        this.render();
    }
    
    updateCursor() {
        // Set cursor based on current state
        if (this.isPanning) {
            this.canvas.style.cursor = 'grabbing';
        } else if (this.isDragging) {
            this.canvas.style.cursor = 'move';
        } else if (this.spacePressed) {
            this.canvas.style.cursor = 'grab';
        } else {
            this.canvas.style.cursor = 'default';
        }
    }
    
    getRandomColor() {
        const colors = ['#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#74b9ff', '#a29bfe'];
        return colors[Math.floor(Math.random() * colors.length)];
    }
    
    render() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.ctx.save();
        this.ctx.translate(this.viewOffset.x, this.viewOffset.y);
        this.ctx.scale(this.zoom, this.zoom);
        
        if (this.mapImage) {
            this.ctx.drawImage(this.mapImage, 0, 0);
        }
        
        if (this.showGrid) {
            this.drawGrid();
        }
        
        this.tokens.forEach((token, index) => {
            this.drawToken(token);
        });
        
        this.ctx.restore();
        
    }
    
    
    
    drawGrid() {
        const width = this.mapImage ? this.mapImage.width : this.canvas.width;
        const height = this.mapImage ? this.mapImage.height : this.canvas.height;
        
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        this.ctx.lineWidth = 1;
        
        switch (this.gridType) {
            case 'square':
                this.drawSquareGrid(width, height);
                break;
            case 'hexagon':
                this.drawHexagonGrid(width, height);
                break;
            case 'continuous':
                // No grid for continuous mode
                break;
        }
    }
    
    drawSquareGrid(width, height) {
        for (let x = 0; x <= width; x += this.gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, height);
            this.ctx.stroke();
        }
        
        for (let y = 0; y <= height; y += this.gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(width, y);
            this.ctx.stroke();
        }
    }
    
    drawHexagonGrid(width, height) {
        const hexSize = this.gridSize / 2;
        const hexWidth = hexSize * 1.5; // horizontal spacing between hex centers
        const hexHeight = hexSize * Math.sqrt(3); // vertical spacing between hex rows
        
        
        // Calculate how many columns and rows we need with margins
        const colsNeeded = Math.ceil(width / hexWidth) + 3;
        const rowsNeeded = Math.ceil(height / hexHeight) + 3;
        
        let hexCount = 0;
        
        // Draw hexagons using the same coordinate system as snapping
        for (let col = -2; col <= colsNeeded; col++) {
            for (let row = -2; row <= rowsNeeded; row++) {
                const x = col * hexWidth;
                const y = row * hexHeight + (col % 2) * (hexHeight / 2);
                
                // Draw all hexes that might be visible (with generous margins)
                if (x >= -hexSize * 3 && x <= width + hexSize * 3 && 
                    y >= -hexSize * 3 && y <= height + hexSize * 3) {
                    this.drawHexagon(x, y, hexSize);
                    hexCount++;
                }
            }
        }
    }
    
    drawHexagon(centerX, centerY, size) {
        this.ctx.beginPath();
        
        for (let i = 0; i < 6; i++) {
            const angle = (i * Math.PI) / 3;
            const x = centerX + size * Math.cos(angle);
            const y = centerY + size * Math.sin(angle);
            
            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }
        }
        
        this.ctx.closePath();
        this.ctx.stroke();
    }
    
    drawToken(token) {
        this.ctx.save();
        
        // Calculate token radius to fit within grid cell
        let tokenRadius;
        if (this.gridType === 'hexagon') {
            // For hex, use radius that fits within the inscribed circle
            const hexSize = this.gridSize / 2;
            tokenRadius = hexSize * 0.7; // 70% of hex radius to leave some padding
        } else {
            // For square grid, use radius that fits within the square
            tokenRadius = (this.gridSize * 0.35); // 70% of half grid size
        }
        
        this.ctx.fillStyle = token.color;
        this.ctx.strokeStyle = token.type === 'monster' ? '#8b0000' : '#fff';
        this.ctx.lineWidth = 2;
        
        this.ctx.beginPath();
        this.ctx.arc(token.x, token.y, tokenRadius, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();
        
        // Scale font size based on token size
        const fontSize = Math.max(8, tokenRadius * 0.6);
        this.ctx.fillStyle = '#fff';
        this.ctx.font = `bold ${fontSize}px Arial`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(token.label, token.x, token.y);
        
        this.ctx.restore();
    }
}

const game = new DnDMap();