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
        
        // Chat system
        this.messages = [];
        this.lastWhisperFrom = null;
        this.tabCompletionIndex = 0;
        this.tabCompletionMatches = [];
        this.tabCompletionOriginal = null;
        
        // Roll system
        this.rollHistory = [];
        this.rollMacros = {};
        
        // Token highlighting
        this.highlightedToken = null;
        this.highlightTimeout = null;
        
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
        
        // Initialize chat state
        this.chatState = 'default';
        document.querySelector('.chat-container').classList.add('default');
        
        // Load macros
        this.loadMacros();
        
        // Load grail modifiers if monarch or if user has grail
        if (this.userRole === 'king') {
            this.loadGrailModifiers();
        } else {
            // For knights, check if they have the grail after participants load
            this.checkAndLoadGrailModifiers();
        }
        
        // Initialize UI settings and load saved palette
        this.initializeUISettings();
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
            // Hide join code section for knights
            document.getElementById('joinCodeSection').style.display = 'none';
        } else {
            document.body.classList.add('king');
            // Show join code for kings
            document.getElementById('joinCodeSection').style.display = 'block';
            if (this.gameInfo && this.gameInfo.id) {
                document.getElementById('joinCode').textContent = this.gameInfo.id;
            }
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
        
        this.socket.on('grail-updated', async () => {
            console.log('🏆 Grail updated event received');
            try {
                await this.loadParticipants();
                console.log('✅ Participants loaded after grail update');
                
                // Check if current user now has or lost the grail, and load/clear modifiers accordingly
                const participant = this.participants?.find(p => p.id === this.user.id);
                const hasGrail = participant?.has_grail;
                console.log('🔍 Checking grail status after update, has grail:', hasGrail);
                
                if (hasGrail && !this.grailModifiers) {
                    console.log('🆕 User gained grail, loading modifiers...');
                    await this.loadGrailModifiers();
                } else if (!hasGrail && this.grailModifiers) {
                    console.log('📤 User lost grail, clearing modifiers...');
                    this.grailModifiers = undefined;
                }
            } catch (error) {
                console.error('❌ Error loading participants after grail update:', error);
            }
        });
        
        this.socket.on('chat-message', (data) => {
            this.addMessage(data);
        });
        
        this.socket.on('whisper-message', (data) => {
            this.addMessage({ ...data, type: 'whisper' });
            this.lastWhisperFrom = data.sender;
        });
        
        this.socket.on('roll-result', (data) => {
            this.addRollToHistory(data);
            // Also show in chat - always use character name for rolls
            this.addMessage({
                type: 'roll',
                sender: data.characterName,
                senderRole: data.senderRole,
                content: `rolled ${data.formula}: **${data.total}** ${data.breakdown}`,
                timestamp: data.timestamp
            });
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
                
                // Update current user's character name display
                const currentUserParticipant = this.participants.find(p => p.id === this.user.id);
                const characterNameDisplay = document.getElementById('characterNameDisplay');
                if (currentUserParticipant && currentUserParticipant.character_name) {
                    characterNameDisplay.textContent = currentUserParticipant.character_name;
                } else {
                    characterNameDisplay.textContent = '';
                }
            }
        } catch (err) {
            console.error('Failed to load participants:', err);
        }
    }
    
    updatePlayersList() {
        const playersList = document.getElementById('playersList');
        playersList.innerHTML = this.participants.map(p => `
            <div class="player-item" onclick="game.setWhisperTarget('${p.username}')">
                <div class="player-info">
                    <div class="player-details">
                        <span class="player-name">${p.username}${this.userRole === 'king' && p.has_grail ? ' 🏆' : ''}</span>
                        ${p.character_name ? `<span class="character-name">${p.character_name}</span>` : ''}
                    </div>
                    <span class="player-role ${p.role}">${p.role === 'king' ? '👑 Monarch' : '⚔️ Knight'}</span>
                </div>
                ${this.userRole === 'king' ? `
                    <div class="grail-controls king-only">
                        ${p.has_grail ? 
                            `<button class="btn-grail-remove" onclick="event.stopPropagation(); game.removeGrail(${p.id})">Remove Grail</button>` :
                            `<button class="btn-grail-assign" onclick="event.stopPropagation(); game.assignGrail(${p.id})">Assign Grail</button>`
                        }
                    </div>
                ` : ''}
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
        
        // Character name editing
        const characterNameDisplay = document.getElementById('characterNameDisplay');
        const characterNameInput = document.getElementById('characterNameInput');
        
        characterNameDisplay.addEventListener('click', () => {
            characterNameDisplay.style.display = 'none';
            characterNameInput.style.display = 'block';
            characterNameInput.value = characterNameDisplay.textContent || '';
            characterNameInput.focus();
            characterNameInput.select();
        });
        
        characterNameInput.addEventListener('blur', () => {
            this.saveCharacterName();
        });
        
        characterNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.saveCharacterName();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                characterNameInput.style.display = 'none';
                characterNameDisplay.style.display = 'block';
            }
        });
        
        // Join Code dropdown functionality
        this.setupJoinCodeDropdown();
        
        // Panel collapse/expand functionality
        this.setupPanelCollapseListeners();
        
        // Macro functionality
        this.setupMacroListeners();
        
        // Grail options functionality
        this.setupGrailOptionsListeners();
        
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
        
        // Chat events
        const chatInput = document.getElementById('chatInput');
        const chatSend = document.getElementById('chatSend');
        
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.sendMessage();
            } else if (e.key === 'Tab') {
                e.preventDefault();
                this.handleTabCompletion();
            }
        });
        
        // Reset tab completion on input change
        chatInput.addEventListener('input', () => {
            this.tabCompletionOriginal = null;
            this.tabCompletionMatches = [];
            this.tabCompletionIndex = 0;
        });
        
        chatSend.addEventListener('click', () => this.sendMessage());
        
        // Roll system events
        document.getElementById('clearRolls').addEventListener('click', () => {
            this.rollHistory = [];
            document.getElementById('rollHistory').innerHTML = '';
        });
        
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
            
            // Add click handler for highlighting
            item.addEventListener('click', (e) => {
                // Don't trigger highlight if clicking on interactive elements
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON') {
                    return;
                }
                this.highlightToken(token.id);
            });
            
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
        // Don't intercept space if any input field is focused
        const activeElement = document.activeElement;
        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
            return;
        }
        
        if (e.code === 'Space') {
            e.preventDefault();
            this.spacePressed = true;
            this.updateCursor();
        }
    }
    
    handleKeyUp(e) {
        // Don't intercept space if any input field is focused
        const activeElement = document.activeElement;
        if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
            return;
        }
        
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
        
        // Check if this token is highlighted
        const isHighlighted = this.highlightedToken === token.id;
        
        // Draw highlight effect
        if (isHighlighted) {
            this.ctx.shadowColor = '#ffd700';
            this.ctx.shadowBlur = 20;
            this.ctx.strokeStyle = '#ffd700';
            this.ctx.lineWidth = 4;
            
            // Draw pulsing outer ring
            this.ctx.beginPath();
            this.ctx.arc(token.x, token.y, tokenRadius + 8, 0, Math.PI * 2);
            this.ctx.stroke();
        }
        
        this.ctx.fillStyle = token.color;
        this.ctx.strokeStyle = isHighlighted ? '#ffd700' : (token.type === 'monster' ? '#8b0000' : '#fff');
        this.ctx.lineWidth = isHighlighted ? 3 : 2;
        
        this.ctx.beginPath();
        this.ctx.arc(token.x, token.y, tokenRadius, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();
        
        // Reset shadow
        this.ctx.shadowColor = 'transparent';
        this.ctx.shadowBlur = 0;
        
        // Scale font size based on token size
        const fontSize = Math.max(8, tokenRadius * 0.6);
        this.ctx.fillStyle = '#fff';
        this.ctx.font = `bold ${fontSize}px Arial`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(token.label, token.x, token.y);
        
        this.ctx.restore();
    }
    
    highlightToken(tokenId) {
        // Clear existing highlight timeout
        if (this.highlightTimeout) {
            clearTimeout(this.highlightTimeout);
        }
        
        // Set the highlighted token
        this.highlightedToken = tokenId;
        this.render();
        
        // Clear highlight after 3 seconds
        this.highlightTimeout = setTimeout(() => {
            this.highlightedToken = null;
            this.render();
        }, 3000);
    }
    
    async assignGrail(userId) {
        if (this.userRole !== 'king') {
            alert('Only the Monarch can assign the grail');
            return;
        }
        
        try {
            const response = await fetch(`/api/games/${this.gameId}/grail/assign/${userId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            if (response.ok) {
                await this.loadParticipants();
                this.socket.emit('grail-updated', { gameId: this.gameId });
            } else {
                const error = await response.json();
                alert(error.error || 'Failed to assign grail');
            }
        } catch (err) {
            console.error('Failed to assign grail:', err);
            alert('Failed to assign grail');
        }
    }
    
    async saveCharacterName() {
        const characterNameInput = document.getElementById('characterNameInput');
        const characterNameDisplay = document.getElementById('characterNameDisplay');
        const newName = characterNameInput.value.trim();
        
        if (newName && newName !== characterNameDisplay.textContent) {
            try {
                const response = await fetch(`/api/games/${this.gameId}/character-name`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.token}`
                    },
                    body: JSON.stringify({ characterName: newName })
                });
                
                if (response.ok) {
                    characterNameDisplay.textContent = newName;
                    await this.loadParticipants();
                } else {
                    const error = await response.json();
                    alert(error.error || 'Failed to update character name');
                }
            } catch (err) {
                console.error('Failed to update character name:', err);
                alert('Failed to update character name');
            }
        }
        
        characterNameInput.style.display = 'none';
        characterNameDisplay.style.display = 'block';
    }
    
    async removeGrail(userId) {
        if (this.userRole !== 'king') {
            alert('Only the Monarch can remove the grail');
            return;
        }
        
        try {
            const response = await fetch(`/api/games/${this.gameId}/grail/remove/${userId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            
            if (response.ok) {
                await this.loadParticipants();
                this.socket.emit('grail-updated', { gameId: this.gameId });
            } else {
                const error = await response.json();
                alert(error.error || 'Failed to remove grail');
            }
        } catch (err) {
            console.error('Failed to remove grail:', err);
            alert('Failed to remove grail');
        }
    }
    
    sendMessage() {
        const input = document.getElementById('chatInput');
        const message = input.value.trim();
        
        if (!message) return;
        
        // Check for mixed content (text with inline commands)
        const rollMatches = message.match(/\/roll\s+([^\/]+?)(?=\s\/|$)/gi);
        
        if (rollMatches && !message.startsWith('/')) {
            // Handle mixed content - text with inline roll commands
            let displayMessage = message;
            
            // Process each roll command found
            rollMatches.forEach(rollMatch => {
                const rollExpression = rollMatch.replace(/\/roll\s+/i, '').trim();
                if (rollExpression) {
                    // Remove the /roll command from display text and perform the roll
                    displayMessage = displayMessage.replace(rollMatch, `[Rolling ${rollExpression}]`);
                    // Extract context from the message for the roll description
                    const contextMatch = message.match(/^([^\/]*?)\/roll/);
                    const context = contextMatch ? contextMatch[1].trim() : null;
                    this.performRoll(rollExpression, context);
                }
            });
            
            // Send the narrative text to chat (without the /roll commands)
            if (displayMessage.trim()) {
                this.socket.emit('chat', {
                    gameId: this.gameId,
                    content: displayMessage
                });
            }
            
        } else if (message.startsWith('/')) {
            // Handle pure commands (existing logic)
            const parts = message.split(' ');
            const command = parts[0].toLowerCase();
            
            if (command === '/w' || command === '/whisper') {
                // Whisper format: /w username message
                if (parts.length < 3) {
                    this.addMessage({
                        type: 'system',
                        content: 'Usage: /w <username> <message>'
                    });
                    return;
                }
                
                let targetUser = parts[1];
                const whisperContent = parts.slice(2).join(' ');
                
                // Check for special aliases
                const targetLower = targetUser.toLowerCase();
                if (targetLower === 'dm' || targetLower === 'monarch') {
                    // Find the monarch in participants
                    const monarch = this.participants.find(p => p.role === 'king');
                    if (monarch) {
                        targetUser = monarch.character_name || monarch.username;
                    } else {
                        this.addMessage({
                            type: 'system',
                            content: 'No Monarch found in this game'
                        });
                        return;
                    }
                }
                
                this.socket.emit('whisper', {
                    gameId: this.gameId,
                    target: targetUser,
                    content: whisperContent
                });
                
                // Show own whisper in chat
                this.addMessage({
                    type: 'whisper',
                    sender: 'You',
                    target: targetUser,
                    content: whisperContent,
                    timestamp: new Date().toISOString()
                });
                
            } else if (command === '/roll') {
                // Dice roll
                const rollExpression = parts.slice(1).join(' ');
                if (!rollExpression) {
                    this.addMessage({
                        type: 'system',
                        content: 'Usage: /roll <dice expression> (e.g., /roll 1d20+5)'
                    });
                    return;
                }
                
                this.performRoll(rollExpression);
                
            } else if (command === '/r' || command === '/reply') {
                // Reply to last whisper
                if (!this.lastWhisperFrom) {
                    this.addMessage({
                        type: 'system',
                        content: 'No one to reply to'
                    });
                    return;
                }
                
                const replyContent = parts.slice(1).join(' ');
                if (!replyContent) {
                    this.addMessage({
                        type: 'system',
                        content: 'Usage: /r <message>'
                    });
                    return;
                }
                
                this.socket.emit('whisper', {
                    gameId: this.gameId,
                    target: this.lastWhisperFrom,
                    content: replyContent
                });
                
                // Show own whisper in chat
                this.addMessage({
                    type: 'whisper',
                    sender: 'You',
                    target: this.lastWhisperFrom,
                    content: replyContent,
                    timestamp: new Date().toISOString()
                });
                
            } else {
                this.addMessage({
                    type: 'system',
                    content: `Unknown command: ${command}`
                });
            }
        } else {
            // Regular public message (no commands)
            this.socket.emit('chat', {
                gameId: this.gameId,
                content: message
            });
        }
        
        input.value = '';
    }
    
    setWhisperTarget(username) {
        if (username === this.user.username) return; // Can't whisper to yourself
        
        const input = document.getElementById('chatInput');
        input.value = `/w ${username} `;
        input.focus();
    }
    
    handleTabCompletion() {
        const input = document.getElementById('chatInput');
        const value = input.value;
        const cursorPos = input.selectionStart;
        
        // Find the word being typed at cursor position
        const beforeCursor = value.substring(0, cursorPos);
        const afterCursor = value.substring(cursorPos);
        
        // Find the start of the current word
        const words = beforeCursor.split(' ');
        const currentWord = words[words.length - 1];
        
        // Check if we're continuing a previous tab completion
        const isNewCompletion = !this.tabCompletionOriginal || 
                               currentWord.toLowerCase() !== this.tabCompletionMatches[this.tabCompletionIndex]?.toLowerCase();
        
        if (isNewCompletion) {
            // Start new completion
            this.tabCompletionOriginal = currentWord;
            this.tabCompletionIndex = 0;
            
            if (!currentWord) {
                // If no word, show all character names (or usernames if no character name)
                this.tabCompletionMatches = this.participants.map(p => p.character_name || p.username);
                // Add DM/monarch aliases if there's a monarch
                if (this.participants.some(p => p.role === 'king')) {
                    this.tabCompletionMatches.push('DM', 'monarch');
                }
            } else {
                // Find matching character names or usernames
                this.tabCompletionMatches = [];
                this.participants.forEach(p => {
                    const name = p.character_name || p.username;
                    if (name.toLowerCase().startsWith(currentWord.toLowerCase())) {
                        this.tabCompletionMatches.push(name);
                    }
                    // Also match on username if different from character name
                    if (p.character_name && p.username.toLowerCase().startsWith(currentWord.toLowerCase())) {
                        this.tabCompletionMatches.push(p.username);
                    }
                });
                
                // Add DM/monarch aliases if they match and there's a monarch
                if (this.participants.some(p => p.role === 'king')) {
                    if ('dm'.startsWith(currentWord.toLowerCase())) {
                        this.tabCompletionMatches.push('DM');
                    }
                    if ('monarch'.startsWith(currentWord.toLowerCase())) {
                        this.tabCompletionMatches.push('monarch');
                    }
                }
            }
            
            if (this.tabCompletionMatches.length === 0) {
                this.tabCompletionOriginal = null;
                return;
            }
        } else {
            // Cycle through matches
            this.tabCompletionIndex = (this.tabCompletionIndex + 1) % this.tabCompletionMatches.length;
        }
        
        // Use the current match
        const completion = this.tabCompletionMatches[this.tabCompletionIndex];
        
        // Replace the partial word with the completion
        const beforeWord = words.slice(0, -1).join(' ');
        const newValue = (beforeWord ? beforeWord + ' ' : '') + completion + afterCursor;
        
        input.value = newValue;
        
        // Set cursor position after the completed word
        const newCursorPos = (beforeWord ? beforeWord.length + 1 : 0) + completion.length;
        input.setSelectionRange(newCursorPos, newCursorPos);
    }
    
    addMessage(data) {
        const messagesDiv = document.getElementById('chatMessages');
        const messageEl = document.createElement('div');
        messageEl.className = `chat-message ${data.type || 'public'}`;
        
        const timestamp = data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : '';
        
        if (data.type === 'system') {
            messageEl.innerHTML = `<span class="content">${data.content}</span>`;
        } else if (data.type === 'roll') {
            messageEl.innerHTML = `
                <span class="sender ${data.senderRole === 'king' ? 'monarch' : ''}">${data.sender}</span>
                <span class="content">${data.content}</span>
                ${timestamp ? `<span class="timestamp">${timestamp}</span>` : ''}
            `;
        } else if (data.type === 'whisper') {
            const direction = data.sender === 'You' ? 'to' : 'from';
            const otherUser = data.sender === 'You' ? data.target : data.sender;
            messageEl.innerHTML = `
                <span class="sender ${data.senderRole === 'king' ? 'monarch' : ''}">[Whisper ${direction} ${otherUser}]</span>
                <span class="content">${data.content}</span>
                ${timestamp ? `<span class="timestamp">${timestamp}</span>` : ''}
            `;
        } else {
            messageEl.innerHTML = `
                <span class="sender ${data.senderRole === 'king' ? 'monarch' : ''}">${data.sender}:</span>
                <span class="content">${data.content}</span>
                ${timestamp ? `<span class="timestamp">${timestamp}</span>` : ''}
            `;
        }
        
        messagesDiv.appendChild(messageEl);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        
        // Keep only last 100 messages
        while (messagesDiv.children.length > 100) {
            messagesDiv.removeChild(messagesDiv.firstChild);
        }
    }
    
    // Dice Rolling System
    parseDiceExpression(expression) {
        // Parse dice expressions like "1d20+5", "2d6+1d4+3", "2d20kh1" (keep highest), etc.
        const parts = [];
        let currentPart = '';
        let modifier = 0;
        
        // Split expression into parts - now supports reroll (r1, r2, etc.) and spaces around operators
        // First normalize the expression by removing spaces around operators
        const normalizedExpression = expression.replace(/\s*([+-])\s*/g, '$1');
        console.log('🔧 Normalized expression:', expression, '→', normalizedExpression);
        
        const regex = /(\d*d\d+(?:kh\d+|kl\d+|r\d+)?|[+-]\d+)/gi;
        const matches = normalizedExpression.match(regex);
        
        if (!matches) return null;
        
        matches.forEach(match => {
            if (match.includes('d')) {
                // Dice roll - now supports reroll (r1, r2, etc.)
                const diceRegex = /^(\d*)d(\d+)(?:(kh|kl|r)(\d+))?$/i;
                const diceMatch = match.match(diceRegex);
                if (diceMatch) {
                    const count = parseInt(diceMatch[1] || '1');
                    const sides = parseInt(diceMatch[2]);
                    const modifier = diceMatch[3]; // kh, kl, or r
                    const modifierValue = parseInt(diceMatch[4] || '1');
                    
                    parts.push({
                        type: 'dice',
                        count,
                        sides,
                        modifier: modifier, // 'kh', 'kl', or 'r'
                        modifierValue: modifierValue // the number after the modifier
                    });
                }
            } else {
                // Modifier
                modifier += parseInt(match);
            }
        });
        
        return { parts, modifier };
    }
    
    rollDice(count, sides) {
        const rolls = [];
        for (let i = 0; i < count; i++) {
            rolls.push(Math.floor(Math.random() * sides) + 1);
        }
        return rolls;
    }
    
    performRoll(expression, description = null) {
        console.log('🎯 performRoll called with:', expression, description);
        
        const parsed = this.parseDiceExpression(expression);
        console.log('🔍 Parsed expression:', parsed);
        
        if (!parsed) {
            console.log('❌ Failed to parse expression');
            this.addMessage({
                type: 'system',
                content: 'Invalid dice expression'
            });
            return;
        }
        
        let total = 0;
        const breakdown = [];
        let hasCritSuccess = false;
        let hasCritFail = false;
        
        parsed.parts.forEach(part => {
            if (part.type === 'dice') {
                let rolls = this.rollDice(part.count, part.sides);
                let finalRolls = [...rolls];
                
                // Handle reroll
                if (part.modifier === 'r') {
                    const rerollValue = part.modifierValue;
                    console.log(`🔄 Rerolling ${rerollValue}s:`, rolls);
                    
                    // Reroll dice that match the reroll value (usually 1s)
                    finalRolls = rolls.map(roll => {
                        if (roll === rerollValue) {
                            const newRoll = this.rollDice(1, part.sides)[0];
                            console.log(`🎲 Rerolled ${roll} → ${newRoll}`);
                            return newRoll;
                        }
                        return roll;
                    });
                }
                
                let keptRolls = [...finalRolls];
                
                // Handle keep highest/lowest
                if (part.modifier === 'kh') {
                    keptRolls.sort((a, b) => b - a);
                    keptRolls = keptRolls.slice(0, part.modifierValue);
                } else if (part.modifier === 'kl') {
                    keptRolls.sort((a, b) => a - b);
                    keptRolls = keptRolls.slice(0, part.modifierValue);
                }
                
                // Check for crits on d20s - only consider kept dice
                if (part.sides === 20) {
                    if (keptRolls.includes(20)) hasCritSuccess = true;
                    if (keptRolls.includes(1)) hasCritFail = true;
                    console.log(`🎲 Crit check for d20: kept=[${keptRolls.join(',')}], success=${keptRolls.includes(20)}, fail=${keptRolls.includes(1)}`);
                }
                
                const subtotal = keptRolls.reduce((sum, roll) => sum + roll, 0);
                total += subtotal;
                
                // Format breakdown based on modifier type
                if (part.modifier === 'r') {
                    // Show reroll: 1d20r1:[1→3] or 2d6r1:[1,4→5,4]
                    const rerollDisplay = rolls.map((original, i) => 
                        original === part.modifierValue ? `${original}→${finalRolls[i]}` : finalRolls[i]
                    ).join(',');
                    breakdown.push(`${part.count}d${part.sides}r${part.modifierValue}:[${rerollDisplay}]`);
                } else if (part.modifier === 'kh' || part.modifier === 'kl') {
                    breakdown.push(`${part.count}d${part.sides}${part.modifier}${part.modifierValue}:[${finalRolls.join(',')}]→${subtotal}`);
                } else {
                    breakdown.push(`${part.count}d${part.sides}:[${finalRolls.join(',')}]`);
                }
            }
        });
        
        total += parsed.modifier;
        if (parsed.modifier !== 0) {
            breakdown.push(`${parsed.modifier > 0 ? '+' : ''}${parsed.modifier}`);
        }
        
        // Apply grail damage modifiers if applicable
        const participant = this.participants?.find(p => p.id === this.user.id);
        const hasGrail = participant?.has_grail;
        let finalTotal = total;
        let finalBreakdown = `(${breakdown.join(' ')})`;
        
        if (hasGrail && this.grailModifiers?.damageModifiers?.length > 0 && this.isDamageRoll(expression)) {
            this.grailModifiers.damageModifiers.forEach(modifier => {
                finalTotal = this.applyGrailDamageModifier(finalTotal, modifier);
            });
            // Only add custom message if one is configured
            if (this.grailModifiers.customMessage) {
                finalBreakdown += ' ' + this.grailModifiers.customMessage;
            }
        }
        
        // Use character name if set, otherwise use username
        const characterName = document.getElementById('characterNameDisplay').textContent || this.user.username;
        
        const rollData = {
            sender: this.user.username,
            characterName: characterName,
            senderRole: this.userRole,
            formula: expression,
            description,
            total: finalTotal,
            breakdown: finalBreakdown,
            hasCritSuccess,
            hasCritFail,
            timestamp: new Date().toISOString()
        };
        
        // Send to server
        this.socket.emit('roll', {
            gameId: this.gameId,
            ...rollData
        });
    }
    
    addRollToHistory(rollData) {
        const historyDiv = document.getElementById('rollHistory');
        const rollEntry = document.createElement('div');
        
        let entryClass = 'roll-entry';
        if (rollData.hasCritSuccess) entryClass += ' critical-success';
        if (rollData.hasCritFail) entryClass += ' critical-fail';
        
        rollEntry.className = entryClass;
        
        let totalClass = 'roll-total';
        if (rollData.hasCritSuccess) totalClass += ' critical-success';
        if (rollData.hasCritFail) totalClass += ' critical-fail';
        
        rollEntry.innerHTML = `
            <div class="roll-content">
                <div class="roll-left">
                    <div class="roll-character ${rollData.senderRole === 'king' ? 'monarch' : ''}" title="${rollData.characterName}">${rollData.characterName}</div>
                    ${rollData.description ? `<div class="roll-description" title="${rollData.description}">${rollData.description}</div>` : ''}
                </div>
                <div class="roll-right">
                    <div class="roll-formula" title="${rollData.formula}">${rollData.formula}</div>
                    <div class="roll-result">
                        <span class="${totalClass}" title="${rollData.total}">${rollData.total}</span>
                        <span class="roll-breakdown" title="${rollData.breakdown}">${rollData.breakdown}</span>
                    </div>
                </div>
            </div>
            <div class="roll-timestamp">${new Date(rollData.timestamp).toLocaleTimeString()}</div>
        `;
        
        historyDiv.insertBefore(rollEntry, historyDiv.firstChild);
        
        // Keep only last 50 rolls
        while (historyDiv.children.length > 50) {
            historyDiv.removeChild(historyDiv.lastChild);
        }
        
        this.rollHistory.unshift(rollData);
        if (this.rollHistory.length > 50) {
            this.rollHistory = this.rollHistory.slice(0, 50);
        }
    }
    
    setupPanelCollapseListeners() {
        // Controls panel collapse
        document.getElementById('controlsCollapseBtn').addEventListener('click', () => {
            const panel = document.querySelector('.controls');
            panel.classList.toggle('collapsed');
        });
        
        // Roll sidebar collapse  
        document.getElementById('rollsCollapseBtn').addEventListener('click', () => {
            const panel = document.querySelector('.roll-sidebar');
            panel.classList.toggle('collapsed');
        });
        
        // Chat collapse with 3 states
        this.chatState = 'default'; // default, expanded, collapsed
        document.getElementById('chatCollapseBtn').addEventListener('click', () => {
            const chatContainer = document.querySelector('.chat-container');
            const button = document.getElementById('chatCollapseBtn');
            
            // Remove all state classes
            chatContainer.classList.remove('default', 'expanded', 'collapsed');
            
            // Cycle through states
            if (this.chatState === 'default') {
                this.chatState = 'expanded';
                button.innerHTML = '▲';
                button.title = 'Chat: Expanded (10 lines) - Click for Collapsed';
            } else if (this.chatState === 'expanded') {
                this.chatState = 'collapsed';
                button.innerHTML = '▼';
                button.title = 'Chat: Collapsed (input only) - Click for Default';
            } else {
                this.chatState = 'default';
                button.innerHTML = '◀';
                button.title = 'Chat: Default (3 lines) - Click for Expanded';
            }
            
            // Add the new state class
            chatContainer.classList.add(this.chatState);
        });
    }
    
    setupJoinCodeDropdown() {
        const joinCodeLabel = document.getElementById('joinCodeLabel');
        const joinCodeDropdown = document.getElementById('joinCodeDropdown');
        const joinCode = document.getElementById('joinCode');
        
        if (!joinCodeLabel || !joinCodeDropdown || !joinCode) return;
        
        // Toggle dropdown on label click
        joinCodeLabel.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = joinCodeDropdown.style.display === 'block';
            joinCodeDropdown.style.display = isVisible ? 'none' : 'block';
            joinCodeLabel.textContent = isVisible ? 'Join Code ▼' : 'Join Code ▲';
        });
        
        // Copy join code on label click (same functionality)
        joinCodeLabel.addEventListener('click', async () => {
            if (this.gameId) {
                try {
                    await navigator.clipboard.writeText(this.gameId);
                    const originalText = joinCodeLabel.textContent;
                    joinCodeLabel.textContent = 'Copied!';
                    joinCodeLabel.style.color = '#4ecdc4';
                    setTimeout(() => {
                        joinCodeLabel.textContent = originalText;
                        joinCodeLabel.style.color = '';
                    }, 1000);
                } catch (err) {
                    console.error('Failed to copy:', err);
                }
            }
        });
        
        // Copy join code on code element click
        joinCode.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (this.gameId) {
                try {
                    await navigator.clipboard.writeText(this.gameId);
                    const originalText = joinCode.textContent;
                    joinCode.textContent = 'Copied!';
                    setTimeout(() => {
                        joinCode.textContent = originalText;
                    }, 1000);
                } catch (err) {
                    console.error('Failed to copy:', err);
                }
            }
        });
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!document.getElementById('joinCodeSection').contains(e.target)) {
                joinCodeDropdown.style.display = 'none';
                joinCodeLabel.textContent = 'Join Code ▼';
            }
        });
    }
    
    setupMacroListeners() {
        // Macro configuration button
        document.getElementById('macrosConfig').addEventListener('click', () => {
            this.openMacroModal();
        });
        
        // Character sheet button
        document.getElementById('characterSheet').addEventListener('click', () => {
            this.openCharacterSheet();
        });
        
        // UI Settings button
        document.getElementById('uiSettings').addEventListener('click', () => {
            this.openUISettingsModal();
        });
        
        // Quick rolls button
        document.getElementById('quickRollsBtn').addEventListener('click', (e) => {
            e.preventDefault();
            this.toggleQuickRolls();
        });
        
        // Close quick rolls when clicking outside
        document.addEventListener('click', (e) => {
            const popup = document.getElementById('quickRollsPopup');
            const button = document.getElementById('quickRollsBtn');
            if (!popup.contains(e.target) && e.target !== button) {
                popup.style.display = 'none';
            }
        });
    }
    
    async openMacroModal() {
        await this.loadMacros();
        
        // For Monarchs, show character sheet linking options and load NPC sheets
        if (this.userRole === 'king') {
            const macroCharacterLink = document.getElementById('macroCharacterLink');
            macroCharacterLink.style.display = 'block';
            await this.loadMacroCharacterSheets();
        }
        
        document.getElementById('macroModal').style.display = 'flex';
    }
    
    async loadMacroCharacterSheets() {
        try {
            const response = await fetch(`/api/games/${this.gameId}/character-sheets`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            
            if (response.ok) {
                const data = await response.json();
                const select = document.getElementById('macroCharacterSheet');
                select.innerHTML = '<option value="">None (Personal Macro)</option>';
                
                if (data.sheets && data.sheets.length > 0) {
                    data.sheets.forEach(sheet => {
                        const option = document.createElement('option');
                        option.value = sheet.id;
                        const typeIcon = sheet.sheet_type === 'monster' ? '👹' : sheet.sheet_type === 'boss' ? '💀' : '👤';
                        option.textContent = `${typeIcon} ${sheet.name}`;
                        select.appendChild(option);
                    });
                }
            }
        } catch (error) {
            console.error('Failed to load character sheets for macros:', error);
        }
    }
    
    closeMacroModal() {
        document.getElementById('macroModal').style.display = 'none';
        // Clear form
        document.getElementById('macroName').value = '';
        document.getElementById('macroFormula').value = '';
        document.getElementById('macroDescription').value = '';
        
        // Clear character sheet selection for Monarchs
        if (this.userRole === 'king') {
            const characterSheetSelect = document.getElementById('macroCharacterSheet');
            if (characterSheetSelect) {
                characterSheetSelect.value = '';
            }
        }
    }
    
    // Character Sheet Methods
    async openCharacterSheet() {
        const modal = document.getElementById('characterSheetModal');
        const content = document.getElementById('characterSheetContent');
        const sheetManagement = document.getElementById('sheetManagement');
        
        modal.style.display = 'block';
        content.innerHTML = 'Loading character sheet...';
        
        // Show sheet management for Monarchs
        if (this.userRole === 'king') {
            sheetManagement.style.display = 'block';
            await this.loadSheetsList();
            this.setupSheetManagement();
        } else {
            sheetManagement.style.display = 'none';
        }
        
        // Load the currently selected sheet (default to player sheet)
        const selectedSheet = this.userRole === 'king' ? document.getElementById('sheetSelect').value : 'player';
        await this.loadCharacterSheet(selectedSheet);
    }
    
    async loadSheetsList() {
        try {
            const response = await fetch(`/api/games/${this.gameId}/character-sheets`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.populateSheetSelector(data.sheets);
            } else if (response.status === 404) {
                // API endpoint not implemented yet, just populate with empty list
                console.log('Character sheets API not implemented yet');
                this.populateSheetSelector([]);
            }
        } catch (error) {
            console.error('Failed to load sheets list:', error);
            // Fallback to empty list if API fails
            this.populateSheetSelector([]);
        }
    }
    
    populateSheetSelector(sheets) {
        const select = document.getElementById('sheetSelect');
        select.innerHTML = '<option value="player">Your Character</option>';
        
        if (sheets && sheets.length > 0) {
            sheets.forEach(sheet => {
                const option = document.createElement('option');
                option.value = sheet.id;
                const typeIcon = sheet.sheet_type === 'monster' ? '👹' : sheet.sheet_type === 'boss' ? '💀' : '👤';
                option.textContent = `${typeIcon} ${sheet.name}`;
                select.appendChild(option);
            });
        }
    }
    
    setupSheetManagement() {
        const sheetSelect = document.getElementById('sheetSelect');
        const newSheetBtn = document.getElementById('newSheetBtn');
        const deleteSheetBtn = document.getElementById('deleteSheetBtn');
        const sheetInfo = document.getElementById('sheetInfo');
        const sheetName = document.getElementById('sheetName');
        const sheetType = document.getElementById('sheetType');
        
        // Remove existing listeners
        sheetSelect.removeEventListener('change', this.handleSheetSelection);
        newSheetBtn.removeEventListener('click', this.handleNewSheet);
        deleteSheetBtn.removeEventListener('click', this.handleDeleteSheet);
        
        // Add event listeners
        this.handleSheetSelection = async () => {
            const selectedValue = sheetSelect.value;
            deleteSheetBtn.style.display = selectedValue === 'player' ? 'none' : 'inline-block';
            sheetInfo.style.display = selectedValue === 'new' ? 'block' : 'none';
            
            if (selectedValue !== 'new') {
                await this.loadCharacterSheet(selectedValue);
            }
        };
        
        this.handleNewSheet = () => {
            const option = document.createElement('option');
            option.value = 'new';
            option.textContent = 'New Sheet';
            option.selected = true;
            sheetSelect.appendChild(option);
            sheetInfo.style.display = 'block';
            deleteSheetBtn.style.display = 'none';
            
            // Clear the character sheet content for new entry
            this.renderCharacterSheet(null, true);
        };
        
        this.handleDeleteSheet = async () => {
            const selectedValue = sheetSelect.value;
            if (selectedValue === 'player' || selectedValue === 'new') return;
            
            if (confirm('Are you sure you want to delete this character sheet?')) {
                try {
                    const response = await fetch(`/api/games/${this.gameId}/character-sheets/${selectedValue}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${this.token}` }
                    });
                    
                    if (response.ok) {
                        await this.loadSheetsList();
                        sheetSelect.value = 'player';
                        await this.loadCharacterSheet('player');
                    }
                } catch (error) {
                    console.error('Failed to delete sheet:', error);
                    alert('Failed to delete character sheet');
                }
            }
        };
        
        sheetSelect.addEventListener('change', this.handleSheetSelection);
        newSheetBtn.addEventListener('click', this.handleNewSheet);
        deleteSheetBtn.addEventListener('click', this.handleDeleteSheet);
    }
    
    async loadCharacterSheet(sheetId) {
        const content = document.getElementById('characterSheetContent');
        content.innerHTML = 'Loading character sheet...';
        
        try {
            const url = sheetId === 'player' ? 
                `/api/games/${this.gameId}/character-sheet` : 
                `/api/games/${this.gameId}/character-sheets/${sheetId}`;
                
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${this.token}` }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.currentSheetId = sheetId;
                this.renderCharacterSheet(data.characterSheet || data, false, sheetId);
            } else if (response.status === 404) {
                // No character sheet exists, create new one
                this.currentSheetId = sheetId;
                if (sheetId !== 'player') {
                    // For NPC sheets, treat as new sheet when API doesn't exist
                    console.log('NPC character sheets API not implemented yet, creating new sheet');
                    this.renderCharacterSheet(null, true, sheetId);
                } else {
                    this.renderCharacterSheet(null, false, sheetId);
                }
            } else {
                throw new Error('Failed to load character sheet');
            }
        } catch (error) {
            console.error('Failed to load character sheet:', error);
            content.innerHTML = '<p style="color: #ff6b6b;">Failed to load character sheet. Please try again.</p>';
        }
    }
    
    renderCharacterSheet(characterSheet, isNew = false, sheetId = 'player') {
        const content = document.getElementById('characterSheetContent');
        // Handle both direct data and nested character_data structure
        const data = characterSheet ? 
            (characterSheet.character_data || characterSheet) : {};
        this.currentSheetId = sheetId;
        this.isNewSheet = isNew;
        
        // Initialize with default values if not present
        const abilities = data.abilities || { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
        const skills = data.skills || {};
        const saves = data.saves || {};
        const weapons = data.weapons || [];
        const armor = data.armor || [];
        const inventory = data.inventory || [];
        const wealth = data.wealth || { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
        const level = data.level || 1;
        const profBonus = this.getProficiencyBonus(level);
        
        // Skills list with their associated abilities
        const skillList = [
            { name: 'Acrobatics', ability: 'dex' },
            { name: 'Animal Handling', ability: 'wis' },
            { name: 'Arcana', ability: 'int' },
            { name: 'Athletics', ability: 'str' },
            { name: 'Deception', ability: 'cha' },
            { name: 'History', ability: 'int' },
            { name: 'Insight', ability: 'wis' },
            { name: 'Intimidation', ability: 'cha' },
            { name: 'Investigation', ability: 'int' },
            { name: 'Medicine', ability: 'wis' },
            { name: 'Nature', ability: 'int' },
            { name: 'Perception', ability: 'wis' },
            { name: 'Performance', ability: 'cha' },
            { name: 'Persuasion', ability: 'cha' },
            { name: 'Religion', ability: 'int' },
            { name: 'Sleight of Hand', ability: 'dex' },
            { name: 'Stealth', ability: 'dex' },
            { name: 'Survival', ability: 'wis' }
        ];
        
        content.innerHTML = `
            <div class="character-sheet-tabs">
                <button class="tab-button active" onclick="game.switchCharacterTab('basics')">Basics</button>
                <button class="tab-button" onclick="game.switchCharacterTab('stats')">Stats</button>
                <button class="tab-button" onclick="game.switchCharacterTab('combat')">Combat</button>
                <button class="tab-button" onclick="game.switchCharacterTab('skills')">Skills & Saves</button>
                <button class="tab-button" onclick="game.switchCharacterTab('equipment')">Equipment</button>
            </div>
            
            <!-- Basics Tab -->
            <div id="basicsTab" class="character-tab active">
                <div class="character-sheet-wide">
                    <div class="character-sheet-section">
                        <h3>Basic Information</h3>
                        <div class="character-sheet-row">
                            <div class="character-sheet-field">
                                <label>Character Name</label>
                                <input type="text" id="charName" value="${data.name || ''}" placeholder="Enter character name">
                            </div>
                            <div class="character-sheet-field">
                                <label>Level</label>
                                <input type="number" id="charLevel" value="${level}" min="1" max="20" onchange="game.updateProficiencyBonus()">
                            </div>
                            <div class="character-sheet-field">
                                <label>Class</label>
                                <input type="text" id="charClass" value="${data.class || ''}" placeholder="Fighter, Wizard, etc.">
                            </div>
                        </div>
                        <div class="character-sheet-row">
                            <div class="character-sheet-field">
                                <label>Race</label>
                                <input type="text" id="charRace" value="${data.race || ''}" placeholder="Human, Elf, etc.">
                            </div>
                            <div class="character-sheet-field">
                                <label>Background</label>
                                <input type="text" id="charBackground" value="${data.background || ''}" placeholder="Soldier, Noble, etc.">
                            </div>
                            <div class="character-sheet-field">
                                <label>Alignment</label>
                                <input type="text" id="charAlignment" value="${data.alignment || ''}" placeholder="Lawful Good, etc.">
                            </div>
                        </div>
                        <div class="character-sheet-row">
                            <div class="character-sheet-field full-width">
                                <label>Proficiency Bonus</label>
                                <input type="number" id="charProfBonus" value="${profBonus}" readonly>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Stats Tab -->
            <div id="statsTab" class="character-tab" style="display: none;">
                <div class="character-sheet-wide">
                    <div class="character-sheet-section">
                        <h3>Ability Scores</h3>
                        <div class="ability-scores-wide">
                            <div class="ability-score">
                                <label>STR</label>
                                <input type="number" id="abilityStr" value="${abilities.str}" min="1" max="30" onchange="game.updateAllCalculations()">
                                <div class="modifier" id="modifierStr">${this.formatModifier(this.getModifierValue(abilities.str))}</div>
                            </div>
                            <div class="ability-score">
                                <label>DEX</label>
                                <input type="number" id="abilityDex" value="${abilities.dex}" min="1" max="30" onchange="game.updateAllCalculations()">
                                <div class="modifier" id="modifierDex">${this.formatModifier(this.getModifierValue(abilities.dex))}</div>
                            </div>
                            <div class="ability-score">
                                <label>CON</label>
                                <input type="number" id="abilityCon" value="${abilities.con}" min="1" max="30" onchange="game.updateAllCalculations()">
                                <div class="modifier" id="modifierCon">${this.formatModifier(this.getModifierValue(abilities.con))}</div>
                            </div>
                            <div class="ability-score">
                                <label>INT</label>
                                <input type="number" id="abilityInt" value="${abilities.int}" min="1" max="30" onchange="game.updateAllCalculations()">
                                <div class="modifier" id="modifierInt">${this.formatModifier(this.getModifierValue(abilities.int))}</div>
                            </div>
                            <div class="ability-score">
                                <label>WIS</label>
                                <input type="number" id="abilityWis" value="${abilities.wis}" min="1" max="30" onchange="game.updateAllCalculations()">
                                <div class="modifier" id="modifierWis">${this.formatModifier(this.getModifierValue(abilities.wis))}</div>
                            </div>
                            <div class="ability-score">
                                <label>CHA</label>
                                <input type="number" id="abilityCha" value="${abilities.cha}" min="1" max="30" onchange="game.updateAllCalculations()">
                                <div class="modifier" id="modifierCha">${this.formatModifier(this.getModifierValue(abilities.cha))}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Combat Tab -->
            <div id="combatTab" class="character-tab" style="display: none;">
                <div class="character-sheet-wide">
                    <div class="character-sheet-section">
                        <h3>Combat Stats</h3>
                        <div class="character-sheet-row">
                            <div class="character-sheet-field">
                                <label>Armor Class</label>
                                <div class="ac-calculation">
                                    <input type="number" id="charAC" value="${data.combat?.ac || 10}" min="1" readonly>
                                    <small id="acFormula">(10 + DEX + Armor Bonus)</small>
                                </div>
                            </div>
                            <div class="character-sheet-field">
                                <label>Initiative</label>
                                <input type="number" id="charInitiative" value="${this.getModifierValue(abilities.dex)}" readonly>
                            </div>
                            <div class="character-sheet-field">
                                <label>Speed</label>
                                <input type="number" id="charSpeed" value="${data.combat?.speed || 30}" min="0"> ft
                            </div>
                        </div>
                        <div class="character-sheet-row">
                            <div class="character-sheet-field">
                                <label>Max HP</label>
                                <input type="number" id="charMaxHP" value="${data.combat?.maxHp || 8}" min="1">
                            </div>
                            <div class="character-sheet-field">
                                <label>Current HP</label>
                                <input type="number" id="charCurrentHP" value="${data.combat?.currentHp || data.combat?.maxHp || 8}" min="0">
                            </div>
                            <div class="character-sheet-field">
                                <label>Temp HP</label>
                                <input type="number" id="charTempHP" value="${data.combat?.tempHp || 0}" min="0">
                            </div>
                        </div>
                        <div class="character-sheet-row">
                            <div class="character-sheet-field">
                                <label>Hit Dice</label>
                                <input type="text" id="charHitDice" value="${data.combat?.hitDice || '1d8'}" placeholder="1d8">
                            </div>
                        </div>
                    </div>
                    
                    <div class="character-sheet-section">
                        <h3>Armor</h3>
                        <div class="armor-list" id="armorList">
                            ${armor.map((armorPiece, index) => `
                                <div class="armor-entry" data-index="${index}">
                                    <input type="text" placeholder="Armor Name" value="${armorPiece.name || ''}" onchange="game.updateArmor(${index}, 'name', this.value)">
                                    <input type="number" placeholder="AC Bonus" value="${armorPiece.acBonus || 0}" min="0" onchange="game.updateArmor(${index}, 'acBonus', this.value); game.updateArmorAC()">
                                    <select onchange="game.updateArmor(${index}, 'statMod', this.value)">
                                        <option value="">No Stat Mod</option>
                                        <option value="str" ${armorPiece.statMod === 'str' ? 'selected' : ''}>STR +${armorPiece.statModValue || 0}</option>
                                        <option value="dex" ${armorPiece.statMod === 'dex' ? 'selected' : ''}>DEX +${armorPiece.statModValue || 0}</option>
                                        <option value="con" ${armorPiece.statMod === 'con' ? 'selected' : ''}>CON +${armorPiece.statModValue || 0}</option>
                                        <option value="int" ${armorPiece.statMod === 'int' ? 'selected' : ''}>INT +${armorPiece.statModValue || 0}</option>
                                        <option value="wis" ${armorPiece.statMod === 'wis' ? 'selected' : ''}>WIS +${armorPiece.statModValue || 0}</option>
                                        <option value="cha" ${armorPiece.statMod === 'cha' ? 'selected' : ''}>CHA +${armorPiece.statModValue || 0}</option>
                                        <option value="ac" ${armorPiece.statMod === 'ac' ? 'selected' : ''}>AC +${armorPiece.statModValue || 0}</option>
                                        <option value="hp" ${armorPiece.statMod === 'hp' ? 'selected' : ''}>HP +${armorPiece.statModValue || 0}</option>
                                        <option value="initiative" ${armorPiece.statMod === 'initiative' ? 'selected' : ''}>Initiative +${armorPiece.statModValue || 0}</option>
                                        <option value="speed" ${armorPiece.statMod === 'speed' ? 'selected' : ''}>Speed +${armorPiece.statModValue || 0}</option>
                                        <option value="proficiency" ${armorPiece.statMod === 'proficiency' ? 'selected' : ''}>Prof +${armorPiece.statModValue || 0}</option>
                                    </select>
                                    <input type="number" placeholder="Value" value="${armorPiece.statModValue || 0}" style="width: 60px;" onchange="game.updateArmor(${index}, 'statModValue', this.value)">
                                    <button onclick="game.removeArmor(${index})" class="btn-remove">×</button>
                                </div>
                            `).join('')}
                        </div>
                        <button onclick="game.addArmor()" class="btn-secondary">Add Armor</button>
                    </div>
                    
                    <div class="character-sheet-section">
                        <h3>Weapons</h3>
                        <div class="weapons-list" id="weaponsList">
                            ${weapons.map((weapon, index) => `
                                <div class="weapon-entry" data-index="${index}">
                                    <input type="text" placeholder="Weapon Name" value="${weapon.name || ''}" onchange="game.updateWeapon(${index}, 'name', this.value)">
                                    <input type="text" placeholder="Damage (1d8)" value="${weapon.damage || ''}" onchange="game.updateWeapon(${index}, 'damage', this.value)">
                                    <select onchange="game.updateWeapon(${index}, 'type', this.value)">
                                        <option value="melee" ${weapon.type === 'melee' ? 'selected' : ''}>Melee</option>
                                        <option value="ranged" ${weapon.type === 'ranged' ? 'selected' : ''}>Ranged</option>
                                    </select>
                                    <select onchange="game.updateWeapon(${index}, 'statMod', this.value)">
                                        <option value="">No Stat Mod</option>
                                        <option value="str" ${weapon.statMod === 'str' ? 'selected' : ''}>STR +${weapon.statModValue || 0}</option>
                                        <option value="dex" ${weapon.statMod === 'dex' ? 'selected' : ''}>DEX +${weapon.statModValue || 0}</option>
                                        <option value="con" ${weapon.statMod === 'con' ? 'selected' : ''}>CON +${weapon.statModValue || 0}</option>
                                        <option value="int" ${weapon.statMod === 'int' ? 'selected' : ''}>INT +${weapon.statModValue || 0}</option>
                                        <option value="wis" ${weapon.statMod === 'wis' ? 'selected' : ''}>WIS +${weapon.statModValue || 0}</option>
                                        <option value="cha" ${weapon.statMod === 'cha' ? 'selected' : ''}>CHA +${weapon.statModValue || 0}</option>
                                        <option value="ac" ${weapon.statMod === 'ac' ? 'selected' : ''}>AC +${weapon.statModValue || 0}</option>
                                        <option value="hp" ${weapon.statMod === 'hp' ? 'selected' : ''}>HP +${weapon.statModValue || 0}</option>
                                        <option value="initiative" ${weapon.statMod === 'initiative' ? 'selected' : ''}>Initiative +${weapon.statModValue || 0}</option>
                                        <option value="speed" ${weapon.statMod === 'speed' ? 'selected' : ''}>Speed +${weapon.statModValue || 0}</option>
                                        <option value="proficiency" ${weapon.statMod === 'proficiency' ? 'selected' : ''}>Prof +${weapon.statModValue || 0}</option>
                                    </select>
                                    <input type="number" placeholder="Value" value="${weapon.statModValue || 0}" style="width: 60px;" onchange="game.updateWeapon(${index}, 'statModValue', this.value)">
                                    <button onclick="game.removeWeapon(${index})" class="btn-remove">×</button>
                                </div>
                            `).join('')}
                        </div>
                        <button onclick="game.addWeapon()" class="btn-secondary">Add Weapon</button>
                    </div>
                </div>
            </div>
            
            <!-- Skills & Saves Tab -->
            <div id="skillsTab" class="character-tab" style="display: none;">
                <div class="character-sheet-wide">
                    <div class="character-sheet-section">
                        <h3>Saving Throws</h3>
                        <div class="saves-list">
                            <div class="save-row">
                                <input type="checkbox" id="saveStrProf" ${saves.strProf ? 'checked' : ''} onchange="game.updateSaveModifier('str')">
                                <label for="saveStrProf">Strength</label>
                                <span class="save-modifier" id="saveStrMod">${this.formatModifier(this.getModifierValue(abilities.str) + (saves.strProf ? profBonus : 0))}</span>
                            </div>
                            <div class="save-row">
                                <input type="checkbox" id="saveDexProf" ${saves.dexProf ? 'checked' : ''} onchange="game.updateSaveModifier('dex')">
                                <label for="saveDexProf">Dexterity</label>
                                <span class="save-modifier" id="saveDexMod">${this.formatModifier(this.getModifierValue(abilities.dex) + (saves.dexProf ? profBonus : 0))}</span>
                            </div>
                            <div class="save-row">
                                <input type="checkbox" id="saveConProf" ${saves.conProf ? 'checked' : ''} onchange="game.updateSaveModifier('con')">
                                <label for="saveConProf">Constitution</label>
                                <span class="save-modifier" id="saveConMod">${this.formatModifier(this.getModifierValue(abilities.con) + (saves.conProf ? profBonus : 0))}</span>
                            </div>
                            <div class="save-row">
                                <input type="checkbox" id="saveIntProf" ${saves.intProf ? 'checked' : ''} onchange="game.updateSaveModifier('int')">
                                <label for="saveIntProf">Intelligence</label>
                                <span class="save-modifier" id="saveIntMod">${this.formatModifier(this.getModifierValue(abilities.int) + (saves.intProf ? profBonus : 0))}</span>
                            </div>
                            <div class="save-row">
                                <input type="checkbox" id="saveWisProf" ${saves.wisProf ? 'checked' : ''} onchange="game.updateSaveModifier('wis')">
                                <label for="saveWisProf">Wisdom</label>
                                <span class="save-modifier" id="saveWisMod">${this.formatModifier(this.getModifierValue(abilities.wis) + (saves.wisProf ? profBonus : 0))}</span>
                            </div>
                            <div class="save-row">
                                <input type="checkbox" id="saveChaProf" ${saves.chaProf ? 'checked' : ''} onchange="game.updateSaveModifier('cha')">
                                <label for="saveChaProf">Charisma</label>
                                <span class="save-modifier" id="saveChaMod">${this.formatModifier(this.getModifierValue(abilities.cha) + (saves.chaProf ? profBonus : 0))}</span>
                            </div>
                        </div>
                    </div>
                    
                    <div class="character-sheet-section">
                        <h3>Skills</h3>
                        <div class="skills-list">
                            ${skillList.map(skill => {
                                const skillKey = skill.name.replace(/\s/g, '');
                                const isProficient = skills[skillKey];
                                const abilityMod = this.getModifierValue(abilities[skill.ability]);
                                const totalMod = abilityMod + (isProficient ? profBonus : 0);
                                return `
                                    <div class="skill-row">
                                        <input type="checkbox" id="skill${skillKey}" ${isProficient ? 'checked' : ''} onchange="game.updateSkillModifier('${skillKey}', '${skill.ability}')">
                                        <label for="skill${skillKey}">${skill.name} (${skill.ability.toUpperCase()})</label>
                                        <span class="skill-modifier" id="skill${skillKey}Mod">${totalMod >= 0 ? '+' : ''}${totalMod}</span>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                        <div class="character-sheet-field" style="margin-top: 15px;">
                            <label>Passive Perception</label>
                            <input type="number" id="passivePerception" value="${10 + this.getModifierValue(abilities.wis) + (skills.Perception ? profBonus : 0)}" readonly>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Equipment Tab -->
            <div id="equipmentTab" class="character-tab" style="display: none;">
                <div class="character-sheet-wide">
                    <div class="character-sheet-section">
                        <h3>Wealth</h3>
                        <div class="wealth-row">
                            <div class="wealth-field">
                                <label>CP</label>
                                <input type="number" id="wealthCP" value="${wealth.cp}" min="0">
                            </div>
                            <div class="wealth-field">
                                <label>SP</label>
                                <input type="number" id="wealthSP" value="${wealth.sp}" min="0">
                            </div>
                            <div class="wealth-field">
                                <label>EP</label>
                                <input type="number" id="wealthEP" value="${wealth.ep}" min="0">
                            </div>
                            <div class="wealth-field">
                                <label>GP</label>
                                <input type="number" id="wealthGP" value="${wealth.gp}" min="0">
                            </div>
                            <div class="wealth-field">
                                <label>PP</label>
                                <input type="number" id="wealthPP" value="${wealth.pp}" min="0">
                            </div>
                        </div>
                    </div>
                    
                    <div class="character-sheet-section">
                        <h3>Inventory</h3>
                        <div class="inventory-list" id="inventoryList">
                            ${inventory.map((item, index) => `
                                <div class="inventory-item" data-index="${index}">
                                    <input type="text" placeholder="Item name" value="${item.name || ''}" onchange="game.updateInventoryItem(${index}, 'name', this.value)">
                                    <input type="number" placeholder="Qty" value="${item.quantity || 1}" min="1" style="width: 60px;" onchange="game.updateInventoryItem(${index}, 'quantity', this.value)">
                                    <input type="number" placeholder="Weight" value="${item.weight || 0}" min="0" step="0.1" style="width: 80px;" onchange="game.updateInventoryItem(${index}, 'weight', this.value)"> lbs
                                    <button onclick="game.removeInventoryItem(${index})" class="btn-remove">×</button>
                                </div>
                            `).join('')}
                        </div>
                        <button onclick="game.addInventoryItem()" class="btn-secondary">Add Item</button>
                        <div class="character-sheet-field" style="margin-top: 15px;">
                            <label>Total Weight</label>
                            <input type="number" id="totalWeight" value="${inventory.reduce((sum, item) => sum + (item.weight || 0) * (item.quantity || 1), 0).toFixed(1)}" readonly> lbs
                        </div>
                    </div>
                    
                    <div class="character-sheet-section">
                        <h3>Notes</h3>
                        <textarea id="charNotes" placeholder="Additional notes, features, traits, etc." rows="6">${data.notes || ''}</textarea>
                    </div>
                </div>
            </div>
            
            <div class="character-sheet-actions">
                <button onclick="game.saveCharacterSheet()" class="btn-primary">Save Character Sheet</button>
                ${this.userRole === 'king' ? '<button onclick="game.viewAllCharacterSheets()" class="btn-secondary">View All Sheets</button>' : ''}
            </div>
        `;
    }
    
    getModifier(score) {
        return Math.floor((score - 10) / 2) >= 0 ? `+${Math.floor((score - 10) / 2)}` : `${Math.floor((score - 10) / 2)}`;
    }
    
    getModifierValue(score) {
        return Math.floor((score - 10) / 2);
    }
    
    formatModifier(value) {
        return value >= 0 ? `+${value}` : `${value}`;
    }
    
    getProficiencyBonus(level) {
        return Math.ceil(level / 4) + 1;
    }
    
    updateModifier(ability, value) {
        const modifier = this.formatModifier(this.getModifierValue(parseInt(value)));
        document.getElementById(`modifier${ability.charAt(0).toUpperCase() + ability.slice(1)}`).textContent = modifier;
    }
    
    async saveCharacterSheet() {
        // Get all character data from the form
        const characterData = {
            name: document.getElementById('charName').value,
            level: parseInt(document.getElementById('charLevel').value),
            class: document.getElementById('charClass').value,
            race: document.getElementById('charRace').value,
            background: document.getElementById('charBackground').value,
            alignment: document.getElementById('charAlignment').value,
            abilities: {
                str: parseInt(document.getElementById('abilityStr').value),
                dex: parseInt(document.getElementById('abilityDex').value),
                con: parseInt(document.getElementById('abilityCon').value),
                int: parseInt(document.getElementById('abilityInt').value),
                wis: parseInt(document.getElementById('abilityWis').value),
                cha: parseInt(document.getElementById('abilityCha').value)
            },
            combat: {
                ac: parseInt(document.getElementById('charAC').value),
                maxHp: parseInt(document.getElementById('charMaxHP').value),
                currentHp: parseInt(document.getElementById('charCurrentHP').value),
                tempHp: parseInt(document.getElementById('charTempHP').value),
                speed: parseInt(document.getElementById('charSpeed').value),
                hitDice: document.getElementById('charHitDice').value
            },
            armor: this.getArmorFromForm(),
            weapons: this.getWeaponsFromForm(),
            inventory: this.getInventoryFromForm(),
            wealth: {
                cp: parseInt(document.getElementById('wealthCP').value) || 0,
                sp: parseInt(document.getElementById('wealthSP').value) || 0,
                ep: parseInt(document.getElementById('wealthEP').value) || 0,
                gp: parseInt(document.getElementById('wealthGP').value) || 0,
                pp: parseInt(document.getElementById('wealthPP').value) || 0
            },
            skills: this.getSkillsFromForm(),
            saves: this.getSavesFromForm(),
            proficiencyBonus: parseInt(document.getElementById('charProfBonus').value),
            notes: document.getElementById('charNotes').value
        };
        
        try {
            // Handle saving new NPC/Monster sheets for Monarchs
            if (this.userRole === 'king' && (this.currentSheetId === 'new' || this.isNewSheet)) {
                const sheetName = document.getElementById('sheetName')?.value || characterData.name;
                const sheetType = document.getElementById('sheetType')?.value || 'npc';
                
                if (!sheetName) {
                    alert('Please enter a name for this NPC/Monster sheet');
                    return;
                }
                
                const response = await fetch(`/api/games/${this.gameId}/character-sheets`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.token}`
                    },
                    body: JSON.stringify({
                        name: sheetName,
                        sheetType: sheetType,
                        characterData: characterData
                    })
                });
                
                if (response.ok) {
                    alert('NPC/Monster sheet saved successfully!');
                    await this.loadSheetsList();
                    
                    // Find the new sheet and select it
                    const data = await response.json();
                    const select = document.getElementById('sheetSelect');
                    select.value = data.sheetId;
                    this.currentSheetId = data.sheetId;
                    this.isNewSheet = false;
                    document.getElementById('sheetInfo').style.display = 'none';
                } else {
                    throw new Error('Failed to save NPC/Monster sheet');
                }
            }
            // Handle updating existing NPC/Monster sheets for Monarchs
            else if (this.userRole === 'king' && this.currentSheetId !== 'player') {
                const response = await fetch(`/api/games/${this.gameId}/character-sheets/${this.currentSheetId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.token}`
                    },
                    body: JSON.stringify({
                        characterData: characterData
                    })
                });
                
                if (response.ok) {
                    alert('NPC/Monster sheet updated successfully!');
                } else {
                    throw new Error('Failed to update NPC/Monster sheet');
                }
            }
            // Handle player character sheets (original functionality)
            else {
                const response = await fetch(`/api/games/${this.gameId}/character-sheet`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.token}`
                    },
                    body: JSON.stringify({
                        characterName: characterData.name,
                        characterData: characterData
                    })
                });
                
                if (response.ok) {
                    alert('Character sheet saved successfully!');
                } else {
                    throw new Error('Failed to save character sheet');
                }
            }
        } catch (error) {
            console.error('Failed to save character sheet:', error);
            
            // Check if this is an NPC/Monster sheet save attempt without backend support
            if (this.userRole === 'king' && this.currentSheetId !== 'player') {
                alert('NPC/Monster character sheets feature requires backend implementation. The API endpoints for multiple character sheets are not yet available.');
            } else {
                alert('Failed to save character sheet. Please try again.');
            }
        }
    }
    
    closeCharacterSheetModal() {
        document.getElementById('characterSheetModal').style.display = 'none';
    }
    
    // UI Settings Modal Management
    openUISettingsModal() {
        document.getElementById('uiSettingsModal').style.display = 'flex';
        this.initializeUISettings();
    }
    
    closeUISettingsModal() {
        document.getElementById('uiSettingsModal').style.display = 'none';
    }
    
    initializeUISettings() {
        // Define color palettes inspired by scientific color schemes
        this.colorPalettes = {
            default: {
                name: 'Default Dark',
                colors: {
                    primary: '#ffffff',
                    secondary: '#cccccc',
                    background: '#1a1a1a',
                    surface: '#2a2a2a',
                    accent: '#4a4a4a',
                    text: '#ffffff',
                    textSecondary: '#b0b0b0',
                    border: '#3a3a3a'
                }
            },
            inferno: {
                name: 'Inferno',
                colors: {
                    primary: '#fcffa4',
                    secondary: '#f0605d',
                    background: '#000004',
                    surface: '#1b0c33',
                    accent: '#ba2f5b',
                    text: '#fcffa4',
                    textSecondary: '#c7306c',
                    border: '#420a68'
                }
            },
            magma: {
                name: 'Magma',
                colors: {
                    primary: '#fcfdbf',
                    secondary: '#fc8961',
                    background: '#000004',
                    surface: '#2c115f',
                    accent: '#b73779',
                    text: '#fcfdbf',
                    textSecondary: '#de4968',
                    border: '#51127c'
                }
            },
            viridis: {
                name: 'Viridis',
                colors: {
                    primary: '#fde725',
                    secondary: '#a0da39', 
                    background: '#1f2d1f',
                    surface: '#2d4a2d',
                    accent: '#440154',
                    text: '#fde725',
                    textSecondary: '#5dc863',
                    border: '#35b779'
                }
            },
            plasma: {
                name: 'Plasma',
                colors: {
                    primary: '#f0f921',
                    secondary: '#cc4778',
                    background: '#0d0887',
                    surface: '#6a0a83',
                    accent: '#eb5268',
                    text: '#f0f921',
                    textSecondary: '#db5c68',
                    border: '#9b179e'
                }
            },
            coldfire: {
                name: 'Cold Fire',
                colors: {
                    primary: '#ff4444',
                    secondary: '#44aaff',
                    background: '#001122',
                    surface: '#1a2844',
                    accent: '#ff6633',
                    text: '#ffffff',
                    textSecondary: '#aaccff',
                    border: '#2244aa'
                }
            },
            arctic: {
                name: 'Arctic',
                colors: {
                    primary: '#87ceeb',
                    secondary: '#b0e0e6',
                    background: '#0f1419',
                    surface: '#1e2833',
                    accent: '#4682b4',
                    text: '#f0f8ff',
                    textSecondary: '#b0d4e6',
                    border: '#2f4f4f'
                }
            },
            ember: {
                name: 'Ember',
                colors: {
                    primary: '#ff6b35',
                    secondary: '#f7931e',
                    background: '#1a0e00',
                    surface: '#2d1b00',
                    accent: '#c5450e',
                    text: '#fff5e6',
                    textSecondary: '#ffb366',
                    border: '#4a2500'
                }
            }
        };
        
        this.renderColorPalettes();
        this.loadCurrentPalette();
    }
    
    renderColorPalettes() {
        const grid = document.getElementById('colorPaletteGrid');
        const currentPalette = localStorage.getItem('selectedPalette') || 'default';
        
        grid.innerHTML = '';
        
        Object.keys(this.colorPalettes).forEach(paletteKey => {
            const palette = this.colorPalettes[paletteKey];
            const option = document.createElement('div');
            option.className = 'color-palette-option';
            option.dataset.palette = paletteKey;
            
            if (paletteKey === currentPalette) {
                option.classList.add('active');
            }
            
            option.innerHTML = `
                <div class="palette-name">${palette.name}</div>
                <div class="palette-description">Click to apply this color theme</div>
            `;
            
            option.addEventListener('click', () => {
                this.selectColorPalette(paletteKey);
            });
            
            grid.appendChild(option);
        });
    }
    
    selectColorPalette(paletteKey) {
        // Update active state
        document.querySelectorAll('.color-palette-option').forEach(option => {
            option.classList.remove('active');
        });
        document.querySelector(`[data-palette="${paletteKey}"]`).classList.add('active');
        
        // Save selection and apply palette
        localStorage.setItem('selectedPalette', paletteKey);
        this.applyColorPalette(paletteKey);
        this.updatePalettePreview(paletteKey);
    }
    
    applyColorPalette(paletteKey) {
        const palette = this.colorPalettes[paletteKey];
        const root = document.documentElement;
        
        // Calculate derived colors
        const surfaceDarker = this.darkenColor(palette.colors.surface, 20);
        const borderColor = this.darkenColor(palette.colors.surface, 30);
        const accentHover = this.lightenColor(palette.colors.accent, 15);
        
        // Apply comprehensive CSS custom properties
        root.style.setProperty('--primary-color', palette.colors.primary);
        root.style.setProperty('--secondary-color', palette.colors.secondary);
        root.style.setProperty('--background-color', palette.colors.background);
        root.style.setProperty('--surface-color', palette.colors.surface);
        root.style.setProperty('--surface-darker', surfaceDarker);
        root.style.setProperty('--border-color', palette.colors.border);
        root.style.setProperty('--accent-color', palette.colors.accent);
        root.style.setProperty('--accent-hover', accentHover);
        root.style.setProperty('--text-color', palette.colors.text);
        root.style.setProperty('--text-secondary', palette.colors.textSecondary);
        
        // Update chat container with alpha
        const chatContainer = document.querySelector('.chat-container');
        if (chatContainer) {
            const surfaceRgb = this.hexToRgb(palette.colors.surface);
            chatContainer.style.background = `rgba(${surfaceRgb.r}, ${surfaceRgb.g}, ${surfaceRgb.b}, 0.95)`;
        }
        
        // Force update of elements that might not pick up CSS variables immediately
        this.forceUpdateElements(palette);
    }
    
    darkenColor(hex, percent) {
        const rgb = this.hexToRgb(hex);
        const factor = (100 - percent) / 100;
        return this.rgbToHex(
            Math.round(rgb.r * factor),
            Math.round(rgb.g * factor),
            Math.round(rgb.b * factor)
        );
    }
    
    lightenColor(hex, percent) {
        const rgb = this.hexToRgb(hex);
        const factor = percent / 100;
        return this.rgbToHex(
            Math.round(rgb.r + (255 - rgb.r) * factor),
            Math.round(rgb.g + (255 - rgb.g) * factor),
            Math.round(rgb.b + (255 - rgb.b) * factor)
        );
    }
    
    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    }
    
    rgbToHex(r, g, b) {
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }
    
    forceUpdateElements(palette) {
        // Force update all panel backgrounds and borders
        const panelElements = [
            { selector: '.controls', background: palette.colors.surface, color: palette.colors.text, border: palette.colors.border },
            { selector: '.roll-sidebar', background: palette.colors.surface, color: palette.colors.text, border: palette.colors.border },
            { selector: '.modal-content', background: palette.colors.surface, color: palette.colors.text, border: palette.colors.border },
            { selector: '.panel-collapse-btn', background: this.darkenColor(palette.colors.surface, 20), color: palette.colors.text },
        ];
        
        panelElements.forEach(item => {
            const elements = document.querySelectorAll(item.selector);
            elements.forEach(el => {
                if (item.background) el.style.backgroundColor = item.background;
                if (item.color) el.style.color = item.color;
                if (item.border) el.style.borderColor = item.border;
            });
        });
        
        // Aggressively update ALL text elements in panels
        const textSelectors = [
            '.controls, .controls *',
            '.roll-sidebar, .roll-sidebar *', 
            '.modal-content, .modal-content *',
            '.chat-container, .chat-container *',
            'label, span, div, p, h1, h2, h3, h4, h5, h6'
        ];
        
        textSelectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                // Skip elements with specific color classes or inline styles we want to preserve
                if (!el.classList.contains('game-name') && 
                    !el.classList.contains('user-role') &&
                    !el.id.includes('joinCode') &&
                    !el.classList.contains('chat-message')) {
                    el.style.color = palette.colors.text;
                }
            });
        });
        
        // Update specific text elements that need primary colors
        const primaryColorElements = document.querySelectorAll('.game-name, h1, .controls h3');
        primaryColorElements.forEach(el => {
            el.style.color = palette.colors.primary;
        });
        
        // Update secondary text elements  
        const secondaryColorElements = document.querySelectorAll('.chat-message .timestamp, .palette-description');
        secondaryColorElements.forEach(el => {
            el.style.color = palette.colors.textSecondary;
        });
        
        // Update button hover states dynamically
        this.updateButtonHoverStates(palette);
    }
    
    updateButtonHoverStates(palette) {
        const style = document.getElementById('dynamic-hover-styles') || document.createElement('style');
        style.id = 'dynamic-hover-styles';
        
        const accentHover = this.lightenColor(palette.colors.accent, 15);
        const surfaceHover = this.lightenColor(this.darkenColor(palette.colors.surface, 20), 10);
        
        style.textContent = `
            .room-info button:hover { background: ${accentHover} !important; }
            .panel-collapse-btn:hover { background: ${surfaceHover} !important; }
            .btn-secondary:hover { background: ${accentHover} !important; }
            .color-palette-option.active { border-color: ${palette.colors.primary} !important; background: ${this.lightenColor(palette.colors.surface, 10)} !important; }
        `;
        
        if (!document.head.contains(style)) {
            document.head.appendChild(style);
        }
    }
    
    loadCurrentPalette() {
        const currentPalette = localStorage.getItem('selectedPalette') || 'default';
        this.applyColorPalette(currentPalette);
        this.updatePalettePreview(currentPalette);
    }
    
    updatePalettePreview(paletteKey) {
        const palette = this.colorPalettes[paletteKey];
        document.getElementById('currentPaletteName').textContent = palette.name;
        
        const preview = document.getElementById('palettePreview');
        preview.innerHTML = `
            <span style="color: ${palette.colors.primary};">■</span>
            <span style="color: ${palette.colors.secondary};">■</span>
            <span style="color: ${palette.colors.accent};">■</span>
            <span style="color: ${palette.colors.text};">■</span>
            <span style="background: ${palette.colors.surface}; padding: 2px 8px; border-radius: 3px; color: ${palette.colors.text};">Sample</span>
        `;
    }
    
    // Character Sheet Tab Management
    switchCharacterTab(tabName) {
        // Hide all tabs
        const tabs = document.querySelectorAll('.character-tab');
        tabs.forEach(tab => tab.style.display = 'none');
        
        // Show selected tab
        document.getElementById(`${tabName}Tab`).style.display = 'block';
        
        // Update tab button states
        const buttons = document.querySelectorAll('.tab-button');
        buttons.forEach(btn => btn.classList.remove('active'));
        event.target.classList.add('active');
    }
    
    // Character Sheet Auto-Calculations
    updateAllCalculations() {
        this.updateModifiers();
        this.updateArmorAC();
        this.updateInitiative();
        this.updateSkillModifiers();
        this.updateSaveModifiers();
        this.updatePassivePerception();
    }
    
    updateModifiers() {
        const abilities = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        abilities.forEach(ability => {
            const score = parseInt(document.getElementById(`ability${ability.charAt(0).toUpperCase() + ability.slice(1)}`).value);
            const modifier = Math.floor((score - 10) / 2);
            const modifierText = modifier >= 0 ? `+${modifier}` : `${modifier}`;
            document.getElementById(`modifier${ability.charAt(0).toUpperCase() + ability.slice(1)}`).textContent = modifierText;
        });
    }
    
    updateProficiencyBonus() {
        const level = parseInt(document.getElementById('charLevel').value);
        const profBonus = this.getProficiencyBonus(level);
        document.getElementById('charProfBonus').value = profBonus;
        this.updateAllCalculations();
    }
    
    updateArmorAC() {
        const dexScore = parseInt(document.getElementById('abilityDex').value);
        const dexMod = Math.floor((dexScore - 10) / 2);
        
        // Calculate total armor bonus from all armor pieces
        let totalArmorBonus = 0;
        const armorEntries = document.querySelectorAll('.armor-entry');
        armorEntries.forEach(entry => {
            const acBonusInput = entry.querySelector('input[placeholder="AC Bonus"]');
            if (acBonusInput && acBonusInput.value) {
                totalArmorBonus += parseInt(acBonusInput.value) || 0;
            }
        });
        
        // Calculate total AC bonus from weapons with AC modifiers
        let totalWeaponACBonus = 0;
        const weaponEntries = document.querySelectorAll('.weapon-entry');
        weaponEntries.forEach(entry => {
            const selects = entry.querySelectorAll('select');
            const inputs = entry.querySelectorAll('input');
            if (selects[1] && selects[1].value === 'ac' && inputs[2]) {
                totalWeaponACBonus += parseInt(inputs[2].value) || 0;
            }
        });
        
        const finalAC = 10 + dexMod + totalArmorBonus + totalWeaponACBonus;
        const formula = `10 + ${dexMod} + ${totalArmorBonus + totalWeaponACBonus}`;
        
        document.getElementById('charAC').value = finalAC;
        document.getElementById('acFormula').textContent = `(${formula})`;
    }
    
    applyArmorModifier() {
        // This will be used to apply stat modifiers from armor
        // Implementation can be added later for automatic stat adjustments
        console.log('Armor modifier applied');
    }
    
    updateInitiative() {
        const dexScore = parseInt(document.getElementById('abilityDex').value);
        const dexMod = Math.floor((dexScore - 10) / 2);
        document.getElementById('charInitiative').value = dexMod;
    }
    
    updateSkillModifiers() {
        const skillList = [
            { name: 'Acrobatics', ability: 'dex' },
            { name: 'Animal Handling', ability: 'wis' },
            { name: 'Arcana', ability: 'int' },
            { name: 'Athletics', ability: 'str' },
            { name: 'Deception', ability: 'cha' },
            { name: 'History', ability: 'int' },
            { name: 'Insight', ability: 'wis' },
            { name: 'Intimidation', ability: 'cha' },
            { name: 'Investigation', ability: 'int' },
            { name: 'Medicine', ability: 'wis' },
            { name: 'Nature', ability: 'int' },
            { name: 'Perception', ability: 'wis' },
            { name: 'Performance', ability: 'cha' },
            { name: 'Persuasion', ability: 'cha' },
            { name: 'Religion', ability: 'int' },
            { name: 'Sleight of Hand', ability: 'dex' },
            { name: 'Stealth', ability: 'dex' },
            { name: 'Survival', ability: 'wis' }
        ];
        
        const profBonus = parseInt(document.getElementById('charProfBonus').value);
        
        skillList.forEach(skill => {
            const skillKey = skill.name.replace(/\s/g, '');
            const abilityScore = parseInt(document.getElementById(`ability${skill.ability.charAt(0).toUpperCase() + skill.ability.slice(1)}`).value);
            const abilityMod = Math.floor((abilityScore - 10) / 2);
            const isProficient = document.getElementById(`skill${skillKey}`) ? document.getElementById(`skill${skillKey}`).checked : false;
            const totalMod = abilityMod + (isProficient ? profBonus : 0);
            
            const modElement = document.getElementById(`skill${skillKey}Mod`);
            if (modElement) {
                modElement.textContent = totalMod >= 0 ? `+${totalMod}` : `${totalMod}`;
            }
        });
    }
    
    updateSaveModifiers() {
        const saves = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
        const profBonus = parseInt(document.getElementById('charProfBonus').value);
        
        saves.forEach(save => {
            const abilityScore = parseInt(document.getElementById(`ability${save.charAt(0).toUpperCase() + save.slice(1)}`).value);
            const abilityMod = Math.floor((abilityScore - 10) / 2);
            const isProficient = document.getElementById(`save${save.charAt(0).toUpperCase() + save.slice(1)}Prof`).checked;
            const totalMod = abilityMod + (isProficient ? profBonus : 0);
            
            document.getElementById(`save${save.charAt(0).toUpperCase() + save.slice(1)}Mod`).textContent = totalMod >= 0 ? `+${totalMod}` : `${totalMod}`;
        });
    }
    
    updateSkillModifier(skillKey, ability) {
        const abilityScore = parseInt(document.getElementById(`ability${ability.charAt(0).toUpperCase() + ability.slice(1)}`).value);
        const abilityMod = Math.floor((abilityScore - 10) / 2);
        const isProficient = document.getElementById(`skill${skillKey}`).checked;
        const profBonus = parseInt(document.getElementById('charProfBonus').value);
        const totalMod = abilityMod + (isProficient ? profBonus : 0);
        
        document.getElementById(`skill${skillKey}Mod`).textContent = totalMod >= 0 ? `+${totalMod}` : `${totalMod}`;
        this.updatePassivePerception();
    }
    
    updateSaveModifier(ability) {
        const abilityScore = parseInt(document.getElementById(`ability${ability.charAt(0).toUpperCase() + ability.slice(1)}`).value);
        const abilityMod = Math.floor((abilityScore - 10) / 2);
        const isProficient = document.getElementById(`save${ability.charAt(0).toUpperCase() + ability.slice(1)}Prof`).checked;
        const profBonus = parseInt(document.getElementById('charProfBonus').value);
        const totalMod = abilityMod + (isProficient ? profBonus : 0);
        
        document.getElementById(`save${ability.charAt(0).toUpperCase() + ability.slice(1)}Mod`).textContent = totalMod >= 0 ? `+${totalMod}` : `${totalMod}`;
    }
    
    updatePassivePerception() {
        const wisScore = parseInt(document.getElementById('abilityWis').value);
        const wisMod = Math.floor((wisScore - 10) / 2);
        const isProficient = document.getElementById('skillPerception') ? document.getElementById('skillPerception').checked : false;
        const profBonus = parseInt(document.getElementById('charProfBonus').value);
        const passivePerception = 10 + wisMod + (isProficient ? profBonus : 0);
        
        const ppElement = document.getElementById('passivePerception');
        if (ppElement) {
            ppElement.value = passivePerception;
        }
    }
    
    // Armor Management
    addArmor() {
        const armorList = document.getElementById('armorList');
        const index = armorList.children.length;
        
        const armorEntry = document.createElement('div');
        armorEntry.className = 'armor-entry';
        armorEntry.setAttribute('data-index', index);
        armorEntry.innerHTML = `
            <input type="text" placeholder="Armor Name" onchange="game.updateArmor(${index}, 'name', this.value)">
            <input type="number" placeholder="AC Bonus" value="0" min="0" onchange="game.updateArmor(${index}, 'acBonus', this.value); game.updateArmorAC()">
            <select onchange="game.updateArmor(${index}, 'statMod', this.value)">
                <option value="">No Stat Mod</option>
                <option value="str">STR</option>
                <option value="dex">DEX</option>
                <option value="con">CON</option>
                <option value="int">INT</option>
                <option value="wis">WIS</option>
                <option value="cha">CHA</option>
                <option value="ac">AC</option>
                <option value="hp">HP</option>
                <option value="initiative">Initiative</option>
                <option value="speed">Speed</option>
                <option value="proficiency">Prof</option>
            </select>
            <input type="number" placeholder="Value" value="0" style="width: 60px;" onchange="game.updateArmor(${index}, 'statModValue', this.value)">
            <button onclick="game.removeArmor(${index})" class="btn-remove">×</button>
        `;
        armorList.appendChild(armorEntry);
    }
    
    removeArmor(index) {
        const armorEntry = document.querySelector(`.armor-entry[data-index="${index}"]`);
        if (armorEntry) {
            armorEntry.remove();
            this.updateArmorAC();
        }
    }
    
    updateArmor(index, field, value) {
        // This is handled by the form itself, no additional logic needed
    }
    
    getArmorFromForm() {
        const armor = [];
        const armorEntries = document.querySelectorAll('.armor-entry');
        
        armorEntries.forEach(entry => {
            const inputs = entry.querySelectorAll('input');
            const select = entry.querySelector('select');
            
            if (inputs[0].value.trim()) { // Only include armor with names
                armor.push({
                    name: inputs[0].value.trim(),
                    acBonus: parseInt(inputs[1].value) || 0,
                    statMod: select.value,
                    statModValue: parseInt(inputs[2].value) || 0
                });
            }
        });
        
        return armor;
    }

    // Weapon Management
    addWeapon() {
        const weaponsList = document.getElementById('weaponsList');
        const index = weaponsList.children.length;
        
        const weaponEntry = document.createElement('div');
        weaponEntry.className = 'weapon-entry';
        weaponEntry.setAttribute('data-index', index);
        weaponEntry.innerHTML = `
            <input type="text" placeholder="Weapon Name" onchange="game.updateWeapon(${index}, 'name', this.value)">
            <input type="text" placeholder="Damage (1d8)" onchange="game.updateWeapon(${index}, 'damage', this.value)">
            <select onchange="game.updateWeapon(${index}, 'type', this.value)">
                <option value="melee">Melee</option>
                <option value="ranged">Ranged</option>
            </select>
            <select onchange="game.updateWeapon(${index}, 'statMod', this.value)">
                <option value="">No Stat Mod</option>
                <option value="str">STR</option>
                <option value="dex">DEX</option>
                <option value="con">CON</option>
                <option value="int">INT</option>
                <option value="wis">WIS</option>
                <option value="cha">CHA</option>
                <option value="ac">AC</option>
                <option value="hp">HP</option>
                <option value="initiative">Initiative</option>
                <option value="speed">Speed</option>
                <option value="proficiency">Prof</option>
            </select>
            <input type="number" placeholder="Value" value="0" style="width: 60px;" onchange="game.updateWeapon(${index}, 'statModValue', this.value)">
            <button onclick="game.removeWeapon(${index})" class="btn-remove">×</button>
        `;
        weaponsList.appendChild(weaponEntry);
    }
    
    removeWeapon(index) {
        const weaponEntry = document.querySelector(`.weapon-entry[data-index="${index}"]`);
        if (weaponEntry) {
            weaponEntry.remove();
        }
    }
    
    updateWeapon(index, field, value) {
        // This is handled by the form itself, no additional logic needed
    }
    
    getWeaponsFromForm() {
        const weapons = [];
        const weaponEntries = document.querySelectorAll('.weapon-entry');
        
        weaponEntries.forEach(entry => {
            const inputs = entry.querySelectorAll('input');
            const selects = entry.querySelectorAll('select');
            
            if (inputs[0].value.trim()) { // Only include weapons with names
                weapons.push({
                    name: inputs[0].value.trim(),
                    damage: inputs[1].value.trim(),
                    type: selects[0].value,
                    statMod: selects[1].value,
                    statModValue: parseInt(inputs[2].value) || 0
                });
            }
        });
        
        return weapons;
    }
    
    // Inventory Management
    addInventoryItem() {
        const inventoryList = document.getElementById('inventoryList');
        const index = inventoryList.children.length;
        
        const inventoryItem = document.createElement('div');
        inventoryItem.className = 'inventory-item';
        inventoryItem.setAttribute('data-index', index);
        inventoryItem.innerHTML = `
            <input type="text" placeholder="Item name" onchange="game.updateInventoryItem(${index}, 'name', this.value); game.updateTotalWeight()">
            <input type="number" placeholder="Qty" value="1" min="1" style="width: 60px;" onchange="game.updateInventoryItem(${index}, 'quantity', this.value); game.updateTotalWeight()">
            <input type="number" placeholder="Weight" value="0" min="0" step="0.1" style="width: 80px;" onchange="game.updateInventoryItem(${index}, 'weight', this.value); game.updateTotalWeight()"> lbs
            <button onclick="game.removeInventoryItem(${index})" class="btn-remove">×</button>
        `;
        inventoryList.appendChild(inventoryItem);
    }
    
    removeInventoryItem(index) {
        const inventoryItem = document.querySelector(`.inventory-item[data-index="${index}"]`);
        if (inventoryItem) {
            inventoryItem.remove();
            this.updateTotalWeight();
        }
    }
    
    updateInventoryItem(index, field, value) {
        // This is handled by the form itself
    }
    
    getInventoryFromForm() {
        const inventory = [];
        const inventoryItems = document.querySelectorAll('.inventory-item');
        
        inventoryItems.forEach(item => {
            const inputs = item.querySelectorAll('input');
            
            if (inputs[0].value.trim()) { // Only include items with names
                inventory.push({
                    name: inputs[0].value.trim(),
                    quantity: parseInt(inputs[1].value) || 1,
                    weight: parseFloat(inputs[2].value) || 0
                });
            }
        });
        
        return inventory;
    }
    
    updateTotalWeight() {
        let totalWeight = 0;
        const inventoryItems = document.querySelectorAll('.inventory-item');
        
        inventoryItems.forEach(item => {
            const inputs = item.querySelectorAll('input');
            const quantity = parseInt(inputs[1].value) || 0;
            const weight = parseFloat(inputs[2].value) || 0;
            totalWeight += quantity * weight;
        });
        
        const totalWeightElement = document.getElementById('totalWeight');
        if (totalWeightElement) {
            totalWeightElement.value = totalWeight.toFixed(1);
        }
    }
    
    // Data Collection for Save
    getSkillsFromForm() {
        const skills = {};
        const skillList = [
            'Acrobatics', 'AnimalHandling', 'Arcana', 'Athletics', 'Deception',
            'History', 'Insight', 'Intimidation', 'Investigation', 'Medicine',
            'Nature', 'Perception', 'Performance', 'Persuasion', 'Religion',
            'SleightofHand', 'Stealth', 'Survival'
        ];
        
        skillList.forEach(skill => {
            const checkbox = document.getElementById(`skill${skill}`);
            if (checkbox) {
                skills[skill] = checkbox.checked;
            }
        });
        
        return skills;
    }
    
    getSavesFromForm() {
        const saves = {};
        const saveList = ['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha'];
        
        saveList.forEach(save => {
            const checkbox = document.getElementById(`save${save}Prof`);
            if (checkbox) {
                saves[`${save.toLowerCase()}Prof`] = checkbox.checked;
            }
        });
        
        return saves;
    }
    
    toggleQuickRolls() {
        const popup = document.getElementById('quickRollsPopup');
        popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
    }
    
    async loadMacros() {
        try {
            const response = await fetch(`/api/games/${this.gameId}/macros`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                this.macros = data.macros;
                this.updateMacrosDisplay();
                this.updateMacrosConfig();
            }
        } catch (err) {
            console.error('Failed to load macros:', err);
        }
    }
    
    updateMacrosDisplay() {
        const macrosList = document.getElementById('macrosList');
        
        if (!this.macros || this.macros.length === 0) {
            macrosList.innerHTML = '<div style="color: #808080; text-align: center; padding: 1rem;">No macros configured</div>';
            return;
        }
        
        macrosList.innerHTML = this.macros.map(macro => `
            <button class="macro-button" onclick="game.executeMacro('${macro.formula}', '${macro.name}')">
                <span class="macro-name">${macro.name}</span>
                <span class="macro-formula">${macro.formula}</span>
            </button>
        `).join('');
    }
    
    updateMacrosConfig() {
        const configList = document.getElementById('macroConfigList');
        
        if (!this.macros || this.macros.length === 0) {
            configList.innerHTML = '<div style="color: #808080; text-align: center; padding: 1rem;">No macros created</div>';
            return;
        }
        
        configList.innerHTML = this.macros.map(macro => `
            <div class="macro-config-item">
                <div>
                    <strong>${macro.name}</strong><br>
                    <code style="color: #b0b0b0; font-size: 0.8rem;">${macro.formula}</code>
                    ${macro.description ? `<br><span style="color: #808080; font-size: 0.8rem;">${macro.description}</span>` : ''}
                </div>
                <button onclick="game.deleteMacro(${macro.id})">Delete</button>
            </div>
        `).join('');
    }
    
    async addMacro() {
        const name = document.getElementById('macroName').value.trim();
        const formula = document.getElementById('macroFormula').value.trim();
        const description = document.getElementById('macroDescription').value.trim();
        const linkedCharacterSheet = this.userRole === 'king' ? 
            document.getElementById('macroCharacterSheet')?.value || null : null;
        
        if (!name || !formula) {
            alert('Name and formula are required');
            return;
        }
        
        try {
            const macroData = { name, formula, description };
            if (linkedCharacterSheet) {
                macroData.linkedCharacterSheet = linkedCharacterSheet;
            }
            
            const response = await fetch(`/api/games/${this.gameId}/macros`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify(macroData)
            });
            
            if (response.ok) {
                // Clear form
                document.getElementById('macroName').value = '';
                document.getElementById('macroFormula').value = '';
                document.getElementById('macroDescription').value = '';
                
                // Reload macros
                await this.loadMacros();
            } else {
                const error = await response.json();
                alert(error.error || 'Failed to create macro');
            }
        } catch (err) {
            console.error('Failed to create macro:', err);
            alert('Failed to create macro');
        }
    }
    
    async deleteMacro(macroId) {
        if (!confirm('Are you sure you want to delete this macro?')) {
            return;
        }
        
        try {
            const response = await fetch(`/api/games/${this.gameId}/macros/${macroId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            if (response.ok) {
                await this.loadMacros();
            } else {
                alert('Failed to delete macro');
            }
        } catch (err) {
            console.error('Failed to delete macro:', err);
            alert('Failed to delete macro');
        }
    }
    
    executeMacro(formula, name) {
        // Use existing roll functionality
        this.quickRoll(formula, name);
    }
    
    setupGrailOptionsListeners() {
        if (this.userRole !== 'king') return;
        
        document.getElementById('applyGrailOptions').addEventListener('click', () => {
            this.applyGrailOptions();
        });
        
        document.getElementById('resetGrailOptions').addEventListener('click', () => {
            this.resetGrailOptions();
        });
    }
    
    async checkAndLoadGrailModifiers() {
        console.log('🔍 Checking if knight has grail for modifier loading...');
        // Wait a bit for participants to load, then check
        setTimeout(async () => {
            const participant = this.participants?.find(p => p.id === this.user.id);
            const hasGrail = participant?.has_grail;
            console.log('🏆 Knight has grail:', hasGrail);
            
            if (hasGrail) {
                console.log('✅ Knight has grail, loading modifiers...');
                await this.loadGrailModifiers();
            }
        }, 1000); // Give time for participants to load
    }
    
    async loadGrailModifiers() {
        console.log('🔧 Loading grail modifiers...');
        try {
            const response = await fetch(`/api/games/${this.gameId}/grail/modifiers`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            console.log('📡 Grail modifiers response status:', response.status);
            
            if (response.ok) {
                const data = await response.json();
                console.log('📥 Grail modifiers data:', data);
                
                // Handle legacy format migration
                let modifiers = data.modifiers;
                if (modifiers && (modifiers.rollModifier !== undefined || modifiers.damageModifier !== undefined)) {
                    console.log('🔄 Migrating legacy grail modifier format');
                    // Convert old singular format to new array format
                    const legacyRollModifier = modifiers.rollModifier;
                    const legacyDamageModifier = modifiers.damageModifier;
                    
                    modifiers = {
                        rollModifiers: legacyRollModifier && legacyRollModifier !== 'none' ? [legacyRollModifier] : [],
                        damageModifiers: legacyDamageModifier && legacyDamageModifier !== 'none' ? [legacyDamageModifier] : [],
                        customMessage: modifiers.customMessage || ''
                    };
                    console.log('✅ Migrated to new format:', modifiers);
                }
                
                this.grailModifiers = modifiers;
                console.log('✅ Grail modifiers loaded:', this.grailModifiers);
                this.updateGrailOptionsUI();
            } else {
                console.log('⚠️ Failed to load grail modifiers, status:', response.status);
            }
        } catch (err) {
            console.error('❌ Failed to load grail modifiers:', err);
            // Make sure we have a fallback
            this.grailModifiers = {
                rollModifiers: [],
                damageModifiers: [],
                customMessage: ''
            };
        }
    }
    
    updateGrailOptionsUI() {
        console.log('🎨 Updating grail options UI...');
        if (!this.grailModifiers) {
            console.log('⚠️ No grail modifiers to update UI with');
            return;
        }
        
        try {
            // Clear all checkboxes first
            document.querySelectorAll('.grail-modifiers-list input[type="checkbox"]').forEach(cb => cb.checked = false);
            document.querySelectorAll('.grail-damage-modifiers-list input[type="checkbox"]').forEach(cb => cb.checked = false);
        
        // Set roll modifiers
        if (this.grailModifiers.rollModifiers && Array.isArray(this.grailModifiers.rollModifiers)) {
            this.grailModifiers.rollModifiers.forEach(modifier => {
                const checkbox = document.getElementById(`grail_${modifier}`);
                if (checkbox) checkbox.checked = true;
            });
        }
        
        // Set damage modifiers  
        if (this.grailModifiers.damageModifiers && Array.isArray(this.grailModifiers.damageModifiers)) {
            this.grailModifiers.damageModifiers.forEach(modifier => {
                const checkbox = document.getElementById(`grail_dmg_${modifier}`);
                if (checkbox) checkbox.checked = true;
            });
        }
        
        // Set custom message
        const messageInput = document.getElementById('grailMessage');
        if (messageInput) {
            messageInput.value = this.grailModifiers.customMessage || '';
        }
        
        console.log('✅ Grail options UI updated successfully');
        } catch (error) {
            console.error('❌ Error updating grail options UI:', error);
        }
    }
    
    async applyGrailOptions() {
        console.log('⚙️ Applying grail options...');
        
        // Collect selected roll modifiers
        const rollModifiers = [];
        const rollCheckboxes = document.querySelectorAll('.grail-modifiers-list input[type="checkbox"]:checked');
        console.log('📋 Found roll checkboxes checked:', rollCheckboxes.length);
        rollCheckboxes.forEach(cb => {
            console.log('✅ Roll modifier:', cb.value);
            rollModifiers.push(cb.value);
        });
        
        // Collect selected damage modifiers
        const damageModifiers = [];
        const damageCheckboxes = document.querySelectorAll('.grail-damage-modifiers-list input[type="checkbox"]:checked');
        console.log('📋 Found damage checkboxes checked:', damageCheckboxes.length);
        damageCheckboxes.forEach(cb => {
            console.log('✅ Damage modifier:', cb.value);
            damageModifiers.push(cb.value);
        });
        
        // Get custom message
        const customMessage = document.getElementById('grailMessage').value.trim();
        console.log('📝 Custom message:', `"${customMessage}"`);
        
        console.log('📤 Sending to server:', { rollModifiers, damageModifiers, customMessage });
        
        try {
            const response = await fetch(`/api/games/${this.gameId}/grail/modifiers`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({
                    rollModifiers,
                    damageModifiers,
                    customMessage
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                this.grailModifiers = data.modifiers;
                alert('Grail modifiers applied successfully!');
            } else {
                const error = await response.json();
                alert(error.error || 'Failed to apply grail modifiers');
            }
        } catch (err) {
            console.error('Failed to apply grail modifiers:', err);
            alert('Failed to apply grail modifiers');
        }
    }
    
    async resetGrailOptions() {
        // Clear all checkboxes
        document.querySelectorAll('.grail-modifiers-list input[type="checkbox"]').forEach(cb => cb.checked = false);
        document.querySelectorAll('.grail-damage-modifiers-list input[type="checkbox"]').forEach(cb => cb.checked = false);
        // Clear custom message
        document.getElementById('grailMessage').value = '';
        await this.applyGrailOptions();
    }
    
    toggleSection(sectionName) {
        const content = document.getElementById(sectionName + 'Content');
        const arrow = document.getElementById(sectionName + 'Arrow');
        
        if (content.classList.contains('collapsed')) {
            content.classList.remove('collapsed');
            arrow.classList.remove('collapsed');
            arrow.textContent = '▼';
        } else {
            content.classList.add('collapsed');
            arrow.classList.add('collapsed');
            arrow.textContent = '▶';
        }
    }
    
    // Modified quickRoll method to apply grail modifiers
    quickRoll(expression, description = null) {
        console.log('🎲 quickRoll called with:', expression, description);
        console.log('🎮 Game object exists:', !!this);
        console.log('🔌 Socket exists:', !!this.socket);
        console.log('👤 User exists:', !!this.user);
        console.log('🎯 Participants:', this.participants);
        
        // Check if current user has grail and apply modifiers
        const participant = this.participants?.find(p => p.id === this.user.id);
        const hasGrail = participant?.has_grail;
        console.log('🏆 Has grail:', hasGrail);
        console.log('⚙️ Grail modifiers:', this.grailModifiers);
        console.log('📊 Grail modifiers type:', typeof this.grailModifiers);
        if (this.grailModifiers) {
            console.log('🎯 Roll modifiers:', this.grailModifiers.rollModifiers);
            console.log('🎯 Roll modifiers length:', this.grailModifiers.rollModifiers?.length);
            console.log('💥 Damage modifiers:', this.grailModifiers.damageModifiers);
            console.log('📝 Custom message:', this.grailModifiers.customMessage);
        }
        
        let modifiedExpression = expression;
        let modifiedDescription = description;
        
        if (hasGrail && this.grailModifiers && this.grailModifiers.rollModifiers.length > 0) {
            console.log('🔮 Applying roll modifiers:', this.grailModifiers.rollModifiers);
            try {
                // Apply all roll modifiers
                this.grailModifiers.rollModifiers.forEach(modifier => {
                    console.log('🎯 Applying modifier:', modifier, 'to expression:', modifiedExpression);
                    const newExpression = this.applyGrailRollModifier(modifiedExpression, modifier);
                    console.log('✨ Result:', newExpression);
                    modifiedExpression = newExpression;
                });
                // Only add custom message if one is configured
                if (this.grailModifiers.customMessage) {
                    modifiedDescription = (description ? description + ' ' : '') + this.grailModifiers.customMessage;
                }
                console.log('✅ Grail modifiers applied successfully');
            } catch (error) {
                console.error('❌ Error applying grail modifiers:', error);
                // Continue with original expression if modifiers fail
            }
        }
        
        console.log('📝 Final expression:', modifiedExpression);
        console.log('📄 Final description:', modifiedDescription);
        console.log('🎲 Calling performRoll...');
        
        // Use performRoll which handles the full dice parsing and roll process
        this.performRoll(modifiedExpression, modifiedDescription);
        
        console.log('✅ quickRoll completed');
    }
    
    applyGrailRollModifier(expression, modifier) {
        console.log('🎲 applyGrailRollModifier called:', { expression, modifier });
        
        try {
            switch (modifier) {
                case 'advantage':
                    // Convert any d20 roll to advantage
                    console.log('🎯 Checking advantage for:', expression);
                    if (expression.match(/\b\d*d20\b/)) {
                        const result = expression.replace(/\b(\d*)d20\b/, (match, count) => {
                            const diceCount = parseInt(count || '1');
                            const doubleDice = diceCount * 2;
                            const replacement = `${doubleDice}d20kh${diceCount}`;
                            console.log(`🔄 Replacing "${match}" with "${replacement}" in "${expression}"`);
                            return replacement;
                        });
                        console.log('✅ Advantage applied:', expression, '→', result);
                        return result;
                    }
                    console.log('⚠️ No d20 found in expression for advantage');
                    return expression;
                case 'disadvantage':
                    // Convert any d20 roll to disadvantage
                    console.log('🎯 Checking disadvantage for:', expression);
                    if (expression.match(/\b\d*d20\b/)) {
                        const result = expression.replace(/\b(\d*)d20\b/, (match, count) => {
                            const diceCount = parseInt(count || '1');
                            const doubleDice = diceCount * 2;
                            const replacement = `${doubleDice}d20kl${diceCount}`;
                            console.log(`🔄 Replacing "${match}" with "${replacement}" in "${expression}"`);
                            return replacement;
                        });
                        console.log('✅ Disadvantage applied:', expression, '→', result);
                        return result;
                    }
                    console.log('⚠️ No d20 found in expression for disadvantage');
                    return expression;
                case 'plus1':
                    return expression + '+1';
                case 'plus2':
                    return expression + '+2';
                case 'plus3':
                    return expression + '+3';
                case 'minus1':
                    return expression + '-1';
                case 'minus2':
                    return expression + '-2';
            case 'reroll_d20':
                // Reroll 1s only on d20 rolls
                console.log('🎯 Checking reroll d20 1s for:', expression);
                if (expression.match(/\b\d*d20\b/)) {
                    const result = expression.replace(/\b(\d*)d20\b/, (match, count) => {
                        const diceCount = count || '1';
                        return `${diceCount}d20r1`;
                    });
                    console.log('✅ Reroll d20 1s applied:', expression, '→', result);
                    return result;
                }
                console.log('⚠️ No d20 found for reroll d20 1s');
                return expression;
            case 'reroll_all':
                // Reroll 1s on all dice
                console.log('🎯 Applying reroll all 1s to:', expression);
                const result = expression.replace(/\b(\d*)d(\d+)\b/g, (match, count, sides) => {
                    const diceCount = count || '1';
                    return `${diceCount}d${sides}r1`;
                });
                console.log('✅ Reroll all 1s applied:', expression, '→', result);
                return result;
            default:
                console.log('⚠️ Unknown modifier:', modifier);
                return expression;
            }
        } catch (error) {
            console.error('❌ Error in applyGrailRollModifier:', error);
            return expression;
        }
    }
    
    applyGrailDamageModifier(damage, modifier) {
        switch (modifier) {
            case 'plus1':
                return damage + 1;
            case 'plus2':
                return damage + 2;
            case 'plus3':
                return damage + 3;
            case 'double':
                return damage * 2;
            case 'maxdamage':
                // This would require knowing the dice formula, simplified for now
                return damage * 1.5; // Rough approximation
            default:
                return damage;
        }
    }
    
    isDamageRoll(expression) {
        // Simple check - could be more sophisticated
        const damagePatterns = ['damage', 'dmg', 'd6', 'd8', 'd10', 'd12'];
        const lowerExpression = expression.toLowerCase();
        return damagePatterns.some(pattern => lowerExpression.includes(pattern));
    }
}

const game = new DnDMap();

// Make game globally accessible and add debugging
window.game = game;
console.log('🌍 Game object created and assigned to window.game:', !!window.game);
console.log('🎲 quickRoll method exists:', typeof game.quickRoll === 'function');

// Test function to verify onclick works
window.testQuickRoll = function(expression) {
    console.log('🧪 Test quick roll called with:', expression);
    if (window.game && typeof window.game.quickRoll === 'function') {
        console.log('✅ Calling game.quickRoll');
        window.game.quickRoll(expression);
    } else {
        console.error('❌ game.quickRoll not available');
    }
};

// Global error handler to catch uncaught errors
window.addEventListener('error', function(event) {
    console.error('🚨 UNCAUGHT ERROR:', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error
    });
});

window.addEventListener('unhandledrejection', function(event) {
    console.error('🚨 UNHANDLED PROMISE REJECTION:', event.reason);
});